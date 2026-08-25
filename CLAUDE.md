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

Window management, native menu, book import dialog, and **15 IPC handlers**:
book CRUD (`get-books`, `get-book`, `import-books`, `delete-book`), reading (`update-progress`, `read-book-content`, `get-book-path`, `get-book-cover`), annotations (`add-bookmark`, `remove-bookmark`, `add-note`, `remove-note`), utilities (`show-open-dialog`, `get-config`, `open-external`).

After an import the main process broadcasts `books-imported` to the renderer; it no longer shows a native success dialog (the renderer toast covers that).

### EPUB handling (src/main/epub-parser.js)

EPUBs are parsed in the main process: container.xml → OPF manifest/spine → each spine XHTML stripped to plain-text paragraphs. Results are returned as structured chapters `{ title, paragraphs[] }` so the renderer's TXT pipeline (TOC, search, bookmarks, notes, immersive/dual modes, progress) works identically for both formats.

**Chapter titles come only from the book's own TOC document** (EPUB2 `toc.ncx` navLabels / EPUB3 `nav epub:type="toc"`, located via spine@toc → ncx media-type → properties="nav"). Chapters not present in the TOC get an **empty title** — no synthetic names are ever generated (no "Chapter N"/"章节 N" fallbacks), so the sidebar mirrors the source TOC exactly. The reader UI already handles empty titles gracefully: untitled sections are omitted from the TOC panel and render no separator heading, while the header indicator keeps showing the last titled chapter. XHTML-internal `<title>`/`<h1>` stay as body text but never become chapter names (many books misuse them for author names).

Cover images are extracted by locating, in order: EPUB3 `properties="cover-image"` → EPUB2 `<meta name="cover">` → filename `cover.*`. Import also enriches title/author from OPF metadata (dc:title/dc:creator) and estimates totalPages from character count.

Books imported before this enrichment keep `author: "未知作者"` and no cover until re-imported (or until `get-book-cover` lazily backfills just the cover image).

### Renderer data flow

All book data flows through react-query with key `['books']` (see `src/renderer/src/hooks/useBooks.ts`). Mutations invalidate it; the `books-imported` broadcast invalidates it too. Reader progress writes go through `update-progress` IPC and additionally patch the `['books']` cache via `setQueryData` so the library view updates instantly on back-navigation. Covers use per-book queries (`['cover', id]`, staleTime Infinity) returning data URLs.

Reader preferences (fontSize, lineHeight) persist in localStorage key `sun-reader-settings`; theme in `sun-reader-theme` (managed by `ThemeProvider`, which toggles classes on `<html>`: light/dark/sepia — token definitions live in `src/renderer/src/index.css`).

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
await window.electronAPI.books.updateProgress(bookId, 67, 120);
await window.electronAPI.covers.get(bookId);          // { success, dataUrl }
await window.electronAPI.bookmarks.add({ bookId, position, chapter });
const res = await window.electronAPI.books.readContent(bookId);
// res.format 'txt' → res.content (plain text)
// res.format 'epub' → res.chapters [{ title, paragraphs }]
```

TypeScript declarations for the full bridge live in `src/renderer/src/lib/types.ts` (`ElectAPI` interface + global `window.electronAPI`). When adding an IPC handler, update all three places: main-process handler (`src/main/index.js`), exposure (`src/preload/index.js`), declaration (`types.ts`).

## Key Implementation Details

### Reading views (ReaderPage)

Three switchable view modes sharing one paragraph pipeline. Immersive/dual use **CSS multi-column pagination** (`useColumnPagination`: text flows into fixed-height columns, `translateX` turns pages — no scrollbars; window resize/font changes re-flow and keep reading position proportionally):
- **standard**: header (back/title/chapter/progress/view-switcher) + scrollable article + right panel (目录/书签/我的批注) + footer toolbar (page prev/next, font size ±2 [right-click decreases], theme cycle, search, bookmark toggle)
- **immersive**: fullscreen single-column paging overlay, floating auto-hiding toolbar, edge click-zones + corner page indicator, Esc exits
- **dual**: fullscreen two-column spread filling the viewport, center gutter line, footer nav with spread/page counter

Keyboard is routed centrally in ReaderPage by viewMode: standard scrolls; immersive/dual drive the pager via refs (`PagerHandle`). Pager progress reports back `(page, total)` → percent → same save pipeline as scrolling. TXT TOC comes from regex chapter headings (第X章 etc.); EPUB TOC from section boundaries.

### Annotations & bookmarks

Text selection in the article shows an "添加批注" popup → color + comment modal → persisted into the book's `notes` array via IPC. Bookmarks store `{ position (percent), chapter }` and appear in the reader side panel and the library's stats panel.

### Theme System

Three themes (light/dark/sepia) as CSS variable sets under `.light`/`.dark`/`.sepia` classes on `<html>` (see `src/renderer/src/index.css`). Cycle button order: light → dark → sepia.
