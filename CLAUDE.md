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
npm run dist    # electron-builder - packaged, unsigned artefacts in dist/
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
util.js       $() and esc() - loaded first so every other renderer script's
              dependency on them is explicit, not implicit in load order.
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
build/        electron-builder resources: the app icon (icon.icns/.ico/.png,
              icons/), referenced from package.json's "build" block.
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

**A level's dimensions are fixed, not authored.** `W` (540 columns) and `H`
(12 rows) in `catalog.js` are both the same cross-repo contract `B` is - the
studio never lets a level be any size but this one, so the inspector's own
`width`/`rows` fields (`panel.js`'s `levelview()`) are always disabled,
read-only readouts, never inputs. There used to be a `Grid.setheight()` that
resized the grid in place (with its own `Undo.grid()` step type, since a
resize is not describable as a cell diff) - removed outright rather than left
unreachable, along with the UI that drove it, once it became clear no size
but `H` was ever meant to be reachable from here. A level loaded from disk
with some other row count (a legacy or hand-edited file - `block_data`'s
format itself still permits it, "Height is free" above) still opens and
displays correctly; only *creating* or *resizing* to a non-`H` height is gone.

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
`Undo.cell()`. `Undo` calls `App.refresh()` afterwards, which rebuilds every
view and re-syncs Monaco's models through `Code.sync()`.

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

**The level scrollbars are real overflow containers.** `#hbar` holds a spacer
as wide as the level at the current zoom; the browser draws and drives the
thumb, and `Grid.syncbar()` keeps it and `Grid.cam.x` in step. Neither side
uses a re-entrancy flag — each ignores a value within a pixel of what it last
wrote, which survives the asynchronous scroll events a flag would miss.
`Grid.clamp()` holds the camera over the level so the bar can stand for the
whole range of x. Middle-drag and Alt-drag still pan freely in both axes.
`#vbar` mirrors the same technique on the vertical axis (`Grid.syncvbar()`/
`Grid.cam.y`), the one asymmetry the horizontal-only version otherwise left: a
level's rows can still outnumber the viewport (a legacy or hand-edited file
taller than `H`, above) with no way to see where the viewport sits among
them. Hidden via `visibility: hidden` (not `display:
none`, so the layout does not shift) whenever the level fits the viewport
vertically, since unlike `#hbar` — always 540 columns wide regardless of
window size — it has nothing to represent in that case. `#stage` and `#vbar`
both need an explicit `min-height: 0`, or the vertical spacer's own
tens-of-thousands-of-pixels intrinsic height propagates straight up through
the flex chain and the canvas row grows to fit it instead of the window — the
same automatic-minimum-size flex bug `--side`/`--right`'s own `min-width: 0`
already guards against on the horizontal axis.

**Pages are served from `app://studio/`, not `file://`.** Monaco's web workers
cannot `importScripts` across a `file://` opaque origin. The custom protocol in
`main.js` gives the renderer a real same-origin base, so the worker shim blob in
`code.js` resolves normally. Keep `index.html` loading through `app://`.

**Validation lives only in `lvl.js`.** It runs in the main process on read and
on write; `main.js` refuses to write a level that fails, and the renderer shows
the returned message in the inspector and the status bar. There is deliberately
no second copy in the renderer to drift out of sync.

**Every `ipcRenderer.invoke()` channel answers one shape.** `main.js`'s
`guard()` wraps a handler's result as `{status: 'ok', data}`, a thrown error as
`{status: 'error', message}`, and the one sentinel value `guard()` itself
recognises, `CANCEL`, as `{status: 'cancel'}` for a dialog the user dismissed.
`app.js`'s `call()` is the one place that unwraps it — every call site reduces
to `const r = await call(api.foo()); if (!r) return;`, which cannot forget to
check for a cancelled dialog the way two separate `.ok`/`.cancel` checks
could. A new handler that wraps a dialog returns `CANCEL` on `r.canceled`
rather than inventing its own falsy-result shape. `ask:discard`'s own
`'save'|'discard'|'cancel'` string is deliberately outside this convention —
it names a real three-way user choice the caller branches on directly, not an
operation outcome to unwrap.

**A dropped file's real path is resolved in the preload, not the renderer.**
`File.path` is deprecated in Electron in favour of `webUtils.getPathForFile`,
which only the preload can call — `api.droppath(file)` (`preload.js`) is the
one bridge for it, keeping "the renderer touches no filesystem" true for drag
and drop the same way it already is for every dialog-driven open.

