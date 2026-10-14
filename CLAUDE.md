# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Sun Reader** is a desktop e-book reader built with **Electron 28 + React 18 + TypeScript + Vite + Tailwind CSS** (shadcn-style UI components). It supports EPUB and TXT for full reading; PDF, MOBI, AZW3 are recognized on import but reading them shows a friendly "not yet supported" notice.

## Common Commands

### Development
```bash
pnpm install           # Install dependencies
pnpm run dev           # Vite dev server (port 5173) + Electron with DevTools open
pnpm start             # Start Electron normally (loads dist/index.html — run a build first)
npx tsc --noEmit       # Type-check
pnpm test              # Run unit tests once (vitest)
pnpm run test:watch    # Watch mode
```

### Testing (Vitest 2 — pinned to match Vite 5)

Config in `vitest.config.ts` (node environment). Tests live in top-level `tests/`, outside `tsconfig.json`'s `include` so app type-checking stays clean:

- `tests/main/epub-parser.test.js` — builds fixture EPUBs in-memory with adm-zip and covers spine-ordered parsing, entity decoding, failure modes, and the three-tier cover-location strategy.
- `tests/renderer/utils.test.ts` — pure helpers from `src/renderer/src/lib/utils.ts` (`cn`, throttle/debounce with fake timers, formatters, deepClone, naming utils…).
- `tests/renderer/font-stacks.test.ts` — every built-in font stack and every `resolveFontFamily` output must parse as a valid CSS `font-family` value (unquoted multi-word names are silently dropped by the browser — see the font-family note below).
- `tests/renderer/pagination-jump.test.ts` — the two pure helpers behind 批注/搜索跳转: `columnIndexAt` (坐标 → 列号，floor 而非 round) and `trimRangeWhitespace` (划线区间挤掉两端空白). Both pin real jump-to-cover incidents; see the jump-positioning note under 分页.

> Vitest major must stay compatible with the project's Vite major: Vite 5 ↔ Vitest 2 (Vitest 4 crashes with `ERR_PACKAGE_PATH_NOT_EXPORTED vite/module-runner`).

`pnpm run dev` starts both processes via `concurrently`. Electron waits/retries for the Vite server (`--dev` flag switches main.js to load `http://localhost:5173`; without it, it loads the production bundle `dist/index.html`).

> **pnpm 11 note:** dependency build scripts are blocked by default. `pnpm-workspace.yaml` already allows `electron` and `esbuild` via `allowBuilds`. If install fails with `ERR_PNPM_IGNORED_BUILDS`, add the package there.

### Building (uses electron-builder)
```bash
pnpm run build:win     # Windows (NSIS + Portable)
pnpm run build:mac     # macOS (DMG)
pnpm run build:linux   # Linux (AppImage + DEB)
```

## Architecture

Single Electron window whose renderer is a React SPA. Two layers talk only through IPC. The repo follows an **electron-vite-style layout** — everything lives under `src/`, split by runtime:

```
src/
├── main/                  # Electron 主进程（Node 环境，不经 Vite 打包）
│   ├── index.js           # 窗口/菜单/IPC/导入（package.json "main" 指向这里）
│   └── epub-parser.js     # EPUB → 结构化章节文本 + 封面抽取
├── preload/
│   └── index.js           # contextBridge 安全暴露 window.electronAPI
└── renderer/              # Vite root（vite.config.ts 里 root: 'src/renderer'）
    ├── index.html         # 渲染层入口（开发: localhost:5173 / 生产: dist/index.html）
    └── src/               # React 源码
        ├── pages/        LibraryPage / ReaderPage / SettingsPage
        ├── components/   layout/, reader/, ui/ (shadcn-style), ErrorBoundary
        ├── hooks/        useBooks.ts (react-query), useColumnPagination.ts
        ├── stores/       zustand: app / library / reader state
        └── lib/          types.ts, constants.ts, utils.ts
```

