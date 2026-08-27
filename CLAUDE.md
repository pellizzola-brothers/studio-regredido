# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this is

Pellizzola Brothers Studio: an Electron level designer that authors `.lvl`
archives for the game (`../game`) and the website (`../website`).

Two modes share one window, switched by the tab strip:

- **Level Editor** — canvas in the centre, palette top right, property
  inspector bottom right, the level's file manager on the left.
- **Text Editor** — Monaco (the VS Code editor) for the level's Lua scripts,
  same file manager on the left.

## Commands

```bash
npm install     # also fetches the Electron binary on first run
npm start       # launch
npm run lint    # eslint . - tabs, 'use strict', no dead vars
npm run check   # tools/check.js - collision grep, .lvl round trip, migrate()
```

There is no test suite and no build step. Sources are loaded as-is; edit and
relaunch. `npm run check` is not a substitute for exercising the running app -
see "Driving the app headlessly" below for that.

## Layout

```
main.js       Electron main: window, dialogs, the app:// protocol, all IPC.
              The only process that touches the filesystem.
menu.js       The application menu (main process). Rebuilt on every renderer
              state change so Undo/Redo/Close Tab are honestly enabled.
chrome.js     The one place process.platform is read (main process): real
              per-platform BrowserWindow chrome and the unsaved-changes
              dialog's per-platform buttons.
preload.js    contextBridge surface — the renderer's entire view outward.
lvl.js        .lvl read/write plus the level.json validator (main process).
catalog.js    Block ids, entity definitions, backgrounds, texture loading.
              Shared: the renderer loads it as a script, lvl.js requires it.
tokens.js     Reads style.css's :root design tokens into a plain object, for
              grid.js's canvas and code.js's Monaco theme to consume.
undo.js       The level document's undo/redo history.
grid.js       The level canvas: rendering, panning, every edit gesture.
panel.js      Palette (top right) and property inspector (bottom right).
layout.js     The four splitters between the panels: drag, keyboard, reset,
              persistence.
code.js       Monaco host: one model per script.
app.js        Document state, tabs, file manager, keyboard commands.
index.html    Markup and script order.
style.css     Colours sampled from `Pellizzola Brothers.svg`.
textures/     Clone of github.com/pellizzola-brothers/textures at e66d748.
tools/        check.js (npm run check) and probe.js (the headless harness).
```

## The .lvl format

A ZIP archive:

```
level.lvl
├── level.json
├── scripts/     user-written Lua
└── midi/        MIDI files
```

`level.json`:

```json
{
    "level": {
        "information": {"name": "", "description": "", "author": ""},
        "block_data": [["000", "001", "..."]],
        "entity_definitions": [{"id": "chapeleira", "script": "chapeleira_ai"}],
        "entities": [{"def": "chapeleira", "pos": [500, 1000]}],
        "backgrounds": ["foo"]
    }
}
```

- `"000"` is air, `"001"`+ are block ids, always three digits.
- Every `block_data` row holds **exactly 540** entries. Height is free.
- Blocks are the only thing in `block_data`. Enemies *and* interactives both
  live in `entities`.
- A built-in script is a bare name (`chapeleira_ai`); a level's own script is
  a path into the archive (`scripts/walker.lua`).
- `pos` is `[x, y]` in world pixels.

## Key design decisions

**Block size is 100px.** `game/src/main.c` draws blocks 100x100 and spaces
them `i * 100`, so `B = 100` in `catalog.js` keeps entity `pos` aligned to the
grid. Changing it here alone desynchronises the studio from the game.

**A level divides into 9 scenes.** `textures/README.md` documents this - each
scene gets its own backdrop once the schema grows a field for it, which it
does not yet (`level.backgrounds` is still one id for the whole level, see
"Backgrounds" below). `SCENES`/`SCENECOLS` in `grid.js` (9 and `W / SCENES` =
60 columns) exist today only for `Grid.fit()`/`Grid.fitW()`: "zoom to fit"
targets the scene nearest the camera rather than the level's full 540-column
width, which no viewport can usefully show at once. Changing the scene count
here alone would disagree with the game and the texture library the same way
changing `B` or `W` alone would.