**`lvl.write()` is async; `lvl.read()` is not.** Both were fully synchronous
until a measurement (POLISH.md, NAT-19) found a 999-row save's own
compression - not disk I/O, not `Grid.commit()` - costing enough to freeze
the main process. Only that step moved: `write()` now returns a Promise,
using fflate's async `zip()` in place of `zipSync`, while the actual
`fs.writeFileSync`/`renameSync` calls around it stay synchronous, since they
measured as trivially fast. `read()`'s own `unzipSync` measured under
budget even at 999 rows and is untouched. Every caller of `write()` must
`await` or `.then()` it now.

**OS-facing labels are Title Case, converted for GNOME.** The menu bar
(`menu.js`), native context menus and dialog titles/buttons (`main.js`) are
each authored once, in Title Case (macOS/Windows' own convention), and
`chrome.js`'s `oscase()` converts a copy to GNOME's Sentence case at the one
place each reaches the OS. It is a no-op on macOS/Windows. Never apply it to
user-authored content (a filename, an entity definition id) — concatenate
that after the call, not through it. In-window UI (panels, buttons, headers,
tooltips, aria-labels) is lowercase everywhere instead, per the design;
proper nouns (`MIDI`, `Lua`, `Pellizzola Brothers`) keep their own
capitalisation on both sides of that rule.

**Settings persist in `settings.json`, view state does not.** A setting the
user chooses once and expects to stick (grid overlay, palette cell size,
editor font size, the recovery-snapshot interval) lives in
`app.getPath('userData')/settings.json`, owned by main
(`settings:get`/`settings:set`) and cached in the renderer as the `Settings`
object (`app.js`), applied once at boot and again live on every change
(`applysettings()`). View state (panel widths, the last zoom, which
splitters were dragged) is a different thing and stays in `localStorage` or
`window.json`, silent and per-machine — do not conflate the two just because
both "persist something."

**The app is packaged with electron-builder (`build` in `package.json`,
`npm run dist`).** `build/` holds the icon set (`icon.icns`/`.ico`/`.png`,
`icons/`), generated by nearest-neighbour resampling from
`textures/characters/leandro.png` — confirmed the canonical "pellizzola
brother" sprite via `textures/ui/main_menu.png`'s own labelled callout, not
hand-tuned pixel art. `files` excludes `node_modules/monaco-editor/dev/**`
and `/esm/**` (`code.js` only ever loads `min/vs`) but deliberately keeps all
of `textures/` — it is 1MB and required at runtime by every sprite the
`app://` protocol serves, unlike what a packaging config might reflexively
exclude. `asar: false`, chosen outright rather than `asarUnpack`, sidesteps
the fact that `code.js`'s worker blob path resolves through the `app://`
handler's `net.fetch(pathToFileURL(...))`, which is not asar-aware.

**A path to open at launch is queued until the window can receive it.**
`app.on('open-file')` (macOS) and an argv path (Windows/Linux cold start, and
a second instance's own `second-instance` argv, `NAT-08`'s
`requestSingleInstanceLock()`) both funnel through `openpath()` in `main.js`.
`open-file` in particular can fire before `whenReady()`, so a `pendingopen`
path is queued rather than sent immediately, and drained only once `winready`
is set — the same point `showwin()` already gates `win.show()` on (`ui:ready`
from the renderer), since that is the first moment the renderer's own IPC
listeners are provably attached. Sent over the existing `open-recent`
channel (`NAT-06`) so it crosses the renderer's own unsaved-changes guard
like any other open, rather than main opening it directly.

**Dock menu, JumpList and save/open progress are native, not custom UI.**
`setdockmenu()` (macOS only, `main.js`) rebuilds the Dock's own "New
Level"/"Open Recent ▸" menu from the same `loadrecent()` list the File menu's
own submenu reads, called after every `addrecent()`/`clearrecent()` so the
two can never disagree. `app.setUserTasks()` (Windows only) installs a "New
Level" JumpList task; recent documents populate it automatically once
`addRecentDocument()` runs. `withprogress()` wraps `lvl:save`/`lvl:saveas`'s
writes in `win.setProgressBar(2)` (indeterminate) / `(-1)` (clear) —
cross-platform, not gated by `chrome.mac`/`chrome.win32`, since Electron maps
it onto whichever launcher API each platform actually has (Dock on macOS,
taskbar on Windows, best-effort on Linux desktops that support it).

**A MIDI file, once imported, is not a one-way trip.** `midiinfo()`/
`midisummary()` (`app.js`) parse the `MThd` header chunk (format, track
count, division) for the row's own tooltip; "Export…" in the row's context
menu (MIDI rows only) round-trips the bytes back to a real path through a new
`midi:export` IPC handler, the same shape `midi:import` already uses in
reverse.

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

`Pellizzola Brothers.svg` is the reference for layout and colour. The design
draws a static mockup with no interaction, error or empty state, so several
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
- A status bar showing the hovered cell, the last message or error.
- `#warnbar`, a one-line strip docked over the status bar's own left span
  (`#stage`'s width, not the full window) whenever `lvl.js`'s `review()` has
  something to say (missing/duplicate start-end blocks, dangling script
  references, out-of-bounds entities, unused definitions/scripts). Every
  current warning is joined onto that one line (`App.setwarnings()`,
  `app.js`) rather than listed one per row, since unlike the inspector view it
  replaced (BUG-11's original placement), it is sized to its own text height,
  not a list's. It used to live inside `#props`'s level view instead, where
  selecting an entity - which placing one does immediately - swapped that
  view out and hid it; docking it under the canvas instead keeps it visible
  regardless of what is selected.
- A search/filter field above the palette (`#palette-filter`), narrowing its
  31+ cells by name as the user types.
- A context menu in the file manager, opened only by **right**-clicking a
  row — a native `Menu.popup()`, built in `main.js` from context the renderer
  sends over `menu:row` and dispatched back over `rowcmd`. It carries open,
  assign, rename, delete, new script and import midi; clicking the panel
  background offers the last two. A left click leaves the row's own "open"
  action to double-click (`app.js`'s `list()`) instead, the gesture every
  other file manager uses for it, rather than costing that most-frequent
  action a trip through the menu.
- Inline renaming, since Electron does not implement `window.prompt`.
- A horizontal scrollbar under the canvas, and (GEO-10) a vertical one
  (`#vbar`) alongside it — the design has no vertical scrollbar for the level
  at all, since nothing in it shows what a level taller than the viewport
  even looks like.
- A right click on the canvas that never dragged deletes whatever is under it
  directly — the same thing a right-*drag* already applies along its path —
  rather than asking first. Only a click with nothing under it to delete (one
  outside the level's own bounds) still opens a menu, the same `menu:row`/
  `rowcmd` round trip as the file manager's, under `kind: 'canvas'`, carrying
  the one action that still applies out there: fit the view. See `grid.js`'s
  `onup()` for the bounds check and `canvasmenu()` for the menu itself. On
  macOS, Ctrl+click arrives as the same button-2 event and never erases
  during a drag regardless of movement, since it is the platform's own reflex
  for reaching a context menu; on release it resolves exactly like any other
  right click, at the cell the press itself was over.

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
carries that explanation in its tooltip and, for a screen reader, in
`aria-describedby="run-help"` (`index.html`) - and the View menu's own
disabled "Playtest" item carries it a second way, for a sighted user who
never hovers or tabs into the tab strip at all.

The studio is local-only. It does not talk to the website API; levels are
published through the website's own `upload.html`.

The design's accent is `#7E58BE` (borders/icons/text) plus a second, lighter
`#815AC1` for filled elements; the implementation ships `--acc: #7b56ba`
(non-text use - borders, rings, grid lines) and `--acc-text: #9a74e0` (text
use), retuned off the design's own value for WCAG contrast (4.5:1 for text,
3:1 for non-text boundaries - see `--dim`'s own comment in `style.css` for the
same reasoning applied to the resting text colour). The design's second,
lighter fill accent has no implementation equivalent: nothing in the app
currently fills a shape with it, and `style.css`'s own rule ("introduce a
token before the component that needs it, not after") is why none exists yet.

## Gotchas

**The renderer scripts share one global scope.** `index.html` loads them as
classic scripts, so a `function` or `const` at the top level of `grid.js` and
one in `panel.js` collide, and the later file silently wins. `grid.js` uses
`at()` for the pointer-to-cell helper precisely because `panel.js` already owns
`cell()`. Check for collisions when adding top-level names:

```bash
grep -hoE '^(function [a-z_]+|const [A-Z_a-z]+ =)' util.js catalog.js tokens.js grid.js panel.js layout.js code.js app.js | sort | uniq -d
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