- **Entry**: `"main": "src/main/index.js"` is the Electron entry; `src/renderer/index.html` is the Vite entry (`root` option in vite.config.ts points there; build output goes back to project-root `dist/`).
- **Routing**: `HashRouter` — `/` library, `/reader/:bookId` reader, `/settings` settings; unknown paths redirect to `/`.
- **Legacy files**: `.backup/` holds the original plain-HTML app in full (index/read/immersive/dual-page.html + old app.js/styles.css/main.js/preload.js/package.json, plus stale root copies `app-root-copy.js`/`styles-root-copy.css`) — treat as UI reference material only, nothing loads it.
- **Packaging**: electron-builder config lives in package.json `"build"`. Its `files` list ships `src/main/**`, `src/preload/**`, `dist/**` — add any new root-level runtime file dependency of the main process there explicitly.
- **Path anchors**: main-process code resolves assets relative to `__dirname` (e.g. `../../dist`, `../preload`); renderer alias `@` → `src/renderer/src`; tailwind content globs are anchored via `__dirname`.

### Main process (src/main/index.js)

Window management, native menu, book import dialog, and **18 IPC handlers**:
book CRUD (`get-books`, `get-book`, `import-books`, `delete-book`), reading (`update-progress`, `read-book-content`, `get-book-path`, `get-book-cover`), annotations (`add-bookmark`, `remove-bookmark`, `add-note`, `remove-note`), utilities (`show-open-dialog`, `get-config`, `open-external`, `list-system-fonts`, `set-native-theme`, `window-control`).

After an import the main process broadcasts `books-imported` to the renderer; it no longer shows a native success dialog (the renderer toast covers that).

### EPUB handling (src/main/epub-parser.js)

EPUB parsing has two reads: **import** and **reading**.
- **Import** (`parseEpub`): extracts package metadata + a `blocks`/`paragraphs` representation used for the title/author/totalPages enrichment and legacy path (it is no longer what the reader renders, but its tests still pin the conversion logic).
- **Reading** (`openEpubReading`): returns the **original spine XHTML** per chapter (`{ title, href, xhtml }`, `href` = full zip path) plus package meta. XML entities (`decodeEntities`) are decoded and OPF paths resolved via `resolveZipPath`. `readEpubResource(filePath, zipPath)` serves any zip-inside resource (CSS/image/font/other XHTML) for the renderer's `bookres://` protocol; the AdmZip instance is cached per file path and released by `dropEpubCache` on book delete. **No CSS-specific parsing** — the goal is to render with the book's own styles, not to re-derive them.

Chapter titles come only from the book's own TOC document (EPUB2 `toc.ncx` navLabels / EPUB3 `nav epub:type="toc"`, located via spine@toc → ncx media-type → properties="nav"), keyed by full zip path. Chapters not present in the TOC get an **empty title** — no synthetic names are ever generated. XHTML-internal `<title>`/`<h1>` stay as body content but never become chapter names.

Cover images are extracted by locating, in order: EPUB3 `properties="cover-image"` → EPUB2 `<meta name="cover">` → filename `cover.*`. Import also enriches title/author from OPF metadata and estimates totalPages from character count (**a placeholder only** — the reader overwrites it with the measured page count on the first progress save; see the page-count note under 阅读视图). Books imported before this enrichment keep `author: "未知作者"` and no cover until re-imported (or until `get-book-cover` lazily backfills just the cover image).

### EPUB in the reader — original-CSS rendering (bookres://)

The reader renders EPUB as the **original XHTML + original CSS** rather than stripped text. A custom `bookres://<bookId>/<zipPath>` protocol (registered in the main process before `app.whenReady`; serves zip resources with a content-type map, never serving JS) lets the renderer `fetch()` the book's CSS/images/fonts. The renderer pipeline (`lib/epub.ts`):

