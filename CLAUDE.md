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
```

There is no test suite and no build step. Sources are loaded as-is; edit and
relaunch. See "Driving the app headlessly" below for how to verify changes.

## Layout

```
main.js       Electron main: window, dialogs, the app:// protocol, all IPC.
              The only process that touches the filesystem.
preload.js    contextBridge surface — the renderer's entire view outward.
lvl.js        .lvl read/write plus the level.json validator (main process).
catalog.js    Block ids, entity definitions, backgrounds, texture loading.
              Shared: the renderer loads it as a script, lvl.js requires it.
undo.js       The level document's undo/redo history.
grid.js       The level canvas: rendering, panning, every edit gesture.
panel.js      Palette (top right) and property inspector (bottom right).
code.js       Monaco host: one model per script.
app.js        Document state, tabs, file manager, keyboard commands.
index.html    Markup and script order.
style.css     Colours sampled from `Pellizzola Brothers.svg`.
textures/     Clone of github.com/pellizzola-brothers/textures at e66d748.
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

Ctrl+Z is bound only while the Level Editor tab is active; inside a script tab
it belongs to Monaco, which keeps its own text history.

**Rendering is viewport-culled.** `Grid.draw()` walks only visible columns and
rows, so a 540x200 level costs what a 540x12 one does. Tile edges are snapped
to whole device pixels via the precomputed `ex`/`ey` arrays, which is what
keeps pixel art seamless at arbitrary zoom. Redraws are coalesced through
`Grid.redraw()` onto one animation frame.

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

## Deviations from the design file

`Pellizzola Brothers.svg` is the reference for layout and colour. Three
additions were needed for the app to be usable:

- `new / open / save / save as` in the title bar. The window is frameless, so
  there is no native menu bar to hang them on. Shortcuts: `Ctrl+N/O/S`,
  `Ctrl+Shift+S`, `Ctrl+W` closes a script tab.
- A status bar showing the hovered cell and the last message or error.
- A context menu in the file manager, opened by **left**-clicking a row (right
  click works too). It carries open, assign, rename, delete, new script and
  import midi; clicking the panel background offers the last two. Left-click
  was asked for explicitly, so opening a script is now the menu's first entry
  rather than a bare click.
- Inline renaming, since Electron does not implement `window.prompt`.
- A horizontal scrollbar under the canvas.

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
grep -hoE '^(function [a-z_]+|const [A-Z_a-z]+ =)' catalog.js grid.js panel.js code.js app.js | sort | uniq -d
```

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

There is no test runner. To exercise the real app, boot it through a harness
that installs hooks and then requires `main.js`, stubbing the native dialogs so
open/save/discard can be driven:

```js
/* probe.js */
const {app, dialog} = require('electron');
const fs = require('fs');

dialog.showOpenDialog = async () => ({canceled: false, filePaths: [process.env.PB_OPEN]});
dialog.showSaveDialog = async () => ({canceled: false, filePath: process.env.PB_SAVEAS});
dialog.showMessageBox = async () => ({response: +(process.env.PB_ANSWER || 1)});

app.on('browser-window-created', (e, w) => {
	w.webContents.on('console-message', (ev, lvl, msg) => lvl >= 1 && console.log(msg));
	w.webContents.on('did-finish-load', () => setTimeout(async () => {
		for (const [n, js] of JSON.parse(process.env.PB_STEPS || '[]'))
			console.log(n, await w.webContents.executeJavaScript(js, true));
		fs.writeFileSync(process.env.PB_SHOT, (await w.capturePage()).toPNG());
		app.exit(0);
	}, 3500));
});

require('/absolute/path/to/studio/main.js');
```

```bash
PB_SHOT=/tmp/shot.png PB_STEPS='[["h","JSON.stringify(Grid.h)"]]' \
	./node_modules/electron/dist/electron /tmp/probe.js
```

Run the binary at `node_modules/electron/dist/electron` directly — a
`NODE_OPTIONS=--require` preload runs before Electron registers its built-in
`electron` module and fails to resolve it.

Because the renderer scripts share a global scope, internals are reachable from
`executeJavaScript`: `Grid`, `App`, `Panel`, `Code`, `Undo`, `setblock()`,
`stroke()`, `at()`, `newdef()`, `menu()`, `closemenu()`. Synthetic
`MouseEvent`s on `#cv` and on `#scripts li` go through the same handlers as
real input, which is the useful way to test the editing rules and the menu.
