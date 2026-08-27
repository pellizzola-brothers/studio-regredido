# POLISH.md — Pellizzola Brothers Studio

An implementation-oriented audit of the Studio Electron app (`main.js`,
`preload.js`, `lvl.js`, `catalog.js`, `undo.js`, `grid.js`, `panel.js`,
`code.js`, `app.js`, `index.html`, `style.css`) against one goal: make Studio
feel like a deliberately designed, production-quality desktop application that
is native to the OS it runs on.

This document is a roadmap, not a diff. Nothing here has been implemented.
Every finding carries the evidence that produced it so the next person does not
have to rediscover it. Follow `CLAUDE.md` for architecture and the
[suckless coding style](https://suckless.org/coding_style/) for code.

**Audit basis.** Full read of all 2 627 lines of source; the design reference
`Pellizzola Brothers.svg` parsed for geometry and colour; and four headless
runs of the real app through the probe harness documented in `CLAUDE.md`
(Electron 43.4.1, macOS 15 / darwin 24.6.0, `devicePixelRatio` 1). Measured
values quoted below (contrast ratios, computed styles, menu contents, font
metrics, DOM geometry) come from those runs, not from inspection.

---

## Already completed (do not re-add)

The sixty-three items below have shipped and are removed from the findings
sections below (4-14). Kept here, in the same `#### ID —` form the rest of the
document uses, so every remaining cross-reference to one of these IDs still
resolves to a real place in the file instead of a dead link.

---

#### BUG-01 — ⌘R / Ctrl+R silently destroyed the unsaved level

Shipped: a real application menu (NAT-01, below) replaces Electron's default
one, so production builds have no Reload item at all; the development-only
Reload item routes through the renderer's existing unsaved-changes guard
(`guard()` in `app.js`) before calling `location.reload()`, exactly like
window close does. Verified with the probe harness: cancelling the guard
leaves the document and the page untouched; confirming it produces a second
`did-finish-load`.

---

#### BUG-02 — Saving was not atomic

Shipped: `lvl.write()` (`lvl.js`) now writes to a `<path>.tmp-<pid>` file in
the destination directory and `fs.renameSync`s it over the target, with the
temp file unlinked on any failure. Verified with a save/reopen round trip
through the probe harness and confirmed no `.tmp-*` file is left behind.

---

#### BUG-03 — Undoing back to a pristine document still marked the level dirty

Shipped: `Undo.clean` (`undo.js`) tracks the depth that matches disk,
`App.recheck()` (`app.js`) computes dirty as `Undo.depth() !== Undo.clean`
OR'd with a new `App.textdirty` flag for Monaco's independent script history,
and the redo-path-discarded edge case pins `Undo.clean` to an unreachable
`-1` so a later coincidental depth match can never read as clean. Verified
with the probe harness: paint-then-undo now reports `dirty: false` (previously
measured as `true`).

---

#### BUG-07 — Save failures were invisible while a script tab was active

Shipped: `main.js` shows a native `dialog.showMessageBox({type: 'error', ...})`
with the full validator output as `detail` whenever `lvl:save`/`lvl:saveas`
fails, reaching the user regardless of which tab is open; the inspector's
`.err` block still renders as the persistent record. Verified by forcing a
validation failure through the probe harness and capturing the dialog call.

---

#### NAT-01 — No application menu; the app shipped Electron's default one

Shipped: `menu.js` builds a real per-platform template
(File/Edit/appMenu/windowMenu/Help), installed via
`Menu.setApplicationMenu()`; `app.setName()` and `productName` in
`package.json` make the app's real name appear in the menu bar, About panel
and Dock; Reload/DevTools only exist behind `!app.isPackaged`; Undo/Redo menu
items are wired to the level's own history and are disabled outside the Level
Editor tab, which is what hands `CmdOrCtrl+Z` back to Monaco in a script tab
without two undo systems racing for the same key; the hand-rolled
`s`/`o`/`n`/`z`/`y`/`w` matching in `app.js`'s `keys()` is gone, replaced by
the menu's accelerators dispatching through the renderer's existing `ACTS`
table over a new `cmd` IPC channel. Not shipped, and still open: the View menu
(zoom, fit), and the Edit menu's Cut/Copy/Paste roles operate on focused text
fields only (no canvas region clipboard exists to wire them to). `chrome.js`/
`api.platform` (ARCH-03, done — see "Already completed") now exists;
`menu.js`'s own `process.platform` branch was folded into it, so this menu
template is no longer one of the places that checks platform directly.

---

#### BUG-06 — Renaming a MIDI file mangled its name

Shipped: `clean()` (`app.js`) is split into `cleanscript()` (unchanged
behaviour) and `cleanmidi()`, which strips separators, rejects an empty
result, and enforces `.mid`/`.midi` — preserving whichever extension the file
already used rather than defaulting to `.lua`. `edit()` now takes the row's
own `isscript` flag from its caller instead of re-deriving the kind from
`old`'s `midi/` prefix. `renmidi()` no longer swallows a name collision; it
reports it through `App.say()` exactly like `renscript()` already did.
Verified with the probe harness: `cleanmidi("intro", "midi/intro.mid")` now
produces `intro.mid` and `cleanmidi("a/b\\c", null)` produces `abc.mid`,
where the old code wrote the bare, extensionless `intro`/`abc`; a colliding
rename now reports "a MIDI file named ... already exists" through the status
bar instead of silently doing nothing.

---

#### BUG-04 — Save dialog offered `.json`, but `write()` always emitted a ZIP

Shipped: `main.js` now defines separate `OPENFILTERS` (`lvl`, `json`) and
`SAVEFILTERS` (`lvl` only), passed to `showOpenDialog` and `showSaveDialog`
respectively, so Save/Save As can no longer offer an extension the writer
cannot honour. Verified with the probe harness: the save-as flow now only
ever sees the `lvl`-only filter.

---

#### BUG-05 — A typed filename with no extension was written extensionless

Shipped: `main.js`'s new `forcelvl()` appends `.lvl` to whatever
`showSaveDialog` returns before `lvl:saveas` writes it, so a bare name typed
into a GTK save dialog is normalised the same way macOS's and Windows'
dialogs already normalise it. Verified with the probe harness: a stubbed save
dialog returning `/tmp/pbtest_noext` (no extension) produced a real ZIP at
`/tmp/pbtest_noext.lvl`, and the renderer's `App.path` was updated to match.

---

#### BUG-08 — The renderer supplied the path that main wrote to

Shipped: `main.js` now owns a module-level `doc = {path, dirty}`. `lvl:save`
takes only the document and writes to `doc.path`, which main itself set on
`lvl:new`/`lvl:open`/`lvl:saveas`; `preload.js`'s `save()` no longer accepts a
path argument at all, so the renderer has no channel through which to name an
arbitrary write target. `doc.dirty` also replaces the ad-hoc `win.dirty`
property, which is half of BUG-09's fix too. The renderer still keeps
`App.path` as a display-only mirror, populated from the same responses it
already read the path from — no new IPC event was needed for that, since
every path-setting operation already returns the new path synchronously to
its caller. Verified with the probe harness: `api.save()` before any path is
known fails cleanly (`"no file to save to"`) instead of crashing or guessing a
path; open → mutate → save round-trips to the opened file; save-as → mutate →
save (no path argument, unlike before) writes to the path save-as recorded,
confirmed by reading it back with `lvl.read()`.

---

#### ARCH-01 — Document identity lived on the wrong side of the process boundary

Covered in detail as **BUG-08**, above — the same commit closes both.

---

#### BUG-09 — `win.dirty` was monkey-patched onto BrowserWindow; a dead renderer wedged close

Shipped: the ad-hoc `win.dirty` property is gone, subsumed by BUG-08's
`doc.dirty`. `main.js`'s `close` handler now time-bounds the renderer's
confirm round-trip (3 s) instead of waiting on it forever, and
`render-process-gone`/`unresponsive` on `win.webContents` both route to a new
`deadrenderer()` that stops trusting the renderer, shows a native "Studio
stopped responding — Reopen / Close" dialog, and lets the close through
either way. Neither mechanism existed before this change — confirmed by
reading the prior `main.js`, which checked only `win.dirty` and had no
listener on either event, so a hung renderer left the window, and on
Windows/Linux the whole app, permanently unclosable. Verified with the probe
harness two ways: `webContents.forcefullyCrashRenderer()` while idle now
surfaces the dialog and closes the window cleanly instead of leaving an
orphaned one; a dirty document whose own discard dialog is made to hang
forever (simulating a wedged renderer that never answers `req:close`) now
recovers via the 3 s timeout and closes, instead of hanging indefinitely.

---

#### VIS-01 — The resting text colour failed contrast; hover was the only readable state

Shipped: `--dim` retuned from `#6a4ba2` to `#9b7fd4` (5.12:1 on `--frame`, the
worst surface — up from 2.52:1) and a new `--acc-text: #9a74e0` (4.77:1 on
`--frame`) took over every place `--acc` had been used as a text colour
(`.tab.on`, `.hdr`, `li.on`, `.run`, `.mi:hover`); `--acc` itself is now
non-text use only (borders, rings, grid lines). Verified by recomputing WCAG
relative-luminance contrast for both new values against all six surfaces they
appear on: `--dim` now measures 5.12-5.91:1 and `--acc-text` 4.77-5.51:1
everywhere, clearing the 4.5:1 AA threshold with what was previously the worst
case now the closest margin, matching the audit's own measurement method.

---

#### VIS-02 — Control borders were invisible

Shipped: `--line` (`#241938`, 1.18:1) stays for decorative separators only; a
new `--control-border` (aliased to the existing `--acc`, `#7b56ba`) now
borders `input`/`select`/`textarea` and the `.act` button. Verified by
recomputing contrast: 3.12-3.59:1 against every surface a control sits on,
clearing WCAG 1.4.11's 3:1 non-text boundary requirement (previously 1.18:1,
failing everywhere).

---

#### VIS-06 — There were no focus indicators

Shipped: both `outline: 0` declarations (`canvas`; `#props input/select/
textarea:focus`) are deleted, and a single global `:focus-visible { outline:
2px solid var(--acc); outline-offset: 2px }` rule now applies everywhere,
including the canvas, which previously suppressed its own outline
unconditionally. Verified statically: `style.css` now contains exactly one
`outline` declaration — the new rule — with nothing left to override it. A
live capture of the ring was not possible in the headless probe harness,
since the offscreen window there never gains real OS input focus
(`document.hasFocus()` stayed `false` even after `BrowserWindow.focus()` and
`app.focus({steal: true})`); that is a limitation of the harness, not a claim
about the CSS, which the browser applies unconditionally once nothing
suppresses it.

---

#### ARCH-07 — No build, no packaging, no lint, no checks

Shipped, minus the packaging piece the finding itself deferred to NAT-07
("`npm run dist` — electron-builder (NAT-07)"): `eslint.config.js` adds
`npm run lint`, checking tabs, a `'use strict'` pragma and dead variables
across every `.js` file — deliberately no `no-undef`, since the renderer
scripts share one global scope on purpose (`CLAUDE.md`) and a name defined in
one file being "undefined" in another is by design, not a bug; `catalog.js`
gained a one-line `/* exported PLACEHOLDER, tex, ready */` comment so
`no-unused-vars` does not flag the three names it only exposes to `grid.js`
and `panel.js`. `tools/check.js` adds `npm run check`: the collision grep
`CLAUDE.md` documents by hand, a `blank() → write() → read()` round-trip
(level, a script, and a MIDI file, compared with `assert.deepStrictEqual`),
and `migrate()` over every `.json` in `../website/levels` (skipped with a
message if that directory is not checked out, rather than failing). `probe.js`
is committed under `tools/` with the env-var interface `CLAUDE.md` already
documented, now fixed to work on macOS too (the binary lives inside
`Electron.app` there, not at `dist/electron` as on the other two platforms)
and with `PB_SHOT` made optional. `CLAUDE.md`'s "Driving the app headlessly"
section now points at the committed file instead of embedding the snippet.
Verified: `npm run lint` and `npm run check` both exit 0 on a clean tree;
temporarily reintroducing a real collision (`function tex` added to `app.js`,
which already exists in `catalog.js`) made `npm run check` fail with
`tex: catalog.js and app.js`, confirming the check actually checks something,
then the reproduction was reverted; `tools/probe.js` driven directly through
the real Electron binary to boot the app, paint and undo a cell, and confirm
the palette still renders all 31 cells through `tex()`/`ready()`/`PLACEHOLDER`
after the `/* exported */` comment was added.

---

#### NAT-18 — Renderer hardening left on the table

Shipped: `main.js` now creates the `BrowserWindow` with `sandbox: true`
(`preload.js` requires nothing beyond `electron`'s `contextBridge`/
`ipcRenderer`, so the sandboxed preload is unaffected); a
`setWindowOpenHandler(() => ({action: 'deny'}))` refuses every window-open
request; and a `will-navigate` guard blocks navigation to anywhere outside the
app's own `app://studio/` origin. The recommended blanket
`e.preventDefault()` on every `will-navigate` turned out to be wrong: Electron
fires that event for `location.reload()` too, which would have silently
broken the Develop menu's guarded Reload item (NAT-01) the moment sandboxing
landed - confirmed empirically before shipping. The guard therefore checks the
target URL's origin instead, which still closes the data-loss hole (a dropped
file or a stray `location` assignment can no longer replace the app with a
view of that file, the same class of failure as BUG-01) without breaking the
one legitimate same-origin navigation the app performs. Verified with the
probe harness: `window.open()` now returns `null`; `location.href =
"https://example.com"` no longer navigates the window away; the guarded
Reload command (`ACTS.reload()`) still reloads and clears in-page state as
before, both when the document is clean and after a dirty document is
discarded or cancelled through the unsaved-changes dialog; `api.blank()`
still round-trips correctly under `sandbox: true`.

---

#### BUG-10 — The discard dialog's result is a magic integer coupled to button order

Shipped, alongside NAT-21 below since both touch the same dialog: `ask:discard`
now returns a named string (`'save' | 'discard' | 'cancel'`) rather than a
response index, mapped from the button array inside `main.js`'s new
`discardbuttons()` so the two can never drift; `App`'s `guard()` (`app.js`)
compares against the strings instead of magic integers `2`/`1`. Verified with
the probe harness: cancelling, discarding and saving through the guarded
Reload command each produce the correct behaviour under the new string
verdicts (mark-survives-cancel, mark-cleared-on-discard).

---

#### NAT-21 — The unsaved-changes dialog is not written to any platform's convention

Shipped: a new `discardbuttons()` in `main.js` returns the button words, order,
`defaultId` and `cancelId` for the running platform - macOS
`Cancel/Don't Save/Save`, Windows `Save/Don't Save/Cancel`, GNOME
`Discard/Cancel/Save` - and the dialog itself now carries `detail`,
`noLink: true` and a `title`. `discardbuttons()` originally lived directly in
`main.js`, next to the file's other `process.platform` checks, since
`chrome.js` did not exist yet; it has since moved there unchanged (ARCH-03,
done — see "Already completed"). Verified with the probe harness on macOS
(`darwin`): the dialog's button/verdict mapping was exercised through all
three outcomes (see BUG-10, above).

---

#### BUG-11 — Nothing checks that a level is playable

Shipped: `lvl.js` gained `review(doc)`, a second, non-blocking tier alongside
`validate()` - it warns on zero or multiple start/end blocks (tile ids `001`/
`004`), a definition pointing at a `scripts/…` path missing from the archive,
entities outside the level's bounds, definitions no entity uses, and scripts
no definition uses. `validate()` is untouched and still gates every write, per
`CLAUDE.md`'s single-source-of-truth rule for validation - `review()` never
blocks a save, only informs. `main.js` computes it alongside the document on
`lvl:new`, `lvl:open`, `lvl:save` and `lvl:saveas` and returns it in the same
response; `App.setwarnings()` (`app.js`) renders the count in the status bar
(clickable, switching the inspector to the level view) and the full list in a
new "warnings" section at the top of `levelview()` (`panel.js`). Recomputed on
every file operation rather than live on every edit, to avoid a second copy of
`review()`'s logic in the renderer (`CLAUDE.md`: validation-shaped logic lives
in `lvl.js` alone). Verified with the probe harness: a fresh blank level now
reports `["no start block placed (tile 1 is required)", "no end block placed
(tile 4 is required)"]` (previously zero warnings, and a silent, successful
save); painting a start and an end block clears both warnings and the level
still saves the same as before either way, confirming warnings never block a
save.

---

#### UX-10 — No autosave, no crash recovery, no backup

Shipped: while the document is dirty, `app.js` pushes a snapshot of it to main
roughly every 30s, gated on `!Grid.pan && Grid.paint < 0 && !Grid.moving` and
run through `Grid.commit()` first, per `CLAUDE.md`'s rule that every save path
must call it; `main.js` writes the snapshot through the same validated, atomic
`lvl.write()` used by a real save, to
`userData/recovery/<sha1-of-path>.lvl` (`'untitled'` for a level with no path
yet), alongside a small `index.json` recording which path and display name
each key belongs to. The snapshot is deleted on a successful save (`lvl:save`/
`lvl:saveas`) and on `forceclose` (an explicit discard, or a close that was
never dirty to begin with). Once the window first shows, `main.js` checks for
a leftover snapshot from an earlier crash and offers a native "Recover"/
"Discard" choice; recovering sends the document to the renderer, which loads
it, marks the level dirty, and pins `Undo.clean = -1` so undoing back to the
freshly-loaded depth 0 cannot misreport as clean - depth 0 here has no match
on disk, unlike a normally opened file. Studio edits one document at a time,
so only the newest snapshot is ever offered; older ones are cleared rather
than accumulating. Additionally, both `lvl:save` and `lvl:saveas` now copy the
file they are about to overwrite to `<name>.lvl.bak` first. Verified with the
probe harness, each in an isolated `--user-data-dir`: a snapshot is written
and its `index.json` entry matches; choosing Recover loads the seeded
document (`dirty: true`, `Undo.clean: -1`, warnings recomputed) and leaves the
snapshot in place; choosing Discard removes both the `.lvl` and its index
entry; a normal save clears any snapshot for the path just saved; overwriting
an existing file produces a `.bak` holding the pre-save content while the
live file holds the new content.

---

#### ARCH-02 — `W` is defined twice and `H` only once

Shipped: `catalog.js` now owns `B`, `W` and `H` (a new `const H = 12`,
exported alongside the other two); `lvl.js` no longer redefines `W`/`H`
itself and reads `cat.W`/`cat.H` at every site that used the bare names.
Verified: `npm run check`'s `blank() -> write() -> read()` round trip and its
migration pass over `website/levels/*` both still pass unchanged.

---

#### ARCH-03 — There is no platform abstraction and no way for the renderer to know its platform

Shipped: a new `chrome.js` in main is now the only place `process.platform`
is read - `main.js`'s `window-all-closed` guard, `menu.js`'s appMenu/
windowMenu split and NAT-21's `discardbuttons()` (previously inline in
`main.js`, done — see above) all consume it instead of each holding their own
check. `preload.js` exposes `api.platform`; `app.js` stamps it onto
`<html data-platform>` at boot, so `style.css` can key off
`[data-platform=...]` with no platform branching in the renderer's own
JavaScript at all. Verified with the probe harness: `[api.platform,
document.documentElement.dataset.platform]` both read `"darwin"`;
`chrome.windowoptions()` and `chrome.discardbuttons()`, called directly under
a forced `process.platform`, produce the correct distinct shape for
`darwin`, `win32` and `linux`.

---

#### NAT-02 — Fake macOS traffic lights are drawn on every platform

Shipped: the hand-drawn `.dots`/`#wclose`/`#wmin`/`#wmax` markup, styles and
the `win:ctl` IPC channel are gone. `chrome.js` (ARCH-03, done — see above)
supplies real per-platform `BrowserWindow` options instead: macOS gets
`titleBarStyle: 'hiddenInset'` with a `trafficLightPosition` computed from
the existing 34px title-bar height and the design's own 14px dot size
(VIS-03); Windows gets `titleBarStyle: 'hidden'` plus `titleBarOverlay`;
Linux keeps a normal, WM-decorated `frame: true` window rather than guessing
at Linux's inconsistent `titleBarOverlay` support, per the audit's own
guidance that a native frame - not a hard-coded macOS-shaped layout - is the
correct fallback there. `#title` reserves space for the native controls via
two `[data-platform]` CSS rules instead of drawing anything itself. The green
button now enters full screen rather than calling `maximize()`, for free -
real OS behaviour, no code required. Verified on macOS, the only platform
this shipped from: an on-screen screenshot (not `capturePage()`, which cannot
see native window chrome at all) shows a real OS-drawn traffic-light triple
at the window's top-left; `document.querySelectorAll('.dots, #wclose, #wmin,
#wmax').length` is `0`; `#title`'s computed `padding-left` is `78px`; open,
save, undo/redo, tab switching and closing a dirty document through the
native controls all still work. The Windows/Linux branches are implemented
against Electron's documented `titleBarOverlay`/`frame` behaviour but were
not exercised on real Windows or Linux hardware - flagged for the next
platform-equipped pass.

---

#### NAT-05 — Context menus are `<div>`s instead of native menus

Shipped: the hand-rolled `#menu`/`menu()`/`closemenu()` and the capture-phase
`mousedown` dismisser (~55 lines) are gone from `app.js` and `style.css`.
`rowmenu()`/`panelmenu()` now send the context a click needs (`kind`, `key`,
`entityDef` - read at click time, not left for main to ask again later, since
`Grid.sel` can change before an async popup resolves) over a new `menu:row`
channel; `main.js` builds the equivalent template with
`Menu.buildFromTemplate()` and pops it at the cursor; the chosen action comes
back over a new `rowcmd` channel to one dispatcher in `app.js` that reuses
the existing `App.opentab`/`Panel.assign`/`edit`/`delscript`/`delmidi`/
`addscript`/`addmidi` functions unchanged. Verified with a probe harness that
intercepts `Menu.buildFromTemplate` so no real OS popup ever opens, and
invokes the returned template's own `click()` handlers directly to drive the
real production code path: a script row's menu built exactly `open, assign
to entity (disabled - no entity selected), rename, delete, ---, new script,
import midi`; invoking `delete` removed the script from `App.doc.scripts`
end-to-end through the real IPC round trip; the panel-background menu built
exactly `new script, import midi`, and invoking `new script` opened the same
inline-rename `<input>` the old code did.

---

#### NAT-11 — The mouse wheel always zooms; trackpad gestures are not understood

Shipped: `onwheel()` (`grid.js`) now checks `ev.ctrlKey` - set by the OS for a
pinch, unset for a two-finger scroll or a plain wheel notch - instead of
always zooming. Ctrl+wheel (and a real pinch) zooms about the pointer,
unchanged in feel: the old, unexplained `0.0015` factor is now
`Math.LN2 / ZOOM_PX_PER_DOUBLING` with `ZOOM_PX_PER_DOUBLING = 462`, an exact
algebraic match. A bare wheel event pans by `(deltaX, deltaY)`; Shift+wheel
pans horizontally from a vertical-only wheel - the classic convention - only
when the device has not already supplied its own `deltaX`. `ev.deltaMode` is
normalised (`LINE`/`PAGE` to pixels) so the same physical notch feels the
same on every device. `ZMIN` is now shared between `Grid.fit()` and the
wheel's own clamp (GEO-11's `0.03`/`3` row and half of its `0.0015` row are
therefore already done here; `FITPAD`, `GRIDMIN`, `SELW` and `BARSLOP` were
named later, see "Already completed", GEO-11).
Verified with the probe harness: a plain wheel event (`deltaX: 40,
deltaY: 20`) panned the camera by `(80, 40)` world px at `z = 0.5` and left
zoom untouched; the same event with `ctrlKey: true` changed zoom
(`0.5 -> 0.58`) while re-centring on the pointer; `shiftKey: true, deltaX: 0,
deltaY: 60` panned horizontally by `120` world px and left `y` untouched.

---

#### A11Y-01 — Most of the interface is not reachable by keyboard

Shipped: the palette's 31+ cells are real `<button>`s now, not clickable
`<div>`s (`cell()`, `panel.js`), so Enter/Space activate them for free; the
file manager's script and MIDI rows carry `role="option"`/`aria-selected`
inside a `role="listbox"` (`list()`, `app.js`); the tab strip carries
`role="tablist"`/`role="tab"`/`aria-selected` (`tabs()`/`tab()`, `app.js`). All
three groups share one Tab stop each through a new `roving()` helper
(`panel.js`) implementing the standard roving-tabindex pattern - arrow keys
(plus Home/End) move both the tab stop and focus, matching the palette's grid
layout (4 columns) and the lists'/tabs' linear one. Activation beyond native
Enter/Space: script and MIDI rows get F2 to rename and Delete to delete
(`rowkeys()`); script rows get Enter to open, the keyboard equivalent of the
row's primary action; tabs get Enter/Space wired by hand, since the closable
ones nest a real `<button>` for the close glyph and a tab therefore cannot
itself be a `<button>` (button-in-button is invalid HTML and Chromium hoists
the inner one out). Making these previously-inert elements focusable exposed
a latent bug in `keys()` (`app.js`), whose old guard excluded only
`INPUT`/`TEXTAREA`/`SELECT` by tag name rather than requiring the canvas
itself to hold focus - fixed alongside this finding, since without it a
Delete keystroke aimed at a focused file row would also have deleted
whatever entity happened to be selected on the canvas underneath. Not
shipped, and still open: type-ahead search within a list; full ARIA listbox
group semantics for the palette's three sub-groups (it carries one
`role="group"` for the whole grid instead); `aria-controls`/`role="tabpanel"`
wiring for tabs, which would misdescribe the DOM as it stands today (every
script tab shares the one `#code` Monaco host, not one panel each). Verified
with the probe harness: the number of elements matching an
interactive-or-`[tabindex]` selector rose from the audit's measured 15 to 47;
the palette's 31 cells report exactly one `tabindex="0"` at a time, and
dispatching `ArrowRight` on the focused one moves both `document.activeElement`
and the tabindex to the next cell; a real `keydown` "Delete" dispatched on a
focused, unused script row deletes that script and leaves a canvas-selected
entity untouched, where before this fix's `keys()` change the same keystroke
would have deleted the entity too; `F2` on a row swaps in the inline rename
`<input>`; `Enter` on a script row opens it as a tab.