**Block ids are a cross-repo contract.** The table in `textures/README.md` is
the authority; the game reads the same ids. `catalog.js` deliberately omits
`blocks/lucky_block.png` and the six `interactives/*_flag.png` sprites: they
ship in the texture library but that README assigns them no id, and inventing
one here would silently disagree with the game. To add them, allocate the id
in the textures repo, the game and `catalog.js` together.

**Interactives are entities, not tiles.** A pizza, coin, soda or star is an
entity definition with a script, dragged into place like an enemy; the palette
only keeps them in their own group. This diverges from `textures/README.md`,
which still lists them as tile ids 43-46 in `block_data` — **the game and that
README need the same change**. Levels written the old way are converted on
open by `items()` in `lvl.js`, and ids 43-46 stay reserved so they are never
handed to a block. Their scripts use an `_item` suffix (`coin_item`) where
enemies use `_ai` (`chapeleira_ai`); both are names the game resolves in its
own script table.

**A script belongs to a definition, not to an entity.** The schema has no
per-entity script field, so assigning one moves every entity of that kind. The
inspector says which ("shared by 4 entities of this kind"); for a one-off,
make a new definition with `+` in the entities group. Assignment is available
two ways: the `script` dropdown in the inspector, or `assign to <def>` in the
file manager menu while an entity is selected. Both go through
`Panel.assign()`.

**An entity always owns its cell.** Painting a block where an entity stands
leaves air, and dragging an entity onto a block clears that block. Both
directions live in `setblock()` and the move branch of `onmove()` in
`grid.js`. The game applies the same rule on load, so this only mirrors it.

**Entities snap to the grid.** They are dragged, never painted: a press
creates the entity and the same gesture carries it to its cell. Snapping keeps
"one entity, one cell" exactly true, which is what makes the rule above
well-defined.

**The canvas is keyboard-operable, in parallel with the pointer.**
`Grid.kcur` (`grid.js`) is a second cursor, independent of the mouse-driven
`Grid.hov`, that arrow keys move one cell at a time; Return/Space applies
`Grid.tool` at it through `Grid.kpaint()`, mirroring `ondown()`'s own
precedence exactly (an existing entity is always grabbed first, regardless
of which tool is active); Delete/Backspace erases under it through
`Grid.kerase()`, but only when nothing is already selected via `Grid.sel` -
that case still deletes the selection, as before. Both wrap their single
edit in `Undo.act()` directly, since a keypress is a discrete action with no
drag to bracket with `begin()`/`end()`. Each move announces the cursor's
position and content through `#msg`'s live region (`role="status"`,
A11Y-05). Wired from `keys()` (`app.js`), gated the same way that file's
other canvas-local keys already are.

**The grid is mirrored into a `Uint16Array`.** `block_data` is 540 three-digit
strings per row — fine on disk, poor to paint into. `Grid.load()` unpacks once
and `Grid.commit()` packs back. **Every save path must call `Grid.commit()`
first**, or the canvas and the file diverge.

**Undo stores small parts whole and the grid as a diff.** A step keeps
`information`, `entity_definitions`, `entities`, `backgrounds` and the script
and MIDI tables verbatim, and the block grid only as the cells that changed —
so painting a stroke costs a few bytes per cell instead of a copy of a 540-wide
grid, which is what makes the history effectively unbounded. Script and MIDI
tables are copied *shallowly*: their values are immutable strings and byte
arrays, so the copy is a handful of pointers.

**Any new mutation of the level document must be wrapped in `Undo.act(fn)`**,
or `Undo.begin()`/`Undo.end()` around a drag. An unwrapped change does not just
fail to undo — it gets silently folded into whatever step runs next, so undo
starts reverting things the user never did. `setblock()` already reports to
`Undo.cell()`; anything that *reallocates* `Grid.a` (only `Grid.setheight()`
today) must call `Undo.grid()` with before and after copies, because a cell
diff cannot describe a resize. `Undo` calls `App.refresh()` afterwards, which
rebuilds every view and re-syncs Monaco's models through `Code.sync()`.