1. `prepareChapterHtml` (**one** DOMParser pass per chapter, returns `PreparedChapter` = `{ html, text, imageCount, cssHrefs, inlineCss }` — the caller must not re-parse the XHTML to find styles) sanitizes each spine XHTML's body: removes script/style/link/form/iframe/object/embed and all `on*` attributes and `javascript:` URLs; **strips `font-family` from any element `style` attribute** (the last possible way a book can impose its font); rewrites image/svg/media `src`/`srcset` to `bookres://` (+ `loading="lazy"`); rewrites `<a href>` into `data-book-link` (internal, resolved to a full zip path) or `data-external-href` (http/mailto), removing the real href so nothing navigates away. `cssHrefs` are the chapter's `<link rel=stylesheet>` paths already resolved against the chapter's directory, `inlineCss` its raw `<style>` text (both collected **before** sanitizing strips those tags), and `imageCount` counts `<img>` + svg `<image>` (used for the duplicate-cover rule below). Inline `<img>` clicks bubble to ReaderPage's content click handler, which opens a **full-image lightbox** (bottom of the click priority: img → lightbox, `a[data-book-link]` → chapter jump, `a[data-external-href]` → system browser).
2. Each chapter's `<link rel=stylesheet>` and inline `<style>` are **fetched via bookres://**, **`font-family` declarations stripped** (`stripFontFamily`, so the book's `.calibre{font-family:...}` class rules can't beat the user-selected reading font) and **`overflow:hidden` rewritten to `visible`** (`stripOverflowHidden`, in `lib/epub.ts`, also applied to element `style` attributes in `prepareChapterHtml`; `auto/scroll` are kept so code blocks still scroll horizontally), then scoped: `<link>` stylesheets are **deduped by href and scoped ONCE** to `#book-flow .epub-chapter[data-chidx]` (matches any chapter — avoids duplicating the whole book CSS per chapter, which for 100-chapter books ballooned to tens of thousands of rules and slowed all style recalcs/click responses); per-chapter inline `<style>` blocks are scoped to their own `[data-chidx="n"]` so a `body{...}` rule from one chapter (e.g. the cover page's `text-align:center`) cannot leak onto the whole book. `@media/@supports/@layer` recursion is handled, `@font-face` left intact. Relative `url()`s in CSS are rewritten to `bookres://`. Chapter build is **6-way concurrent**, and each batch ends with a `setTimeout(0)` yield — once the stylesheets are cached the loop is pure microtasks, React never gets scheduled, and the "正在解析本书排版… n/total 章" progress would never repaint on a 100+ chapter book.
   > **Why `stripOverflowHidden` exists (don't remove):** Chromium's multicol fragmentation does not slice boxes with non-visible `overflow` properly. DDIA wraps every chapter in `.section{overflow:hidden}` (calibre's clearfix) — the whole book rendered **one column per chapter**, and everything that didn't fit piled vertically into the last column, clipped (measured: 127 columns / content stacked 21,000px deep vs **1,147–1,741 columns** after the rewrite; the "第x章" link line at the part page straddled the column bottom and was half-clipped when enlarging font). `hidden` in reflowable EPUB CSS is just a float-clearfix leftover; making it `visible` restores column fragmentation — floats at worst leak within their own column since every chapter force-breaks to a new one. `overflow:hidden` also causes line-boxes straddling a column boundary to stay in place and get clipped instead of moving to the next column (the 放大字体后下方文字被裁 bug). Residual out-of-bounds rects (≈0.1–0.3% at large fonts) live inside `overflow:auto` code blocks / `<details>`, accepted trade-off.
3. ReaderPage builds `content` = optional cover page + each chapter as `<section data-chidx data-anchor class="epub-chapter"><style>{inlineBookCss}</style><div class="epub-body" dangerouslySetInnerHTML>`; each chapter starts a new page (`break-before: column`). One global `<style>` carries the deduped shared book CSS, one carries the **reader-typography fallback** (`readerTypographyCss`: `#book-flow, #book-flow * { font-family: user !important }` + mono override for code — total coverage, since every book font source is stripped upstream), one carries the highlight pseudos. `loadReaderPrefs`/`resolveFontFamily` normalize stale stored names (strip trailing " Regular"). **Progress anchoring**: every text anchor element carries `data-anchor` (TXT = pidx, EPUB = chidx); `useColumnPagination` captures the anchor of the current window start (`captureAnchor`) on every page change/measure and restores position **by content anchor** on re-layout (font-size/window changes) instead of by ratio; `PagerHandle.getAnchor()` feeds `update-progress` which persists `book.readingAnchor`, and opening a book passes `initialAnchor` (element-level restore, preferred over percent). Images: `break-inside: avoid` on `img/svg/figure` + single-image paragraphs (`:has(> img:only-child)`) get `display:block; margin:auto` so a figure that doesn't fit moves to the next page; `max-height: calc(var(--col-h, 70vh) - 4.5em)` scales images to the **measured column height** (`--col-h` is set by `useColumnPagination.measure` on the content element — a taller-than-column image in multicol has nowhere to go and gets clipped, so it must be clamped to the real column height); clicking any image shows the full-size lightbox; `table/td/th { max-width:100% !important }` stops wide tables overflowing.
4. **Clickable TOC/links**: the book's own internal links are intercepted by `handleBookLinkClick` → jump to the chapter whose zip path matches (`goToElement('[data-chidx=n]')`) or open external URLs in the system browser.
5. **Underlines/notes** (`type:'underline'`, `chidx`/`start`/`end`) map to the **whole chapter's text** (`Range.toString()` offsets, so any inner HTML structure works) and render via the **CSS Custom Highlight API** — `collectTextRanges` builds static `Range`s per color and registers `::highlight(note-hl-*)` rules (dynamic; colors come from `ANNOTATION_COLORS`). TXT keeps the old span-segmentation path.
6. **Duplicate cover suppression**: calibre-style EPUBs ship their own image-only cover as spine item 0 (`titlepage.xhtml`, typically `<svg preserveAspectRatio="none"><image/></svg>` — which also renders *stretched*). The reader already prepends its own `.reader-cover-page` from the extracted cover, so the two appear back to back as **two cover images on the first screen**. `duplicateCoverChidx` detects it — chapter 0, no text, `imageCount >= 1`, and an extracted `coverUrl` exists — and renders that section as an empty `display:none` placeholder. Keep the placeholder: dropping the `<section data-chidx="0">` entirely would renumber nothing but would break `[data-chidx="0"]` jump selectors, and `display:none` generates no column so no blank page appears. With no extracted cover the book's own page is kept as the cover.

TXT remains on the text-block pipeline. The reader detects format with the reader-state flag; `PagerHandle` exposes `next/prev/goToElement/goToTextOffset/goToPercent` (TXT jumps use `[data-pidx]`, EPUB uses `[data-chidx]`); bookmarks jump by percent; in-content TOC links and the app's 目录 popup both land on chapters.

### Renderer data flow

All book data flows through react-query with key `['books']` (see `src/renderer/src/hooks/useBooks.ts`). Mutations invalidate it; the `books-imported` broadcast invalidates it too. Reader progress writes go through `update-progress` IPC and additionally patch the `['books']` cache via `setQueryData` so the library view updates instantly on back-navigation. Covers use per-book queries (`['cover', id]`, staleTime Infinity) returning data URLs.

Reader preferences (fontSize, lineHeight, fontFamily) persist in localStorage key `sun-reader-settings` through the shared module `lib/prefs.ts` (`loadReaderPrefs`/`saveReaderPrefs`/`resolveFontFamily`/`quoteFontFamily`/`isFontFamilyAvailable`/`healStoredFontFamily`) used by both ReaderPage and SettingsPage's 阅读设置 card — never write that key with a partial object (it would drop the other fields). Note that dev and production are **different localStorage origins** (`http://localhost:5173` vs `file://`), so settings made in `pnpm run dev` do not appear in the built app and vice versa. `fontFamily` holds either a `FONT_FAMILIES` key (serif/sans/mono) or a **system font family name**: the SettingsPage font picker (`components/font-picker.tsx` + `hooks/useSystemFonts.ts`) enumerates installed fonts primarily via the `list-system-fonts` IPC because Electron does not expose Chromium's `navigator.queryLocalFonts` by default — that API stays as a renderer-side fallback only. On Windows the main process resolves each registry font entry's **file** and parses its OpenType `name` table (`readFontFamilyNames`: nameID 1/16, UTF-16BE, TTC collections) for the family names CSS/DirectWrite actually matches — registry value names are install-time display names and may differ (e.g. `霞鹜文楷等宽 屏幕阅读版 Regular` ↔ real families `LXGW WenKai Mono Screen` / `霞鹜文楷等宽 屏幕阅读版`); the value-name heuristic (OEM-codepage decode, style-variant collapsing, trailing-"Regular" strip) remains as fallback when the file can't be read. The IPC also returns `aliases` (per-file family-name groups) which `healStoredFontFamily` uses — when a stored name can't be matched, ReaderPage/SettingsPage self-heal it to a matching alias that Chromium can resolve. Availability is probed with **canvas text-width comparison** against the three generics (`isFontFamilyAvailable`): `document.fonts.check` is unusable for this — per spec it only reports on the document's `FontFaceSet`, so it returns `true` for *every* name, including `'Zzz No Such Font'` (verified in Electron). A name that fails the probe is still kept at the front of the stack (the probe can have false negatives; CSS falls back on its own) and the picker marks it 「未匹配」. Linux `fc-list`, macOS font-dir scan. The picker offers search and self-previewing options; `resolveFontFamily` turns a system name into `'<name>', <serif stack>` so missing glyphs fall back.

> **font-family values must quote every multi-word family name** (`FONT_FAMILIES`/`READER_MONO_FAMILY` in `lib/constants.ts`, `tailwind.config.js`, and `resolveFontFamily`'s output via `quoteFontFamily`). An unquoted value is parsed as a sequence of CSS *identifiers*, and `Source Serif 4` contains `4`, which is not a valid identifier → **the whole declaration is invalid and silently dropped**. Because that stack is appended to every user-selected font, one bad token made *every* font setting a no-op: the reader inherited Tailwind's `html` sans stack and all CJK rendered as Microsoft YaHei, with no error anywhere. `tests/renderer/font-stacks.test.ts` guards this.

Theme lives in `sun-reader-theme` (managed by `ThemeProvider`, which toggles classes on `<html>`: light/dark — token definitions live in `src/renderer/src/index.css`; legacy stored 'sepia' falls back to the default theme).

## Data Storage

User data lives in `~/.sunreader/` (hidden dot-directory under the OS home; see `APP_CONFIG.rootDir` in `src/main/index.js`):

```
~/.sunreader/
├── Books/{bookId}/     # Imported book files (one folder per book)
├── Covers/{bookId}.ext # Extracted EPUB cover images (cache)
├── library.json        # Book metadata, progress, bookmarks, notes
└── settings.json       # Window size/position (written by main.js on close)
```

> Renamed from the old visible `~/SunReader/` (which also had a vestigial empty `Data/` subfolder) to `~/.sunreader/`; existing data was migrated by moving the folder. If another machine still has old data, rename its `~/SunReader` to `~/.sunreader` manually before launching.

## IPC Communication

Renderer access via `window.electronAPI` (exposed by preload.js with context isolation):

```javascript
const books = await window.electronAPI.books.getAll();
await window.electronAPI.books.updateProgress(bookId, 67, 120, anchor, 240); // pct, currentPage, 锚点, 实测总页数
await window.electronAPI.covers.get(bookId);          // { success, dataUrl }
await window.electronAPI.bookmarks.add({ bookId, position, chapter });
const res = await window.electronAPI.books.readContent(bookId);
// res.format 'txt' → res.content (plain text)
// res.format 'epub' → res.chapters [{ title, href(zip 完整路径), xhtml }] + meta
```

TypeScript declarations for the full bridge live in `src/renderer/src/lib/types.ts` (`ElectAPI` interface + global `window.electronAPI`). When adding an IPC handler, update all three places: main-process handler (`src/main/index.js`), exposure (`src/preload/index.js`), declaration (`types.ts`).

## Key Implementation Details

### Reading view (ReaderPage)

A single fullscreen **dual-page view** (`DualPageView.tsx`; the former standard/immersive modes were removed). Text flows through **CSS multi-column pagination** (`useColumnPagination`: two fixed-height columns per spread, `translateX` turns pages — no scrollbars; window resize/font changes re-flow and keep reading position proportionally). No page header/footer/progress bar: a floating **dock toolbar** (auto-hides after 2.6s idle) carries exit-reader, page prev/next, font size ±, theme cycle, search, bookmark toggle, plus popup entries for 目录/书签/我的批注 (`reader-modals.tsx` — TocModal/BookmarksModal/NotesModal), with a permanent one-line progress caption at the bottom centre. The book card uses the `--reader-page` theme token (`.reader-page-surface`) so the reading surface is visually distinct from the app background. ReaderPage assembles the `content` node for the two formats:

- **EPUB**: original-CSS rendering (see the EPUB-in-the-reader section) — cover page (`.reader-cover-page`) + per-chapter `<section data-chidx class="epub-chapter">` with sanitized book XHTML and scoped book CSS injected via a `<style>`; each chapter starts a fresh page. A book's own image-only cover page is suppressed so the first screen shows one cover, not two (`duplicateCoverChidx`).
- **TXT**: the text-block pipeline (`ReaderBlock`: title | heading | para | pre) — chapter titles bold via `.reader-chapter-title` (force a fresh page), in-content headings bold via `.reader-heading` scaled by level, `pre` blocks via `.reader-code-block` (monospace, preserved newlines, no link parsing), paragraphs through `lib/richtext.tsx` (`renderInlineMarkup`).

`PagerHandle` exposes `next/prev/goToElement/goToTextOffset/goToPercent/getAnchor/getPageInfo`: TOC jumps measure `[data-pidx]`/`[data-chidx]` offsetLeft, in-content links and notes use chapter text offsets, bookmarks/legacy notes jump by percent, `getPageInfo` feeds the persisted page numbers (see below). Esc closes popups first, then exits the reader to the library (progress is flushed before navigating). TXT TOC comes from regex chapter headings (第X章 etc.); EPUB TOC from section boundaries.

While the chapters are still being built the page shows a determinate `正在解析本书排版… n/total 章` (bare `正在打开…` before the first batch). This is normal for large books and **not** special-casing: measured on real books, 《数据密集型应用系统设计》 (8 MB, 127 chapters, 1.2 M chars) spends ipc 61 ms + chapter build 213 ms + React render & **multicol layout** — ~1.3 s when it only laid out ~95 000 px of columns (the pre-`stripOverflowHidden` broken state), and the footer still appears within ≈2 s after the fix expanded it to ~1.3 M px / 1,700+ columns of real pagination — while 《窄门》 (200 KB, 24 chapters) totals ~300 ms — the spinner is there for both, just imperceptible on small books. The dominant cost is column layout, not parsing, so optimizing the parser buys nothing.

#### Page counts — one definition only ("页" = one column)

The library and the reader must never invent their own page numbers. `useColumnPagination` measures the real column count and is the single source of truth: **one column = one page**, so a dual-page spread is two pages. It exposes `pages` (measured total) and `getPageInfo(): { spread, spreads, pages, firstPage }` on `PagerHandle`; `pages === 0` means "not measured yet", and callers must not write that to disk. DualPageView's footer renders `第 x - y 页 · 共 {pages} 页 · n%` from it, and `saveProgress` sends the same `firstPage`/`pages` through `update-progress` (5th arg `totalPages`), which the main process stores on the book — so the library's 继续阅读 card ("剩余 totalPages − currentPage 页") and 累计阅读 stat agree with the reader by construction.

Import's `Math.ceil(chars / 1000)` estimate is only a placeholder until the book is first opened, and it is *far* off in both directions (measured: 《数据密集型》 estimate 507 → real ≈850 at default font; 《窄门》 estimate 67 → real 145). Reading the estimate in one place and the measured count in another is what produced the "书库 剩余 499 页 vs 阅读页 共 128 页" mismatch — as did the old footer's `total * 2` (spreads × 2 overcounts by one whenever the last spread holds a single column). The measured total legitimately changes with font size/window size; the stored value describes the layout of the last read session.

#### Jump positioning (`goToTextOffset` / `columnIndexAt`) — two real bugs, don't reintroduce

- **Zero rects are real.** Whitespace-only text nodes (the `"\n"`/indent between block elements) generate **no layout box**, so a `Range` inside one returns an all-zero `DOMRect` — and browsers routinely place a drag-selection's start on exactly such a node. The old `rect.left || ctRect.left` fallback treated that legitimate `0` as "missing" and mapped every such note to column 0, i.e. **the cover** (this was the 《数据密集型》 三条批注全跳封面 bug; 《窄门》 only worked because its offset happened to land mid-text). `firstRealRect` now takes the first `getClientRects()` entry with non-zero area, `goToTextOffset` walks forward to the next text node with real geometry, and the last-resort fallback is the chapter's own `offsetLeft` — never a silent 0. Complementary fix on the creation side: `trimRangeWhitespace` (`lib/selection.ts`) pushes stored `start`/`end` onto visible characters and rejects all-whitespace selections.
- **Column index uses `floor`, not `round`.** With colW 675 + gap 72, `Math.round` assigns the back half of a column to the *next* column (x=1300 → 2 instead of 1), which in dual-page mode is a whole spread off. `columnIndexAt(x, colW) = floor((x + 1) / (colW + GAP))`; the `+1` only absorbs sub-pixel error at a column's left edge. All three call sites (`goToElement`, `goToTextOffset`, `anchorColIndex`) share it.
- `rect.left - ctRect.left` is already the content-flow coordinate (both are post-`translateX` screen coords, so the transform cancels). Do **not** add the current offset back — that makes jump targets drift with the current page.
- Both helpers are exported and unit-tested in `tests/renderer/pagination-jump.test.ts`.

### Annotations, underlines & bookmarks

Selecting text in the article shows an action popup (color swatches + 划线 + 批注): 划线 persists an `underline` note (same-anchor selections only — TXT same-paragraph, EPUB same-chapter; cross-anchor selections degrade to comment-only), 批注 opens a comment modal. Stored offsets always run through `trimRangeWhitespace` first so `start` sits on a visible character (see the jump-positioning note above — a whitespace start offset used to send jumps to the cover); an all-whitespace selection is rejected. Notes carry optional `pidx`/`start`/`end` (TXT paragraph-level) or `chidx`/`start`/`end` (EPUB chapter-level, offsets over the chapter's whole text) — TXT re-renders as colored `<span>`s (`lib/selection.ts`: `getSelectionRange` → paragraph offsets; `segmentParagraph` merges/slices), EPUB renders via the CSS Custom Highlight API (`collectTextRanges` + `::highlight(note-hl-*)`). Old notes without these fields stay list-only. Bookmarks store `{ position (percent), chapter }` and appear in the BookmarksModal and the library's stats panel.

### Theme System

Two themes (light/dark) as CSS variable sets under `.light`/`.dark` classes on `<html>` (see `src/renderer/src/index.css`). Cycle button order: light → dark.

### Window caption vs. theme (titleBarStyle:'hidden')

Windows/macOS 用 `titleBarStyle: 'hidden'`（`CUSTOM_CAPTION = process.platform !== 'linux'`）：原生标题栏被隐藏后 caption 区是**透明**的，露出页面背景，于是标题栏颜色天然等于 `index.css` 的 `--background`，与主题完全一致 —— 这是本项目标题栏配色的全部机制，**不要改回 `'default'**（那会让 caption 回到系统色，和主题两张皮）。Linux 保留 `'default'`：隐藏标题栏会把最小化/最大化/关闭一起丢掉，用户就无法关窗/移动窗口。

三件事必须成套维护，少一个就残：

1. **`set-native-theme` IPC**（`theme-provider.tsx` 的主题 effect → 主进程）。caption 上的最小化/最大化/关闭由 **OS 绘制，不吃 CSS 主题**，只设 `nativeTheme.themeSource` 才能让它们跟着反色 —— 深色主题下漏了这一步就是深底深字，完全看不出来（实测：Win10 19044 上 `themeSource='dark'` 会开 DWM immersive dark mode，标题栏和字形一起变深/变亮）。同一个 handler 里 `mainWindow.setBackgroundColor()` 管窗口底色（标题栏透明区透出的就是它）。
2. **背景色由渲染层传 `getComputedStyle(document.body).backgroundColor`**，主进程不硬编码 hex —— 唯一来源是 `--background`，改主题色不会漂移。主进程把 `theme` + `windowBackgroundColor` 落进 `settings.json`，冷启动建窗时直接读（`DEFAULT_WINDOW_BG` 只是首次运行的兜底色），否则深色主题每次开屏先闪一下浅色标题栏。
3. **拖拽区与顶部让位**（`hasCustomCaption()` 门控，Linux 全部不渲染）。原生标题栏没了窗口就只能靠 `-webkit-app-region: drag` 移动：`Layout.tsx` 里一条 `fixed top-0 inset-x-0 h-8 z-[1100]` 的 `.titlebar-drag` 条（z 值盖住阅读页的 z-1000、低于各弹窗的 z-1200+）。drag 区会吞掉该区域的鼠标事件，所以内容必须让开这块 32px：`main` 加 `pt-2`、`Sidebar` 品牌块加 `pt-14`（macOS 左上角红绿灯约 44px 高，必须避开）、`DualPageView` 的左右翻页热区从 `top-0` 改成 `top-8`（否则点阅读页角落会拖动窗口而不是翻页）。

#### Windows 上必须自己画窗口按钮（`WindowControls.tsx`）

**Win10 上 `titleBarStyle:'hidden'` 不画原生三键。** 实测窗口样式位：`'default'` → `0x16CF0000`（含 `WS_SYSMENU`，三键正常）；`'hidden'` → `0x14C70000`，**`WS_SYSMENU` 被一起去掉**，没有系统菜单 Windows 就不画最小化/最大化/关闭，连点击都没有。`titleBarOverlay` 只对 Win11 有效，Win10 完全不认。所以 `CUSTOM_CAPTION` 打开时，Windows 必须由渲染层自己画这三个按钮（`components/layout/WindowControls.tsx`，`needsCustomWindowControls()` = `platform === 'win32'` 门控）再走 `window-control` IPC 调 `minimize/unmaximize/maximize/close`。macOS 的红绿灯由系统保留、Linux 用原生边框，两边都不渲染。

画按钮时有三个坑，都是实测踩过的：

- **必须加 `.titlebar-no-drag`**（`-webkit-app-region: no-drag`）。按钮和拖拽条是顶部同一条 32px 带上的兄弟元素，不加的话 drag 区会把鼠标事件吞掉 —— 按钮画得出来、`elementFromPoint` 也命中，但真实点击毫无反应（`DOM.click()` 却正常，因为绕过 OS 输入）。
- **图标状态要靠主进程推**：`maximize/unmaximize` 事件里 `webContents.send('window-state', {maximized})`（preload 的 `on()` 白名单要加这个通道）。只在前端点击后本地切换是不够的 —— 用户拖拽到屏幕顶端或双击拖拽区也会最大化，图标会停在错误的一档。
- **`titleBarStyle:'hidden'` 会把 OS 窗口文本清空**（`GetWindowText` 返回 `''`，而 `'default'` 下是 `'Sun Reader'`），任务栏悬停提示和 Alt+Tab 就什么都不显示。用 `page-title-updated` 里 `event.preventDefault()` + `setTitle()` 写回。
