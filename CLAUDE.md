# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Sun Reader** is a desktop e-book reader application built with Electron. It supports EPUB, PDF, TXT, MOBI, and AZW3 formats with multiple reading modes.

## Common Commands

### Development
```bash
pnpm install           # Install dependencies
pnpm run dev           # Start with DevTools open
pnpm start             # Start normally
```

### Building (uses electron-builder)
```bash
pnpm run build:win     # Windows (NSIS + Portable)
pnpm run build:mac     # macOS (DMG)
pnpm run build:linux   # Linux (AppImage + DEB)
```

## Architecture

### Core Files
- **main.js** (501 lines) - Electron main process. Window management, file import dialogs, book parsing, IPC handlers for 17 endpoints.
- **preload.js** (65 lines) - Secure IPC bridge exposing `window.electronAPI` with context isolation.
- **app.js** (799 lines) - Frontend logic: theme switching, font sizing, progress tracking, search, annotations.
- **styles.css** (1,397 lines) - Complete stylesheet with CSS variables for light/dark/sepia themes.

### HTML Views
- **index.html** - Library view with book grid, statistics, continue reading card.
- **read.html** - Standard reading view with sidebar, TOC, progress bar.
- **immersive.html** - Minimal reading mode with floating toolbar.
- **dual-page.html** - Book-like dual-page layout with spine.

### Data Storage
User data in `~/SunReader/`:
```
~/SunReader/
├── Books/              # Imported book files (by book ID)
└── Data/
    ├── library.json    # Book metadata, reading progress, bookmarks
    └── settings.json   # User preferences, window state
```

### IPC Communication
Main process handlers in main.js:
- Book operations: `get-books`, `get-book`, `import-books`, `delete-book`
- Reading: `update-progress`, `read-book-content`, `get-book-path`
- Utilities: `show-open-dialog`, `get-config`, `open-external`

Renderer access via `window.electronAPI`:
```javascript
const books = await window.electronAPI.books.getAll();
await window.electronAPI.books.updateProgress(bookId, 67, 120);
```

## Key Implementation Details

### Theme System
Three themes via CSS variables: `light`, `dark`, `sepia`
- Applied via `body[data-theme]` attribute
- Colors defined in `:root` and theme-specific selectors
- Smooth transitions between themes

### Book Import Flow
1. Main process opens `dialog.showOpenDialog()`
2. Files copied to `~/SunReader/Books/{bookId}/`
3. Metadata extraction (title from filename, format detection)
4. Record saved to `library.json`
5. Renderer notified via IPC, UI refreshes

### Security Model
- Context isolation enabled (`contextIsolation: true`)
- Node integration disabled (`nodeIntegration: false`)
- All main-renderer communication via preload script's explicit API
- File system access restricted to `~/SunReader/` user data directory