A step left open by `Undo.begin()` can also be abandoned instead of finished:
`Undo.cancel()` reverts whatever it had already applied (reusing `apply()`
against the step's own `before` shot) and discards it without ever pushing it
onto `Undo.past`. `Grid.cancel()` (`grid.js`) is the gesture-level wrapper —
called when Escape or a `blur` interrupts a still-open drag or paint stroke —
so a cancelled gesture can never leave a step open for the next unrelated edit
to be folded into.

Ctrl+Z is bound only while the Level Editor tab is active; inside a script tab
it belongs to Monaco, which keeps its own text history. This is enforced by
`menu.js`: the Edit menu's Undo/Redo items are disabled whenever the active
tab is not `'level'`, and a disabled menu item's accelerator does not fire —
that is what hands the key back to Monaco instead of two undo systems racing
for it. `App.syncmenu()` (`app.js`) pushes `{tab, canUndo, canRedo}` to main
on every tab switch and undo/redo step, driven from `undo.js`'s `Undo.end()`
and `shift()`, and main rebuilds the whole menu from that state.

The level's dirty flag follows the same depth-tracking idea: `Undo.clean`
(`undo.js`) holds the undo depth that matches what is on disk, and
`App.dirty` is `Undo.depth() !== Undo.clean` (`App.recheck()` in `app.js`),
not "has anything happened since open" — so undoing back to the opened state
clears it and redoing past it sets it again. Script edits bypass `Undo`
entirely (Monaco's own history, above), so they set a separate
`App.textdirty` flag that `App.recheck()` ORs in.

**Rendering is viewport-culled.** `Grid.draw()` walks only visible columns and
rows, so a 540x200 level costs what a 540x12 one does. Tile edges are snapped
to whole device pixels via the precomputed `ex`/`ey` arrays, which is what
keeps pixel art seamless at arbitrary zoom. Redraws are coalesced through
`Grid.redraw()` onto one animation frame.

**Canvas-drawn indicators guarantee contrast against arbitrary content.** The
selection ring, level bounds, hover cell and keyboard cursor are drawn over
the level's own art, which can be any colour a single-tone stroke could
vanish into. `outline()` (a two-tone dark/light stroke) and `diffRect()`
(`globalCompositeOperation: 'difference'`) in `grid.js` are what guarantee
each stays visible regardless — the former for the persistent indicators,
the latter for the ones redrawn every frame, where a second stroke would
cost more than a composite op. `watchcontrast()` mirrors `watchdpr()`'s
`matchMedia` pattern for `prefers-contrast: more`, but *without*
`watchdpr()`'s `{once: true}` self-rearming: a boolean preference query
stays valid indefinitely, unlike a `resolution: Xdppx` query tied to one
exact value, so re-arming it on every change would only leak listeners.

**The level scrollbar is a real overflow container.** `#hbar` holds a spacer
as wide as the level at the current zoom; the browser draws and drives the
thumb, and `Grid.syncbar()` keeps it and `Grid.cam.x` in step. Neither side
uses a re-entrancy flag — each ignores a value within a pixel of what it last
wrote, which survives the asynchronous scroll events a flag would miss.
`Grid.clamp()` holds the camera over the level so the bar can stand for the
whole range of x. Middle-drag and Alt-drag still pan freely in both axes.

**Pages are served from `app://studio/`, not `file://`.** Monaco's web workers
cannot `importScripts` across a `file://` opaque origin. The custom protocol in
`main.js` gives the renderer a real same-origin base, so the worker shim blob in
`code.js` resolves normally. Keep `index.html` loading through `app://`.

**Validation lives only in `lvl.js`.** It runs in the main process on read and
on write; `main.js` refuses to write a level that fails, and the renderer shows
the returned message in the inspector and the status bar. There is deliberately
no second copy in the renderer to drift out of sync.

**Legacy levels migrate on open.** `migrate()` reshapes the old flat
`level.data` array into 540-wide rows and fills in fields that predate the
current schema, so files like `website/levels/1774028825093-pellizzola.json`
still open. Bare `.json` (not zipped) is accepted too.

**Backgrounds.** The schema allows only the presets `foo`, `bar`, `baz`;
`catalog.js` maps them onto real backdrop art. The names are the spec's, not
descriptions of the art — renaming them is a schema change affecting the game.

**Renames cascade.** Renaming a script rewrites any `entity_definitions.script`
pointing at it, its Monaco model and its open tab. Deleting a script that a
definition still uses is refused.

**Design tokens live once, in `style.css`'s `:root`.** Spacing, row heights,
type, colour, radius, elevation, motion and z-index are each defined there
and nowhere else. `tokens.js` reads the colour custom properties once, at
load, into a plain object (`Tokens`) for the two consumers that cannot
resolve a CSS `var(...)` reference themselves: `grid.js`'s canvas 2D context
(`fillStyle`/`strokeStyle` want a plain string) and `code.js`'s Monaco theme
(`defineTheme()` wants a plain object literal). `main.js`'s
`BrowserWindow`'s `backgroundColor` and `chrome.js`'s `BAR` are the two
sanctioned exceptions — each must be known before any CSS has loaded, so each
duplicates a token's value with a comment naming which one and the rule to
change both together. Not every token has a consumer yet; introduce them
before the components that need them, not after, per the pattern this file's
own row/spacing tokens already set (`--row`, `--row-sm`, `--row-lg`,
`--row-hdr`).

## Deviations from the design file

`Pellizzola Brothers.svg` is the reference for layout and colour. Three
additions were needed for the app to be usable:

- `new / open / save / save as` in the title bar. On macOS and Windows the
  window has no visible menu bar (real traffic lights via `hiddenInset` and a
  `titleBarOverlay` caption strip respectively, `chrome.js`) even though
  `menu.js` sets a real menu on every platform (its accelerators work
  regardless of whether the bar itself is drawn); Linux falls back to a
  WM-decorated `frame: true` window, which does show one. The hotbar is kept
  on all three for now, by choice rather than necessity, since narrowing it
  to only where it is load-bearing is a deliberate follow-up, not a default.
  Shortcuts (`Ctrl+N/O/S`, `Ctrl+Shift+S`, `Ctrl+W` closes a script tab,
  `Ctrl+Z`/`Ctrl+Shift+Z` for the level's undo/redo) are declared once, in the
  menu template, and dispatched through `App`'s `ACTS` table over a `cmd` IPC
  channel — not matched by hand against `keydown` in the renderer.
- A status bar showing the hovered cell and the last message or error.
- A context menu in the file manager, opened by **left**-clicking a row (right
  click works too) — a native `Menu.popup()`, built in `main.js` from context
  the renderer sends over `menu:row` and dispatched back over `rowcmd`. It
  carries open, assign, rename, delete, new script and import midi; clicking
  the panel background offers the last two. Left-click was asked for
  explicitly, so opening a script is now the menu's first entry rather than a
  bare click.
- Inline renaming, since Electron does not implement `window.prompt`.
- A horizontal scrollbar under the canvas.
- A context menu on the canvas itself, opened by a right click that never
  dragged — the same `menu:row`/`rowcmd` round trip as the file manager's,
  under `kind: 'canvas'`. A right press that *does* drag still erases, as
  before; on macOS, Ctrl+click arrives as the same button-2 event and never
  erases regardless of movement, since it is the platform's own reflex for
  reaching a context menu. The menu itself only carries actions that already
  exist (delete the clicked entity, fit the view) — see `grid.js`'s
  `canvasmenu()`.

The design draws the active tab's own corner flare at a 26px radius - at the
scale the window itself was drawn at. This tab strip is 34px tall
(`--row-lg`) end to end, where 26px would consume nearly the whole tab in one
curve and read as a pill rather than a flare, so the literal figure does not
transfer to an element this size. `.tab.on` uses `--radius-2` (4px) instead -
the largest radius step actually proportionate here - reused rather than
inventing a token for one consumer. The design's other radius, the window's
own top corners at the same 26px, is the OS's to own now (`hiddenInset`/
`titleBarOverlay`, `chrome.js`).

The design's inspector shows `health`, `damage`, `hit position`. The schema has
no home for per-entity properties — an entity is `{def, pos}` — so the
inspector edits what the format can actually store. Adding them means adding a
field to the schema in the studio, the game and the website together.

The `▶` button renders per the design but is **inert**: the game cannot load
`.lvl` archives yet (`game/todo.txt` step 3.1, minizip + jansson). Wiring it up
means spawning the game binary with a temporary level; the button already
carries that explanation in its tooltip.

The studio is local-only. It does not talk to the website API; levels are
published through the website's own `upload.html`.

## Gotchas

**The renderer scripts share one global scope.** `index.html` loads them as
classic scripts, so a `function` or `const` at the top level of `grid.js` and
one in `panel.js` collide, and the later file silently wins. `grid.js` uses
`at()` for the pointer-to-cell helper precisely because `panel.js` already owns
`cell()`. Check for collisions when adding top-level names:

```bash
grep -hoE '^(function [a-z_]+|const [A-Z_a-z]+ =)' catalog.js tokens.js grid.js panel.js layout.js code.js app.js | sort | uniq -d
```

`npm run check` (`tools/check.js`) runs the same check on every invocation, so
a collision fails the command instead of surfacing as one file silently
overwriting another's function at load time.

**`textures/` is a plain clone, not a submodule**, because this directory is
not itself a git repository. If you `git init` here, re-add it properly:
`git submodule add https://github.com/pellizzola-brothers/textures.git textures`.

**`catalog.js` is loaded two ways.** The renderer takes it as a classic script
and picks its names up as globals; `lvl.js` `require`s it in the main process
for the migration tables. The `module.exports` at the bottom is guarded, and
nothing above it may touch a browser global at load time — `tex()` may
reference `Image` only because it is never called in the main process.

**Texture filenames contain accents, spaces, parentheses and `!`**
(`abú.png`, `energéticoBrothers(estrela).png`). Always build URLs through
`texurl()` in `catalog.js`, which encodes each path segment.

## Driving the app headlessly

There is no test runner. `tools/probe.js` boots the real app, stubbing the
native dialogs so open/save/discard can be driven, then runs `PB_STEPS` (a
JSON array of `[name, js]` pairs) through `executeJavaScript` once the
renderer has loaded and optionally writes a screenshot:

```bash
PB_SHOT=/tmp/shot.png PB_STEPS='[["h","JSON.stringify(Grid.h)"]]' \
	./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tools/probe.js   # macOS
./node_modules/electron/dist/electron tools/probe.js                                  # Linux/Windows
```

Run the platform's real binary directly rather than `npx electron` or a
`NODE_OPTIONS=--require` preload — either runs before Electron registers its
built-in `electron` module and fails to resolve it. The macOS binary lives
inside `Electron.app`, not at `dist/electron` as on the other two platforms;
`node_modules/electron/path.txt` names the exact relative path if it moves.

Other env vars `tools/probe.js` reads: `PB_OPEN`/`PB_SAVEAS` (paths a stubbed
Open/Save-As dialog returns), `PB_ANSWER` (the button index a stubbed message
box returns, default 1), `PB_WAIT` (ms before `PB_STEPS` runs, default 3500).
`PB_SHOT` is optional; omit it to skip the screenshot.

Because the renderer scripts share a global scope, internals are reachable from
`executeJavaScript`: `Grid`, `App`, `Panel`, `Code`, `Undo`, `Layout`, `setblock()`,
`stroke()`, `at()`, `newdef()`, `menu()`, `closemenu()`. Synthetic
`MouseEvent`s on `#cv` and on `#scripts li` go through the same handlers as
real input, which is the useful way to test the editing rules and the menu.
Main-process-only behaviour (a crashed or hung renderer, dialog button
choices) is easiest driven from a copy of `tools/probe.js` that calls
`webContents.forcefullyCrashRenderer()` or stubs `dialog.showMessageBox` to
never resolve, rather than from a `PB_STEPS` entry, since those are outside
what `executeJavaScript` can reach.