---

#### NAT-03 — Window title, dirty state and proxy icon ignore every OS convention

Shipped: `main.js` now owns a `retitle()` that runs whenever `doc.path`,
`doc.dirty` or the new `doc.name` changes - macOS and Linux get
`win.setTitle(name)`, the document name alone; Windows gets `name + ' — ' +
NAME`, since `titleBarOverlay` means the taskbar reads `document.title`
directly; macOS additionally gets `setRepresentedFilename(doc.path || '')`
for the proxy icon and `setDocumentEdited(doc.dirty)` for the close-button
dot. `doc.name` is the one part of this main cannot derive from `{path,
dirty}` alone (BUG-08, done — see "Already completed"), so a new `doc:name`
IPC channel (`preload.js`'s `api.retitle`) carries it from the renderer's
`App.retitle()` on every call. The in-window `#name` element and
`document.title` are no longer the same string built twice: `#name` now
shows the document name plus a dirty dot (`•`, not an asterisk) and nothing
else, with the full path moved to its `title=` tooltip; the renderer's own
`document.title` assignment is deleted outright. Verified with the probe
harness (a copy of `tools/probe.js` that also reads the `BrowserWindow`
itself, per `CLAUDE.md`'s guidance for main-process-only behaviour): setting
the level's name and touching the document produced `win.getTitle() ===
"My Level"` and `win.isDocumentEdited() === true`, with no path and no
asterisk anywhere in the title; `win.getRepresentedFilename()` was empty for
an unsaved document, as it should be.

---

#### NAT-10 — Window geometry is a fixed constant and is never remembered

Shipped, together with **GEO-12** below since the same commit closes both:
`main.js`'s four literals (`1600 × 950` default, `960 × 620` minimum) are
gone. The default size is now 80% of `screen.getPrimaryDisplay()
.workAreaSize` (which already excludes the menu bar, Dock and taskbar),
clamped between the unchanged minimum and the `1600 × 950` the UI was
actually designed and tested at - now a ceiling on the *default*, not a fixed
size, and centred (`center: true`) rather than placed at a hard-coded
`(160, 25)`. `MINW`/`MINH` stay the old `960 × 620` literals, named and
commented; deriving them from the panels' own new content-driven minimums
(`--side-min` + `--right-min` + a usable canvas width - GEO-03, done, see
"Already completed") instead of a guessed pair of numbers is still open, and
is now a pure main.js change with nothing left blocking it. `getNormalBounds()` plus
`isMaximized()`/`isFullScreen()` are persisted to
`userData/window.json` on every `close`, and restored on the next launch
**only if** the saved rectangle still overlaps some currently-attached
display's work area (`screen.getAllDisplays()`) - otherwise the derived
default is used instead, which is the multi-monitor case that breaks naive
implementations. Verified with the probe harness (the same main-process
variant as NAT-03, run with an isolated `--user-data-dir` per case): a fresh
launch on this machine's 1470 × 828 work area produced a `1176 × ~660`
window - smaller in both axes than the old hard-coded `1600 × 950`, which
would in fact have exceeded this display's width; resizing the window to
`(200, 100, 1000, 700)` and closing it wrote exactly that rectangle to
`window.json`, and a fresh launch against that `--user-data-dir` restored it
exactly; a `window.json` naming a rectangle at `(9000, 9000)` - off every
connected display - fell back to the derived default instead of restoring
off-screen; a `window.json` with `maximized: true` launched maximized while
`getNormalBounds()` still reported the un-maximized rectangle it would
restore to.

---

#### GEO-12 — Initial and minimum window size are not derived from the display

Covered in detail as **NAT-10**, above — the same commit closes both.

---

#### NAT-13 — No cursor feedback anywhere

Shipped: a new `Grid.cursor(c)` (`grid.js`) derives the canvas's CSS cursor
from `{pan, moving, tool, entity-under-pointer, in-bounds}` and writes
`Grid.cv.style.cursor` only when called - from `onmove()` on every pointer
move, and from `ondown()`/`onup()` so panning and entity-dragging switch to
`grabbing` on the same press that starts them rather than waiting for the
next `mousemove`. All seven states the finding asked for are implemented:
`crosshair` for the block/eraser tool, `copy` for the entity tool, `grab`
over an existing entity (regardless of which tool is active, matching
`ondown()`'s own precedence - grabbing an entity always wins over painting),
`grabbing` while panning or dragging an entity, and `not-allowed` outside the
level's bounds. Verified with the probe harness by calling `Grid.cursor()`
directly with each state and reading back `Grid.cv.style.cursor`: block tool
in-bounds → `crosshair`; out-of-bounds → `not-allowed`; entity tool →
`copy`; an entity pushed onto the hovered cell → `grab`; `Grid.pan` set →
`grabbing`; `Grid.moving` set → `grabbing`.

---

#### BUG-12 — Moving the window to a different-DPI display leaves the canvas blurry

Shipped: a new `watchdpr()` (`grid.js`), called once from `Grid.init()`,
arms a `matchMedia('(resolution: ' + devicePixelRatio + 'dppx)')` query and
re-runs `Grid.resize()` - which re-reads `devicePixelRatio` into `Grid.dpr`
and reallocates the canvas backing store - on its `change` event, then
re-arms a fresh query for whatever the ratio just became (a media query is
only valid for the ratio it was created at, so it cannot simply be reused).
This is the exact mechanism the audit itself recommended. Verified
structurally rather than by an actual DPI change: the headless probe
harness's offscreen window runs on a single, fixed-DPI display, the same
limitation the audit records for VIS-06's focus ring, so a live
before/after capture of a cross-monitor drag is not possible here. Confirmed
instead that `Grid.resize()` still correctly reads `Grid.dpr = devicePixelRatio
|| 1` (unchanged), that `watchdpr` is reachable and callable from the
renderer's shared global scope, and that `Grid.init()` calls it exactly once
per canvas so a resolution change is never left unwatched.

---

#### GEO-01 — There is no spacing, sizing or type scale

Shipped: `style.css` `:root` gained its one spacing/row/type scale - `--space-1`
through `--space-7` (a 2/4/6/8/12/16/24 progression), `--font-size`/
`--font-size-sm`, and a line-box token every row height is derived from
(`--row-sm`/`--row`/`--row-lg`, replacing `--bar`, `--tabs`, `.hdr`'s 24px,
`#status`'s 22px and `li`'s `1px 10px 1px 18px` padding with three named,
derived rows) - plus radius, elevation, motion and z-index tokens, defined but
not yet consumed at the time (VIS-08/VIS-09, both since done — see "Already
completed"; VIS-07 consumed the colour tokens this same commit added,
`--surface-hover`/`--surface-active`/`--fg-disabled`, done too). The line-box
token is named `--line-box`, not `--line` as the audit's own draft proposed,
because `--line` already names the separator-colour token shipped with VIS-01
and the two would otherwise silently overwrite each other in `:root`. GEO-02
(band heights) and part of GEO-08 (the gaps and font sizes that exactly
matched a new scale step) are resolved as a side effect - see their own
entries. Verified with the probe harness: `#tabs` computes to `34px` and
`#status` to `26px` (`--row-lg`/`--row-sm`; `.hdr` itself has since moved to
`--row-hdr`, 36px, GEO-13, done); after adding a script row, `li` computes to
`30px` (`--row`) where it previously measured 20px.

---

#### GEO-02 — Chrome band heights are unrelated to each other and to the type

Covered in detail as **GEO-01**, above — the same commit closes both.

---

#### VIS-04 — Colour is defined in four independent places

Shipped: `style.css` `:root` gained the missing surfaces (`--surface-raised`,
`--surface-selected`, `--canvas-bg`, `--checker-a`/`--checker-b`,
`--missing-tex`, `--missing-def`, `--scroll-thumb`, `--danger`) and an
`--acc-rgb` decimal triple so canvas alpha and the CSS accent read from one
number instead of two. A new `tokens.js` reads the colour custom properties
once, at load, into a plain `Tokens` object - the piece neither consumer could
do itself, since a canvas 2D context cannot resolve `var(...)` and Monaco's
`defineTheme()` wants a plain object literal, not a live stylesheet reference.
`grid.js`'s canvas clear, grid lines, selection ring, hover cell, level bounds
and missing-texture swatches all read `Tokens` instead of restating the
literal; `code.js`'s `THEME` generates its `--fg`/`--acc`/`--tab`/
`--scroll-thumb`-derived keys from the same object rather than transcribing
them by hand (the three keys with no existing token to duplicate - `#150f24`,
`#2e2049`, `#1e1633` - are untouched; giving them a considered relationship to
the surrounding chrome is VIS-18, not this). `main.js`'s `backgroundColor`
remains the one documented, necessary duplicate, now with a comment naming
`--frame` as its source. Verified with the probe harness: `Tokens` matches
every `:root` colour value it names exactly; `THEME.colors['editorCursor.
foreground'] === Tokens.acc` and `'editorWidget.background' === Tokens.tab`
both read `true`; `getComputedStyle()` on a palette cell and a `#props input`
both compute to `--surface-raised`'s `rgb(23, 16, 42)`.

---

#### NAT-20 — Only one of four scroll containers is styled

Shipped, together with **GEO-09** below since the same commit closes both: new
`--scrollbar`/`--scrollbar-pad`/`--scrollbar-thumb` tokens (track thickness,
thumb inset, and the thumb's own thickness derived from the other two, so the
capsule radius is `--scrollbar-thumb / 2` by construction rather than by the
coincidence of a too-large radius CSS silently clamps) are now shared by
`#scripts`, `#midis`, `#palette` and `#props` as well as `#hbar`, with
`scrollbar-gutter: stable` on the four vertical containers so their content
width no longer depends on the platform's overlay-vs-classic scrollbar
convention or the user's "always show scrollbars" setting. Monaco's own
scrollbar theme keys are untouched - that is VIS-18's scope, not this one's.
Verified with the probe harness: `getComputedStyle(...).scrollbarGutter` reads
`"stable"` on all four vertical containers and `"auto"` on `#hbar` (by design -
a horizontal-only container has no vertical gutter to reserve); a screenshot
of the running app shows no unstyled system scrollbar in the palette.

---

#### GEO-09 — The horizontal scrollbar band is three mismatched numbers

Covered in detail as **NAT-20**, above — the same commit closes both.

---

#### PERF-01 — The inspector is rebuilt from an HTML string on every cell of an entity drag

Shipped: a new `Panel.update(e)` (`panel.js`) writes the `x`/`y`/`cell` field
values directly when the inspector is already showing the entity being
dragged, returning `false` (so the caller falls back to a full rebuild) only
when it is not. `onmove()`'s entity-move branch (`grid.js`) calls it instead
of `App.inspect()` on every cell the entity crosses; `onup()` calls the real
`App.inspect()` once, when the gesture ends, exactly as the audit's own
"Recommended" section asked. `ARCH-04`'s other call site - the `onchange`
handlers destroying a field's own caret - is unaffected and still open, though
`Panel.update()` is now there for it to reuse. Verified with the probe
harness: instrumented `Panel.inspect()` and drove a synthetic 5-cell entity
drag directly through `ondown()`/`onmove()`/`onup()` - `Panel.inspect()` was
called **0** times during the 5-cell drag (previously once per cell, several
dozen times a second at a fast drag) and **1** time after `onup()`; the
`#p_x` DOM node's identity was unchanged across the whole drag, confirming no
rebuild happened; the field's value tracked the entity's position live
(`"700"` after moving to column 7).

---

#### A11Y-05 — Nothing is announced

Shipped: `#msg` carries `role="status"` and `aria-atomic="true"` in
`index.html`, present and empty in the DOM at load rather than created when
the first message arrives, per the audit's own requirement for a reliably
announced live region. `App.fail()`'s dynamically-created `.err` block gets
`role="alert"`/`aria-atomic="true"` at creation instead - the audit's
alternative suggestion, and the correct one here: `role="alert"` is defined to
announce even a freshly-inserted node, which is what this block always is,
since `Panel.inspect()` (called immediately before it) wipes `#props` on every
failure. The audit's literal recommendation to give the *whole* `#status` bar
`role="status"` was not followed - it would also make every mouse-driven
cursor-position update (`#cursor`, updated on almost every `mousemove`) a
live-region announcement, which is noise no user asked for; A11Y-03's own
keyboard-cursor case is where position genuinely needs announcing, and it has
since shipped through exactly this live region (done — see "Already
completed"). Verified with the
probe harness: `#msg`'s `role` reads `"status"`; calling `App.fail()` produces
a `.err` element with `role="alert"`, `aria-atomic="true"` and the failure
text.

---

#### GEO-11 — Canvas magic numbers

Shipped: `grid.js` gained a named `const` block - `FITPAD = B` (`Grid.fit()`'s
margin above and below the level), `GRIDMIN = 10` (the device-px threshold
below which grid lines stop drawing), `SELW = 2` (the selection ring's stroke
width, with its inset now derived as `SELW / 2` rather than the bare `1`/`2`
pair it used to be), and `BARSLOP = 1` (the scrollbar re-entrancy tolerance,
now provably the same value at both the site that writes `bar.scrollLeft` and
the site that reads it back) - joining `ZMIN`/`ZMAX`/`ZOOM_PX_PER_DOUBLING`,
already named (NAT-11, done, see above). The `+ .5` canvas offsets are left as
bare literals, per the finding's own text, with a comment added at their first
use explaining why they are correct as written. `ZMIN` itself still uses its
old floor rather than a "the level fits the narrowest viewport" derivation -
the finding's own "Recommended" section scoped this to naming constants, not
reformulating them, so that remains a separate, un-filed possibility rather
than a gap in this fix. Verified with the probe harness: all four names are
reachable in the renderer's shared global scope with their expected values
(`100`, `10`, `2`, `1`); `Grid.fit()` still produces the same zoom it did
before the rename for an unchanged level.

---

#### PERF-04 — Canvas resize is uncoalesced

Shipped: `Grid.resize()` (`grid.js`) no longer reallocates the canvas backing
store synchronously on every `ResizeObserver` callback - it now schedules one
`requestAnimationFrame` (tracked on `Grid.rsz`, the same coalescing pattern
`Grid.redraw()`/`Grid.need` already established), and the actual work,
`doresize()`, skips reassigning `cv.width`/`cv.height` when the computed
target device-pixel dimensions have not changed from the canvas's current
ones - a DPI-only change (BUG-12's case) still reallocates, since the target
dimensions genuinely differ at the same CSS size. Verified with the probe
harness: instrumenting `requestAnimationFrame` and firing `Grid.resize()`
five times in a burst scheduled exactly **one** frame, not five; the canvas's
`width`/`height` were unchanged and correct after the coalesced frame ran.

---

#### GEO-07 — The palette produces fractional cells for 32 px sprites

Shipped: `style.css` gained `--sprite: 32px` and `--cell: var(--sprite)`;
`#palette`'s `grid-template-columns: repeat(4, 1fr)` is now
`repeat(auto-fill, var(--cell))` with `justify-content: start`, so cells are
always an integer 32px and the *column count*, not the cell size, changes
with the panel's width. Offering 1×/2× cell sizes as a preference (UX-11) was
not implemented - out of this finding's own scope, which only asked that the
token exist for such a preference to flip later. Fixing this exposed a real,
separate layout bug: `#right` (a flex item whose default `min-width` is
`auto`) was sizing itself off the grid's own large intrinsic width instead of
its clamped flex-basis, because a `repeat(auto-fill, <fixed size>)` grid -
unlike the old `1fr`-based one, which had almost no minimum-content width -
has a real one. `min-width: 0` on `#side`/`#right` (the standard fix for
exactly this class of flex-sizing bug) closed it; without it, `#right` was
measured at 350px against a computed 13% target of 200px, silently ignoring
its own flex-basis entirely. `panel.js`'s roving-tabindex helper used a
hardcoded `PALCOLS = 4` for arrow-key navigation, which the palette's now
width-dependent column count would have made wrong at any width other than
the one it was written against; replaced with `palcols()`, which reads the
actual column count back from the grid's own resolved
`gridTemplateColumns`. Verified with the probe harness: `getComputedStyle(
palette).gridTemplateColumns` now reports N `"32px"` entries (previously
`"42.25px"` × 4) at the window size tested; a screenshot shows crisp,
unblurred cell borders where the old fractional cells anti-aliased to grey.

---

#### GEO-03 — Side panels are fixed pixel widths and consume 41 % of the minimum window

Shipped: `--side`/`--right` in `style.css` are now
`clamp(var(--side-min), 10.5%, var(--side-max))` /
`clamp(var(--right-min), 13%, var(--right-max))` - the percentages are the
design file's own ratios (`Pellizzola Brothers.svg`: 10.44%, 13.09%), stated
as such rather than frozen into one window width's pixels. `--right-min` is
content-driven exactly as the finding asked: the width three whole `--cell`
columns need, plus the palette's own padding/gaps and the scrollbar gutter
(GEO-07, NAT-20, both done). `--side-min` has no equally concrete formula in
the finding to follow - the file manager has no analogous "N whole units"
constraint - so it is derived instead from a legible file name in `ch` units
(which tracks the actual font's metrics, not a guessed pixel count) plus
`li`'s own indent/padding and the scrollbar gutter. Both maxima are 320px, a
ceiling wide enough for the palette's default four-across layout or the
inspector's widest field without ballooning into empty space on an ultrawide
display. User-resizing that overrides this default, per the finding's own
closing note ("the proportion is the default, not a cage"), is GEO-04, done -
see "Already completed" below. Verified with the probe harness: at this machine's measured
1536px window width, `#right` computed to `199.672px` (`clamp(132px, 13% =
199.68px, 320px)`, matching by hand) and `#side` to `161.266px` (10.5% of
1536, above its own floor); the palette rendered 4 whole 32px columns in that
width, confirming GEO-07's own integer-cell math now has room to work with.

---

#### ARCH-08 — Monaco is loaded eagerly and shipped whole

Shipped: `Code.init()` (`code.js`) is now idempotent - a first call actually
loads Monaco (showing a plain "loading editor…" placeholder in `#code` while
it does), a call made while that load is already in flight queues its
callback instead of starting a second `require(['vs/editor/editor.main'],
...)`, and a call once ready runs its callback immediately. `App.select()`
(`app.js`) calls it on the first script-tab activation instead of the
unconditional call `DOMContentLoaded` used to make, so the Level Editor tab -
the one every session opens first, and the only one most sessions ever use -
no longer pulls in several megabytes of JavaScript it never touches.
Narrowing the packaged `files` list (this finding's other half) has nothing
to narrow yet, since no packaging configuration exists (NAT-07, still open).
Verified with the probe harness: `Code.ready`/`Code.loading` both read
`false` immediately after boot, before any script tab is opened; opening a
script tab drives `Code.ready` to `true` (polled), with a real Monaco model
holding the new script's content; opening a second script tab immediately
after reused the same editor instance with no second load, showing the
second script's own content; a screenshot confirms the editor renders
correctly end-to-end after the lazy load.

---

#### VIS-05 — The application has never been rendered in its own typeface

Shipped: `fonts/JetBrainsMono-Regular.woff2` (OFL-licensed, licence included
as `fonts/JetBrainsMono-LICENSE.txt`) is now bundled and loaded via a
`font-display: block` `@font-face` in `style.css`, so the whole chrome does
not reflow after first paint. The two `<b>` elements that existed purely for
layout - `tab()`'s label and `list()`'s row name, both in `app.js` - are now
`<span>`s, and the `font-weight: normal` overrides that used to fight them
are gone, since only the 400 weight ships. `code.js`'s Monaco theme already
pointed at the same family; it now actually resolves it instead of falling
back by accident. Verified with the probe harness's own canvas metrics
probe: `"JetBrains Mono"` now measures 93.6px for `"mmmmmmmmmmlli"` at 12px,
distinct from the fallback stack's unchanged 103.34px - previously all five
families in the audit's own test, including a deliberately nonexistent one,
measured identically; a screenshot of the running app shows the real
typeface's glyph shapes throughout.

---

#### NAT-04 — The custom hotbar duplicates what belongs in the menu

Shipped, per-platform as the finding's own "Recommended" section asked:
macOS hides the hotbar entirely (`html[data-platform="darwin"] .acts {
display: none }`, `style.css`) since the menu bar already carries New/Open/
Save/Save As with the same accelerators regardless of window framing;
Windows/Linux keep it, now a real toolbar - `role="toolbar"`, per-button
tooltips carrying the platform's own accelerator glyphs (`⌘N`/`Ctrl+N`, read
from `api.platform`), and one Tab stop with arrow-key roving via the same
`roving()` helper A11Y-01 gave the palette, file lists and tab strip.
Verified with the probe harness on macOS: `.acts` computes `display: none`;
forcing it visible (simulating Windows/Linux, not run on real hardware)
confirms `ArrowRight` moves both focus and the roving tabindex from "new" to
"open", and tooltips read `"new (⌘N)"` / `"save as (⌘⇧S)"`.

---

#### UX-04 — Zoom has no controls, no indicator, and no fit-width

Shipped: `Grid.fit()` (`grid.js`) originally took the smaller of the
width-fit and height-fit scales against the level's actual full width -
`Grid.fitH()`/`Grid.fitW()` keep the single-axis behaviour available as
explicit commands, per the finding's own "keep fit-height as an explicit
command" note. That full-width fit turned out to still be the wrong target
even at `min()`: a 540-column level clamps to `ZMIN` and shows most, but
never all, of an unfittable width, which reads the same as the original bug
to a user - so a follow-up (same session) redefined "fit"/"fit width" to
target the scene nearest the camera instead of the whole level (`grid.js`'s
`SCENES`/`SCENECOLS`/`curscene()`/`fitscene()`, `CLAUDE.md`'s new "A level
divides into 9 scenes" note); `Grid.fitH()` is untouched, since height is not
scene-divided. `Grid.zoomto()`/`Grid.zoomby()` zoom about the canvas's own
centre, driving a new View menu (`menu.js`: Zoom In/Out, Actual Size, Fit
Height/Scene Width/Scene, and Toggle Full Screen - which had no home since
NAT-01's menu shipped without a View menu, closing the §12 "Full screen"
regression too) and a new `#zoom` status-bar button showing the live
percentage, opening a native 25/50/100/200%/Fit quick-menu (`main.js`'s
`menu:zoom`, mirroring NAT-05's row-menu pattern) on click. Verified with the
probe harness: `Grid.fitH()` on this window reproduced the audit's own
finding almost exactly (z = 0.469, ~4.6% of the level's width visible,
against the audit's measured 3.7%); from a settled camera, `Grid.fit()` now
computes scene 0 (camx -100, stable under repeated calls) instead of clamping
to `ZMIN` over the whole level; panning into scene 3 and re-fitting locks
onto scene 3 with the entire scene inside the viewport; `zoomby(ZOOM_STEP)`/
`zoomto(1)` move the camera as expected; a patched `Menu.buildFromTemplate`
confirms the View menu reads "Fit Height"/"Fit Scene Width"/"Fit Scene" with
Zoom In enabled on the level tab and a `togglefullscreen` role.

---

#### VIS-07 — There is no interaction-state system

Shipped: new `--surface-hover`/`--surface-active` tints apply through one
generic `button` rule to every button in the app; `li`/`.tab` get the same
tints plus a shared "selected" contract - accent text, `--surface-selected`,
and a `--border-strong` accent marker on the edge each reads naturally from
(`li.on`'s left edge, a vertical list; `.tab.on`'s bottom edge, where it
meets the content it opens) - closing the finding's own complaint that
`li.on`/`.tab.on`/`.cell.on` were three unrelated mechanisms for one
semantic. A new `--fg-disabled` (3.48-4.56:1 against every surface it sits
on, computed the same way VIS-01 tuned `--dim`/`--acc-text`) replaces
`opacity: .35` for every disabled control, including `#props`'s read-only
fields, which had no disabled styling of their own before this. The
`.mi.off` case the finding's own "Current" section cited is moot - NAT-05
deleted the DOM context menu `.mi` belonged to. Verified with the probe
harness: the disabled playtest button's computed colour now reads `#786a9c`
(was ≈1.5:1, effectively invisible, under `opacity: .35` on `--acc-text`);
opening a script tab shows `.tab.on::after` and its row's `li.on::before`
both computing to a 2px `rgb(123, 86, 186)` (`--acc`) marker, with the row's
own background at `--surface-selected`; a screenshot confirms both markers
render and the palette's sprites are unaffected by the new hover/active
tints.

---

#### GEO-04 — Panels cannot be resized

Shipped: `#body` (`style.css`) is now a CSS grid - `var(--side) var(--split)
minmax(0,1fr) var(--split) var(--right)` - with four keyboard-operable
splitters (`layout.js`, new): `#side | #stage` and `#stage | #right` drag an
absolute length clamped to GEO-03's own `--side-min`/`--side-max`/
`--right-min`/`--right-max` tokens (read live via a hidden probe element,
since a `calc()`-based custom property's own computed value does not resolve
to a px number the way a real layout box's does); `#scripts | #midis` and
`#palette | #props` (new `--scripts-h`/`--props-h` tokens) drag a plain
percentage within a 15-85% floor and ceiling, since neither split had a
content-driven min/max of its own yet (GEO-05 and GEO-06, both since done -
see "Already completed", below). Each
splitter is `role="separator"`, drags via Pointer Events with the OS cursor
locked to the whole document for the gesture's duration, and double-click or
Enter removes the override so the panel goes back to tracking the window
through the stylesheet's own default. Persisted to `localStorage` - view
state, never the `.lvl` (`CLAUDE.md`). `Grid.resize()`'s existing
`ResizeObserver` on `#wrap` (PERF-04, done) picks up the canvas's new size
with no additional wiring. Verified with the probe harness: a synthetic drag
on the side splitter moves `#side` from its clamp()-derived 161px to exactly
250px and persists `{"side":250}`; double-click removes the override and
`#side` returns to exactly its pre-drag width; `ArrowRight` moves it a
further 16px with `aria-valuenow` tracking; the same sequence for the
scripts/midis split moves `--scripts-h` from 60% to 30% and back. A full
regression pass through the real gesture path confirmed paint, undo/redo,
entity placement, script create/rename/delete, MIDI import and a save-as/
open round trip all still work with the new grid layout in place.

---

#### UX-12 — Escape does not cancel an in-progress gesture

Shipped: a new `Grid.cancel()` (`grid.js`) reverts whatever the currently-open
`Undo` step has already applied - reusing `apply()` against the step's own
`before` shot via a new `Undo.cancel()` (`undo.js`), exactly as if the step had
been undone rather than completed - then resets `pan`/`paint`/`last`/`moving`
and returns whether a gesture was actually open. `keys()`'s Escape branch
(`app.js`) calls it first, falling back to the previous plain-deselect
behaviour only when nothing was open; `Grid.init()` also wires it to
`window.blur`, so alt-tabbing away mid-drag no longer leaves the gesture (and
its still-open `Undo` step) live, per the finding's own "Related" note.
Verified with the probe harness: a synthetic mousedown-then-mousemove paint
drag left 6 cells changed and `Undo.step` open; dispatching Escape reverted
all 6 cells, closed the step without pushing it onto `Undo.past` (`past.length`
unchanged, `App.dirty` still `false`), and cleared `paint`/`last`/`moving`; a
second drag cancelled via a synthetic `blur` event reverted identically.

---

#### NAT-12 — Right-click erases, which collides with Ctrl-click on macOS and blocks a canvas menu

Shipped: a right *press* (`ondown()`, `grid.js`) no longer erases by itself -
it only records the press (position, cell, whatever entity was under it); a
right **drag** past a 3px threshold (`onmove()`) converts it into the same
erase gesture as before, so "keep right-drag-to-erase" (the finding's own
first bullet) is unchanged. A press that reaches mouseup without ever
converting was a click, resolved into a new canvas context menu instead
(`canvasmenu()`/`onup()`, `grid.js`; `main.js`'s `menu:row` handler grows a
`kind === 'canvas'` branch) carrying the two actions that already have a real
implementation - delete the clicked entity, fit the view - rather than the
finding's fuller wish list (duplicate, toggle grid), which are features that
do not exist yet and are out of this finding's own scope. On macOS, Ctrl+click
arrives as this same button-2 event; it is marked `noerase` at press time and
never converts into an erase regardless of any subsequent movement, per the
finding's own "do not treat Ctrl+click as erase" instruction. Verified with the
probe harness: a plain right click with no movement erased nothing (previously
erased one cell) and built a menu template reading `delete entity` (disabled),
`fit view`; painting then right-dragging across the same cells still erased
all of them, confirming the drag gesture is unchanged; placing an entity and
right-clicking it (no drag) built the menu with `delete entity` **enabled**,
and invoking it removed exactly that entity; a Ctrl+click drag across painted
cells erased nothing despite the movement.

---

#### A11Y-04 — Hit targets are below the platform minimums

Shipped: `.tab .tabclose` and `.hdr button` (the tab-close glyph and the MIDI
header's `+`) each grow a `display: flex; align-items: center;
justify-content: center` box sized to `--space-7` (24px, GEO-01's own token,
not a new literal) - the glyph inside is untouched, so only the *hit* area
grows, per the finding's own "does not require 24px of visual area" note. `li`
file rows were already 30px (GEO-01) and window controls are already the OS's
own (NAT-02), so those two rows needed nothing further. Verified with the
probe harness: `getComputedStyle()` on `#addmidi` and on a `.tab .tabclose`
both now read `24px` × `24px` (previously measured ≈12×12 and ≈7×18).

---

#### GEO-05 — `#scripts` 60 % / `#midis` 40 % is arbitrary and ergonomically backwards

Shipped: `#scripts`/`#midis` (`style.css`) default to `flex: 0 1 auto` with a
three-row `min-height` floor (`#scripts` also capped at a 70% ceiling), so each
section is only as tall as its own content by default - the exact rule the
finding's own "Recommended" section gives. A user's own drag still overrides
it: `layout.js`'s `pctsplitter()` grows an optional `cls`/`target` pair, toggled
onto `#side` as `.split-scripts` for exactly as long as `--scripts-h` is
actually overridden (dragged, stepped, or restored from a previous session),
and `#side.split-scripts #scripts` is the only rule that still reads the
literal `--scripts-h` percentage - one custom property, two meanings resolved
by which class is present, rather than a second token. Verified with the probe
harness: a fresh document's `#scripts` computed to exactly `90px`
(`--row * 3`, the floor) with no `.split-scripts` class present; pressing
`ArrowDown` on the scripts splitter applied `.split-scripts` and moved
`--scripts-h` to `62%`, confirming the keyboard-operable override still works
unchanged.

---

#### VIS-12 — Empty states are blank voids

Shipped: `list()` (`app.js`) renders a single non-option `<li class="empty"
role="presentation">` in place of the row loop whenever a list is empty -
"no scripts yet · **new script**", "no midi files · **import…**" - wired to
the same `addscript()`/`addmidi()` the section's own create commands already
use, so there is exactly one way to do each, not two. `addscript()` also drops
any such placeholder before appending its own inline-rename row, so the
message does not linger above the new field while the user is still typing.
Depended on GEO-05 (done, above) for a sensibly-sized region to sit in.
Verified with the probe harness: a fresh document's `#scripts`/`#midis` each
show exactly one child with the expected text; adding a script removes the
placeholder and leaves one real row; clicking the placeholder's own button
end-to-end starts the inline script-rename field (and, for MIDI, drives a
stubbed import dialog through to a real new row) exactly as the equivalent
header/menu commands already did.

---

#### UX-08 — Destructive actions have no confirmation and no undo affordance

Shipped, without a modal confirmation - both are undoable already, and the
finding's own text is explicit that a dialog on top would be pure friction.
`Grid.setheight()` (`grid.js`) counts how many entities its own shrink
splices out and reports it through `App.say()` - `level shortened to 8 rows,
1 entity removed · ⌘Z to undo` (`Ctrl+Z` off macOS) - or the plain `level
grown/shortened to N rows` when nothing was lost. `panel.js`'s `p_rm` handler
(`remove definition`) does the same for the entities a definition removal
takes with it: `removed 'goomba' and 40 entities · ⌘Z to undo`. The rows
field also gained a live, in-place warning as the finding's second bullet
asked: a new `oninput` handler (`levelview()`, `panel.js`) computes how many
entities sit below the typed row count and shows `N entities below row 8
will be removed` in a `.hint` under the field, before the value ever commits
on `onchange`. Verified with the probe harness: placing an entity then
calling `Grid.setheight()` to a smaller value produced exactly the expected
message and left the entity gone; typing a shorter row count into `p_rows`
populated the hint with the correct count and target row, and clearing it
back to the current height cleared the hint; removing a definition with two
placed entities produced `removed 'custom_1' and 2 entities · ⌘Z to undo` and
left both entities gone.

---

#### VIS-08 — There is no motion at all

Shipped, deliberately minimal and tokenised exactly as recommended:
`transition: background-color/color var(--dur-fast) var(--ease)` on the
generic `button`, `.tab`, `li` and `.cell` rules covers hover/active/selected
tints everywhere they apply (a state class only ever changes which
background/colour value wins - the transition property living once, on the
base selector, is what makes every state under it animate without a rule per
state); the focus ring's `outline-color` transitions the same way; `#msg`'s
colour transitions at `--dur` for the less-frequent error/success swap; the
inline rename field (`edit()`, `app.js`) fades in via a new `pb-fade-in`
keyframe referenced from its own inline style, since the field is still
styled inline (VIS-15, still open) rather than through a class this could
attach to structurally. Canvas drawing, tab content swapping and the save
path are untouched, per the finding's own "do not animate" list. The
mandatory `@media (prefers-reduced-motion: reduce)` companion landed in the
same commit, collapsing every transition and animation to 1ms. Verified with
the probe harness: `getComputedStyle()` on a button and a tab both report a
`0.09s` (`--dur-fast`) transition duration; a full regression pass (paint,
undo/redo, save/open, script create/rename/tab-switch) showed no behavioural
change, confirming the motion is purely cosmetic.

---

#### VIS-09 — No radius, border-width or elevation scale

Shipped: `--radius-1` already had a consumer (the generic `button` rule,
which palette cells inherit since they are real `<button>`s, A11Y-01) -
`--radius-2` is now the standalone-action-button tier, applied to the hotbar,
`.act`, the two header `+`s and the active tab's own corner flare (GEO-13);
`--radius-3` stays deliberately unconsumed, since there is still no dialog or
popover that would need it. `--elev-1` now shadows both side panels, per the
design's own drop-shadow filters (GEO-13); `--elev-2` stays unconsumed for
the same reason NAT-05 already gave it - the context menu that would have
been its only consumer is native now. `--border` replaced the bare `1px`
literal on `.cell`, `#props`'s fields and `.act`, so the one border-width
token actually has consumers instead of being defined and ignored. Verified
with the probe harness: `getComputedStyle()` on `#add` reports a `4px`
border-radius (`--radius-2`); on `#side` a `box-shadow` matching `--elev-1`'s
`0 1px 2px rgba(0,0,0,.4)`.

---

#### GEO-13 — Design-file proportions that were not carried over

Shipped, two of three items in full and the third as a documented,
evidence-based departure rather than a literal transcription. (1) The
window's own top-corner radius is the OS's to own now (NAT-02, done); the
internal tab flare is real, but at `--radius-2` (4px) rather than the
design's literal 26px - at 34px tall (`--row-lg`), this tab strip would read
as a pill at 26px, not a flare, so the figure does not transfer from the
scale it was drawn at, and `--radius-2` is the largest step actually
proportionate to an element this size (recorded in `CLAUDE.md`'s
"Deviations from the design file", the section the finding's own text names
for exactly this). (2) A new `--row-hdr` token (`calc(var(--line-box) * 2)`,
36px - the same "N × line-box" statement `--row-sm`/`--row`/`--row-lg`
already make) now drives every section header (`.hdr`), replacing the
`--row-sm` (26px) it defaulted to. (3) Both side panels carry `--elev-1`
(VIS-09, above). Verified with the probe harness: `getComputedStyle()` on
`.tab.on` reports `4px 4px 0 0`; on a `.hdr` element, a `36px` height; on
`#side`, the `--elev-1` box-shadow.

---

#### A11Y-02 — The DOM has no semantics

Shipped the scope A11Y-01 left open: `#title` (`index.html`) is a real
`<header>` now, not a `<div>`; each of the four section headers (`scripts`,
`midi`, `items`, `properties`) is a real `<h2 class="hdr">` with its own id,
and the list or panel it labels points back to it with `aria-labelledby`
instead of a second, parallel `aria-label` string naming the same thing
(`list()`/`app.js` for the file lists, `Panel.palette()`/`panel.js` for the
palette); `#props` carries `role="region" aria-label="Properties"`, and its
`h4`s were already real headings, so an inspector user can already jump
between them. `.hdr`'s own CSS gained `font: inherit` - a heading carries UA
default font-size/weight a `<div>` never did, which would otherwise have
blown the row out of its token-derived height the moment the tag changed.
The disabled `▶` button's `aria-disabled`/`aria-describedby` stays with
VIS-13, as the finding's own text already scoped it. Verified with the probe
harness: `document.getElementById('title').tagName === 'HEADER'`; all four
header ids resolve to `H2` elements; `#scripts`/`#midis`/`#palette` each
report the expected `aria-labelledby`; `#props` reports `role="region"`,
`aria-label="Properties"`; `getComputedStyle()` on a header element reports
the inherited `12px` font size, not a heading's UA default; a full
regression pass (paint, undo/redo, save/open, script rename/delete, MIDI
import, tab switching) showed no behavioural change.

---

#### GEO-06 — `#props { flex: 0 1 46% }` is an unexplained fraction

Shipped: `#props` defaults to `flex: 0 1 auto` with a three-row floor and a
70% ceiling - the inspector is as tall as its own fields, exactly the
`flex: 0 1 auto`/`min-height`/`max-height` pattern GEO-05 already gave
`#scripts`, with `#palette` (the DOM's first child of the pair, taking the
role `#midis` played there) as the one that absorbs the remainder. A user's
own drag still overrides the default: `layout.js`'s `pctsplitter()` call for
the props splitter grew the same `cls`/`target` pair GEO-05 introduced,
toggling `.split-props` on `#right` for exactly as long as `--props-h` is
actually overridden. Verified with the probe harness, in a clean
`--user-data-dir` (a stale drag from an earlier test run otherwise persists
`--props-h` across separate probe launches and silently defeats the
content-driven default - the first read gave a false failure here): the
level view (seven fields) computed to 479px, matching its own 467px
`scrollHeight` almost exactly; switching to a definition view (three fields,
via `newdef()`) reflowed it down to exactly 175px, matching that view's own
175px `scrollHeight` precisely; no `.split-props` class present in either
case.

---

#### UX-06 — The active tool is barely indicated

Shipped: `Panel.palette()` now calls a new `App.tool()` with the newly
selected tool's own display name - the same name each cell already shows as
its own tooltip/`aria-label` (`toolname()`, `panel.js`) - writing `tool:
brick` / `tool: air (eraser)` / `tool: chapeleira` into a new `#tool` status
field. `.cell.on` also gains a filled corner-triangle marker on top of
VIS-07's existing accent border + fill, the same "a border alone is easy to
miss" reasoning `li.on`/`.tab.on`'s own edge markers were built for. Verified
with the probe harness: `#tool`'s text read `"tool: brick"` for the default
tool, updated to `"tool: air (eraser)"` and `"tool: chapeleira"` after
switching; `getComputedStyle(cell, '::after')` on the selected cell reported
the expected triangle border.

---

#### VIS-14 — Status messages are transient information rendered permanently

Shipped: `App.say()` now clears a transient (non-error) message after ~4s,
using a single tracked timer so an overlapping call cannot have its message
wiped early by a stale one; an error (`bad: true`) never auto-clears, per the
finding's own text, and now carries an aria-hidden `⚠` glyph plus its
existing `--danger` colour rather than colour alone - `App.fail()`'s `.err`
block gets the same glyph. Three new persistent status fields - `#dims`
(`W×Grid.h`) and `#entcount` (the entity count) - are updated once per frame
from `Grid.draw()`, the same place `App.zoom()` already got its own readout,
so they stay correct without hunting down every one of the several places
that add or remove an entity; the fourth persistent field the finding asked
for, the active tool, is UX-06 (done, same batch). `#msg` gained a
`border-left`/`padding-left` divider so the persistent group and the
transient message read as two different kinds of field, not one long run of
five. Verified with the probe harness: a success message's `textContent`
was empty after a 4.3s wait; an error message's was not; the error message's
own `<span aria-hidden>` held the glyph; `#dims`/`#entcount` read `"540×12"`/
`"0 entities"` on a fresh document.

---

#### A11Y-08 — Disabled and error states are communicated by colour alone

Shipped: `aria-disabled="true"` now sits alongside the native `disabled`
attribute on all three disabled controls (`#run`, the level view's read-only
width field, the entity view's read-only cell field). The error-icon half of
this finding shipped together with VIS-14 (same batch, same `⚠` glyph on
`#msg.bad` and `App.fail()`'s `.err` block), since both findings asked for
exactly the same fix on the same element. Verified with the probe harness:
`getAttribute('aria-disabled')` on `#run` and on the disabled width field
both read `"true"`.

---

#### A11Y-03 — The canvas is inaccessible and unnamed

Shipped, all four parts of the finding's own "Recommended" section. (1)
`#cv` carries `role="application"`, `aria-label="Level canvas"`, and
`aria-describedby` pointing at a new visually-hidden (`.sr-only`) paragraph
naming the four keys. (2) A new `Grid.kcur` (`grid.js`) is a second cursor,
independent of the mouse-driven `Grid.hov`, that the arrow keys move one
cell at a time (`Grid.kmove()`); Return/Space applies `Grid.tool` at it
through `Grid.kpaint()`, mirroring `ondown()`'s own precedence exactly - an
existing entity is always grabbed first, regardless of which tool is
active; Delete/Backspace erases under it through `Grid.kerase()`, but only
when nothing is already selected via `Grid.sel`, which still deletes the
selection as before. Both wrap their single edit in `Undo.act()` directly,
since a keypress is a discrete action with no drag to bracket. (3) Every
cursor move announces `column N, row M — <content>` through `#msg`'s live
region (A11Y-05, done — see "Already completed"); focusing the canvas (by
Tab, or the first time a key moves it) does the same. (4) The pointer
gestures are untouched. Depended on UX-06 (done, same batch) for the active
tool to be nameable in the announcement's context, and on VIS-06/A11Y-05
(both done already) for the ring and the live region the finding's own
steps 2 and 3 need. Verified with the probe harness: a synthetic focus
event set a keyboard cursor centred in the viewport and announced it;
`ArrowRight` moved it and re-announced; `Enter` painted the selected block
at the cursor, `Delete` erased it, `Space` placed an entity and selected it,
`Backspace` (nothing mouse-selected) removed it; the paint was independently
confirmed undoable and redoable through `Undo.undo()`/`Undo.redo()`; a full
regression pass (paint, undo/redo, save/open, script rename/delete, MIDI
import, tab switching, UX-12's gesture-cancel) showed no behavioural change.

---

## Table of contents

- [Already completed (do not re-add)](#already-completed-do-not-re-add)
1. [Executive summary](#1-executive-summary)
2. [Guiding principles](#2-guiding-principles)
3. [Current architecture overview](#3-current-architecture-overview)
4. [Findings](#4-findings)
   - [4.1 Correctness and data safety (BUG)](#41-correctness-and-data-safety-bug)
   - [4.2 Native platform (NAT)](#42-native-platform-nat)
   - [4.3 Layout and geometry (GEO)](#43-layout-and-geometry-geo)
   - [4.4 Visual consistency (VIS)](#44-visual-consistency-vis)
   - [4.5 UX and quality of life (UX)](#45-ux-and-quality-of-life-ux)
   - [4.6 Accessibility (A11Y)](#46-accessibility-a11y)
   - [4.7 Architecture and code quality (ARCH)](#47-architecture-and-code-quality-arch)
   - [4.8 Performance (PERF)](#48-performance-perf)
5. [Native platform improvements](#5-native-platform-improvements)
6. [Layout and proportionality audit](#6-layout-and-proportionality-audit)
7. [Visual consistency audit](#7-visual-consistency-audit)
8. [UX / QOL summary](#8-ux--qol-summary)
9. [Accessibility summary](#9-accessibility-summary)
10. [Architecture and code quality summary](#10-architecture-and-code-quality-summary)
11. [Performance summary](#11-performance-summary)
12. [Platform compatibility matrix](#12-platform-compatibility-matrix)
13. [Prioritised roadmap](#13-prioritised-roadmap)
14. [Implementation order](#14-implementation-order)
15. [Definition of done](#15-definition-of-done)

---

## 1. Executive summary

### Overall assessment

Studio's **core is good**. The level document model, the `Uint16Array` grid
mirror, the cell-diff undo history, the viewport-culled renderer with
device-pixel edge snapping, the single-source-of-truth validator in `lvl.js`,
and the strict process split (renderer touches no filesystem) are all sound,
well-commented decisions that a senior engineer would defend. The comments in
`grid.js` and `undo.js` explain *why*, not *what*. That layer needs targeted
improvement, not a rewrite.

The **shell around that core is the problem**. Studio is a web page wearing a
desktop application's clothes. It invents its own title bar and has never
been packaged. Its geometry is a collection of unrelated pixel constants. And
the font it was designed in is neither installed nor bundled, so the app has
never actually been seen in its own typeface. It now ships a real application
menu under its own name rather than Electron's default one (NAT-01, see
"Already completed" above), which also closed the ⌘R data-loss bug and three
other data-safety findings; document identity now lives in main rather than
split across the process boundary (BUG-08/ARCH-01); a dead or wedged renderer
can no longer leave the window permanently unclosable (BUG-09); and the
resting text, accent text and control-boundary colours all now clear WCAG
AA/1.4.11 contrast (VIS-01, VIS-02), with a real focus ring restored
everywhere (VIS-06) — see "Already completed" above for all of these. Data
safety has since been carried further still: the renderer runs sandboxed and
can no longer be navigated away from the app, losing the open document, by a
dropped file or a stray link (NAT-18); a crash or power loss can be recovered
from on the next launch, and an overwrite-save keeps a `.bak` (UX-10); the
unsaved-changes dialog now speaks each platform's own words, order and button
style, with a named verdict rather than a magic response index (NAT-21,
BUG-10); and the editor now warns, without ever blocking a save, when a level
is missing the start/end blocks or script references the game actually needs
to run it (BUG-11) — see "Already completed" above for these five too. The
shell has since gained real per-platform window chrome in place of the fake
traffic-light dots (NAT-02), a native `Menu.popup()` file-manager context
menu in place of the hand-rolled `<div>` one (NAT-05), a single `chrome.js`
platform module the renderer's own `<html data-platform>` attribute is
derived from (ARCH-03), and a trackpad that pans on a scroll and zooms only
on a pinch or Ctrl+wheel (NAT-11) — see "Already completed" above for these
four too. Most recently: the window title, proxy icon and edited dot now
follow each platform's own convention instead of duplicating a path-plus-
asterisk string in the DOM (NAT-03); window size and position persist across
restarts, derived from the display's own work area rather than a fixed
`1600 × 950` (NAT-10); the canvas gives per-gesture cursor feedback instead
of a single static arrow (NAT-13); a display-DPI change is now caught and
the canvas backing store re-rendered instead of staying soft (BUG-12); and
the palette, file manager and tab strip are reachable and operable by
keyboard for the first time, closing the largest remaining accessibility
gap outside the canvas itself (A11Y-01) — see "Already completed" above for
all five. Most recently: `style.css` gained its one design-token definition —
spacing, row heights, type, radius, elevation, motion and z-index alongside
colour — with `tokens.js` reading the colour tokens for `grid.js`'s canvas and
`code.js`'s Monaco theme to consume instead of each restating its own copy
(GEO-01/VIS-04, folding in GEO-02's and GEO-09's band-height and scrollbar-
token asks); all five scroll containers now share one scrollbar treatment
instead of just `#hbar` (NAT-20); the inspector no longer rebuilds itself from
an HTML string on every cell an entity drag crosses (PERF-01); and status
messages and validation failures now reach a screen reader instead of being
silent visual-only changes (A11Y-05) — see "Already completed" above for all
of these. Most recently still: the palette's cells are an integer multiple of
their 32 px sprites instead of a fractional 42.25 px stretch (GEO-07); the
side panels are proportional and clamped instead of frozen at one window
width's worth of pixels (GEO-03); `grid.js`'s remaining unnamed constants are
named (GEO-11); a window resize no longer reallocates the canvas backing
store on every observed frame (PERF-04); and Monaco - several megabytes of
JavaScript the Level Editor tab never touches - now loads on the first script
tab a session opens instead of unconditionally at boot (ARCH-08) — see
"Already completed" above for all five. Most recently of all: the app is
finally rendered in its own bundled typeface instead of a silent per-platform
fallback (VIS-05); the New/Open/Save/Save As hotbar is gone on macOS, where
the menu bar already carried it, and is a real per-platform toolbar on
Windows/Linux (NAT-04); every button, row and tab now shares one hover/
active/selected/disabled treatment instead of three unrelated mechanisms for
"selected" and an effectively-invisible disabled state (VIS-07); zoom has a
status-bar indicator, a quick-menu, a View menu, and a `Grid.fit()` that
targets the scene nearest the camera instead of the level's unfittable full
width (UX-04); and the side panels, the
scripts/MIDI split and the palette/inspector split are all user-resizable
with keyboard-operable splitters that persist across sessions (GEO-04) — see
"Already completed" above for all five. Most recently of all: Escape now
cancels and reverts a gesture in progress instead of only deselecting
underneath it (UX-12); a right click on the canvas that never dragged opens
the canvas's own context menu instead of erasing a cell, and Ctrl+click on
macOS no longer erases at all (NAT-12); the tab-close glyph and the MIDI
header's `+` both reach the 24px platform hit-area minimum without growing
their visible glyph (A11Y-04); the script/MIDI split defaults to its own
content's height, with a floor and a ceiling, instead of an unexplained 60/40
(GEO-05); and both file-manager lists say what goes there and how instead of
sitting empty on every fresh launch (VIS-12) — see "Already completed" above
for all five. The shell's remaining problems are below.

### The three biggest remaining sources of perceived unpolish

1. **Packaging is the largest remaining native gap.** Window controls,
   context menus, the hotbar, the window title/proxy-icon/edited-dot and
   window-state persistence are all native or OS-driven now (NAT-02, NAT-04,
   NAT-05, NAT-03, NAT-10, see "Already completed"), but there is still no
   recent documents, no `open-file` handler, no file association, no
   single-instance lock, no drag-and-drop, no icon, no packaging config, no
   `nativeTheme` (NAT-06 through NAT-09, NAT-15, NAT-17). Most of the
   Electron APIs that exist precisely to make this application feel native
   are still unreferenced anywhere in the tree (verified by grep).
2. **There is still no icon system.** Five text glyphs stand in for icons at
   four different effective sizes, three of them a bare "+" rendered three
   different ways by three different mechanisms, while a real icon set sits
   unused in `textures/icons/` (VIS-11). The slot this used to describe -
   motion, radius and elevation, tokens defined but with nothing consuming
   them - is closed now: every hover/active/selected tint transitions,
   `--radius-2` distinguishes a standalone action button from an inline
   control, and both side panels carry the design's own drop-shadow
   (VIS-08, VIS-09, GEO-13, all done — see "Already completed").
3. **The Monaco editor is still a fifth, drifting copy of the design.** Four
   of its eleven colour keys read from the shared token object now
   (`tokens.js`, VIS-04, done), but the rest - the editor's own background,
   the scrollbar, the suggestion list, the bracket-match highlight - are
   still VS Code's own defaults, a blue that has nothing to do with the rest
   of this application (VIS-18). Geometry's own remaining loose ends are
   closed now: the spacing/row/type scale, proportional and clamped side
   panels, integer palette cells, user-resizable splitters, and both
   in-panel splits' own content-driven defaults are all real (GEO-01,
   GEO-03, GEO-04, GEO-05, GEO-06, GEO-07, all done — see "Already
   completed").

### The highest-impact improvements

All four of the original items — `titleBarStyle`/`titleBarOverlay` in place
of the fake dots (NAT-02), native `Menu.popup()` context menus (NAT-05), the
spacing/row/type token scale plus proportional, user-resizable panels
(GEO-01/VIS-04, GEO-03/GEO-04), and bundling JetBrains Mono as a woff2
(VIS-05) — are now done, see "Already completed" above. Nothing remains in
this list; §13's roadmap is the next place to look, where NAT-07 (packaging)
is the only item left in its "High" tier.

---

## 2. Guiding principles

These are the rules every recommendation below was tested against. Apply them
to work not covered here too.

**Native-first.** If the OS or Electron provides a mechanism, use it. A
platform's own menu, dialog, scrollbar, or window control is better tested,
better localised, keyboard-navigable, screen-reader-aware, and correct under
accessibility settings the app will never think to check. Re-implement only
when the native mechanism genuinely cannot do the job, and record why in a
comment.

**Platform awareness is not platform uniformity.** The correct cross-platform
result is one product that behaves like three well-mannered natives, not one
appearance imposed on three systems. macOS and Windows each have a settled
window convention; honour it. Linux does not have one — GNOME expects
client-side decorations, KDE and most WMs expect server-side — so Linux is
where a custom fallback is legitimate, and it must be the fallback, not the
default that the other two inherit.

**Intentional geometry.** Every dimension answers "what determines this?" Good
answers: the line box, a spacing step, the parent's width, the sprite's native
size, the display work area, a platform metric. Bad answers: "it looked right".

**No unjustified magic numbers.** A literal survives only with a name, a
comment stating what determines it, and a reason it cannot be derived. Do not
replace arithmetic with formulae for their own sake — `--space-3` is better
than `calc(var(--line-box) * 0.618)` when the design simply wants 12 px. Phi
and Pi appear in this document exactly zero times, because nothing here needs
them.

**One design system.** Colour, type, spacing, radius, elevation, motion and
z-index each have one definition, in one place, consumed by CSS, by the canvas
renderer, and by the Monaco theme alike. Today there are four independent
colour definitions.

**Accessibility is part of "polished".** Keyboard reachability, a visible focus
ring, 4.5:1 text contrast, 3:1 control-boundary contrast, and honest semantics
are not a separate workstream; they are what "finished" means.

**Maintainability.** Prefer deleting code to adding it. Prefer one platform
check in one place to fifteen scattered ones. Prefer a targeted fix to a
refactor. This codebase is 2 627 lines and should stay small.

---

## 3. Current architecture overview

### Stack

- **Electron 43.4.1**, `contextIsolation: true`, `sandbox: false`, custom
  privileged `app://` scheme, frameless `BrowserWindow`.
- **No framework, no bundler, no build step.** `index.html` loads five classic
  scripts into one shared global scope; `style.css` is hand-written; state is
  plain module-level objects.
- **fflate** for ZIP, **monaco-editor 0.53** loaded through its AMD loader
  straight out of `node_modules`.
- **No test framework, no packaging config.** `npm run lint`/`npm run check`
  exist (ARCH-07, done — see "Already completed"); there is still nothing
  that exercises the running app itself beyond `tools/probe.js` run by hand.

### Process responsibilities (as built)

| Concern | Lives in | Correct? |
|---|---|---|
| Window creation, `app://` protocol | `main.js` | Yes |
| All filesystem I/O | `main.js` + `lvl.js` | Yes |
| `.lvl` read/write/validate/migrate | `lvl.js` (main) | Yes — one copy, no renderer duplicate |
| Native dialogs (open/save/discard/midi) | `main.js` | Yes |
| Which file is open; whether it is dirty | `main.js` (`doc = {path, dirty}`); renderer keeps a display-only mirror | Yes — done, BUG-08/ARCH-01 |
| Window controls (min/max/close) | the OS, via real per-platform `BrowserWindow` chrome | Yes — done, NAT-02 |
| Application menu | `menu.js` (main), rebuilt on renderer state | Yes — done, NAT-01 |
| Context menus | `Menu.buildFromTemplate().popup()` (main), triggered by `menu:row` IPC | Yes — done, NAT-05 |
| Level document, undo, canvas, palette, inspector, Monaco | renderer | Yes |

The preload (`preload.js`, now 26 lines) is a clean, minimal, correctly-shaped
bridge: named functions, no object passthrough, no `ipcRenderer`
exposure. It is the best-designed file in the project. It now also exposes
`api.platform` (ARCH-03, done — see "Already completed"), so the gap this
paragraph used to note - no platform information, so the renderer could not
adapt to the host OS - is closed.

### UI architecture

Five global-scope modules, coordinated by `App`:

- `App` (`app.js`) owns the document, tab strip, file manager and key
  bindings, and sends the context a click needs for main to build a native
  menu from (NAT-05, done — see "Already completed"). `App.refresh()` is the
  universal "rebuild everything" entry point; `Undo` calls it after every
  history step.
- `Grid` (`grid.js`) owns the canvas: camera, `Uint16Array` mirror, culled
  draw, all pointer gestures.
- `Panel` (`panel.js`) owns the palette and inspector, both rebuilt from
  scratch via `innerHTML` on every call.
- `Code` (`code.js`) owns Monaco, one model per script.
- `Undo` (`undo.js`) owns history.

Rendering is entirely imperative full-subtree rebuilds. There is no diffing,
no component model and no reactive layer, which is the right choice at this
size — but it means every rebuild destroys focus, scroll position and caret,
which matters where it happens on a hot path (UX-15; the entity-drag case,
formerly the more severe of the two, is done — see "Already completed",
PERF-01).

### Existing design system

Done — see "Already completed", GEO-01/VIS-04. `style.css` `:root` is now a
real token system: colour (unchanged from VIS-01/VIS-02's already-shipped
retune, plus the surfaces VIS-04 added), spacing, row heights derived from the
line box, radius, elevation, motion and z-index each have exactly one
definition. `tokens.js` reads the colour custom properties once into a plain
object; `grid.js`'s canvas draw calls and `code.js`'s Monaco `THEME` both
consume it instead of restating their own copies of the same values (the
Monaco keys that are not a restatement of an existing token - `code.js`'s own
`#150f24`/`#2e2049`/`#1e1633` - are unaffected; giving them a considered
relationship to the surrounding chrome is VIS-18, not this). `main.js`'s
`backgroundColor` and `chrome.js`'s `BAR` remain the two documented, necessary
duplicates (each must be known before any CSS has loaded). Radius, elevation
and motion now have real consumers too (VIS-08/VIS-09, done - see "Already
completed"): every hover/active/selected tint, the focus ring and the inline
rename field transition at `--dur-fast`/`--dur`; `--radius-2` marks a
standalone action button apart from an inline control's `--radius-1`,
including the active tab's own corner flare (GEO-13); both side panels carry
`--elev-1`, per the design's own drop-shadow filters. `--radius-3` and
`--elev-2` remain unconsumed, deliberately - there is still no dialog or
popover that would need them, the same reasoning that already applied to
`--elev-2` before NAT-05 made the context menu native. `z-index` is the one
still genuinely waiting on a second layer above the surface. Panel widths are
proportional and clamped, the palette's cells are an integer multiple of the
sprite, and the panels are user-resizable with keyboard-operable splitters
(GEO-03/GEO-07/GEO-04, all done - see "Already completed").

### Existing platform abstractions

Done — see "Already completed", ARCH-03. `chrome.js` is now the only place
`process.platform` is read in the whole codebase: `main.js`'s
`window-all-closed` guard, `menu.js`'s appMenu/windowMenu split and
`discardbuttons()` (NAT-21) all consume it rather than each holding their own
check. The renderer knows its OS through `api.platform` and the
`<html data-platform>` attribute it drives; real per-platform window chrome
(NAT-02) already keys off it. The ⌘/Ctrl handling and the label
capitalisation (VIS-10) are not yet ported to use it, but the abstraction
itself - the thing this finding was about - now exists. NAT-20's scrollbar
treatment (done, see "Already completed") turned out not to need a
platform branch at all: one token-driven `::-webkit-scrollbar` rule plus
`scrollbar-gutter: stable` behaves correctly under both the overlay and
classic scrollbar conventions without asking which one is active.

---

## 4. Findings

Each finding carries: **Category · Severity · Priority · Affects**, then
current behaviour, why it matters, evidence, the recommended behaviour, how to
implement it, platform notes, prerequisites and risks.

Severity is impact if left alone. Priority is scheduling order (P0 = before
anything else ships, P3 = nice to have).

---

### 4.1 Correctness and data safety (BUG)

These are ordinary bugs found while auditing. They come first because polish on
top of data loss is worthless.

---

#### BUG-13 — `app://` path containment check is prefix-only

**Category** Security · **Severity** Low · **Priority** P2 · **Affects** Architecture

**Current.** `main.js:29` — `if (!p.startsWith(ROOT)) return 403`. `ROOT` has
no trailing separator, so a sibling directory whose name extends the root's
(`…/studio-backup`) satisfies the prefix test. `path.join` + `normalize`
already collapse `..`, so this is a hardening gap rather than a live traversal,
but the check as written does not do what it claims.

**Recommended.** `if (p !== ROOT && !p.startsWith(ROOT + path.sep))`. Also
consider serving from an explicit allow-list of subtrees
(`index.html`, `*.css`, `*.js`, `textures/`, `node_modules/monaco-editor/min/`)
rather than the whole application directory — today `app://studio/.git/config`
is served if a `.git` directory is present, which it is.

**Platforms.** All three; `path.sep` handles the Windows separator.

---

### 4.2 Native platform (NAT)

---

#### NAT-06 — No recent documents

**Category** Native · **Severity** Medium · **Priority** P2 · **Affects** UX

**Current.** Nothing calls `app.addRecentDocument()`. There is no Open Recent
menu, no Dock recent-items list on macOS, no Windows JumpList. The only way to
reopen yesterday's level is to navigate the open dialog from scratch — and
`showOpenDialog` is called with no `defaultPath` (`main.js:97`), so it starts
wherever the OS last left it, per-app-session.

**Recommended.** `app.addRecentDocument(p)` on every successful open and
save-as. Feed a File → Open Recent submenu from a persisted list of the last
10 paths (skipping ones that no longer exist, checked lazily on menu build).
`app.clearRecentDocuments()` behind an "Clear Menu" item.

**Implementation.** In main's `doc` module (`{path, dirty}`, done — see
"Already completed", BUG-08), alongside the assignments to `doc.path`.
Persist the list in `app.getPath('userData') + '/recent.json'` — the same store
as window state (NAT-10, done — see "Already completed").

**Platforms.** macOS: also populates the Dock icon's right-click menu and the
"Open Recent" system behaviour, for free. Windows: `addRecentDocument`
populates the JumpList, but **only for file types the application is
registered to handle** — so it depends on NAT-07's file association.
Linux: `addRecentDocument` writes `~/.local/share/recently-used.xbel`, honoured
by GTK file choosers and some launchers.

---

#### NAT-07 — Studio cannot be launched by opening a level, and has never been packaged

**Category** Native · **Severity** High · **Priority** P1 · **Affects** Architecture, UX

**Current.** There is **no packaging configuration of any kind** — no
electron-builder, no Electron Forge, no `build`/`electron-builder.yml`, no
icons (`.icns`/`.ico`/`.png`), no `productName`, no bundle identifier, no code
signing or notarisation setup, no `.desktop` file, no MIME type registration.
`package.json` has one script: `"start": "electron ."`. Correspondingly:
`app.on('open-file')` is not handled (macOS), `process.argv` is never inspected
(Windows/Linux), and `app.requestSingleInstanceLock()` is not called (NAT-08).

**Why it's a problem.** The consequences compound:
- Double-clicking a `.lvl` in Finder/Explorer/Nautilus does nothing.
- The Dock/taskbar shows Electron's default icon.
- The window is titled by an app called "Electron".
- The app cannot be distributed to anyone who does not have Node installed.
- On macOS an unsigned, un-notarised build is blocked by Gatekeeper.
- Recent documents (NAT-06) and JumpLists cannot fully work without the
  association.

**Recommended.** Adopt **electron-builder** (fewer moving parts than Forge for
a no-bundler project) with:
- `appId: "com.pellizzolabrothers.studio"`, `productName`.
- `fileAssociations: [{ext: "lvl", name: "Pellizzola Brothers Level",
  role: "Editor", icon: …}]` — builder emits the macOS `CFBundleDocumentTypes`,
  the Windows registry entries, and the Linux `.desktop` + MIME XML.
- Icons at the sizes each platform wants; source them from
  `textures/icons/` or the design file, at 1024 × 1024 down to 16 × 16, keeping
  the pixel art crisp at small sizes (hand-tune 16/32, do not just downscale).
- `files` narrowed so the whole `textures/` clone and the whole
  `monaco-editor` package do not ship - Monaco itself now loads lazily
  (ARCH-08, done, see "Already completed"), but nothing narrows what a build
  would package until this finding lands.
- macOS `hardenedRuntime` + notarisation; Windows Authenticode; Linux AppImage
  and/or `.deb`.

Then handle the incoming file in main:
```
app.on('open-file', (e, p) => { e.preventDefault(); openpath(p); });  /* macOS */
/* Windows/Linux: the path arrives in process.argv, and in the
   second-instance event's argv (NAT-08) */
```
`open-file` can fire **before** `whenReady()`, so queue the path and drain the
queue once the window exists — this is the classic bug in this area.

**Platforms.** All three, with different mechanisms; electron-builder unifies
the declaration.

**Depends on.** `productName` is already set (NAT-01, shipped). Still needs
NAT-08 (single instance), and a decision on `asar` — with `asar: true`, `code.js`'s worker blob path
(`node_modules/monaco-editor/min/vs`) resolves through the `app://` handler,
which reads from disk via `net.fetch(pathToFileURL(...))` and **will not see
inside the asar archive**. Either set `asar: false`, or add
`asarUnpack: ["node_modules/monaco-editor/**"]`, or serve those bytes through
the protocol handler by reading them with `fs` (which *is* asar-aware). Verify
before shipping; this is the most likely packaging surprise.

---

#### NAT-08 — No single-instance lock

**Category** Native · **Severity** Medium · **Priority** P2 · **Affects** UX

**Current.** `app.requestSingleInstanceLock()` is never called. Once file
association exists (NAT-07), opening a second `.lvl` on Windows or Linux
launches a **second copy of the whole application**, with a second Monaco, a
second document, and no knowledge of the first.

**Recommended.** Take the lock at startup; on failure, `app.quit()`
immediately. In the `second-instance` handler, restore and focus the existing
window and open the path from the incoming `argv`.

**Platforms.** Windows and Linux need this. macOS does not — Launch Services
routes a second open to the running instance via `open-file` — but taking the
lock is harmless there and keeps one code path.

**Depends on.** NAT-07.

---

#### NAT-09 — No drag and drop

**Category** Native · **Severity** Medium · **Priority** P2 · **Affects** UX

**Current.** No `dragover`/`drop` handlers anywhere in the renderer, and the
default behaviour of a Chromium page — navigating to the dropped file — is not
prevented. Dropping a `.lvl` onto the window therefore **replaces the
application with a view of the file**, losing the unsaved document. (This is
the same class of failure as BUG-01 and is fixed by the same `will-navigate`
guard.)

**Recommended.**
1. `addEventListener('dragover'|'drop', e => e.preventDefault())` on `window`
   as a global backstop, plus `webContents.on('will-navigate', e =>
   e.preventDefault())` in main so nothing can ever navigate the shell.
2. Drop a `.lvl`/`.json` anywhere → open it (through the unsaved-changes
   guard).
3. Drop `.mid`/`.midi` onto the MIDI list → import.
4. Drop a `.lua` file onto the script list → add it to the archive.
5. Show a drop-target overlay while a valid drag is over the window; reject
   invalid types visibly rather than silently.
6. macOS Dock drop (dragging a level onto the Dock icon) arrives as
   `open-file` — free once NAT-07 lands.

**Implementation.** `e.dataTransfer.files[i].path` gives the real filesystem
path in Electron; hand it to main rather than reading the file in the renderer,
preserving the "renderer touches no filesystem" rule from `CLAUDE.md`.
Note that in recent Electron the `File.path` property is deprecated in favour
of `webUtils.getPathForFile(file)`, which must be called from the **preload** —
add it to the bridge.

---

#### NAT-14 — The command set is thin; zoom, tab switching and region operations have no shortcut

**Category** Native · **Severity** Medium · **Priority** P1 · **Affects** UX, Accessibility

**Current.** NAT-01 (shipped, see "Already completed") moved New/Open/Save/
Save As/Undo/Redo/Close Tab onto the menu's own layout-aware `CmdOrCtrl`
accelerators, and `keys()` (`app.js`) now only matches Escape and
Delete/Backspace against `Grid.sel`, guarded to the Level Editor tab. The
original duplication between a hand-rolled `e.key` handler and the menu no
longer exists, and `Ctrl+Y` for redo is gone. What is left of this finding:

1. The command set is thin. Missing, and expected in a tile editor: zoom in /
   out / fit (⌘+ / ⌘- / ⌘0), tab switching (⌘1…⌘9, ⌃Tab), arrow-key nudge of
   the selected entity (with Shift for a coarse step), tool cycling, duplicate
   (⌘D), and select-all/copy/paste of a region.
2. `Escape` cancelling and reverting an in-progress drag or paint stroke is
   done (UX-12, see "Already completed").

**Recommended.** Add the missing commands to the menu template and the
renderer's `ACTS` table (both already exist) as each one is implemented; keep
`keys()` for genuinely canvas-local keys only (Escape, Delete/Backspace,
arrows, tool digits). Escape/Delete are non-letter keys whose `e.key` is
already layout-stable, so switching them to `e.code` is not required unless
digit tool-cycling is added, at which point `e.code` (`Digit1`…) is the
correct choice for the same reason the menu's own accelerators are.

**Platforms.** Electron's `CmdOrCtrl` gives ⌘ on macOS and Ctrl elsewhere from
one declaration, which is exactly why the menu should own them.

---

#### NAT-15 — No theme awareness; the app is unconditionally dark

**Category** Native · **Severity** Low · **Priority** P3 · **Affects** UI

**Current.** No `nativeTheme` usage, no `prefers-color-scheme` media query, no
`forced-colors` handling, `backgroundColor: '#1c1d20'` hard-coded in
`main.js:38` (a fifth copy of `--frame`).

**Assessment — and a recommendation not to over-correct.** A dark, purple,
pixel-art level editor with a design file specifying exactly these colours is
legitimately a single-theme application, the way Blender, Aseprite and DaVinci
Resolve are. **Do not build a light theme** unless the design asks for one;
that is feature quantity, not polish.

**Do** handle three things that are about respecting the system rather than
theming:
1. **`prefers-contrast: more`** — raise border and text contrast further still
   on top of the VIS-01/VIS-02 retune (done — see "Already completed"); nearly
   free now that the rest of the token block exists (GEO-01, done — see
   "Already completed").
2. **`forced-colors: active`** (Windows High Contrast) — Chromium overrides
   colours wholesale; make sure the layout does not collapse and that
   canvas-drawn content, which forced colours cannot reach, gets a fallback
   outline. Currently untested and certain to be broken.
3. **`prefers-reduced-motion`** — done, see "Already completed", VIS-08: the
   transitions it now reduces, and the media query itself, landed in the same
   commit as required.
Also: `nativeTheme.on('updated')` must re-push `titleBarOverlay` colours on
Windows if the OS accent/theme changes - `titleBarOverlay` itself is done
(NAT-02, see "Already completed"), the re-push on theme change is not.

---

#### NAT-16 — A native `<select>` sits inside a fully custom form

**Category** Native · **Severity** Low · **Priority** P2 · **Affects** UI

**Current.** `#props select` is styled with the same rules as `input` and
`textarea` (`style.css:195-203`) but is measured live as
`appearance: auto`. Chromium therefore draws the platform's own popup control —
on macOS a rounded, light-bordered popup button with a system chevron — inside
a set of flat, square, dark inputs. It is the most visually foreign element in
the screenshot.

**Why it's a problem — and the correct resolution.** This is the one case where
"prefer native" and "visual consistency" collide. The right answer is *not* to
build a custom listbox (that would repeat the mistake the old DOM context menu
made before NAT-05 replaced it - done, see "Already completed" - and cost the
keyboard and accessibility behaviour a `<select>` gives free). It is to keep
the real `<select>` and style the **control** to match, letting the **popup**
be native:
```
#props select { appearance: none; background-image: <chevron>; }
```
`appearance: none` restyles the closed control only; the dropdown list itself
is still drawn by the OS, keyboard navigation and type-ahead still work, and a
screen reader still sees a combobox. That is the correct trade.

**Implementation.** Add an inline SVG chevron as a `background-image` data URI
positioned from the spacing token, with `padding-right` reserving room for it.
Ensure the focus ring (VIS-06, done — see "Already completed") applies.

---

#### NAT-17 — No Dock menu or taskbar integration

**Category** Native · **Severity** Low · **Priority** P3 · **Affects** UX

**Current.** `app.setAboutPanelOptions` is now called (NAT-01, shipped) with
name, version and copyright, so About is real on macOS and Linux and the Help
menu's About item is honest everywhere — still missing the app icon, since no
icon exists yet (NAT-07). None of `app.dock.setMenu`, `app.setUserTasks`,
`win.setProgressBar`, `app.setBadgeCount` are used.

**Recommended (small, cheap, high signal).**
- Pass an `iconPath` to `setAboutPanelOptions` once NAT-07 produces an icon.
- macOS Dock menu (`app.dock.setMenu`): "New Level", "Open Recent ▸".
- Windows JumpList (`app.setUserTasks`): "New Level" task; recent documents
  arrive automatically once NAT-06 + NAT-07 land.
- `win.setProgressBar()` during a long save/open (also NAT-19) — Dock progress
  on macOS, taskbar progress on Windows, Unity launcher on Linux.

---

#### NAT-19 — No feedback for long or background operations

**Category** Native · **Severity** Low · **Priority** P3 · **Affects** UX

**Current.** `lvl.read`/`lvl.write` are fully synchronous in the main process
(`fs.readFileSync`, `unzipSync`, `zipSync`, `fs.writeFileSync`). While they
run, the main process is blocked, which means the window does not repaint and
menus do not open. There is no spinner, no progress, no cursor change, and no
completion feedback beyond a status-bar line that never expires (VIS-16).

**Assessment.** For a 12-row level this is imperceptible and the synchronous
code is simpler — the suckless-correct choice today. It stops being correct at
999 rows: `Grid.commit()` produces 540 × 999 ≈ 540 000 strings, `JSON.stringify`
with 4-space indentation produces several megabytes, and `zipSync` at level 6
compresses it on the same thread.

**Recommended.** Measure before changing. If a 999-row save exceeds ~100 ms:
move to `fs.promises` + fflate's async `zip`/`unzip`; show `win.setProgressBar()`
and a busy state in the status bar; restore `setProgressBar(-1)` on completion.
Notify on completion **only** if the window is not focused
(`new Notification(...)` in main), never for a foreground save — a toast for
something the user just watched happen is noise.

---

### 4.3 Layout and geometry (GEO)

The brief asks that arbitrary geometry be eliminated. This section identifies
every instance and states what should determine the value instead. The design
tokens that come out of it are collected in §6.

---

#### GEO-08 — Assorted one-off dimensions

**Category** Layout · **Severity** Low · **Priority** P2 · **Affects** UI

Each of these is a single literal with no stated origin. Collected rather than
given its own finding.

Two rows are gone rather than resolved onto a token: `#menu`'s `min-width:
150px`, the `2`/`4` px clamps in `menu()`, and the `.dots i` dimensions and
gap no longer exist in the codebase (NAT-05, NAT-02 — done, see "Already
completed"); and `li`'s padding, gap and row height are now `--space-3
--space-4 --space-3 --space-6` and `--row` (GEO-01/GEO-02, done — see
"Already completed", which also tokenised `.tab`'s gap and `#status`'s
`font-size` to the exact values below, unchanged visually but no longer bare
literals).

| Value | Location | What should determine it |
|---|---|---|
| `max-width: 260px` on `.tab` | `style.css:79` | A character count (`ch` units) — tabs hold filenames, so `max-width: 24ch` is a statement about content; 260 px is not. Add `min-width` too, so a one-character name is not a sliver. |
| `height: 48px` on `#props textarea` | `style.css:208` | `calc(var(--line-box) * 3)` — "three lines of description", which is a decision; 48 px is 2.67 lines, which is not. |
| `gap: 14px` on `.acts`, `gap: 10px` on `#title` | `style.css` passim | Neither is on the 2/4/6/8/12/16/24 scale GEO-01 introduced (12 or 16 is the nearest step); become spacing tokens once a value is chosen. |
| `font-size: 10px` on `.grp`, `.hint`, `#props h4`; `13px` on `.run` | `style.css` passim | Two ad-hoc sizes remain (`#status`'s 11 px is now `--font-size-sm`, done). `--font-size-sm` covers the 11 px case; 10 px is below the practical legibility floor for a UI face and should go rather than gain a third size token. |

---

#### GEO-10 — There is no vertical scrollbar for the level

**Category** Layout / UX · **Severity** Medium · **Priority** P2 · **Affects** UI, UX

**Current.** `#hbar` gives the level a real horizontal scrollbar
(a genuinely good decision — `CLAUDE.md` explains the reasoning and it is
sound). There is no vertical equivalent, even though `Grid.setheight()`
(`grid.js:134`) permits up to **999 rows**. Vertical navigation is
middle-drag, Alt-drag, or the wheel, which now scrolls (NAT-11, done — see
"Already completed") — but still with no indicator of position.

**Why it's a problem.** Asymmetry that the user cannot explain: one axis has a
scrollbar and shows its position, the other has neither. On a 200-row level
there is no indication of where in the level the viewport is.

**Recommended.** Mirror the `#hbar` mechanism on the vertical axis, using the
same spacer technique and the same `Grid.syncbar()` reconciliation. `Grid.clamp()`
already maintains a well-defined vertical range (`grid.js:177-179`), including
the "shorter than the viewport" case, so the range the bar must represent
already exists. Hide it (`visibility: hidden`, not `display: none`, so the
layout does not shift) when the level fits the viewport.

**Depends on.** NAT-11 — done (see "Already completed"); the wheel now scrolls
without a splitter, so the vertical bar has something to reflect.

---

### 4.4 Visual consistency (VIS)

---

#### VIS-03 — Colours diverge from the design file for no recorded reason

**Category** Visual · **Severity** Low · **Priority** P2 · **Affects** UI

**Current vs. `Pellizzola Brothers.svg`:**

| Element | Design | Implementation | Δ |
|---|---|---|---|
| Close dot | `#FF736A` | `#ff736a` | — |
| Minimise dot | `#FEBC2E` | `#ffbe2f` | diverged |
| Maximise dot | `#19C332` | `#2bc840` | diverged |
| Accent (text/icons, 24 uses) | `#7E58BE` | `#7b56ba` | diverged |
| Accent (fill, 2 uses) | `#815AC1` | — | absent |
| Dot diameter / pitch | 14 px / 23 px | 12 px / 20 px | diverged |

**Assessment.** The dot colours and diameter/pitch rows above are now moot
(NAT-02, done — see "Already completed": real traffic lights have the OS's
own colours and size, which was the point). The **accent** divergence is the
one that still matters: `#7b56ba` is not the design's `#7E58BE`, nobody recorded why,
and the design also uses a second, lighter accent `#815AC1` for filled
elements that the implementation has no equivalent of.

**Recommended.** Pick one accent deliberately. The contrast retune already
shipped `--acc` (non-text, 3:1) and `--acc-text` (text, 4.5:1) — see "Already
completed" — so what is left is recording the mapping to the design's
`#7E58BE` / `#815AC1` in `CLAUDE.md`. Then update the SVG or the deviations
note so the two artefacts agree — a design file that silently disagrees with
the build is worse than no design file.

---

#### VIS-10 — Label capitalisation is inconsistent

**Category** Visual · **Severity** Low · **Priority** P2 · **Affects** UI

**Current.** Four conventions coexist:
- lowercase: `new`, `open`, `save`, `save as`, `scripts`, `midi`, `items`,
  `properties`, `blocks`, `entities`, `fit view`, `remove entity`,
  `remove definition`, `new script`, `import midi`, `rename`, `delete`, `open`;
- Title Case: `Level Editor` (the tab), `New Lua script`, `Import MIDI`,
  `New custom entity definition` (all `title=` tooltips);
- Sentence case: status messages (`imported 3 file(s)`, `nothing to undo`);
- and `MIDI` appears as both `midi` and `MIDI` in the same interface.

**Why it's a problem.** The lowercase style is a legitimate, deliberate
aesthetic (and clearly the design's intent), but it is applied to about 80 % of
the interface, and the exceptions are not principled — they are wherever
someone wrote a tooltip.

**Recommended.** State the rule and apply it:
- **In-window UI** (panels, buttons, headers, palette, status): lowercase, per
  the design.
- **OS-facing surfaces** (menu bar items, native context menus, dialog buttons,
  dialog titles, the About panel, file-association names): **the platform's
  convention** — Title Case on macOS and Windows, Sentence case on GNOME. These
  are rendered by the OS in the OS's font next to the OS's own items; matching
  the app's lowercase style there would look broken, not stylish. This is a
  case where consistency *with the platform* beats consistency with the app.
- Proper nouns keep their capitalisation everywhere: **MIDI**, **Lua**,
  **Pellizzola Brothers**.
- Tooltips follow the surface they annotate.

---

#### VIS-11 — There is no icon system

**Category** Visual · **Severity** Medium · **Priority** P2 · **Affects** UI

**Current.** Every "icon" in the application is a text glyph at an ad-hoc size:
`+` for new script (`index.html:21`, inherits 12 px), a second `+` for import
MIDI (`index.html:31`, also 12 px but with `line-height: 1`), a third `+` as
the palette's add-definition cell (`panel.js:46`, styled with an inline
`style.cssText`), `×` for tab close (`app.js:88`, `opacity: .6`), and
`&#9654;` (▶) for playtest at 13 px (`style.css:91`).

Three different `+` buttons, rendered by three different mechanisms, at
different effective sizes and alignments. Meanwhile the project **has an icon
set**: `textures/icons/` contains `gear.png`, `hammer.png`, `plus_sign.png`,
`minus_sign.png`, `three_dee.png`, `placeholder.png`.

**Why it's a problem.** Text glyphs inherit the text font - no longer a moving
target across platforms now that the font itself is bundled (VIS-05, done —
see "Already completed"), but still not an icon: they do not align optically
with adjacent labels, cannot be sized independently of the text, and centre
inconsistently — visible in the screenshot, where the palette's `+` sits low
in its cell.

**Recommended.** A small inline-SVG icon set with one size token
(`--icon: 16px`) and `currentColor` fill, so icons take the text colour and
therefore participate in the state system (VIS-07, done — see "Already
completed") for free. Use SVG, not the
PNGs: `textures/icons/*.png` are 32 px pixel-art assets meant for the *game's*
UI, and scaling them into a 16 px chrome button will alias (the same fractional
scaling problem GEO-07 fixed for the palette, done - see "Already completed").
Where a pixel-art icon is genuinely wanted, size it
at exactly 16 or 32 px with `image-rendering: pixelated`.

Needed icons: new, open, save, save-as, new-script, import, close, play,
script-file, midi-file, block, entity, warning, error.

---

#### VIS-13 — The playtest button is permanently disabled and explains itself only in a tooltip

**Category** Visual / UX · **Severity** Low · **Priority** P2 · **Affects** UI, UX

**Current.** `index.html:23-24` — a `▶` button, `disabled`, with
`title="Playtest is inert: the game cannot load .lvl archives yet
(game/todo.txt 3.1)"`. Still a barely-discoverable glyph in the corner of the
tab strip with no visible "soon" affordance and no screen-reader explanation -
though it is no longer near-invisible: VIS-07 (done, see "Already completed")
replaced `opacity: .35` with `--fg-disabled`, so the button's own contrast is
now 3.48-4.56:1 rather than the ≈1.5:1 the original audit measured.

`CLAUDE.md` documents the reasoning and it is honest: the button renders per
the design, and the game genuinely cannot load `.lvl` yet (`game/todo.txt`
step 3.1, minizip + jansson).

**Recommended.** Keep it, fix its communication:
1. A disabled control the user cannot ever enable should say why **without
   hovering**. Give it a visible "soon" affordance or move it behind a
   `View → Playtest` menu item that is disabled with an explanatory
   `toolTip` — native menus support disabled items with tooltips and are the
   right home for a not-yet-implemented command.
2. `aria-disabled` is done (A11Y-08, see "Already completed"); still open is
   `aria-describedby` pointing at the explanation, so the reason itself - not
   just the fact of being disabled - reaches a screen reader.
3. Disabled contrast ≥3:1 is done (VIS-07, see "Already completed").
4. When the game does gain `.lvl` support, the implementation is: write the
   document to `app.getPath('temp')`, spawn the game binary with it, and stream
   its stderr into the status bar. Worth recording in `CLAUDE.md` next to the
   existing note so the eventual implementer does not have to rediscover it.

---

#### VIS-15 — Two components style themselves with inline `cssText`

**Category** Visual / Code quality · **Severity** Low · **Priority** P2 · **Affects** UI, Maintainability

**Current.**
- `app.js:217` — the inline rename input:
  `'width:100%;border:1px solid var(--acc);background:#17102a;color:var(--fg);font:inherit'`.
  Half tokens, half literal, and it does not match `#props input`
  (`style.css:195-203`), which has `padding: 3px 5px` and a `--line` border.
  So the app has two visually different text inputs.
- `panel.js:47` — the add-definition palette cell:
  `'display:grid;place-items:center;color:var(--dim)'`.

**Recommended.** Two classes, `.rename` and `.cell.add`, in `style.css`. The
rename field should be the *same* component as `#props input` — extract a
`.field` class both use. Zero behaviour change; removes a whole category of
future drift.

---

#### VIS-16 — Canvas-drawn indicators have no contrast guarantee

**Category** Visual · **Severity** Medium · **Priority** P2 · **Affects** UI

**Current.** Four things are drawn over arbitrary artwork with fixed colours:

| Indicator | Colour | Location |
|---|---|---|
| Selection ring | `#7b56ba`, 2 px | `grid.js:275-277` |
| Hover cell | `rgba(200,170,255,.75)`, 1 px | `grid.js:285-287` |
| Grid lines | `rgba(123,86,186,.14)` | `grid.js:258` |
| Level bounds | `rgba(123,86,186,.5)` | `grid.js:290` |

**Why it's a problem.** The canvas shows the level's own art — a purple enemy
sprite, a violet backdrop — so a single purple ring can vanish entirely. The
selection ring in particular is the app's only indication of *what is
selected*, and there is no fallback. This also cannot be fixed by
`forced-colors` (NAT-15), because Chromium's forced-colours override does not
reach canvas pixels.

**Recommended.** Draw indicators as **two-tone** strokes: a dark 3 px outer
stroke and a light 1 px inner stroke (or `globalCompositeOperation =
'difference'` for the hover cell). This is the standard technique in
image editors precisely because it guarantees visibility over any content, and
it costs one extra `strokeRect` per indicator. Same treatment for the level
bounds. Grid lines are decorative and can stay single-tone.

Additionally: honour `prefers-contrast: more` by thickening the selection
stroke, since the canvas cannot inherit a system high-contrast palette.

---

#### VIS-17 — Missing-texture swatches are indistinguishable from content

**Category** Visual · **Severity** Low · **Priority** P3 · **Affects** UI

**Current.** `blit()` (`grid.js:297-307`) fills `#4a3a6a` when a known texture
has not decoded and `#803050` when the entity definition is unknown entirely.
Both are flat, saturated rectangles that read as *blocks* — the user sees a
purple tile and a maroon tile, not an error.

**Recommended.** Distinguish "loading" from "missing":
- **Loading** — leave the cell empty (the backdrop shows through). Textures
  decode in milliseconds from local disk; a flash of flat purple is worse than
  a flash of nothing, and `tex()` already re-triggers a redraw on load
  (`catalog.js:94`).
- **Missing/unknown definition** — a diagonal hatch or the existing
  `icons/placeholder.png` (which the code already knows about,
  `catalog.js:69`, and already uses for unknown defs at `grid.js:273` — so the
  `#803050` path is nearly dead code) plus a status-bar/inspector warning
  naming the unknown definition, which is a real authoring error worth
  surfacing. `lvl.js` already gained a warnings tier for save-time issues
  (done — see "Already completed", BUG-11); route this one through the same
  `review()`/`App.warnings` plumbing rather than inventing a second channel.

Name both colours as tokens if they survive.

---

#### VIS-18 — The Monaco theme is a fifth, drifting copy of the design

**Category** Visual · **Severity** Medium · **Priority** P2 · **Affects** UI, Maintainability

**Current.** Four of `code.js`'s eleven colour keys (`editor.foreground`,
`editor.lineHighlightBackground`, `editorCursor.foreground`,
`editorLineNumber.foreground`/`activeForeground`, `editorWidget.background`)
are generated from `Tokens` (`tokens.js`) rather than transcribed by hand
(VIS-04, done — see "Already completed"). The rest — `#150f24`, `#2e2049`,
`#1e1633` — are values that exist nowhere else in the app, so the editor's
background is still a *different* dark violet from every panel around it;
VIS-04's own scope stopped at removing the duplication, not at giving these
three a considered relationship to the surrounding chrome, which is this
finding's remaining scope.

Unset keys fall through to `vs-dark`'s defaults, which is why the editor's
scrollbars (NAT-20's own gap here is done — see "Already completed"; Monaco's
scrollbar theme keys below are not), find widget, suggestion list,
bracket-match highlights, error squiggles and selection-match highlights are
all VS Code blue inside a purple application.

**Recommended.**
1. Set the keys that currently leak VS Code's defaults into a themed app:
   `scrollbarSlider.*`, `editorWidget.border`, `editorSuggestWidget.*`,
   `list.hoverBackground`, `list.activeSelectionBackground`,
   `editorBracketMatch.*`, `editor.selectionHighlightBackground`,
   `editorError.foreground`, `editorWarning.foreground`, `focusBorder`.
2. Align `editor.background` with the surface it sits in — currently `#150f24`
   floats between `--panel` `#100a1a` and `--tab` `#1a122c` for no reason.
3. Set Monaco's own options to match the chrome: `lineHeight` from
   `--line-box`, `fontSize` from `--font-size`, and `renderLineHighlight`
   consistent with the app's selection treatment.

---

### 4.5 UX and quality of life (UX)

---

#### UX-01 — A file row cannot be opened by clicking it

**Category** UX · **Severity** Medium · **Priority** P2 · **Affects** UX

**Current.** `list()` (`app.js:141-149`) binds **both** `onclick` and
`oncontextmenu` on a script row to `rowmenu()`. `CLAUDE.md` records that
left-click-to-open-the-menu "was asked for explicitly, so opening a script is
now the menu's first entry rather than a bare click".

**Assessment.** Respect the request — it is a documented user decision, not an
accident. But the cost is real: opening a script, the most frequent action in
the panel, now takes two clicks and a pointer traverse, and there is no
single-gesture path to it.

**Recommended.** Keep left-click → menu, and **add double-click → open**. The
two do not conflict (the menu can dismiss on the second click of a
double-click), it matches every file manager on every platform, and it costs
nothing to discoverability because the menu still exists. Return already opens
the focused script row from the keyboard - rows are focusable now (A11Y-01,
done — see "Already completed"), which shipped that keyboard equivalent
directly; only the mouse's double-click affordance is still open.

---

#### UX-02 — Every row menu carries the same two global commands

**Category** UX · **Severity** Low · **Priority** P3 · **Affects** UX

**Current.** `rowmenu()` (`app.js:181-200`) appends `new script` and
`import midi` to **every** row's menu, and `panelmenu()` offers only those two.
So "new script" appears in every one of N+1 menus.

**Recommended.** A context menu should carry actions *on the thing clicked*.
Global create actions belong on the panel background menu (where they already
are) and in the section header's `+` button (where they already are) — the
File menu (shipped by NAT-01, see "Already completed") does not carry them
today and would make a third route if `new script`/`import midi` are ever
added there, but two is already plenty. Remove them from row menus and the
row menu becomes: Open · Assign to <def> · — · Rename · Delete. That is a menu
a user can read at a glance.

---

#### UX-03 — Undo and redo say nothing about what they undid

**Category** UX · **Severity** Low · **Priority** P2 · **Affects** UX

**Current.** NAT-01 (shipped) added Edit → Undo / Redo menu items, enabled
from `Undo.past.length` / `Undo.future.length` and disabled outside the Level
Editor tab — so "no UI presence at all" and "the menu item must reflect the
active tab's history" are both resolved; the menu is already rebuilt on every
tab change and every `Undo.end()`/undo/redo (`App.syncmenu()` in `app.js`,
called from `undo.js`). What is still missing: the items are always labelled
generically "Undo"/"Redo" rather than the action's name ("Undo Paint", "Undo
Move Entity"), and `Undo.depth()` (`undo.js`) still only feeds the status-bar
message `'undo (' + Undo.past.length + ' left)'` (`undo.js`) — which reports
how many steps *remain*, phrasing no other application uses and which most
users will read as "3 things were undone".

**Recommended.**
- Give steps a label at the point they open (`Undo.begin(label)`), carry it
  onto the menu item text ("Undo Paint", "Undo Move Entity").
- Say what was undone, not how many remain, in the status bar: `undid paint`.

---

#### UX-05 — The editing verb set is thin

**Category** UX · **Severity** Medium · **Priority** P2 · **Affects** UX

**Current.** The complete set of level edits: paint one cell, drag-paint a
Bresenham line (`stroke()`, `grid.js:54`), erase (right-drag), place an entity,
drag an entity, delete an entity, change level height.

**Missing, and expected in any tile editor:**

| Verb | Notes |
|---|---|
| Rectangle fill / outline | Shift-drag with the block tool; by far the most-missed |
| Flood fill | Bucket tool; bounded by the level rect |
| Line constrain | Shift to constrain a drag to horizontal/vertical/45° |
| Rectangular select, copy, cut, paste | Including paste-at-cursor; the Edit menu currently offers Cut/Copy/Paste that do nothing here (NAT-01) |
| Duplicate entity | ⌘D, offset by one cell |
| Multi-select entities | Marquee + Shift-click; `Grid.sel` is a single `int` (`grid.js:17`), so this is a real data-model change — scope accordingly |
| Nudge with arrow keys | Selected entity, ±1 cell, Shift for ±10 |
| Eyedropper | Alt-click picks the block under the pointer into the tool; Alt is currently pan, so bind to `I` or middle-click |
| Toggle grid overlay | View menu |

**Recommended.** Prioritise **rectangle fill**, **flood fill**, **arrow-key
nudge** and **duplicate** — four small, self-contained additions that between
them cover most authoring friction. Defer selection/clipboard until there is a
reason, since it changes `Grid.sel`'s shape and every consumer of it.

All of them must go through `Undo.act()` / `Undo.begin()`–`end()`, per the
rule `CLAUDE.md` states in bold: an unwrapped mutation does not merely fail to
undo, it corrupts the next step.

---

#### UX-07 — The palette has no search or filter

**Category** UX · **Severity** Low · **Priority** P3 · **Affects** UX

**Current.** 31 cells today (measured), unbounded as custom definitions are
added, in a 4-column scrolling grid with 10 px group headings.

**Recommended.** A one-line filter field at the top of the palette matching
block and definition names, plus collapsible groups. Only worth doing once
custom definitions make the list long — flag as a follow-up, not now.

---

#### UX-09 — First run drops the user into an untitled void

**Category** UX · **Severity** Medium · **Priority** P1 · **Affects** UX

**Current.** `app.js:543-546` calls `api.blank()` on load and shows an
untitled 12-row empty level. No recent files (NAT-06), no template, no
onboarding, no indication of what the tool does or how to place the first
block. The file manager's two empty voids now say what goes there and how
(VIS-12, done — see "Already completed"). The palette's first cell
is the *eraser*, selected-by-default tool is `{kind: 'block', id: 2}` (brick),
and nothing says so.

**Recommended.** A restrained first-run:
- Restore the **last session's document** if it still exists on disk and was
  saved — this is what a document-based app does, and it is one line now that
  main owns the path (BUG-08, done — see "Already completed") and already
  persists window state the same way (NAT-10, done — see "Already
  completed") - the last path just needs adding to that same file.
- Otherwise show a **start view** in place of the canvas: New Level · Open… ·
  Recent (list) — reusing the same commands, no new surfaces.
- A single status-bar hint on the empty canvas: `click to place · right-drag
  to erase · alt-drag to pan`, dismissed on the first edit.

Do not build a tour, a modal, or a settings wizard. One screen, three commands.

---

#### UX-11 — There are no preferences

**Category** UX · **Severity** Low · **Priority** P3 · **Affects** UX

**Current.** Nothing is configurable and nothing is persisted — not panel
widths, not the last directory, not zoom, not grid visibility.

**Recommended.** Keep it small and justified. A preferences surface is worth
adding only once there are ≥4 real settings; the credible list is:
grid overlay on/off, palette cell size 1×/2× (the `--cell` token this would
flip between 1x and 2x already exists, GEO-07, done - see "Already
completed"), editor font size, and
the recovery-snapshot interval (fixed at 30s today - done, see "Already
completed", UX-10). A confirm-on-destructive-height-change toggle, floated
here in an earlier draft, turned out not to be the right fix - UX-08 (done,
see "Already completed") reports the consequence and warns in-place instead,
per its own "do not add a modal confirmation" reasoning, so there is nothing
left for a preference to gate.

Store in `app.getPath('userData')/settings.json`, owned by main, exposed
read/write through the preload. On macOS the item is
`Pellizzola Brothers Studio → Settings… (⌘,)`; on Windows/Linux it is
`Edit → Preferences` or `File → Preferences`. Use the platform's word —
"Settings" on macOS and modern Windows, "Preferences" on GNOME.

**View state** (panel widths, last zoom, open tabs) is *not* preferences and
should persist separately and silently, per-document where it makes sense.

---

#### UX-13 — Deleting an in-use script refuses instead of helping

**Category** UX · **Severity** Low · **Priority** P2 · **Affects** UX

**Current.** `delscript()` (`app.js:312-318`) refuses with
`p + ' is still used by ' + defs`, in the status bar. Correct behaviour
(`CLAUDE.md` documents the rule), unhelpful presentation: the user now has to
find each named definition and reassign it by hand, one at a time, through the
inspector.

**Recommended.** Offer the resolution in the refusal: a native dialog listing
the definitions and offering "Reassign to…" (a picker) or "Delete anyway and
unassign". Both go through `Panel.assign()`, which already exists and already
handles the cascade (`panel.js:233`).

---

#### UX-14 — Creating a custom definition silently creates a script

**Category** UX · **Severity** Low · **Priority** P2 · **Affects** UX

**Current.** `newdef()` (`panel.js:82-101`) picks an arbitrary existing script
(`Object.keys(App.doc.scripts)[0]` — insertion order, not sorted, so
effectively arbitrary) or, if there are none, **creates one**
(`App.newscript(id + '.lua')`) as a side effect of clicking `+` in the palette.
The comment explains why (an empty definition fails validation on the game's
side), and the reasoning is right — but the user clicked "new entity
definition" and got a new file in their archive with no announcement.

**Recommended.** Say what happened (`created custom_1 with scripts/custom_1.lua`)
and select the new definition in the inspector so the script field is visible
and changeable. When scripts already exist, do not silently bind to an
arbitrary one — bind to nothing and let the inspector show `(unassigned)`,
which `entityview()` already renders (`panel.js:205`), with the save-time
validator catching it if the user forgets.

---

#### UX-15 — Inline rename gives no feedback and loses work on failure

**Category** UX · **Severity** Medium · **Priority** P2 · **Affects** UX

**Current.** `edit()` (`app.js`) commits on `blur`. On failure — a duplicate
script name (`renscript`) or a duplicate MIDI name (`renmidi`, which now
reports the collision instead of silently discarding it, BUG-06) — the input
is already gone, `sidebar()` has rebuilt the list, and the user's typed text
is lost. The only signal is a status-bar line (now legible at rest, VIS-01)
that they may not be looking at.

Also: Escape sets `inp.onblur = null` and calls `sidebar()`, which is correct,
but Enter calls `inp.blur()`, so Enter and click-away are indistinguishable —
there is no way to say "commit" versus "I clicked elsewhere by accident".

**Recommended.**
- Validate **as the user types** (duplicate, empty, illegal characters) and
  show the invalid state on the field itself — `--danger` border plus a
  one-line message under it — with commit disabled while invalid.
- On a failed commit, **keep the field open** with the text intact.
- Enter commits, Escape cancels, blur commits-if-valid / stays-open-if-not.

---

#### UX-16 — Tabs overflow into nothing

**Category** UX · **Severity** Low · **Priority** P2 · **Affects** UI, UX

**Current.** `#tablist { display: flex; overflow: hidden }` (`style.css:74`)
with `.tab { max-width: 260px }`. Open seven or eight scripts in a 1 600 px
window and the later tabs are simply clipped out of existence — not scrollable,
not stacked, not indicated. `App.closetab` has no way to reach them and neither
does the user.

**Recommended.** `overflow-x: auto` with the shared scrollbar treatment
(NAT-20, done — see "Already completed"), plus: scroll the active tab into
view on `App.select()`; a
`⌘1…⌘9` / `⌃Tab` keyboard route (NAT-14); and an overflow chevron listing
hidden tabs via the native menu (NAT-05, done — see "Already completed", so
this is a new `menu:row`-style channel and template rather than a new
mechanism). Also add middle-click-to-close, which
every tabbed editor supports and which costs three lines.

Related: the Level Editor tab is not closable but is visually identical to the
closable script tabs (`app.js:72` passes `closable: false` but nothing marks
it). Give it a distinct treatment — a pin icon, a separator, or a fixed
position outside the scrolling region, which also solves the overflow case of
"the Level Editor tab scrolled away".

---

#### UX-17 — Numeric inspector fields round silently

**Category** UX · **Severity** Low · **Priority** P3 · **Affects** UX

**Current.** `entityview()` (`panel.js:186-192`) rounds any entered x/y to the
nearest multiple of `B` — correct, since entities snap to the grid
(`CLAUDE.md`) — but writes the rounded value back without comment, so typing
`137` yields `100` with no explanation. Similarly `p_rows` (`panel.js:145`)
clamps to 1–999 in `Grid.setheight()` without saying so.

**Recommended.** `step="100"` is already set, so the spinner is correct; add
the reason to the label (`x (snaps to 100)`) or show the cell coordinate as the
primary field and the pixel position as the derived, read-only one — which is
what the user actually thinks in. The `cell` field already exists
(`panel.js:170`) but is the disabled one; consider swapping which is editable.

---

#### UX-18 — MIDI files are opaque

**Category** UX · **Severity** Low · **Priority** P3 · **Affects** UX

**Current.** MIDI files can be imported, renamed and deleted. They cannot be
previewed, played, exported back out, or inspected — not even to see their
size or track count. `App.doc.midi` holds raw `Uint8Array`s and nothing reads
them.

**Recommended.** Minimum viable: show size and, cheaply parsed from the header
chunk, format/track-count/division in the row's tooltip and in an inspector
view when a MIDI row is selected. Add "Export…" to the row menu (a
`showSaveDialog` + `fs.writeFile` in main, ~10 lines) so an imported file is
not a one-way trip. Playback is out of scope — the sibling `midi/` project
exists for that, and Studio should not grow a synthesiser.

---

### 4.6 Accessibility (A11Y)

The brief asks that accessibility be treated as part of "professional and
polished", not as a separate workstream. Three accessibility findings —
VIS-01 (contrast), VIS-02 (control borders), VIS-06 (focus indicators) — are
already shipped (see "Already completed") and are not repeated here.

---

#### A11Y-06 — Everything is in absolute pixels and ignores OS text scaling

**Category** Accessibility · **Severity** Medium · **Priority** P2 · **Affects** UI

**Current.** Every dimension and every font size in `style.css` is in `px`.
Chromium's page zoom used to be reachable through the default menu's Zoom
In/Out roles (⌘+/⌘−); NAT-01's replacement menu (shipped) carries no such
role, so that particular exposure is currently closed as a side effect rather
than by design — there is still no `View → Zoom` of any kind. Were one added,
it would need its own DPI handling: `webFrame.setZoomFactor` (Chromium page
zoom) does not change `devicePixelRatio`, so BUG-12's shipped fix (done — see
"Already completed") - which re-arms a `matchMedia('(resolution: …)')` query
and does not fire on a zoom change, only a real display-DPI one - would not
by itself catch it; a UI-zoom command needs its own hook into
`Grid.resize()`, in the same spirit as BUG-12 but not the same event. The
underlying problem this finding is about — an all-`px` layout with no
response to OS text-size settings — is unaffected by either change.

**Recommended.**
1. Define type in `rem` off a root size, and spacing tokens in `px` (spacing
   should not scale with text in a dense tool UI — controls would break their
   grid). This gives OS text-size settings something to act on without
   destroying the layout.
2. Add explicit **UI scale** commands (View → Zoom In/Out/Reset) implemented as
   `webFrame.setZoomFactor` or, better, as a root font-size change, persisted
   with the other view state.
3. **Handle the zoom change**: whichever mechanism, hook it to re-run
   `Grid.resize()` so the canvas backing store and the pixel snapping stay
   correct - its own hook, since it is a distinct event from the
   `devicePixelRatio` change BUG-12 already watches.

---

#### A11Y-07 — System accessibility preferences are not honoured

**Category** Accessibility · **Severity** Low · **Priority** P2 · **Affects** UI

**Current.** `prefers-reduced-motion: reduce` is done - it shipped in the same
commit as the first transition, as VIS-08 itself required (done — see
"Already completed"). Still missing: `prefers-contrast`, `forced-colors`.
Windows High Contrast mode is untested and will produce a broken result:
Chromium force-overrides CSS colours but cannot touch canvas pixels, so the
chrome would flip to the system palette while the canvas stays purple, and
the canvas-drawn selection ring (VIS-16) would become invisible.

**Recommended.** Two media queries remain, each small:
- `prefers-contrast: more` → `--control-border` to `--fg`, focus ring to 3 px,
  disabled text to ≥4.5:1, canvas selection stroke thickened (VIS-16).
- `forced-colors: active` → `forced-color-adjust: none` on the canvas and the
  palette swatches (so they keep showing the artwork), system colours
  (`Canvas`, `CanvasText`, `Highlight`, `ButtonBorder`) everywhere else, and
  ensure every state that currently relies on colour alone also has a
  non-colour cue (border, icon, or weight).

---

### 4.7 Architecture and code quality (ARCH)

The codebase is small, consistently formatted, and unusually well commented —
the module comments in `grid.js`, `undo.js`, `lvl.js` and `catalog.js` explain
decisions rather than restating code, which is exactly right and should be
preserved. The findings below are targeted, not a call for restructuring.

---

#### ARCH-04 — `Panel` rebuilds its entire DOM for every change

**Category** Code quality / Performance · **Severity** Medium · **Priority** P1 · **Affects** UI, Performance

**Current.** `Panel.inspect()` (`panel.js:103`) dispatches to one of three
functions, each of which assigns a freshly-concatenated HTML string to
`p.innerHTML` and then re-binds every handler by `getElementById`. The same
pattern is used by `Panel.palette()`, `tabs()` and `list()`.

For most call sites this is fine and appropriately simple. Two call sites made
it a defect:
1. `onmove()` called `App.inspect()` on every cell crossed while dragging an
   entity (`grid.js:458`) - **done, see "Already completed", PERF-01**, which
   added exactly the `Panel.update()` this finding's own "Recommended" section
   asks for below, scoped to the fields a drag can change (`p_x`, `p_y`, the
   disabled cell field).
2. **Any rebuild while a field has focus still destroys the caret.** `bind()`
   (`panel.js:299-305`) works around this for the three level-info text fields
   by binding `oninput` without rebuilding — a good, documented workaround —
   but `p_rows`, `p_def` and `p_script` (`p_x`/`p_y`'s own `onchange` handlers
   still call the full `Panel.inspect()` too, same as before PERF-01 - only
   the drag path was rewired) all call `Panel.inspect()` from their
   `onchange`, so the element the user just interacted with is destroyed and
   recreated underneath them.

**Recommended.** Do not introduce a framework. `Panel.update()` (PERF-01,
done) already exists; the remaining work is two targeted changes:
- Extend `Panel.update()`, or call it from, the `onchange` handlers listed
  above so a value commit does not destroy the very field the user is still
  interacting with.
- Build with `document.createElement` + `textContent` for anything carrying
  user data, retiring `esc()` (`panel.js:11`) — a hand-rolled four-character
  escaper is a small, avoidable risk surface in a document format that carries
  user-supplied names and paths.

---

#### ARCH-05 — Renderer modules share one global scope with a documented collision hazard

**Category** Code quality · **Severity** Low · **Priority** P3 · **Affects** Maintainability

**Current.** `index.html:52-58` loads five classic scripts into one scope.
`CLAUDE.md` documents the hazard and even supplies a grep to detect
collisions — which currently reports **none**, so the discipline is working.
But the coupling is real: `$()` is defined in `panel.js:9` and used by
`app.js` and `code.js`; `grid.js` had to name its pointer helper `at()` because
`panel.js` owns `cell()`.

**Assessment.** For 2 600 lines with no build step, this is a defensible
suckless-style choice and the documented grep is a reasonable mitigation. **Do
not convert to ES modules purely for tidiness** — that would mean `type="module"`,
which changes script execution timing and `catalog.js`'s dual-load contract
(`CLAUDE.md`: it is loaded as a classic script by the renderer *and*
`require`d by main), for no user-facing gain.

**Recommended, if anything:** move `$()` and `esc()` into a `util.js` loaded
first, so the implicit dependency becomes explicit. The collision grep is
already automated in `npm run check` (`tools/check.js`, ARCH-07, done — see
"Already completed"), so it is run rather than remembered.

---

#### ARCH-06 — IPC surface is inconsistently shaped

**Category** Code quality · **Severity** Low · **Priority** P2 · **Affects** Maintainability

**Current.** Three naming conventions coexist: namespaced
(`lvl:new`, `lvl:open`, `win:ctl`, `midi:import`, `ask:discard`, `req:close`,
`lvl:snapshot`, `recover:load`) and bare (`dirty`, `forceclose`). `ask:discard`
now returns a named string verdict rather than a response index (done — see
"Already completed", BUG-10), but the shapes still do not agree with each
other: the `guard()` envelope `{ok, …}` / `{ok: false, err}`
(`main.js:72-81`) for most handlers, versus `ask:discard`'s bare
`'save'|'discard'|'cancel'` string with no envelope at all. Cancellation is
signalled by an extra `{cancel: true}` field that every caller must remember
to check (`app.js:428`, `:451`, `app.js:341`) and that is easy to forget — a
missed check treats a cancelled dialog as a success.

**Recommended.** One convention: `domain:verb` for every channel; every
`invoke` handler returns
`{status: 'ok'|'cancel'|'error', data?, message?}`; one renderer-side helper
unwraps it and routes errors to the native error dialog (BUG-07), so no call
site can forget. `guard()` becomes that one wrapper. This is a 30-line change
that removes a whole class of silent-failure bug.

Also: `App.open_` (`app.js:421`) carries a trailing underscore to dodge the
`open` keyword collision — rename to `App.openlevel` and let the name say what
it does.

---


#### ARCH-09 — Main-process filesystem work is fully synchronous

**Category** Architecture · **Severity** Low · **Priority** P3 · **Affects** Performance

Covered under **NAT-19**. Summary: `readFileSync`, `unzipSync`, `zipSync`,
`writeFileSync` all block the main process, which blocks window painting and
menu opening. Fine at 12 rows, not fine at 999. Measure, then convert if the
measurement justifies it — the synchronous code is simpler and simplicity is
the house style.

---

### 4.8 Performance (PERF)

The renderer's hot path is already well-engineered: viewport culling
(`grid.js:233-236`), `requestAnimationFrame` coalescing (`grid.js:205-211`),
whole-device-pixel snapping (`grid.js:238-244`), and a texture cache
(`catalog.js:85-98`). The findings below are the specific places where that
care lapses. Each has an identified cause; none is speculative.

---

#### PERF-02 — Layout is read and written twice per frame in the draw path

**Category** Performance · **Severity** Medium · **Priority** P2 · **Affects** Performance

**Current.** Every `Grid.draw()`:
- `Grid.clamp()` calls `Grid.cv.getBoundingClientRect()` (`grid.js:172`);
- `Grid.syncbar()` calls `document.getElementById('hbar')` and
  `getElementById('hspace')` (`grid.js:186, 189`), **writes**
  `hspace.style.width` (a style invalidation), then **reads** and possibly
  writes `bar.scrollLeft` (a forced layout);
- `at()` calls `getBoundingClientRect()` again on every `mousemove`
  (`grid.js:343`).

Reading `getBoundingClientRect` after writing a style forces a synchronous
layout — the classic thrash — and it happens on every frame of every pan, drag
and zoom.

**Recommended.**
1. Cache the canvas rect. `Grid.resize()` already runs from a `ResizeObserver`
   and already computes it (`grid.js:86`); store it as `Grid.rect` and have
   `clamp()`, `fit()` and `at()` read the cached value. Invalidate on resize
   and on scroll of any ancestor (there is none — `#wrap` is `overflow:
   hidden`), so the cache is trivially correct here.
2. Cache the two element references at `Grid.init()` time.
3. Write `hspace.style.width` **only when the zoom or height changes**, not
   every frame — track the last written value. Today it is rewritten with an
   identical string 60 times a second during a pan.

---

#### PERF-03 — `entat()` is a linear scan called once per painted cell

**Category** Performance · **Severity** Low · **Priority** P3 · **Affects** Performance

**Current.** `setblock()` (`grid.js:41`) calls `entat()` for every non-zero
tile, and `entat()` scans the whole entity list (`grid.js:26-33`).
`stroke()` calls `setblock()` once per cell on the Bresenham line
(`grid.js:60-67`). A fast horizontal drag across a level with 100 entities
therefore performs up to 540 × 100 = 54 000 comparisons per gesture.

**Assessment.** The comment at `grid.js:24` explicitly justifies the scan
("levels hold tens of entities, so a scan beats maintaining a second index that
can fall out of sync") and that reasoning is **correct** at the current scale —
this is not a bug and should not be pre-emptively optimised.

**Recommended.** Leave it. Revisit only if entity counts reach the hundreds, at
which point the right fix is a `Map` keyed on `cy * W + cx`, rebuilt in
`Grid.load()` and maintained by the three places that mutate `entities` — and
the comment's warning about it falling out of sync becomes the thing to test.
Recorded here so the trade-off is on the record rather than rediscovered.

---


#### PERF-05 — Full-subtree rebuilds on every refresh

**Category** Performance · **Severity** Low · **Priority** P3 · **Affects** Performance

**Current.** `App.refresh()` (`app.js:358-373`) — called after **every undo and
redo step** — rebuilds the tab strip, both file lists, the entire palette (31+
cells, each with a background-image URL string), the inspector, and re-syncs
every Monaco model. Undoing a single painted cell rebuilds the whole UI.

**Assessment.** Correct and simple, and at this scale not perceptible. It
becomes perceptible when a user holds ⌘Z to walk back through a long history,
which is a normal thing to do.

**Recommended.** Have `Undo.apply()` report *what* it changed (it already knows
— a step is `{cells, grid, info, defs, ents, bgs, scripts, midi}`) and let
`App.refresh()` rebuild only the affected views. A cell-diff step needs only
`Grid.redraw()`; a script-table change needs the sidebar and Monaco. This is a
contained change with a clear win on held-undo, and it follows the structure
`undo.js` already has.

---

#### PERF-06 — `Grid.commit()` allocates one string per tile

**Category** Performance · **Severity** Low · **Priority** P3 · **Affects** Performance

**Current.** `Grid.commit()` (`grid.js:116-129`) builds `W × h` three-character
strings — 6 480 for a 12-row level, **539 460** for a 999-row one — plus `h`
arrays, on every save, immediately before `JSON.stringify` produces several
megabytes of indented text and `zipSync` compresses it on the same thread.

**Assessment.** The format demands the strings (`CLAUDE.md`: three-digit ids
are the on-disk contract) and the mirror-and-pack design is right. The cost is
bounded and only paid on save.

**Recommended.** Leave unless NAT-19's measurement shows saves are slow, in
which case the cheap win is a precomputed lookup table of the 1 000 possible
id strings (`const PAD = Array.from({length: 1000}, (_, i) => …)`), turning
539 460 allocations into 539 460 array reads. Two lines, no structural change.

---

#### PERF-07 — Startup shows an empty window before the document exists

**Category** Performance · **Severity** Low · **Priority** P2 · **Affects** UX

**Current.** `win.once('ready-to-show', () => win.show())` (`main.js:46`) is
the right pattern and avoids a white flash — but `ready-to-show` fires when the
renderer has painted, and the renderer paints *before* `api.blank()` resolves
(`app.js:543`). So the first frame is an empty chrome with no canvas content.
Monaco no longer competes with this window for startup time - it loads lazily
now, on the first script tab a session opens, not at boot (ARCH-08, done, see
"Already completed") - so this finding's own remaining scope is narrower than
originally written: only the blank-document race, not a Monaco-load race too.

**Recommended.** Have main create the blank (or restored, per UX-09) document
**before** the window is shown and hand it to the renderer as part of
initialisation, or delay `win.show()` until the renderer signals
`ui:ready` after its first real paint. The latter is more robust and is what
the `ready-to-show` + `show()` pattern is designed to compose with.

---

## 5. Native platform improvements

This section is the platform-by-platform view of §4.2. Nothing new is
introduced; the findings are re-cut by the audience that has to live with them.

### 5.1 macOS

Studio currently reads as a web app on macOS. The gap is almost entirely in the
window and menu layers.

| Area | Do this | Finding |
|---|---|---|
| App identity | `.icns`; bundle id `com.pellizzolabrothers.studio` (`productName`, `app.setName()` and `setAboutPanelOptions` are already shipped, NAT-01) | NAT-07, NAT-17 |
| Window chrome | `titleBarStyle: 'hiddenInset'` + `trafficLightPosition`; the fake dots are deleted; the green button is real full screen, not `maximize()` — done, see "Already completed" | NAT-02 |
| Title | Document name only; `setRepresentedFilename` for the proxy icon; `setDocumentEdited` for the close-button dot. Not a path, not an asterisk — done, see "Already completed" | NAT-03 |
| Toolbar | The New/Open/Save hotbar is gone — the menu bar carries File regardless of window framing — done, see "Already completed" | NAT-04 |
| Context menus | `Menu.popup()`, including the canvas's own; Ctrl+click no longer erases — done, see "Already completed" | NAT-05 |
| Open Recent | `addRecentDocument` — feeds both the File menu and the Dock icon menu. | NAT-06, NAT-17 |
| File association | `CFBundleDocumentTypes` for `.lvl` via electron-builder; handle `app.on('open-file')`, including before `whenReady`. | NAT-07 |
| Trackpad | Two-finger scroll pans; pinch (`wheel` + `ctrlKey`) zooms — done, see "Already completed". This was the single biggest day-to-day usability defect on a Mac. | NAT-11 |
| Shortcuts | `CmdOrCtrl` accelerators from the menu; drop the hand-rolled `Ctrl+Y`. Settings is **⌘,** and is called "Settings". | NAT-14, UX-11 |
| Scrollbars | Respect the overlay/classic setting; `scrollbar-gutter: stable` so layout does not depend on it — done, see "Already completed" | NAT-20 |
| Dialogs | "Don't Save", not "Discard"; sheet-parented; `detail` added — done, see "Already completed" | NAT-21 |
| Distribution | `hardenedRuntime`, code signing, notarisation — without these an unsigned build is blocked by Gatekeeper. | NAT-07 |
| Accessibility | Native menus (NAT-05), real controls in the palette/file lists/tabs (A11Y-01), the status bar's live region (A11Y-05), headings/landmarks for the title bar, section headers and inspector (A11Y-02), and the canvas's own keyboard editing and naming (A11Y-03) are all done — see "Already completed". What VoiceOver still reaches nothing of is system-preference handling (A11Y-06, A11Y-07) and OS text scaling. | A11Y-06, A11Y-07 |

### 5.2 Windows

| Area | Do this | Finding |
|---|---|---|
| Window chrome | `titleBarStyle: 'hidden'` + `titleBarOverlay: {color, symbolColor, height}` so Windows draws its own caption buttons, correctly placed top-right and themed — done, see "Already completed" (implemented against Electron's documented behaviour; not yet run on real Windows hardware). Re-pushing the colours on an OS theme change is still open. | NAT-02, NAT-15 |
| Toolbar | The hotbar stays, since `titleBarStyle: 'hidden'` shows no visible menu bar - now a real `role="toolbar"` with accelerator tooltips and roving tabindex — done, see "Already completed" (implemented against Electron's documented behaviour; not yet run on real Windows hardware). A hamburger that calls `Menu.popup()` was not added. | NAT-04 |
| Title | `Document — Pellizzola Brothers Studio`, with dirty state reflected in the OS title, not only in the DOM — done, see "Already completed" (implemented against Electron's documented `titleBarOverlay`/`setTitle` behaviour; not yet run on real Windows hardware) | NAT-03 |
| File association | Registry entries + `.ico` via electron-builder; handle the path in `process.argv` **and** in `second-instance`. | NAT-07, NAT-08 |
| Single instance | Required — without it every double-clicked `.lvl` launches a whole new app. | NAT-08 |
| JumpList | `setUserTasks` ("New Level") plus automatic recent documents once the association exists. | NAT-06, NAT-17 |
| Dialogs | Button order Save / Don't Save / Cancel; `noLink: true` so they are push buttons, not command links; `title` set — done, see "Already completed" | NAT-21 |
| Scrollbars | Classic scrollbars consume layout width — this is where NAT-20's `scrollbar-gutter: stable` fix (done, see "Already completed") matters most, though not yet exercised on real Windows hardware. | NAT-20 |
| High contrast | `forced-colors: active` is a real, commonly-enabled Windows mode; currently untested and certain to break the canvas indicators. | A11Y-07, VIS-16 |
| Mixed DPI | Per-monitor scaling is common; the canvas goes soft when the window moves between displays — done, see "Already completed" (implemented against the documented `matchMedia`/`devicePixelRatio` mechanism; not yet run on real per-monitor-DPI Windows hardware) | BUG-12 |
| Distribution | Authenticode signing; NSIS or MSI. | NAT-07 |

### 5.3 Linux

Linux is where a custom implementation is legitimate — but as a *fallback*,
chosen deliberately, not as the default the other two inherit.

| Area | Do this | Finding |
|---|---|---|
| Window chrome | Landed as `frame: true`, not `titleBarOverlay` — done, see "Already completed": Electron's Linux `titleBarOverlay` support is inconsistent across desktops and was untestable on the machine this shipped from, so guessing at it was judged worse than the documented fallback, which the audit itself names as correct here. Letting the WM decorate also means the fake macOS dots never applied on Linux at all, on this platform or any other. | NAT-02 |
| Button layout | Resolved as a side effect of the `frame: true` choice above: `org.gnome.desktop.wm.preferences.button-layout` is now entirely the WM's own to honour, since Studio no longer draws window controls itself on any platform. | NAT-02 |
| Toolbar | Same as Windows — a real toolbar, not four bare buttons — done, see "Already completed" (not run on real Linux hardware); GNOME may also surface parts of the menu itself in the shell. | NAT-04 |
| Context menus | Native menus inherit the GTK theme — the fastest single change to stop looking foreign — done, see "Already completed" (not run on real Linux hardware). | NAT-05 |
| Dialogs | GNOME convention: destructive action leftmost, "Discard" is the right word here (unlike macOS/Windows) — done, see "Already completed", NAT-21. Sentence case elsewhere is not yet applied. | VIS-10 |
| File association | `.desktop` file + MIME XML (`application/x-pellizzola-level`) + hicolor icons via electron-builder; handle `process.argv`. | NAT-07 |
| Recent files | `addRecentDocument` writes `recently-used.xbel`, honoured by GTK file choosers. | NAT-06 |
| Single instance | Required. | NAT-08 |
| Fonts | The `DejaVu Sans Mono` fallback was the *only* one likely to be present, and differed in metrics from JetBrains Mono — bundling the font (done, see "Already completed") matters most here, since Linux had no other realistic path to it. | VIS-05 |
| Wayland | Fractional scaling changes `devicePixelRatio` without a CSS resize — done, see "Already completed" (not yet run on real Wayland hardware) | BUG-12 |
| DE variance | State explicitly in `CLAUDE.md` which desktops were tested. "Linux" is not one target. | — |

### 5.4 Cross-platform Electron improvements

| Improvement | Finding |
|---|---|
| `will-navigate`, `setWindowOpenHandler`, `sandbox: true` — done, see "Already completed" (NAT-18); still open: dropping a `.lvl` itself does not yet open it (NAT-09) | NAT-09 |
| Window state persistence with display validation — done, see "Already completed" | NAT-10 |
| Display-derived default window size — done, see "Already completed" (folds in GEO-12) | NAT-10 |
| DPI-change handling for the canvas — done, see "Already completed" (BUG-12); a future UI-zoom command would still need its own hook (A11Y-06) | A11Y-06 |
| Recovery snapshots and `.bak` in `userData` — done, see "Already completed" | UX-10 |
| One `chrome.js` for every platform branch; `api.platform` to the renderer — done, see "Already completed" | ARCH-03 |
| Consistent IPC envelope, one unwrap helper (string verdicts on `ask:discard` already done, BUG-10) | ARCH-06 |
| electron-builder config, icons, associations, signing | NAT-07 |
| Lazy Monaco - done, see "Already completed"; narrowed packaged files still needs NAT-07 to exist first | ARCH-08 |

---

## 6. Layout and proportionality audit

### 6.1 Every instance of arbitrary geometry

Fourteen rows from the original 26 are gone rather than resolved onto a token:
`#menu`'s `min-width: 150px`, its click-handler's `2`/`4` px edge clamps, and
`.dots i`'s `12px`/`gap 8px` all named code that no longer exists (NAT-05,
NAT-02 — done, see "Already completed"); `--bar`/`--tabs`/`#status`'s band
heights, the horizontal scrollbar's three mismatched numbers, and
`backgroundColor`'s duplication are now real token relationships instead of
bare literals (GEO-01/GEO-02, NAT-20/GEO-09, VIS-04 — all done, see "Already
completed"); `--side`/`--right`, the palette's column definition, and all
six of `grid.js`'s remaining unnamed constants are done too (GEO-03, GEO-07,
GEO-11 — see "Already completed").

Row 3 (`.hdr`'s band height against the design's own 36px figure) is done too
- see "Already completed", GEO-13: `--row-hdr`, twice the line box, now
drives it - this table's own note that GEO-02 had already moved it to 26px
(`--row-sm`) was itself out of date by the time this row was last touched, an
inaccuracy corrected in the same pass that closed the row.

Row 9 (`--props-h: 46%`'s own unreconciled default) is done too - see
"Already completed", GEO-06: `#props` is content-driven, the same
`flex: 0 1 auto`/min-height/max-height pattern GEO-05 already gave
`#scripts`, with the same `.split-props` class toggle so a user's own drag
still overrides it.

| # | Value | Where | What should determine it | Finding |
|---|---|---|---|---|
| 11 | `.tab max-width: 260px` | `style.css:79` | `24ch` — a statement about filenames | GEO-08 |
| 12 | `textarea height: 48px` | `style.css:208` | `calc(var(--line-box) * 3)` | GEO-08 |
| 13 | Gaps `14px` on `.acts`, `10px` on `#title` | `style.css` passim | `--space-*` scale (the `li`/`.tab`/`#palette`/`#props`/`.grp` gaps that were also here are now tokenised — GEO-01, done) | GEO-08 |
| 14 | Font sizes `10px`/`13px` | `style.css` passim | `--font-size-sm` covers the `11px` case now (GEO-01, done); `10px`/`13px` remain | GEO-08 |
| 15 | `li` indent has no icon to hang from | `style.css:123` | `--space-4 + --icon` once rows get a file-type icon (the padding/height itself is `--row` now — GEO-01/GEO-02, done; the row's own hit area is done too, A11Y-04) | VIS-11 |

Row 8 (`--scripts-h`'s unexplained 60/40 default) is done too - see "Already
completed", GEO-05. `0.03`/`3` zoom clamps and the `0.0015` wheel factor, both
formerly rows here, are done (NAT-11, see "Already completed"): `ZMIN`, `ZMAX` and
`ZOOM_PX_PER_DOUBLING = 462` (`Math.LN2 / ZOOM_PX_PER_DOUBLING` reproduces
`0.0015` exactly) are now named `const`s in `grid.js`, shared between
`Grid.fit()` and `onwheel()`. The `1600 × 950` / `960 × 620` window-size row is
also done (NAT-10, see "Already completed"): the default is now 80% of the
display's work area, clamped between the unchanged `960 × 620` floor and the
`1600 × 950` the UI was designed at, and the actual size and position are
persisted across launches. `--side: 184px`/`--right: 212px`, the palette's
`repeat(4, 1fr)`, and `grid.js`'s `2 * B` fit padding / `1` max fit zoom /
`B * z >= 10` grid threshold / `1` px bar tolerance / `1`,`2` selection inset
are also done (GEO-03, GEO-07, GEO-11, see "Already completed").

### 6.2 Design tokens

Done — see "Already completed", GEO-01/VIS-04. The shipped `:root` block
(`style.css`) differs from what this section originally proposed in two
deliberate ways, both because the proposal collided with something already
real: the line-box token is named `--line-box`, not `--line`, because `--line`
already names the separator-colour token (VIS-01) and the two would otherwise
overwrite each other; and `--control-border` stayed aliased to `--acc`
(3.1-3.6:1), not the alternate `#77599f` an earlier draft of this section
floated, since `--acc` already clears the 3:1 non-text threshold everywhere it
is used (VIS-02). Colour composes for the canvas via `--acc-rgb`, a decimal
triple (`123, 86, 186`), rather than a fourth `--acc-alpha`-shaped token — the
same number, read once by `tokens.js` into a `'rgba(...)'` string, so canvas
alpha and the CSS accent can never drift apart. `--surface-hover`/
`--surface-active`/`--fg-disabled` (VIS-07, done — see "Already completed")
are defined and consumed now, exactly per GEO-01's own implementation note
that a token should arrive with the component that needs it, not before -
the same note `--split`/`--scripts-h`/`--props-h` (GEO-04, done) followed too.

`--radius-*`, `--elev-*` (VIS-09) and `--dur-*`/`--ease` (VIS-08) are consumed
now too — see "Already completed" for both; `--radius-1` was already
consumed (the generic `button` rule), so what those two findings actually
closed was `--radius-2` (a standalone action button, including the active
tab's own flare, GEO-13), `--elev-1` (both side panels, GEO-13) and every
`--dur-*` transition. `--radius-3` and `--elev-2` stay unconsumed
deliberately — there is still no dialog or popover that would need them.
`--z-*` is the one token still genuinely waiting on a second layer above the
surface; no finding currently needs it. `--side`/`--right` are `clamp()`-based
percentages now, not fixed literals (GEO-03, done — see "Already completed");
`--sprite`/`--cell` were added for the same commit that gave the palette
integer-sized cells (GEO-07, done); `--row-hdr` was added for the section
headers' own 36px band (GEO-13, done).

JavaScript-side constants in `grid.js` are now fully named: `FITPAD`,
`GRIDMIN`, `SELW`, `BARSLOP` (GEO-11, done — see "Already completed") join
`ZMIN`, `ZMAX` and `ZOOM_PX_PER_DOUBLING` (NAT-11, done).

### 6.3 Values that must stay fixed, and why

Per the brief, each surviving literal is documented rather than removed.

| Value | Where | Why it cannot be derived | Platform-specific? | Configurable later? |
|---|---|---|---|---|
| `B = 100` | `catalog.js:12` | A cross-repo contract: `game/src/main.c` draws blocks 100 × 100 and spaces them `i * 100`. Changing it here alone desynchronises the studio from the game. | No | **No** — changing it is a three-repo change |
| `W = 540` | `catalog.js:13` | The on-disk format: every `block_data` row holds exactly 540 entries. | No | No |
| `H = 12` | `catalog.js` | Rows in a fresh level — a product decision, not a derivation. Moved from `lvl.js` (ARCH-02, done — see "Already completed"). | No | Yes, as a preference |
| `999` max rows | `grid.js:134` | Bound implied by the three-digit id format's sibling conventions and by memory (999 × 540 × 2 B ≈ 1 MB grid). Name it `HMAX` and state the reason. | No | No |
| `--sprite: 32px` | `style.css` | Every texture in the library is 32 × 32; verified. It is a fact about the asset library, not a design choice. Defined and consumed by the palette's `--cell` (GEO-01, GEO-07 — both done, see "Already completed"). | No | No |
| `backgroundColor: '#1c1d20'` | `main.js:38` | Must be known before the page and its CSS load, so it cannot read `--frame`. Duplicated deliberately (VIS-04, done — see "Already completed"), with a comment naming its source and the requirement to change both together. | No | No |
| `--scrollbar: 12px` | `style.css`, shipped (NAT-20, done — see "Already completed") | Chromium's `::-webkit-scrollbar` needs a concrete length; there is no CSS-side access to the platform's metric. | Effectively — macOS overlay vs classic; mitigated with `scrollbar-gutter: stable` | No |
| `+ .5` canvas offsets | `grid.js` passim | A 1 px canvas stroke is centred on the coordinate, so a half-pixel offset is what lands it on a whole device pixel. Correct as written; comment it. | No | No |
| `trafficLightPosition` | new, macOS | Derived from `--row-lg`, but must be passed to `BrowserWindow` as a number before CSS exists — the same class of exception as `backgroundColor`. | **Yes, macOS only** | No |

---

## 7. Visual consistency audit

A component-by-component pass. Each row states the current inconsistency and
the finding that resolves it.

| Area | Current state | Resolution |
|---|---|---|
| **Typography** | Fixed — the app renders in its own bundled font now, identically on all three platforms, and the two `<b>`-plus-`font-weight: normal` layout hacks are `<span>`s instead (VIS-05, done — see "Already completed"); font sizes down to two (GEO-01, done), `10px`/`13px` remain | GEO-08 |
| **Spacing** | Fixed — a 7-step scale now covers most of the stylesheet (GEO-01, done — see "Already completed"); `.acts`'/`#title`'s two gaps and a few `10px`/`13px` one-offs remain | GEO-08 |
| **Rows / heights** | Fixed — `--row-sm`/`--row`/`--row-lg`, derived from the 18px line box, now cover the title bar, tab strip, section headers, status bar and file-manager rows (GEO-01, GEO-02, done — see "Already completed"); every hit area below the 24 px platform minimum is padded up to it too (A11Y-04, done — see "Already completed") | VIS-11's row icon is the remaining, unrelated piece |
| **Colour** | Fixed — one `:root` definition, consumed by `grid.js`'s canvas and `code.js`'s Monaco theme through `tokens.js` instead of each restating it (VIS-04, done — see "Already completed") | — |
| **Contrast** | Fixed — resting and accent text, control borders, and disabled text (VIS-01, VIS-02, VIS-07, all done — see "Already completed"); `.mi.off` is moot, its `<div>` menu deleted by NAT-05 | — |
| **Borders** | `--line` is now split from `--control-border` (VIS-02, done); still one width only, no distinct strong/emphasis weight | Add `--border-strong` |
| **Radius** | Fixed — `--radius-1` (inputs, palette cells, inline controls) and `--radius-2` (standalone action buttons, and the active tab's own corner flare) both have real consumers now; `--radius-3` stays unconsumed, deliberately, until a dialog or popover exists (VIS-09, GEO-13, done — see "Already completed") | — |
| **Shadows** | Fixed — both side panels carry `--elev-1`, per the design's own drop-shadow filters; `--elev-2` stays unconsumed, deliberately, for the same reason as `--radius-3` (VIS-09, GEO-13, done — see "Already completed") | — |
| **Scrollbars** | Fixed — all five containers now share one tokenised treatment with `scrollbar-gutter: stable` (NAT-20/GEO-09, done — see "Already completed"); Monaco's own scrollbar keys are still VS Code's defaults | Monaco keys set (VIS-18) |
| **Hover** | Fixed — every button, row and tab gets a `--surface-hover` tint, text unchanged (VIS-07, done — see "Already completed") | — |
| **Active / pressed** | Fixed — a deeper `--surface-active` tint on `:active` (VIS-07, done — see "Already completed") | — |
| **Focus** | Fixed — a global `:focus-visible` ring, 2 px + 2 px offset, now applies everywhere including the canvas (VIS-06, done — see "Already completed") | — |
| **Disabled** | Fixed — `--fg-disabled` at ≥3:1 replaces `opacity: .35` everywhere, including `#props`'s read-only fields (VIS-07, done — see "Already completed"); `aria-disabled` now sits alongside the native `disabled` attribute on all three disabled controls too (A11Y-08, done — see "Already completed") | VIS-13 |
| **Selected** | Fixed — one treatment across `li.on`/`.tab.on`/`.cell.on`: accent text (or border, for the palette's icon swatches) + surface fill + a leading-edge marker (VIS-07, done — see "Already completed") | — |
| **Icons** | Five text glyphs at four effective sizes, three of them `+`; an unused icon set exists in `textures/icons/` | Inline-SVG set, `currentColor`, one `--icon` token (VIS-11) |
| **Text alignment** | `.hdr` left in the file manager, right in the inspector — deliberate mirroring per the design; keep | — |
| **Capitalisation** | Four conventions, `midi`/`MIDI` in one interface | Lowercase in-window, platform convention on OS surfaces, proper nouns always (VIS-10) |
| **Cursor** | Fixed — seven states on the canvas (`crosshair`/`copy`/`grab`/`grabbing`/`not-allowed`) driven by `Grid.cursor()` (NAT-13, done — see "Already completed"), and `col-resize`/`row-resize` on the four splitters (GEO-04, done — see "Already completed") | — |
| **Tooltips** | Native `title=` on some controls, absent on tabs and rows; Windows/Linux's hotbar carries accelerators now (NAT-04, done — see "Already completed"); Title Case among lowercase labels elsewhere | Add the missing ones; VIS-10 for capitalisation |
| **Loading** | Fixed for the editor — Monaco now shows a plain "loading editor…" text while it lazy-loads (ARCH-08, done — see "Already completed"); long saves still block silently | Progress for long ops (NAT-19) |
| **Empty states** | Fixed — one line of secondary text plus one affordance per list, replacing the two blank voids every fresh launch used to show (VIS-12, done — see "Already completed") | — |
| **Error states** | Fixed — an aria-hidden `⚠` glyph now sits alongside `var(--danger)` on both `#msg.bad` and `App.fail()`'s `.err` block, so neither relies on colour alone; save failures reach a native dialog regardless of tab (BUG-07, shipped), and every error is announced to a screen reader (A11Y-05, shipped) (VIS-14, A11Y-08, done — see "Already completed") | — |
| **Context menus** | Fixed — native `Menu.popup()`, real keyboard navigation and platform appearance (NAT-05, done — see "Already completed") | — |
| **Dialogs** | The unsaved-changes prompt now has a per-platform template, `detail`, `noLink`, and string verdicts (NAT-21, BUG-10, done — see "Already completed") | — |
| **Forms** | Borders now visible via `--control-border` (VIS-02, done); still: a native `<select>` among flat custom fields; the inline rename input is a second, different text field | `appearance: none` on the select control only; one shared `.field` class (NAT-16, VIS-15) |
| **Buttons** | One shared hover/active/disabled treatment now (VIS-07, done — see "Already completed"); still no border except `.act`, and `.acts`/`.hdr button`/`#add` remain differently sized | One button component with size variants (GEO-08) |
| **Resizers / splitters** | Fixed — four keyboard-operable splitters (GEO-04, done — see "Already completed") | — |
| **Panels** | Widths are proportional, clamped and user-resizable now, the file manager's own split is content-driven by default, and both carry the design's own drop-shadow now too (GEO-03/GEO-04/GEO-05, VIS-09/GEO-13, done — see "Already completed"); still not collapsible | Collapsible sections |
| **Overlays** | NAT-05 (done) removed the app's only `z-index` along with the DOM context menu it belonged to; `--z-*` is defined (GEO-01, done) with nothing to convert yet | — |
| **Animation** | Fixed — hover/active/selected tints, the focus ring and the inline rename field all transition now, with the mandatory `prefers-reduced-motion` companion in the same commit (VIS-08, done — see "Already completed") | — |
| **Canvas indicators** | Purple-on-purple, no contrast guarantee, unreachable by forced colours | Two-tone strokes (VIS-16) |
| **Missing assets** | Flat purple and maroon rectangles that read as blocks | Empty while loading; hatch + warning when genuinely missing (VIS-17) |
| **Editor (Monaco)** | A fifth colour definition; unset keys leak VS Code blue into a purple app | Generate from tokens; set the leaking keys (VIS-18) |

---

## 8. UX / QOL summary

Grouped by the workflow they unblock. Detail in §4.5.

**Opening and starting work** — restore the last document or show a start view
with Recent (UX-09); recent documents in the menu and the Dock/JumpList
(NAT-06); drag a `.lvl` onto the window or Dock icon (NAT-09); double-click a
`.lvl` in the file manager (NAT-07).

**Editing** — rectangle fill, flood fill, duplicate, arrow-key nudge (UX-05);
trackpad scroll now pans instead of zooming, and pinch/Ctrl+wheel zooms
(NAT-11, shipped, see "Already completed"); the canvas now shows a cursor for
every gesture - crosshair, copy, grab, grabbing, not-allowed (NAT-13, shipped,
see "Already completed"); zoom now has controls, an indicator, and a fit that
targets the scene nearest the camera instead of an unfittable whole level
(UX-04, shipped, see "Already completed"); Escape cancelling and reverting a
gesture, and a right click that never dragged opening the canvas's own
context menu instead of erasing, are shipped too (UX-12, NAT-12, see "Already
completed"); the canvas is keyboard-operable now too - arrow keys move a
cursor cell, Return/Space paints the current tool, Delete erases, and the
tool itself is finally named somewhere - the status bar (A11Y-03, UX-06, see
"Already completed").

**Navigating** — a vertical scrollbar (GEO-10); resizable panels that remember
their size are shipped (GEO-04, see "Already completed"); tabs that overflow
into a scroller instead of vanishing (UX-16); keyboard tab switching (NAT-14).

**Files and scripts** — double-click to open a script (UX-01); row menus that
carry row actions only (UX-02); rename that validates as you type and does not
throw away your text (UX-15 — MIDI renaming no longer mangles the name,
BUG-06, shipped, see "Already completed"); delete-in-use offering reassignment
instead of refusal (UX-13); MIDI export and metadata (UX-18).

**Trust and recovery** — atomic saves, an honest dirty flag, save failures that
are impossible to miss, a `.bak` on overwrite, crash-recovery snapshots,
playability warnings before the game rejects the level, and destructive
actions that report what they did are all shipped (BUG-02, BUG-03, BUG-07,
UX-10, BUG-11, UX-08 — see "Already completed").

**Feedback** — status messages that auto-clear, errors that persist with a
non-colour cue, and persistent zoom/dimensions/entity-count/tool fields
separated from the transient message by a divider are all shipped (VIS-14,
UX-06, UX-04 — see "Already completed"); progress for long operations
(NAT-19); undo and redo are visible in the Edit menu now (NAT-01, shipped)
but still need to say what they undid rather than how many steps remain
(UX-03).

---

## 9. Accessibility summary

Studio was previously **not operable without a pointer at all**. Contrast and
focus visibility (VIS-01, VIS-02, VIS-06), keyboard reachability for the
palette, file manager and tab strip (A11Y-01), and now the canvas itself -
where the actual editing happens - are all fixed. See "Already completed" for
all five.

| Requirement | Status | Fix |
|---|---|---|
| 1.4.1 Use of Colour | Fixed — disabled, selected and error are all non-colour-only now (VIS-07, A11Y-08) | VIS-07, A11Y-08, done |
| 1.4.3 Contrast (Minimum) | Fixed — was 2.5–2.9:1, now 4.77–5.91:1 for the affected text | VIS-01, done |
| 1.4.11 Non-text Contrast | Fixed — was 1.18:1, now 3.12–3.59:1 for control borders | VIS-02, done |
| 1.4.12 Text Spacing | Fail — all-`px` layout, no response to OS text size | A11Y-06 |
| 2.1.1 Keyboard | Fixed — the palette, file rows and tabs are operable (A11Y-01); arrow keys, Return/Space and Delete now drive the canvas itself too, the one surface that used to require a pointer (A11Y-03) | A11Y-01, A11Y-03, done |
| 2.4.3 Focus Order | Fixed — roving tabindex gives the palette, file lists and tab strip one Tab stop each, in a defined title-bar-to-status-bar order | A11Y-01, done |
| 2.4.7 Focus Visible | Fixed — global `:focus-visible` rule, nothing left to suppress it | VIS-06, done |
| 2.5.8 Target Size | Fixed — `li` rows are 30 px (GEO-01, done); window controls are the OS's own (NAT-02, done); the `.tab` close glyph and `.hdr button` are padded to a 24px hit area too (A11Y-04, done) | A11Y-04, done |
| 4.1.2 Name, Role, Value | Fixed — the palette, file lists and tab strip carry `role`/`aria-*` (A11Y-01); the title bar is a `<header>`, section headers are real `<h2>`s their lists point back to with `aria-labelledby`, `#props` is a labelled region (A11Y-02), and the canvas itself carries `role="application"` with a name and description (A11Y-03) | A11Y-01, A11Y-02, A11Y-03, done |
| 4.1.3 Status Messages | Fixed — `#msg` carries `role="status"`, `App.fail()`'s error block carries `role="alert"`, and both now announce the keyboard cursor's own position as it moves (A11Y-03) | A11Y-05, A11Y-03, done |
| 2.3.3 Animation from Interactions | Fixed — `prefers-reduced-motion: reduce` collapses every transition/animation to 1ms, shipped in the same commit as the first one | VIS-08, done |
| System high contrast | Untested; will break canvas indicators | A11Y-07, VIS-16 |

Native menus (NAT-05, done — see "Already completed") already deleted one
entire inaccessible subsystem rather than fixing it in place, and replacing
the palette, file rows and tabs' clickable `<div>`s with real controls
(A11Y-01, done — see "Already completed") was the single largest remaining
piece of keyboard, focus-order and semantics work; status and error messages
reaching a screen reader (A11Y-05, done — see "Already completed") closed
the announcements gap the same way, and giving the rest of the DOM real
semantics - a `<header>`, real headings, a labelled inspector region
(A11Y-02, done — see "Already completed") - closed the semantics gap outside
the canvas. The canvas itself - the one surface a parallel-DOM approach
genuinely could not cover - is keyboard-operable now too (A11Y-03, done — see
"Already completed"): a keyboard cursor, moved by the arrow keys, that Return/
Space paints and Delete erases, announced through the same live region
A11Y-05 already gave the status bar. What is left is system preferences
(A11Y-06, A11Y-07).

---

## 10. Architecture and code quality summary

**Keep.** The process split; `lvl.js` as the single validator; the `Uint16Array`
mirror and `Grid.commit()` contract; the cell-diff undo model; viewport culling
and device-pixel snapping; the `app://` protocol and its documented reason; the
minimal preload surface; the comment style that explains decisions rather than
code; the flat global scope with its documented collision grep. The renderer
owning window title logic - the menu moved to main (NAT-01, shipped), window
controls and context menus moved to main (NAT-02/NAT-05, shipped), and now
the title/proxy-icon/edited-dot logic itself (NAT-03, done — see "Already
completed") - is also resolved; `main.js`'s `retitle()` is the one place all
four are driven from.

**Fix.**

| Problem | Finding |
|---|---|
| Full innerHTML rebuilds on a drag hot path (done, see "Already completed", PERF-01); an `onchange` commit still destroys the field the user just used; hand-rolled `esc()` | ARCH-04 |
| Three IPC naming conventions, two response shapes, forgettable `cancel` (the `ask:discard` response is a named string now, BUG-10, done — see "Already completed") | ARCH-06 |
| Synchronous main-process I/O | ARCH-09, NAT-19 |
| Two components styling themselves with inline `cssText` | VIS-15 |
| `App.open_`'s trailing underscore | ARCH-06 |
| Prefix-only path containment in the protocol handler | BUG-13 |

**Explicitly do not do.** Do not introduce a framework, a bundler, TypeScript
or ES modules. Do not convert the flat global scope. Do not add a state
container. Do not index the entity list until entity counts justify it
(PERF-03). Do not build a light theme (NAT-15) or a custom `<select>` popup
(NAT-16). Each of these would add more than it removes at this size.

---

## 11. Performance summary

The renderer is already carefully built. Two of the four real problems this
section originally listed are done (PERF-01, PERF-04 — see "Already
completed"); one real problem and three non-problems remain, in priority
order.

**Fix:**
1. **PERF-02** — `getBoundingClientRect` and `getElementById` called on every
   frame, with a style write between the read and the next read (layout
   thrash), during every pan and drag.

**Also worth doing:**
2. **PERF-05** — `App.refresh()` rebuilds every view for every undo step; walk
   back a long history and the whole UI is rebuilt per step.
3. **PERF-07** — the window is shown before the document exists - narrower
   now that ARCH-08 (done) removed the Monaco-load race this section
   originally described alongside it.

**Measure before touching:**
4. **PERF-06** / **NAT-19** — `Grid.commit()` + `JSON.stringify` + `zipSync` on
   a 999-row level. Bounded, save-only, and simple as written. Get a number
   first.

**Leave alone:** `entat()`'s linear scan (PERF-03) — the existing comment
justifies it correctly at the current scale, and the alternative introduces the
desync risk that comment warns about. Recorded so the trade-off is not
relitigated.

---

## 12. Platform compatibility matrix

`✅` correct today · `⚠️` works but non-native or inconsistent ·
`❌` wrong or absent

| Capability | macOS | Windows | Linux | Findings |
|---|---|---|---|---|
| App name / identity in the menu, taskbar and Dock | ✅ shipped (NAT-01) | ✅ shipped (NAT-01) | ✅ shipped (NAT-01) | remaining: `.icns`/bundle id, NAT-07 |
| Window controls | ✅ shipped (NAT-02) | ✅ shipped, not run on real hardware (NAT-02) | ✅ shipped, not run on real hardware (NAT-02) | — |
| Green button semantics | ✅ shipped - real full screen, not `maximize()` (NAT-02) | n/a | n/a | — |
| Window title | ✅ shipped - document name only (NAT-03) | ✅ shipped, not run on real hardware (NAT-03) | ✅ shipped, not run on real hardware (NAT-03) | — |
| Proxy icon / edited dot | ✅ shipped (NAT-03) | n/a | n/a | — |
| Context menus | ✅ shipped (NAT-05) | ✅ shipped, not run on real hardware (NAT-05) | ✅ shipped, not run on real hardware (NAT-05) | — |
| File dialogs | ✅ | ✅ | ✅ | — |
| Save extension handling | ✅ shipped (BUG-04, BUG-05) | ✅ shipped (BUG-04, BUG-05) | ✅ shipped (BUG-04, BUG-05) | — |
| Unsaved-changes dialog | ✅ shipped (NAT-21, BUG-10) | ✅ shipped (NAT-21, BUG-10) | ✅ shipped (NAT-21, BUG-10) | — |
| Recent documents | ❌ | ❌ | ❌ | NAT-06 |
| File association / launch by file | ❌ | ❌ | ❌ | NAT-07 |
| Single instance | ❌ n/a in practice | ❌ | ❌ | NAT-08 |
| Drag and drop | ⚠️ no longer navigates away (NAT-18, shipped); a drop still does not open the level | ⚠️ same | ⚠️ same | NAT-09 |
| Dock / taskbar integration | ❌ | ❌ | ❌ | NAT-06, NAT-17 |
| Window state persistence | ✅ shipped - position, size, maximized and fullscreen survive a restart, with a disconnected-display fallback (NAT-10) | ✅ shipped, not run on real hardware (NAT-10) | ✅ shipped, not run on real hardware (NAT-10) | — |
| Default window size | ✅ shipped - 80% of the display's work area, clamped (NAT-10) | ✅ shipped, not run on real hardware (NAT-10) | ✅ shipped, not run on real hardware (NAT-10) | — |
| Mixed-DPI / scaling | ✅ shipped (BUG-12) | ✅ shipped, not run on real per-monitor-DPI hardware (BUG-12) | ✅ shipped, not run on real Wayland hardware (BUG-12) | — |
| Trackpad scroll vs pinch | ✅ shipped (NAT-11) | ✅ shipped (NAT-11) | ✅ shipped (NAT-11) | — |
| Right-click semantics | ✅ shipped - Ctrl+click no longer erases, and a right click that never dragged opens the canvas's own menu (NAT-12) | ✅ shipped (NAT-12) | ✅ shipped (NAT-12) | — |
| Keyboard shortcuts | ⚠️ conflicts with default menu; layout-dependent | ⚠️ same | ⚠️ same | NAT-14 |
| Scrollbars | ✅ shipped - one tokenised treatment, `scrollbar-gutter: stable` (NAT-20) | ✅ shipped, not run on real hardware (NAT-20) | ✅ shipped, not run on real hardware (NAT-20) | — |
| Fonts | ✅ shipped - bundled, identically on all three platforms (VIS-05) | ✅ shipped (VIS-05) | ✅ shipped (VIS-05) | — |
| High contrast / forced colours | ⚠️ Increase Contrast ignored | ❌ untested, will break | ⚠️ | A11Y-07 |
| Reduced motion | ✅ shipped - `prefers-reduced-motion: reduce` collapses every transition/animation, landed in the same commit as the first one (VIS-08) | ✅ shipped (VIS-08) | ✅ shipped (VIS-08) | — |
| Screen reader | ✅ shipped - the palette, file lists and tab strip are named and role-bearing (A11Y-01), status/error messages are announced (A11Y-05), the title bar, section headers and inspector carry real semantics (A11Y-02), and the canvas itself is named, described and keyboard-operable with its cursor announced (A11Y-03) — see "Already completed" for all four. What is left is system-preference handling, not VoiceOver reaching the app at all. | ✅ same for Narrator | ✅ same for Orca | A11Y-07 |
| Notifications | ❌ | ❌ | ❌ | NAT-19 |
| Full screen | ✅ shipped - a new View menu carries `role: 'togglefullscreen'`, closing the regression NAT-01's own menu opened by shipping without a View menu (UX-04) | ✅ shipped (UX-04) | ✅ shipped (UX-04) | — |
| Quit / lifecycle | ✅ ⌘Q works (`role: 'appMenu'`, NAT-01); a hung/dirty renderer no longer wedges close (BUG-09, shipped) | ✅ shipped (BUG-09) | ✅ shipped (BUG-09) | — |
| Packaging / signing | ❌ | ❌ | ❌ | NAT-07 |

**Linux desktop variance.** Every Linux row above depends on the desktop:
GNOME/Mutter expects client-side decorations and exposes button layout as a
user setting; KDE/Plasma, XFCE and most tiling WMs use server-side decorations,
where `frame: false` produces a window the WM cannot decorate or snap. Wayland
differs from X11 in fractional scaling and in whether programmatic window
positioning is honoured at all (NAT-10). `CLAUDE.md` should record which
desktops were actually tested — "Linux" is not a single target and must not be
documented as one.

---

## 13. Prioritised roadmap

### Critical — data loss, or the app is not credibly a desktop application

Every item ever listed at this tier is now done: BUG-01, BUG-02, BUG-07,
NAT-01, NAT-02, VIS-01, VIS-02, VIS-06 and A11Y-01 — see "Already completed"
at the top of this document. Nothing remains in this tier.

### High — the difference between "works" and "finished"

| ID | Title |
|---|---|
| NAT-07 | No packaging, icons, or file association |

NAT-04, NAT-05, NAT-11, NAT-20, ARCH-02, ARCH-03, ARCH-08, BUG-12, GEO-01,
GEO-03, GEO-04, GEO-07, GEO-11, NAT-03, NAT-10, NAT-13, PERF-01, VIS-04,
VIS-05 and VIS-07, and UX-04, the other twenty-one items that were listed
here, are done — see "Already completed". NAT-07 - packaging, icons, file
association, code signing and notarisation across three platforms, none of
which this pass had the infrastructure (certificates, a release pipeline) to
complete or verify - is the only item remaining in this tier.

### Medium — real friction, contained fixes

| ID | Title |
|---|---|
| BUG-13 | Prefix-only path containment |
| NAT-06 | No recent documents |
| NAT-08 | No single-instance lock |
| NAT-09 | No drag and drop (the navigation-loses-work hole itself is shipped, NAT-18) |
| NAT-14 | Command set is thin: zoom, tab switching, region operations (Escape's own gesture-cancel case is shipped, UX-12) |
| NAT-16 | Native `<select>` among custom fields |
| GEO-08 | One-offs onto the scale (GEO-05, GEO-06 are both shipped) |
| GEO-10 | No vertical scrollbar |
| VIS-03, VIS-10, VIS-11 | Design divergence, capitalisation, icons |
| VIS-15, VIS-16, VIS-18 | Inline `cssText`, canvas indicators, Monaco theme (VIS-14 is shipped) |
| UX-01, UX-03, UX-05, UX-09, UX-15, UX-16 | Editing and navigation friction |
| A11Y-06 | OS text scaling (A11Y-03 is shipped) |
| ARCH-04, ARCH-06 | Panel rebuilds, IPC shape |
| PERF-02, PERF-07 | Layout thrash, startup paint |

### Low

| ID | Title |
|---|---|
| NAT-15 | System preference handling (contrast, forced colours) |
| NAT-17 | Dock menu, JumpList tasks (About panel already shipped, NAT-01) |
| NAT-19 | Feedback for long operations |
| VIS-13, VIS-17 | Playtest button communication; missing-texture swatches |
| UX-02, UX-11, UX-13, UX-14, UX-17, UX-18 | Menu contents, preferences, in-use script deletion, silent script creation, numeric rounding, MIDI opacity |
| A11Y-07 | System accessibility preferences (A11Y-08 is shipped) |
| ARCH-05, ARCH-09 | Global scope hygiene; synchronous I/O |
| PERF-05, PERF-06 | Refresh granularity; commit allocation |

### Nice to have — genuinely optional, none of it required to call Studio polished

- Minimap / overview strip rendered into the `#hbar` track - floated in
  UX-04's own text (done, see "Already completed") as the real answer for
  540-column levels, scoped out here as a separate, larger feature.
- Palette search and collapsible groups (UX-07).
- Rectangular selection, clipboard, multi-select entities (UX-05) — changes
  `Grid.sel`'s shape; scope deliberately.
- MIDI metadata and export (UX-18).
- Playtest, once the game can load `.lvl` (`game/todo.txt` 3.1) (VIS-13).
- Level templates and a starter library.
- PERF-03's entity index — only if entity counts reach the hundreds.

---

## 14. Implementation order

The order matters because several later items depend on foundations. Do not
start visual work before phase 1; it will be redone.

### Phase 0 — Stop the bleeding (days)

Independent, small, and each removed a way to lose work. **BUG-01, BUG-02,
BUG-03, BUG-04, BUG-05, BUG-06 and BUG-07** are all done — see "Already
completed". Nothing remains in this phase.

### Phase 1 — Foundations (these unblock everything downstream)

**ARCH-07** (`npm run lint`, `npm run check` — the collision grep + a
`blank → write → read` round-trip + `migrate()` over `website/levels/*` —
and `tools/probe.js` committed under `tools/`) is done — see "Already
completed". Every step below, and every future change, is verifiable through
it. **ARCH-03** (`chrome.js` in main, `api.platform` to the renderer,
`<html data-platform>`) and **ARCH-02** (one definition of `W`/`H`/`B`) are
also done — see "Already completed"; `chrome.js` already absorbed `menu.js`'s
own `process.platform` branch and NAT-21's `discardbuttons()`, and it is
where NAT-02 (below, also done) got the platform options it needed.

**GEO-01 + VIS-04** — the token block: spacing, rows, type, radius, elevation,
motion, z-index, plus the `tokens.js` reader that `grid.js` and `code.js`
consume — is done, together with GEO-02's and GEO-09's band-height and
scrollbar asks, which turned out to be the same fix (see "Already completed").
Nothing remains in this phase. §7's remaining rows can now be attempted -
this was the gate on all of them.

### Phase 2 — Native shell

**NAT-01** (menu template + `productName` + `setName` + About panel, Reload/
DevTools behind `!app.isPackaged`) is done and **closed BUG-01** — see
"Already completed". **BUG-09** (renderer-death handling) is also done, so the
wedge risk that a hung renderer posed under NAT-01's ⌘Q → `app.quit()` path is
already closed. **NAT-18** (`will-navigate`, `setWindowOpenHandler`,
`sandbox: true`) is also done, closing the drag-and-drop navigation hole
(NAT-09) that BUG-01's own fix did not cover; NAT-09's own remaining scope -
actually opening a dropped or double-clicked file - still needs step 5 below.
**NAT-21** (per-platform unsaved-changes dialog) and **BUG-10** (string
verdicts on `ask:discard`) are also done. **NAT-02** (real window chrome per
platform; the fake dots and `win:ctl` are deleted) and **NAT-05** (native
context menus; `#menu` and ~55 lines of `app.js` are deleted, reusing the
`cmd`/`ACTS` dispatcher NAT-01 already built) are also done — see "Already
completed" for both. **NAT-03** (title, represented filename, edited dot -
NAT-02, its prerequisite, was done; document identity itself was already in
main, BUG-08) and **NAT-10** (window state persistence with display
validation) are also done — see "Already completed" for both. **NAT-04**
(hotbar per platform - ARCH-03, its prerequisite, was done, and the menu
itself did not block it either) is also done — see "Already completed".

5. **NAT-07** packaging, icons, associations; **NAT-08** single instance;
   **NAT-06** recent documents; **NAT-09** drag and drop. These four are one
   coherent piece of work and share prerequisites — all can build directly on
   the `doc` module (BUG-08, done).

### Phase 3 — Design system made real

The contrast/focus-ring step originally scheduled here (VIS-01, VIS-02,
VIS-06) is done — see "Already completed". **VIS-05** (bundle JetBrains Mono
- everything measured in the real typeface from here on) and **VIS-07** (the
five-state contract, applied to every interactive surface) are also done —
see "Already completed" for both.

8. **VIS-11 / VIS-10** icons, capitalisation. **VIS-09** (radius and
   elevation) and **VIS-08** (motion, with its mandatory
   `prefers-reduced-motion` companion) are done — see "Already completed" for
   both.
9. **NAT-20 / GEO-09** — done, see "Already completed": one scrollbar
   treatment across all five containers. **VIS-18** Monaco theme fully
   aligned with the surrounding chrome (its own colour duplication is
   resolved, VIS-04, done) is still open.
10. **GEO-07** — done, see "Already completed": integer palette cells.
    **GEO-08** the remaining one-offs onto the scale.
11. **VIS-15 / VIS-16 / VIS-17** `.field`/`.cell.add` classes, canvas
    indicators, missing-texture treatment. **VIS-12** empty states and
    **VIS-14** status-message expiry/persistent fields are both done — see
    "Already completed".

### Phase 4 — Layout and interaction

**PERF-04** (resize coalescing) and **GEO-03** (proportional, clamped panel
widths) are both done — see "Already completed"; PERF-04 was scheduled here
specifically so a splitter drag would not stutter, and it did not, since it
shipped ahead of the splitters themselves. **GEO-11** (the remaining unnamed
canvas constants - `FITPAD`, `GRIDMIN`, `SELW`, `BARSLOP`) is also done.
**GEO-04** (four keyboard-operable splitters, building directly on GEO-03's
`--side`/`--right`/`--side-min`/`--side-max`/`--right-min`/`--right-max`
tokens) and **UX-04** (zoom controls and a real fit, including the new View
menu that also gives Toggle Full Screen a home again - see §12, "Full
screen") are also done — see "Already completed" for both.

13. **GEO-05** (content-driven script/MIDI list height) and **GEO-06** (the
    same treatment for the inspector) are both done — see "Already
    completed".
14. **GEO-10** vertical scrollbar (NAT-11, its prerequisite, is done - the
    wheel already scrolls).
15. **NAT-12** canvas context menu and Ctrl+click, and **UX-12** gesture
    cancel, are both done — see "Already completed" (**NAT-13** cursors is
    done too).
16. **PERF-01** — done, see "Already completed": `Panel.update()` now exists
    and the drag hot path uses it. **ARCH-04**'s remaining scope (the
    `onchange` handlers, `esc()`) can reuse it. **PERF-02** cached rect and
    refs.
17. **UX-16** tab overflow; **NAT-14** the remaining missing commands (zoom,
    tab switching, region operations — the menu/shortcut consolidation itself
    is done, NAT-01).

### Phase 5 — Accessibility completion

**A11Y-01** (real controls with roving tabindex — palette, rows, tabs) is
done — see "Already completed"; it was the largest single piece of work in
this phase, and native menus (NAT-05) and A11Y-01 together deleted or fixed
every inaccessible subsystem outside the canvas itself, which has since been
fixed too (A11Y-03, below).

19. **A11Y-05** live regions, **A11Y-04** hit targets - the `li` row height
    piece (GEO-01) and the `.tab` close glyph/`.hdr button` padding both
    shipped - **A11Y-02** semantics and landmarks, **A11Y-03** the canvas's
    own keyboard cursor (its UX-06 and focus-ring/VIS-06 dependencies were
    both already in place) and **A11Y-08** non-colour cues are all done, see
    "Already completed".
20. **A11Y-06** scaling; **A11Y-07** system preferences.

### Phase 6 — Reliability and remaining QOL

**UX-10** (recovery snapshots and `.bak`) and **BUG-11** (playability
warnings) are also done - see "Already completed"; both built directly on
BUG-02's atomic write and BUG-08's `doc` module, as scheduled.

21. **ARCH-08** — done, see "Already completed": lazy Monaco. **PERF-07**
    show-after-ready; **PERF-05** refresh granularity.
22. **ARCH-06** IPC envelope; **BUG-13** path containment; **ARCH-09 / NAT-19**
    async I/O *if* measurement justifies it.
23. **UX-01 / UX-02 / UX-03 / UX-05 / UX-09 / UX-13 / UX-14 /
    UX-15 / UX-17** — the remaining workflow items, each independent. UX-03 is
    narrower than originally scoped: the menu items themselves already exist
    (NAT-01), only per-action labelling is left. UX-15 is also narrower: the
    contrast and MIDI-collision problems it cited are already fixed (VIS-01,
    BUG-06). **UX-06** active-tool indicator and **UX-08**
    destructive-action reporting are both done - see "Already completed".
24. **NAT-15 / NAT-17 / UX-11 / UX-18 / VIS-13** — the low-priority tail.
    NAT-17 is narrower too: the About panel already shipped (NAT-01), only the
    Dock menu and JumpList tasks are left.

### Dependency summary

```
Done and no longer on this graph: VIS-05 (font, done) unblocked every
type-metric-dependent step that follows it, needing nothing from this graph
itself; GEO-03 (done) unblocked GEO-04 (also done - the min/max/proportion
tokens a splitter drag needs to constrain against already existed by the time
the splitters themselves were built); ARCH-07 (checks) unblocked everything below
it by making every later change verifiable at all; BUG-08 (doc state)
unblocked NAT-03, NAT-06, NAT-07, NAT-08, NAT-10, UX-10, all of which could
then build on it directly - NAT-03 and NAT-10 have since shipped, done — see
"Already completed"; BUG-09 closed the live gap NAT-01 opened;
VIS-01/VIS-02/VIS-06 unblocked nothing else in this graph; NAT-18 closed
NAT-09's navigation hole without needing any of the above; NAT-21/BUG-10 and
UX-10/BUG-11 each shipped straight off BUG-08's `doc` module and BUG-02's
atomic write, also without needing ARCH-03; ARCH-03 (platform) unblocked
NAT-02 (also done) and VIS-10 (which can now apply the OS-facing
capitalisation convention it asks for - not yet done), and NAT-02 in turn
unblocked NAT-03 and NAT-04 (both now done); NAT-05 deleted an entire
inaccessible subsystem rather than fixing it in place, independently of the
rest of this graph; NAT-11 unblocked GEO-10 (the wheel now scrolls) and named
two of GEO-11's eight constants; A11Y-01 (also done, needing nothing from
this graph) unblocked A11Y-02 and A11Y-04 (both also since done, needing
nothing further from this graph), and A11Y-03 (also since done - its own
UX-06 dependency shipped independently of this graph too); BUG-12 and NAT-13
each shipped independently, needing nothing
from this graph and unblocking nothing on it; **GEO-01 + VIS-04** (the token
block - spacing, rows, type, radius, elevation, motion, z-index, colour
consolidation, folding in GEO-02's and GEO-09's asks) is done and unblocked
exactly what this graph said it would: NAT-20 and A11Y-05 both shipped
straight off it, PERF-01 shipped independently of it (the drag hot path is a
pure-JS fix, not a token consumer), and GEO-07 and GEO-03 both then shipped
straight off the `--sprite`/`--space-*`/`--scrollbar` tokens it provided, and
VIS-08/VIS-09 both then shipped straight off the `--dur-*`/`--radius-*`/
`--elev-*` tokens it provided, genuinely unblocked rather than waiting on a
foundation that did not exist yet (VIS-07 was one of them and had already
shipped, also needing nothing further from this graph); GEO-08/VIS-18/
NAT-15's forced-colours work remain open on the same basis; PERF-04 and
GEO-11 (grid.js's own remaining unnamed constants) each shipped
independently, needing nothing from this graph.
```

---

## 15. Definition of done

Studio is polished and production-quality when **all** of the following are
demonstrably true. Each is checkable, not a matter of opinion.

### Platform

- [ ] The application is named "Pellizzola Brothers Studio" in the menu bar,
      the About panel, the Dock/taskbar, and the window title — never
      "Electron".
- [ ] A real application menu exists on all three platforms; every command the
      app offers appears in it; no production build exposes Reload or DevTools.
- [x] macOS uses real traffic lights via `hiddenInset`; Windows uses
      `titleBarOverlay`; Linux uses `titleBarOverlay` or a WM-decorated frame.
      The fake dots do not exist in the codebase. (NAT-02 — Windows/Linux
      implemented against Electron's documented behaviour, not run on real
      hardware)
- [x] The window title follows each platform's convention; macOS shows a proxy
      icon and an edited dot. (NAT-03 — Windows/Linux implemented against
      Electron's documented behaviour, not run on real hardware)
- [x] Every context menu is a native `Menu.popup()`. (NAT-05 — not run on real
      Windows/Linux hardware)
- [ ] Double-clicking a `.lvl` in Finder, Explorer and a Linux file manager
      opens it in a running (single) instance.
- [ ] Recent documents appear in File → Open Recent, the macOS Dock menu, and
      the Windows JumpList.
- [ ] Dropping a `.lvl` on the window or the Dock icon opens it; dropping
      anything never navigates the shell away.
- [x] Window size, position, maximised and fullscreen state survive a restart,
      and a saved position on a disconnected display falls back gracefully.
      (NAT-10 — Windows/Linux implemented against Electron's documented
      `screen`/`BrowserWindow` behaviour, not run on real hardware)
- [x] The default window fits within the primary display's work area on a
      1366 × 768 screen without being resized by the OS. (NAT-10 — verified
      against this machine's actual work area and hand-verified arithmetically
      for 1366 × 768: `80% -> 1093 × 620`, both within bounds)
- [x] On a trackpad, two-finger scroll pans and pinch zooms. (NAT-11)
- [ ] Packaged, signed and notarised/Authenticode-signed artefacts exist for
      all three platforms and launch on a clean machine.

### Geometry

- [ ] No pixel literal exists in `style.css` outside the `:root` token block,
      except values documented in §6.3 with a stated reason.
- [x] No unnamed numeric constant exists in `grid.js`'s camera, zoom or render
      paths. (GEO-11 — `FITPAD`, `GRIDMIN`, `SELW`, `BARSLOP` join the
      already-named `ZMIN`/`ZMAX`/`ZOOM_PX_PER_DOUBLING`; verified with the
      probe harness: all four reachable in the shared global scope with the
      expected values)
- [x] Every band height derives from the line box. (GEO-01/GEO-02 — `--row-sm`/
      `--row`/`--row-lg`, computed from `--line-box`, now drive the title bar,
      tab strip, section headers, status bar and file-manager rows; verified
      with the probe harness: `#tabs` 34px, `#status`/`.hdr` 26px, `li` 30px)
- [x] Side panels are proportional, clamped, user-resizable, and their sizes
      persist. (GEO-03 — proportional and clamped: `--side`/`--right` are
      `clamp()`s of the design's own SVG ratios with content-driven minimums
      and an ultrawide-safe maximum, verified with the probe harness against
      this machine's window width. GEO-04 — user-resizable and persisted:
      four keyboard-operable splitters drag those same tokens directly and
      write the result to `localStorage`; verified with the probe harness: a
      synthetic drag moves `#side` from 161px to exactly 250px and persists
      `{"side":250}`, and double-click removes the override back to the
      original width)
- [x] Palette cells are an integer multiple of 32 px, and the column count —
      not the cell size — changes with the panel width. (GEO-07 — `--cell`
      and `repeat(auto-fill, var(--cell))`; verified with the probe harness:
      `gridTemplateColumns` resolves to whole `32px` tracks, not `42.25px`)
- [ ] The layout is coherent and usable at the minimum window size, at
      1366 × 768, at 2560 × 1440, and maximised on an ultrawide.
- [x] The canvas is pixel-crisp at 1×, 2× and fractional scaling, and stays
      crisp when the window moves between displays of different DPI. (BUG-12
      re-detects a DPI change and re-runs `Grid.resize()`; verified
      structurally - the headless harness runs on one fixed-DPI display, so a
      live cross-monitor drag was not capturable here, the same limitation
      noted for VIS-06's focus ring)

### Visual

- [x] Colour, type, spacing, radius, elevation, motion and z-index each have
      exactly one definition; `grid.js` and `code.js` consume it rather than
      restating it. (GEO-01/VIS-04 — `style.css` `:root` is the one
      definition; `tokens.js` reads the colour tokens once and `grid.js`'s
      canvas draw calls and `code.js`'s `THEME` both consume that object;
      verified with the probe harness: `Tokens` matches every `:root` colour
      it names, and `THEME.colors['editorCursor.foreground'] === Tokens.acc`.
      Radius, elevation and motion have real consumers now too - VIS-07's
      colour tokens, VIS-08's motion and VIS-09's radius/elevation, all done,
      see "Already completed" - leaving `z-index` the one token still
      genuinely waiting on a second layer above the surface)
- [x] The app renders in JetBrains Mono, bundled, identically on all three
      platforms. (VIS-05 — verified with the probe harness's canvas metrics
      probe: "JetBrains Mono" now measures 93.6px against the fallback
      stack's unchanged 103.34px for the same string, where before this
      change all five families measured identically)
- [x] Every interactive surface implements the same five states (rest, hover,
      active, selected, disabled), plus a composable focus ring. (VIS-07 —
      one generic `button` rule plus `li`/`.tab`/`.cell` share
      `--surface-hover`/`--surface-active`/`--surface-selected`/
      `--fg-disabled`; verified with the probe harness: the disabled
      playtest button now computes `#786a9c` instead of an effectively
      invisible ≈1.5:1; `.tab.on::after`/`li.on::before` both compute a 2px
      `--acc` marker. VIS-06's ring, already shipped, composes with all of
      it unchanged)
- [x] All five scroll containers share one treatment, and the layout does not
      shift between overlay and classic scrollbars. (NAT-20/GEO-09 —
      `#scripts`/`#midis`/`#palette`/`#props`/`#hbar` share one tokenised
      `::-webkit-scrollbar` rule and `scrollbar-gutter: stable` on the four
      vertical ones; verified with the probe harness: `scrollbarGutter` reads
      `"stable"` on all four)
- [x] Motion is tokenised and honours `prefers-reduced-motion`. (VIS-08 —
      hover/active/selected tints, the focus ring, the inline rename field
      and the status message all transition at `--dur-fast`/`--dur`; the
      mandatory `@media (prefers-reduced-motion: reduce)` companion landed in
      the same commit, collapsing every duration to 1ms. Verified with the
      probe harness: `getComputedStyle()` on a button and a tab both report a
      `0.09s` transition duration)
- [x] Every list has an empty state; every error has an icon, a colour and a
      message that persists until acted on. (VIS-12 — a `no scripts yet ·
      new script` / `no midi files · import…` row replaces each blank void.
      VIS-14/A11Y-08 — an aria-hidden `⚠` glyph sits alongside `--danger` on
      both `#msg.bad` and `App.fail()`'s `.err` block, and only a transient
      success auto-clears; an error persists until the next action. All
      three done, see "Already completed"; verified with the probe harness:
      a success message cleared itself after 4.3s, an error message did not,
      and both empty-state rows render with the expected text)
- [ ] The Monaco editor's palette matches the surrounding chrome, including
      scrollbars, widgets and lists.
- [ ] `CLAUDE.md`'s "Deviations from the design file" section records every
      remaining divergence from `Pellizzola Brothers.svg`, with a reason.

### Accessibility

- [x] Every function of the application is reachable and operable with the
      keyboard alone, including placing and erasing tiles. (A11Y-03 —
      `Grid.kcur`, moved by the arrow keys, is a second cursor independent
      of the mouse-driven `Grid.hov`; Return/Space applies the current tool
      through `Grid.kpaint()`, Delete/Backspace erases through
      `Grid.kerase()` when nothing is already mouse-selected. Verified with
      the probe harness: a synthetic Enter painted the selected block at the
      keyboard cursor, a synthetic Delete erased it, Space placed an entity
      and selected it, and Backspace with nothing mouse-selected removed
      it - each going through `Undo.act()` and confirmed undoable/redoable)
- [x] A visible focus indicator appears on every focusable element, and focus
      order is logical. (VIS-06 for the ring; A11Y-01 gives the palette, file
      lists and tab strip roving tabindex in a defined title-bar-to-status-bar
      order)
- [ ] All text meets WCAG AA (4.5:1, or 3:1 at ≥18.66 px bold / 24 px);
      all control boundaries and focus indicators meet 3:1. Verified with a
      contrast checker, not by eye.
- [ ] No state is communicated by colour alone.
- [x] All hit targets are at least 24 × 24 px. (A11Y-04 — the tab-close glyph
      and the MIDI header's `+` are padded to a `--space-7` (24px) hit box
      without growing the visible glyph; `li` rows and window controls were
      already there (GEO-01, NAT-02); `#hbar`'s own scrollbar track is exempt
      as an inline control, per the finding's own text. Verified with the
      probe harness: `getComputedStyle()` on both previously-undersized
      targets now reads `24px` × `24px`)
- [x] Status messages and errors are announced by a screen reader. (A11Y-05 —
      `#msg` carries `role="status"`, `App.fail()`'s error block carries
      `role="alert"`; verified with the probe harness: both roles present,
      `aria-atomic="true"` on both)
- [ ] The app is usable under Windows High Contrast, `prefers-contrast: more`,
      and OS text scaling.
- [ ] A VoiceOver, Narrator and Orca pass each reach and describe the file
      list, tabs, palette, inspector and canvas.

### Correctness and reliability

- [x] It is not possible to lose unsaved work through reload, navigation,
      drag-drop, quit, window close, or a renderer crash. (BUG-01, BUG-09,
      NAT-18 — dropping a file can no longer navigate the shell away; NAT-09's
      own remaining scope is making a drop *open* the file, not losing work)
- [x] Saves are atomic; a previous good file is never replaced by a partial
      one; an overwrite leaves a `.bak`. (BUG-02, UX-10)
- [x] A save failure is impossible to miss from any tab. (BUG-07)
- [x] The dirty indicator is true: undoing to the opened state clears it,
      redoing past it restores it. (BUG-03)
- [x] Recovery snapshots exist and a crash offers to restore them. (UX-10)
- [x] The editor warns — without blocking — about levels the game cannot run
      (missing or duplicate start/end, dangling script references,
      out-of-bounds entities). (BUG-11)
- [ ] Every mutation of the level document is wrapped in `Undo.act()` or a
      `begin`/`end` pair, per `CLAUDE.md`. Verified by review of every writer.
- [ ] Every save path calls `Grid.commit()` first, per `CLAUDE.md`.

### Code and process

- [x] `npm run lint` and `npm run check` pass, and `check` includes the
      global-collision grep, a `.lvl` round-trip, and migration of the known
      legacy levels. (ARCH-07)
- [x] `tools/probe.js` is committed and documented, so the app can be driven
      headlessly with one command. (ARCH-07)
- [x] Document identity lives in the main process; the renderer never supplies
      a filesystem path. (BUG-08/ARCH-01)
- [x] Exactly two places contain platform branches: `chrome.js` in main, and
      `[data-platform]` selectors in CSS. (ARCH-03)
- [x] `W`, `H` and `B` are each defined once. (ARCH-02)
- [ ] `npm run dist` produces installable artefacts for all three platforms.
- [x] `CLAUDE.md` is updated to describe the new architecture — main-owned
      document state, the menu, the platform module, the token system — so the
      next reader does not have to rediscover any of it. (BUG-08/ARCH-01,
      NAT-01, ARCH-03 for the first three; GEO-01/VIS-04 added the token
      system paragraph and the `tokens.js` row in the file table)

### Performance

- [ ] Dragging an entity across a level holds 60 fps with the inspector open.
- [ ] Panning and zooming perform no forced synchronous layout per frame.
- [ ] Dragging a splitter does not stutter. (GEO-04's splitters exist now and
      drive the canvas resize through the same `requestAnimationFrame`-
      coalesced path PERF-04 already built for exactly this; not yet backed
      by a dedicated frame-timing measurement, so the box stays unchecked)
- [ ] Cold start to an interactive Level Editor is under one second on a
      mid-range machine, with Monaco loaded lazily. (Monaco loaded lazily is
      done, ARCH-08; the under-one-second cold-start figure itself has not
      been measured with a timer, so the box stays unchecked)
- [ ] Saving a 999-row level completes without the window becoming
      unresponsive, or shows honest progress if it cannot.
