# 🎮 Pellizzola Brothers (studio)

A desktop level designer for the Pellizzola Brothers platformer game. <br>
Authors `.lvl` archives containing block layouts, entities, scripts, and MIDI tracks — no build step, edit and relaunch.

![Electron](https://img.shields.io/badge/Electron-latest-47848F?logo=electron&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Monaco](https://img.shields.io/badge/Editor-Monaco-007ACC?logo=visualstudiocode&logoColor=white)
![Canvas API](https://img.shields.io/badge/Rendering-Canvas%202D-FF9900?logo=firefox&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-red)

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the App](#running-the-app)
- [Commands](#commands)
- [Architecture](#architecture)
- [The .lvl Format](#the-lvl-format)
- [Workflow](#workflow)
- [Known Limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🎨 **Visual level editor** — drag-and-drop placement of blocks, enemies, and collectibles on a zoomable grid canvas
- ⌨️ **Keyboard-operable** — full arrow-key navigation and paint/erase with no mouse required
- 📝 **Lua script editor** — Monaco (VS Code) integration for per-entity behavior scripts with syntax highlighting
- 🎹 **MIDI import/export** — attach and tweak background music for levels
- 🎯 **Undo/redo** — pixel-efficient history that stores diffs, not copies, for unbounded action history
- 📁 **File manager** — browse and manage scripts, MIDI, and entity definitions for the level
- 💾 **ZIP archives** — levels save as `.lvl` files with embedded scripts and media
- 🖥️ **Cross-platform** — macOS, Windows, and Linux via Electron and electron-builder

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop framework | Electron |
| UI/Canvas | Vanilla HTML/CSS/Canvas 2D — no frameworks |
| Script editor | Monaco Editor (VS Code engine) |
| File format | ZIP archives (fflate library) |
| Undo/redo | Custom pixel-efficient diff-based history |
| IPC | Electron's `ipcRenderer` ↔ `ipcMain` channels |
| Build | electron-builder (packaged, unsigned) |

## Project Structure

```
main.js              Electron main process — window, dialogs, IPC, filesystem
preload.js           contextBridge surface — renderer's only view outward
menu.js              Application menu — rebuilt on every state change
chrome.js            Platform-specific window chrome (macOS/Windows/Linux)
index.html           Markup and renderer script order
util.js              Helpers ($(), esc()) — loaded first, depended on by all
tokens.js            Reads design tokens from style.css into a plain object
catalog.js           Block IDs, entity defs, backgrounds, texture loading
lvl.js               .lvl file read/write and schema validation
undo.js              Undo/redo history with grid diff compression
grid.js              Canvas rendering, panning, viewport culling, edit gestures
panel.js             Palette (top right) and property inspector (bottom right)
layout.js            Splitter drag, keyboard navigation, persistence
code.js              Monaco editor host — one model per script
app.js               Document state, tabs, file manager, keyboard commands
style.css            Design tokens and component styles
settings.json        Default settings (grid overlay, palette size, etc.)
textures/            Git submodule — clone of github.com/pellizzola-brothers/textures
tools/
  check.js           Validation: collision grep, .lvl round trip, collision check
  probe.js           Headless test harness (no GUI) for driving the app via JS
build/
  icon.icns/.ico/.png   Application icon resources (from textures/characters/leandro.png)
  icons/             macOS/Windows icon sets
```

## Getting Started

### Prerequisites

- Node.js 18+
- Git (for textures submodule)
- Platform-specific build tools for native Electron modules (if building from source)

### Installation

```bash
git clone https://github.com/pellizzola-brothers/studio.git
cd studio
npm install    # also fetches the Electron binary on first run
```

### Running the App

```bash
npm start      # launches the Electron window
```

Edit and relaunch — there is no build step. Changes to any `.js`, `.css`, or `.html` file take effect after reopening the window.

## Commands

```bash
npm start              # Launch the app
npm run check          # Validate: collision grep, .lvl round trip, schema migration
npm run lint           # ESLint — tabs, 'use strict', no dead vars
npm run dist           # Build packaged app in dist/ (unsigned)
```

### Headless Testing

For automated testing or CI, run the app headless without a GUI:

```bash
PB_STEPS='[["h","JSON.stringify(Grid.h)"]]' PB_SHOT=/tmp/screenshot.png \
  ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tools/probe.js   # macOS
./node_modules/electron/dist/electron tools/probe.js                                  # Linux/Windows
```

Environment variables: `PB_STEPS`, `PB_OPEN`, `PB_SAVEAS`, `PB_ANSWER`, `PB_WAIT`, `PB_SHOT`. See `tools/probe.js` for details.

## Architecture

The studio is split across two processes:

**Main process** (`main.js`, `menu.js`, `chrome.js`, `lvl.js`):
- File I/O (open, save, import)
- Native dialogs (file picker, unsaved changes)
- Undo/redo menu state
- IPC handlers responding to renderer requests

**Renderer process** (all others):
- Canvas and UI rendering
- Edit gestures (paint, drag, erase)
- Undo/redo action dispatch
- Live text editing in Monaco

**Design decisions and architectural patterns are documented in depth in [CLAUDE.md](./CLAUDE.md).** That file explains:
- Why blocks are 100px (synced with the game)
- Why the grid is mirrored into a `Uint16Array` for performance
- Why undo stores diffs, not copies
- Why validation lives only in the main process
- Viewport culling, contrast-safe rendering, and more

## The .lvl Format

A `.lvl` file is a ZIP archive:

```
level.lvl
├── level.json          Level data (blocks, entities, metadata)
├── scripts/            Lua scripts (Pellizzola game VM)
└── midi/               MIDI background music files
```

### level.json schema

```json
{
  "level": {
    "information": {
      "name": "My Level",
      "description": "...",
      "author": "..."
    },
    "block_data": [["000", "001", "..."]],
    "entity_definitions": [
      { "id": "chapeleira", "script": "chapeleira_ai" }
    ],
    "entities": [
      { "def": "chapeleira", "pos": [500, 1000] }
    ],
    "backgrounds": ["foo"]
  }
}
```

**Block IDs** are three-digit strings: `"000"` is air, `"001"+` are blocks. See `textures/README.md` for the full block registry.

**Every row in `block_data` is exactly 540 cells wide** (9 scenes × 60 columns per scene). Height is free.

**Blocks** live in `block_data`. **Enemies and collectibles** (pizza, coins, soda, stars) are entities — dragged into place like the enemies, not painted as tiles.

## Workflow

1. **Open or create a level** — File menu or Ctrl+N/O/S
2. **Paint blocks** — Select from the palette (top right), click on the canvas
3. **Place entities** — Drag from the palette or right-panel groups onto the canvas
4. **Assign scripts** — Select an entity and choose its script from the inspector dropdown (bottom right)
5. **Edit scripts** — Click the script tab (top) to open Monaco, write Lua
6. **Add music** — Drag a MIDI file into the file manager, or use Import in its context menu
7. **Save** — Ctrl+S writes a `.lvl` archive

Use **arrow keys + Space/Return** to paint, **Delete** to erase. The keyboard cursor (green outline) is independent of the mouse.

## Known Limitations

- **No test suite** — `npm run check` validates the schema and round-trips `.lvl` files, but manual testing against the real app is the norm
- **Playtest button (▶) is inert** — the game cannot load `.lvl` archives yet (see `game/todo.txt`). The button carries a tooltip explaining why
- **One character tileset** — the game uses a fixed spritesheet for player and NPC animations. Replacing character sprites requires coordination with the game engine
- **Spritesheet brittleness** — inserting a column in the middle of `textures/block_sheet.png` shifts all subsequent tile IDs. Always append or rebuild the entire sheet

## Contributing

Issues and PRs welcome. Keep changes framework-free and dependency-light — this project stays vanilla JS with no build step.

**Before you start:** Read [CLAUDE.md](./CLAUDE.md) if using an AI coding assistant. It documents conventions, architectural patterns, and gotchas (e.g., how the renderer scripts share a global scope).

When adding features:
- Prefer editing existing files to creating new ones
- Keep the undo system in sync — wrap mutations in `Undo.act()` or `Undo.begin()/end()`
- Add design tokens to `style.css` before the components that need them
- Test the full round-trip: editor → save `.lvl` → reopen → play in game

## License

Except where otherwise noted, this repository is licensed under the MIT license.

---

**Related projects:**
- [Pellizzola Brothers (game)](https://github.com/pellizzola-brothers/game) — the platformer engine
- [Pellizzola Brothers (website)](https://github.com/pellizzola-brothers/website) — level sharing platform
- [Pellizzola Brothers (textures)](https://github.com/pellizzola-brothers/textures) — asset library (submodule)
