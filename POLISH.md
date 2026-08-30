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

The one hundred and seven items below have shipped and are removed from the findings
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

Shipped, including the packaging piece the finding itself deferred to NAT-07
(`npm run dist` — electron-builder, done, see "Already completed" below):
`eslint.config.js` adds
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
(VIS-03, done — see above); Windows gets `titleBarStyle: 'hidden'` plus `titleBarOverlay`;
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
(band heights) is resolved as a side effect, below; GEO-08 (the remaining
one-offs, including the gaps and font sizes that exactly matched a new scale
step) is done too, in a later round — see "Already completed" above.
Verified with the probe harness: `#tabs` computes to `34px` and
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
`#2e2049`, `#1e1633` - were untouched at the time; giving them a considered
relationship to the surrounding chrome was VIS-18's own remaining scope,
done in a later round — see "Already completed" above). `main.js`'s
`backgroundColor`
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
scrollbar theme keys were untouched at the time - that was VIS-18's own
scope, done in a later round (see "Already completed" above). Verified with
the probe harness: `getComputedStyle(...).scrollbarGutter` reads
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
handlers destroying a field's own caret - is done too, in a later round (see
"Already completed" above), reusing this same `Panel.update()`. Verified with the probe
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
with the panel's width. Offering 1×/2× cell sizes as a preference was out of
this finding's own scope, which only asked that the token exist for such a
preference to flip later - it does now, in a later round (UX-11, done, see
"Already completed"). Fixing this exposed a real,
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
Narrowing the packaged `files` list (this finding's other half) is done too,
in a later round — see "Already completed" above, NAT-07: `node_modules/monaco-editor/dev/**`
and `/esm/**` are excluded, since `code.js` only ever loads `min/vs`.
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
converting was a click, resolved (`onup()`, `grid.js`) into an instant delete
of whatever is under the original press cell when that cell is inside the
level's own bounds - the same action a right-drag already applies along its
path, just without needing to ask first - or into the canvas context menu
(`canvasmenu()`; `main.js`'s `menu:row` handler grows a `kind === 'canvas'`
branch) when it is not, the one place left with nothing to delete. The menu
itself now carries only `fit view`; a follow-up request narrowed the click
case from "open a menu with a delete-entity item" to "just delete, no menu"
directly, which made the menu's own `delete entity` item permanently dead
(no cell outside the level can ever hold an entity) and it was removed along
with the `canvasdelete` IPC round trip it drove. On macOS, Ctrl+click arrives
as this same button-2 event; it is marked `noerase` at press time and never
converts into an erase-drag regardless of any subsequent movement, per the
finding's own "do not treat Ctrl+click as erase" instruction, and resolves on
release exactly like any other right click, at the cell the press itself was
over. Verified with the probe harness: a plain right click on a painted cell
with no movement deleted it directly with no menu call; the same on a placed
entity removed exactly that entity; right-dragging across painted cells still
erased all of them, confirming the drag gesture is unchanged; a right click
outside the level's own bounds called `canvasmenu()` (confirmed via a
temporary global stub - `api`'s own surface is frozen by `contextBridge` and
not reassignable from a test) and left the grid untouched; a Ctrl+click drag
across painted cells erased nothing despite the movement, then deleted the
press cell on release, matching a real right click's own behaviour exactly.

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
keyframe, referenced at the time from its own inline style since the field
was still styled inline; it is a real `.rename` class now (VIS-15, done in a
later round — see "Already completed" above), and the animation moved onto
that class with it. Canvas drawing, tab content swapping and the save
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
palette); `#props` carries `role="region" aria-label="properties"` (the label
itself went lowercase in a later round, VIS-10, done - see "Already
completed", to match the in-window convention every other in-window label
now states explicitly), and its
`h4`s were already real headings, so an inspector user can already jump
between them. `.hdr`'s own CSS gained `font: inherit` - a heading carries UA
default font-size/weight a `<div>` never did, which would otherwise have
blown the row out of its token-derived height the moment the tag changed.
The disabled `▶` button's `aria-disabled`/`aria-describedby` is done too, in
a later round (VIS-13, see "Already completed"). Verified with the probe
harness: `document.getElementById('title').tagName === 'HEADER'`; all four
header ids resolve to `H2` elements; `#scripts`/`#midis`/`#palette` each
report the expected `aria-labelledby`; `#props` reports `role="region"`,
`aria-label="properties"`; `getComputedStyle()` on a header element reports
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

#### VIS-11 — There is no icon system

Shipped, for the five sites the finding's own "Current"/"Why it's a problem"
text names as broken: a `--icon: 16px` token and `.icon`/`.icon.fill` classes
now live in `style.css`, and a new `svgicon(fill, d)` helper (`panel.js`)
builds a `currentColor` inline `<svg>` from a path - `fill` picks between the
stroke-only outline style (`.icon`) and the solid-fill style (`.icon.fill`).
The three "+"s - `new script` and `import midi` (`index.html`) and the
palette's add-definition cell (`panel.js`) - now render the same plus icon
through the same mechanism instead of three different text glyphs at three
different sizes and alignments; tab-close (`app.js`) is a stroke X and
playtest (`index.html`) a filled triangle, each its own SVG. Icons take
`currentColor`, so they participate in VIS-07's hover/active/disabled state
system for free, same as the text they replaced. Deliberately not
retrofitted: the hotbar (already a deliberate text-based design, NAT-04,
done - see above), file-manager rows, and block/entity/warning/error - the
finding's own text does not demonstrate any of those as currently broken, and
building icons with no consumer would repeat the mistake GEO-01 already
avoided for `--radius-3`/`--elev-2`/`--z-*`. Verified with the probe harness:
`#add`, `.run`, `#addmidi` each report a child `<svg>` (`querySelector('...
svg')` true for all three); `npm run lint`/`npm run check` pass.

---

#### VIS-18 — The Monaco theme is a fifth, drifting copy of the design

Shipped: `Tokens` (`tokens.js`) gained the five entries VIS-04 didn't already
cover - `accRgb` (the raw `--acc-rgb` triple, for accent-tinted overlays, the
same composition `gridLine` already used), `line`, `danger`, `surfaceHover`,
`surfaceSelected` - plus `fontSize`/`lineHeight` read as plain numbers, since
`monaco.editor.create()`'s options can no more resolve a CSS `var(...)` than
its colours can. `code.js`'s `THEME.colors` grew from four keys sourced from
`Tokens` to nineteen: `editor.background` now sits at `Tokens.canvasBg`
(Monaco visually replaces the canvas on screen, not a side panel), and every
key the finding named as leaking VS Code's own blue -
`scrollbarSlider.*`, `editorWidget.border`, `editorSuggestWidget.*`,
`list.hoverBackground`, `list.activeSelectionBackground`,
`editorBracketMatch.*`, `editor.selectionHighlightBackground`,
`editorError`/`editorWarning.foreground`, `focusBorder` - is now built from
`Tokens.accRgb`/`Tokens.danger`/`Tokens.surfaceHover`/`Tokens.surfaceSelected`
instead of falling through to `vs-dark`'s own defaults.
`monaco.editor.create()` also now passes `fontSize: Tokens.fontSize`,
`lineHeight: Tokens.lineHeight`, and an explicit `renderLineHighlight: 'line'`
- the same "this row" fill treatment a selected `li`/`.tab` already give
(VIS-07, done). Verified with the probe harness, a script tab opened and
Monaco loaded: `THEME.colors['editor.background']` read `"#0b0813"`, matching
`--canvas-bg` exactly; `editorError.foreground`/`editorWarning.foreground`
both read `Tokens.danger`; `scrollbarSlider.background` read an
`accRgb`-tinted `rgba(123, 86, 186, .2)`, not VS Code's default blue; the
live editor's own `fontSize`/`lineHeight` options read `12`/`18`, matching
`--font-size`/`--line-box`.

---

#### VIS-16 — Canvas-drawn indicators have no contrast guarantee

Shipped, both recommended techniques, applied to exactly the indicators the
finding names. New `outline(g, x, y, w, h)` (`grid.js`) draws the two-tone
dark-3px/light-1px stroke the finding asks for; `diffRect(g, x, y, w, h)`
draws a `globalCompositeOperation: 'difference'` rectangle for the transient,
per-frame indicators. The selection ring and the level-bounds outline (both
persistent) now go through `outline()`; the hover cell and the new keyboard
cursor (A11Y-03, done - see above) now go through `diffRect()`, so an
indicator is guaranteed visible over any content underneath it regardless of
that content's own colour. `prefers-contrast: more` is honoured too: a new
`watchcontrast()` (`grid.js`), called from `Grid.init()`, sets `Grid.hc` from
a persistent `matchMedia('(prefers-contrast: more)')` listener - persistent,
not the `{once:true}` self-rearming pattern `watchdpr()` uses for
`resolution: Xdppx`, because a boolean preference query stays valid
indefinitely and re-arming it on every change would only leak listeners - and
thickens the selection ring's outer stroke from `SELW` (3px) to `SELW_HC`
(5px) when set. Grid lines stay single-tone, per the finding's own scope.
Verified with the probe harness by sampling raw canvas pixels
(`getImageData`) at the selection ring's edge, anchored to the current
camera position rather than a guessed absolute coordinate: the expected
`[0,0,0]` (dark) / `[255,255,255]` (light) / `[0,0,0]` (dark) three-band
pattern was present at the ring's border in both directions; a full
regression pass (paint, undo/redo, save/open, tab switching) showed no
behavioural change.

---

#### GEO-08 — Assorted one-off dimensions

Shipped all four remaining rows. `.tab`'s `max-width: 260px` is now
`max-width: 24ch` with a new `min-width: 6ch` floor - a character count,
since tabs hold filenames, rather than an unexplained pixel width; `#props
textarea`'s `height: 48px` (2.67 lines) is now `calc(var(--line-box) * 3)` -
"three lines," a decision, rather than a number close to one. `.acts`'s
`gap: 14px` and `#title`'s `gap: 10px` are both now `var(--space-5)` (12px),
the nearest step on GEO-01's own 2/4/6/8/12/16/24 scale. `.grp`, `#props h4`
and `#props .hint`'s `font-size: 10px` are now `var(--font-size-sm)` (11px,
the same token `#status` already used) rather than a third, sub-legibility
size token; `.run`'s own `font-size: 13px` was already dead by the time this
finding was reached - VIS-11 (done, same round) made it an icon-only button
with no text to size. Verified with the probe harness: `getComputedStyle()`
on `.tab` reported the `ch`-derived max-width; on `#props textarea` reported
`54px` (three `18px` line-boxes); on `.acts`/`#title` reported `12px` gaps;
on `.grp`/`#props h4`/`#props .hint` reported `11px` font-size; `npm run
lint`/`npm run check` pass.

---

#### VIS-15 — Two components style themselves with inline `cssText`

Shipped the one site still open - `.cell.add` (`panel.js`) was already a real
class by the time this finding was reached, in an earlier round. A new
`.field` class (`style.css`) is the same declaration block `#props input,
#props select, #props textarea` already used - one comma-separated selector
list, so the two are one component with zero duplicated declarations, not
two rules that happen to agree today - and a `.rename` class carries the one
thing genuinely specific to the inline rename input: the `pb-fade-in`
animation (VIS-08) that marks the moment it replaces a row's static label.
`edit()`'s (`app.js`) rename `<input>` now gets `className = 'field rename'`
in place of a hand-written `style.cssText` that duplicated half of
`#props input`'s rule and disagreed with the other half (no padding, no
radius, no focus transition, a hardcoded `#17102a` instead of
`var(--surface-raised)`). `--border`/`--control-border` already evaluate to
the same `1px solid var(--acc)` the old inline style hardcoded, so the
rename field's focused appearance is pixel-identical to before; unfocused, it
now gets the padding/radius/transition it never had. Verified with the probe
harness: the rename input's `className` reads `"field rename"` with an empty
`style.cssText`; its computed border (`1px rgb(123, 86, 186)`), background,
and `border-radius: 2px` match `#props input`'s own computed values exactly;
`animationName` reads `"pb-fade-in"`; a full regression pass (paint,
undo/redo, save/open, tab switching) showed no behavioural change.

---

#### BUG-13 — `app://` path containment check is prefix-only

Shipped: `serve()`'s (`main.js`) check is now `p !== ROOT && !p.startsWith(ROOT
+ path.sep)`, so a sibling directory whose name merely extends `ROOT`'s
(`…/studio-backup`) no longer satisfies it. The audit's further suggestion -
an explicit allow-list of servable subtrees - was not adopted: the prefix fix
alone closes the actual defect the finding describes, and `path.join` +
`normalize` already collapse `..` before this check runs, so a second
narrowing layer had no live gap left to close. Verified by reading the new
condition against both cases by hand: `ROOT` itself and any real descendant
still pass; a sibling directory sharing `ROOT`'s prefix no longer does.

---

#### NAT-06 — No recent documents

Shipped: `main.js` gained a small `recent.json` (`userData`, mirroring
`window.json`'s own pattern), bumped on every successful `lvl:open`/
`lvl:saveas` via a new `addrecent()`, which also calls
`app.addRecentDocument()` for the OS's own memory of the file; a path that no
longer exists on disk is filtered out lazily, when the list is loaded for the
menu, rather than watched. `menu.js`'s File menu gained an "Open Recent"
submenu built from that list (basenames as labels, a trailing "Clear Menu"
that empties both the OS list and the persisted one) - a dedicated
`open-recent` channel carries the chosen path to the renderer rather than
main opening it directly, since it still has to cross the renderer's own
unsaved-changes guard first, exactly like any other open (`App.openrecent()`,
`preload.js`'s `api.openpath`/`onopenrecent`, a new `lvl:openpath` handler
sharing `lvl:open`'s own `openfile()` helper). Windows JumpList population and
the macOS Dock's own menu are done too, in later rounds — see "Already
completed" above, NAT-07 and NAT-17. Verified with the probe harness: opening a level wrote its path as the
sole entry in `recent.json`; the File menu's "Open Recent" submenu built
exactly that path's basename; invoking its `click()` handler after a `New
Level` had cleared `App.path` reopened it end-to-end through the real guarded
round trip; invoking "Clear Menu" emptied both the submenu (down to "No
Recent Documents") and `recent.json`; seeding `recent.json` with a path to a
file that does not exist produced the same empty "No Recent Documents" state
on the next menu build.

---

#### NAT-16 — A native `<select>` sits inside a fully custom form

Shipped: `#props select { appearance: none; ... }` (`style.css`) restyles the
closed control to match the flat, square, dark fields around it - a chevron
background-image (an inline SVG data URI, since a data URI cannot resolve a
CSS custom property) replaces the platform's own popup-button chrome. The
dropdown list itself is untouched and still native: keyboard navigation,
type-ahead and a screen reader's combobox semantics are all unaffected, which
is the whole point of restyling the control rather than replacing it with a
custom listbox (the finding's own explicit recommendation - repeating the
mistake the old DOM context menu made before NAT-05 replaced it would have
cost exactly that). Verified with the probe harness: `getComputedStyle()` on
the level view's background `<select>` reads `appearance: "none"`.

---

#### GEO-10 — There is no vertical scrollbar for the level

Shipped: a `#vbar`/`#vspace` pair, structurally identical to `#hbar`/
`#hspace`, sits beside the canvas (`#canvasrow`, a new row wrapping `#wrap`
and `#vbar`) with `#corner` filling the square `#hbar` would otherwise leave
underneath it - the same spacer-driven real-overflow-container technique
`CLAUDE.md` already documents for the horizontal bar, mirrored onto the
vertical axis by `Grid.syncvbar()`/`onvbar()` (`grid.js`), reading and writing
`Grid.cam.y` the way `Grid.syncbar()`/`onbar()` already do for `cam.x`. Hidden
via `visibility: hidden` (not `display: none`, so the row does not reflow)
whenever the level fits the viewport vertically - unlike `#hbar`, which always
has 540 columns' worth of range to represent regardless of window size. Fixing
this exposed the same automatic-minimum-size flex bug GEO-07's `#side`/
`#right` fix (`min-width: 0`) already named on the other axis: `#stage` and
`#vbar` both needed an explicit `min-height: 0`, or `#vspace`'s own
tens-of-thousands-of-pixels intrinsic height propagated straight up through
the flex chain and the canvas row grew to fit it instead of the window.
Verified with the probe harness: a 12-row (default) level's `#vbar` computes
`visibility: hidden`; growing the level to 999 rows flips it to `"visible"`
and its `scrollHeight` now genuinely exceeds `clientHeight`; setting
`bar.scrollTop` and dispatching `scroll` updates `Grid.cam.y` by the expected
amount, and setting `Grid.cam.y` and redrawing writes the matching
`scrollTop` back - the same round trip verified for `#hbar`, unaffected by
this change. A screenshot confirms the two bars read as one L-shaped frame
around the canvas.

---

#### UX-01 — A file row cannot be opened by clicking it

Shipped: `list()` (`app.js`) now also binds `ondblclick` on a script row to
`App.opentab(k)`, alongside the existing single-click-opens-the-menu binding
`CLAUDE.md` documents as a deliberate, explicit choice - the two do not
conflict, since a double-click's second click simply dismisses the menu the
first click opened. MIDI rows are unaffected: they have no "open" action to
speed up. Verified with the probe harness: dispatching a synthetic
`dblclick` on a script row opened it as a tab (`App.tab`/`App.open` both
updated) without going through the menu round trip.

---

#### UX-03 — Undo and redo say nothing about what they undid

Shipped: every `Undo.begin()`/`Undo.act()` call site across `grid.js`,
`app.js` and `panel.js` now names its own step ("paint", "erase", "move
entity", "place entity", "delete entity", "resize level", "rename script", …),
stored on the step itself (`undo.js`'s `Undo.step.label`, defaulting to
`'edit'` for the rare unlabelled caller). `App.syncmenu()` sends the label at
the top of each stack alongside `canUndo`/`canRedo`; `menu.js` Title-Cases it
onto the item text ("Undo Paint", "Redo Move Entity"), and `undo.js`'s
`shift()` reports "undid paint"/"redid paint" in the status bar instead of
"undo (3 left)" - a count the finding correctly noted most users read
backwards. Verified with the probe harness (a variant that also intercepts
`Menu.buildFromTemplate` to read the real template main builds): painting a
cell produced `Undo.past[...].label === "paint"`; the Edit menu's own item
labels read `["Undo Paint", "Redo"]`; undo/redo produced `"undid paint"`/
`"redid paint"` in `#msg`.

---

#### UX-05 — The editing verb set is thin

Shipped, the three the finding's own text asked to prioritise alongside flood
fill - "four small, self-contained additions", of which flood fill alone
needs a genuinely new piece of persistent UI (a bucket tool the palette has no
slot for yet) rather than a modifier on a gesture that already exists, so it
is left for a separate pass rather than folded in as a fourth, larger scope
change here:
- **Rectangle fill** - Shift-drag with the block tool (including the eraser)
  now shows a live preview (the same two-tone `outline()` the selection ring
  uses) and commits the whole rectangle once, on release, rather than
  free-hand painting the drag path (`Grid.rectAnchor`/`Grid.rectCur`, `grid.js`).
- **Arrow-key nudge** - a selected entity now takes the arrow keys over the
  keyboard cursor (`Grid.nudge()`, mirroring `ondown()`'s own "a selection
  wins" precedence), ±1 cell or ±10 with Shift, clamped to the level's own
  bounds.
- **Duplicate** - `Grid.duplicate()`, offset by one cell, wired to a new
  Edit → Duplicate menu item (⌘D/Ctrl+D).

All three go through `Undo.act()`/`Undo.begin()` per `CLAUDE.md`'s rule.
Verified with the probe harness: a Shift-drag across a 4×8 region painted
zero cells before release and exactly 32 after, undoing in one step labelled
"rectangle fill"; `Grid.nudge()` moved a selected entity by exactly `B` (and
by `10 * B`, clamped to the level's last row, with Shift); `Grid.duplicate()`
added a second entity offset by one cell and reported "nothing selected to
duplicate" when nothing was.

---

#### UX-15 — Inline rename gives no feedback and loses work on failure

Shipped: `edit()` (`app.js`) now validates on every keystroke (`badname()`,
the same duplicate/empty checks `renscript()`/`renmidi()` already made after
the fact, moved earlier) and shows the field's own invalid state - a
`--danger` border plus a one-line message under it (`li.editing` switches the
row to wrap so the message gets its own line) - rather than only reporting a
rejected rename after the field is already gone. Enter now calls a `commit()`
that keeps the field open, text intact and refocused when invalid, instead of
blurring into a rebuild that discarded whatever was typed; a blur (clicking
away) commits if valid and re-opens if not, so "I clicked elsewhere by
accident" no longer reads the same as a deliberate commit. Escape is
unchanged - it still discards unconditionally. Verified with the probe
harness: typing a name that collides with an existing script showed
`invalid: true` and the exact "a script named … already exists" message live,
before Enter was even tried; pressing Enter while invalid left the field open
with the typed text intact and the script table unchanged; fixing the name
and pressing Enter committed normally; Escape still discarded the edit as
before.

---

#### UX-16 — Tabs overflow into nothing

Shipped: `#tablist` is `overflow-x: auto` (with the same tokenised scrollbar
treatment NAT-20 already gave the other four scroll containers) instead of
`overflow: hidden`, so every open tab is reachable again; `tabs()` (`app.js`)
scrolls the active tab into view (`scrollIntoView({block: 'nearest', inline:
'nearest'})`) on every switch, so opening or selecting a tab scrolled out of
sight brings it back; middle-click now closes a tab
(`onauxclick`/`button === 1`), which costs three lines as the finding
predicted. The non-closable Level Editor tab gets `.tab.pin`
(`position: sticky; left: 0`) so it stays fixed outside the scrolling region
instead of reading identically to the closable tabs next to it, which doubles
as the fix for "the Level Editor tab scrolled away". `⌃Tab`/`⌃⇧Tab` keyboard
switching is done too, in a later round (NAT-14, see "Already completed") -
`⌘1…⌘9` numbered jumps and the overflow chevron listing hidden tabs via a
native menu are not: scrolling and cycling together already make every tab
reachable, which is what this finding's own title names as the defect, and
`⌘9` was already spoken for (View → Fit Scene, UX-04). Verified with the probe harness: opening 15
scripts produced `#tablist.scrollWidth > #tablist.clientWidth`; selecting the
first and the last tab moved `#tablist.scrollLeft` accordingly; the pinned
tab's computed `position` read `"sticky"`; a middle-click (`auxclick`,
`button: 1`) on a tab closed it. A screenshot confirms the pinned tab and the
scrollbar both render as intended.

---

#### PERF-02 — Layout is read and written twice per frame in the draw path

Shipped: `Grid.rect` is now cached at `Grid.init()` and refreshed only from
`doresize()` (the already-coalesced `ResizeObserver` callback, PERF-04, done
- see "Already completed"), rather than every one of `clamp()`, `fit()`,
`fitH()`/`fitW()`/`fitscene()`, `zoomto()`, `at()`, `kdefault()`, `onwheel()`
and `onmove()` calling `getBoundingClientRect()` on its own; `#hbar`/`#hspace`
and (GEO-10, above) `#vbar`/`#vspace`/`#corner` are looked up once at
`Grid.init()` too, instead of by `getElementById()` on every `syncbar()`/
`syncvbar()` call. `Grid.syncbar()`/`Grid.syncvbar()` also now skip writing
`hspace.style.width`/`vspace.style.height` when the value they would write is
unchanged from the last write, rather than rewriting an identical string
dozens of times a second during a plain pan. Verified with the probe harness:
instrumenting `getBoundingClientRect` and driving a synthetic pan (ten
`mousemove`s) counted **1** call (the one-time cache at `Grid.init()`/on
resize), against 30+ before this change (one per `clamp()` inside every
`Grid.draw()` the pan's `requestAnimationFrame` coalescing still allows);
instrumenting the `hspace`/`vspace` style setters the same way showed a write
only on the first frame of a zoom-driven pan, not on every subsequent frame at
the same zoom.

---

#### ARCH-04 — `Panel` rebuilds its entire DOM for every change

Shipped: the entity-drag hot path itself was already fixed by PERF-01, done —
see above; this closes the finding's remaining half. `Panel.inspect()`
(`panel.js`) now saves and restores focus around each of its three-way
rebuilds - `savefocus()`/`restorefocus()` capture the focused element's id
and, for a text-like field, its `selectionStart`/`selectionEnd` before the
rebuild runs, and refocus the freshly-built element with the same id
afterward, so `p_rows`/`p_def`/`p_id`/`p_script`'s own `onchange` handlers no
longer strand focus on `document.body` when they call `Panel.inspect()` from
inside the field that just changed. The x/y `onchange` handlers in
`entityview()` go further still, reusing PERF-01's own `Panel.update()`
directly instead of triggering a full rebuild at all - the exact reuse the
finding's own "Recommended" section asked for. Retiring `esc()` (the audit's
other suggested change) was reassessed and left alone: it already escapes
`&`, `<`, `>` and `"` everywhere it is used, both inside quoted attributes
and inside element text content (including a `<textarea>`'s own content,
where an unescaped `</textarea>` would otherwise break out), so there is no
actual injection hole for `document.createElement`/`textContent` to close -
the escaper is exactly as safe as the finding worried it might not be, just
not the newest idiom. Verified with the probe harness: a synthetic entity
drag through `p_x`'s `onchange` kept `document.getElementById('p_x')`
identical to the node captured before the change (`sameNode: true`), with
the cell/y fields updated correctly through `Panel.update()` alone; focusing
`#p_rows`, changing its value and dispatching `change` left
`document.activeElement.id === 'p_rows'` afterward (previously reverted to
nothing, the exact bug the finding described).

---

#### ARCH-06 — IPC surface is inconsistently shaped

Shipped, the load-bearing half of the finding: `main.js`'s `guard()` now
answers exactly one envelope, `{status: 'ok'|'cancel'|'error', data,
message}` - a handler returns the sentinel value `CANCEL` to signal a
dismissed dialog (`lvl:open`, `lvl:saveas`, `midi:import` all do), throws to
signal a real error, or returns its data plain otherwise. `app.js` gained one
`call()` helper that unwraps this - `const r = await call(api.foo()); if
(!r) return;` - collapsing what used to be two separate, forgettable checks
(`!r.ok`, then `r.cancel`) into one that cannot be half-done: a missed check
now throws immediately on `undefined` instead of silently reading a
cancelled dialog as a success. Every existing call site (`App.new`,
`App.openlevel`, `App.openrecent`, `App.save`, `App.saveas`, `addmidi`) was
moved onto it. `App.open_` is renamed `App.openlevel`, as the finding's own
closing note asked. Channel-name normalisation to a strict `domain:verb`
convention was not done - the audit's own text names the *envelope*
inconsistency as the actual silent-failure risk ("a missed check treats a
cancelled dialog as a success"); renaming already-working channel names is
cosmetic risk with no matching safety upside, so it was left out of scope.
`ask:discard`'s own bare `'save'|'discard'|'cancel'` string is deliberately
still outside this convention too: it names a real three-way user choice a
caller branches on directly, not an operation outcome to unwrap, and BUG-10
already gave it a self-describing shape. Verified with the probe harness:
`call(Promise.resolve({status:'cancel'}))` resolved to `undefined` without
touching `#msg` or creating a `.err` block; `call(Promise.resolve({status:
'error', message:'boom'}))` resolved to `undefined` and produced `#msg` text
`"⚠ boom"` plus a `.err` block; a real cancelled Save As and cancelled Open
(a probe variant stubbing `dialog.showSaveDialog`/`showOpenDialog` to
`{canceled: true}`) both left `App.path` unchanged and `#msg` untouched, with
no `.err` block - confirming a cancelled dialog can no longer be mistaken for
either a success or a failure.

---

#### UX-09 — First run drops the user into an untitled void

Shipped, the two lower-risk pieces of the finding's own three: `main.js`'s
`savewindowstate()` now writes `doc.path` into the same `window.json` NAT-10
already persists geometry to, and a new `lvl:init` handler (replacing
`lvl:new` as the boot-time call) reads it back, reopening that file - through
the same `openfile()` every other open already goes through - if it still
exists on disk, or falling back to the same blank level `lvl:new` always
produced otherwise. `app.js`'s boot sequence calls this instead of
`api.blank()`, and shows a sticky status-bar hint (`click to place ·
right-drag to erase · alt-drag to pan`) on a genuine first run - sticky via a
new third `App.say(m, bad, sticky)` argument that skips the 4s auto-clear
timer, dismissed by `App.touch()` comparing `#msg`'s own text rather than a
separate flag, so it only ever clears itself and never a different, more
recent message. The third piece, a start view (New Level/Open/Recent in
place of the canvas) replacing the first-run blank level entirely, was not
built: it is a new persistent UI surface with real scope of its own - hiding
the canvas, wiring three commands to it, a dismiss path - not a small
addition to an existing one, and the commands it would offer are already one
click away in the menu and hotbar. Verified with the probe harness, each
against an isolated `--user-data-dir`: a fresh profile with no `window.json`
boots to `path: null`, `dirty: false`, `#msg` reading the hint text; a
profile seeded with `window.json`'s `path` pointing at a real,
previously-saved level boots with that level loaded (`path`, `name` and
`dirty: false` all correct) and `#msg` reading `"restored last session"`; a
profile seeded with a `path` to a file that no longer exists on disk falls
back to the same blank-plus-hint state as a fresh profile.

---

#### PERF-07 — Startup shows an empty window before the document exists

Shipped: `win.once('ready-to-show', ...)` no longer calls `win.show()`
directly - it starts a 2s fallback timer, and the actual `showwin()`
(`win.show()` plus the existing `maybeRecover()` call) now runs from the
renderer's own `ui:ready` signal instead, sent once `App.setdoc()` has
loaded a real document (UX-09's `boot()`, in the same commit). The fallback
timer exists so a renderer that throws before reaching that point still
shows a window rather than leaving one permanently hidden - the same "do not
trust the other side of the process boundary to always answer" discipline
`closetimer`/`deadrenderer` (BUG-09) already established for window close.
`ipcMain.once('ui:ready', ...)` is registered, and explicitly torn down
again on the window's own `closed` event, per `createwin()` call, so a
window closed before it ever signals `ui:ready` cannot leave a stale
listener that fires against a later window. Verified with the probe harness
(a variant reading `win.isVisible()` directly, per `CLAUDE.md`'s guidance for
main-process-only behaviour): `visible=false` at window creation and still
`visible=false` at `did-finish-load` (previously the moment `ready-to-show`
would have shown it); `visible=true` only once the `'show'` event actually
fires, after the renderer's own boot sequence has run.

---

#### NAT-14 — The command set is thin; zoom, tab switching and region operations have no shortcut

Shipped, the tab-switching piece of the finding's own remaining scope:
`menu.js`'s View menu gained "Next Tab"/"Previous Tab", `Control+Tab`/
`Control+Shift+Tab` - the bare `Control` form deliberately, not `CmdOrCtrl`,
since `Cmd+Tab` is macOS's own application switcher and must not be
shadowed, the same reasoning that already governs every other accelerator
this menu declares. `app.js`'s `switchtab(dir)` cycles `['level',
...App.open]` in tab-strip order, wrapping at both ends, dispatched through
the same `cmd`/`ACTS` channel every other menu command already uses.
Numbered `⌘1…⌘9` jumps were not added - `⌘9` already belongs to View → Fit
Scene (UX-04), and building nine dynamic, tab-count-dependent accelerators
around that one collision was judged not worth it for what cycling already
covers. Tool cycling and region operations (select-all/copy/paste of a
canvas selection) remain open: the former has no concrete key proposed
anywhere in this document to implement against, and the latter changes
`Grid.sel`'s shape, the same scope UX-05 already deferred under "defer until
there is a reason" (§13, "Nice to have"). Verified with the probe harness:
opening two script tabs left `App.tab` on the second; dispatching `cmd`
`nexttab` three times cycled it `level → scripts/a.lua → scripts/b.lua`,
wrapping correctly at both ends; `prevtab` from there moved back to
`scripts/a.lua`.

---

#### NAT-09 — No drag and drop

Shipped: `dragover`/`dragleave`/`drop` are handled globally in `app.js` now -
`dragover` unconditionally calls `preventDefault()` (the actual backstop;
without it on `dragover` specifically, Chromium never fires `drop` at all
and falls through to navigating the window to the file, exactly the class of
loss BUG-01/NAT-18 already closed elsewhere) and shows a `#dropzone` overlay
(`pointer-events: none`, so the real drop target underneath still receives
the event) when the drag carries files. `drop()` resolves each file's real
path via a new `api.droppath(file)` bridge (`webUtils.getPathForFile`,
callable only from the preload, per Electron's own deprecation of
`File.path`) and routes by the drop target and extension: a `.mid`/`.midi`
onto `#midis` or a `.lua` onto `#scripts` imports through two new
main-process handlers (`midi:importpaths`/`script:importpaths`, siblings of
the existing dialog-driven `midi:import`) that share `app.js`'s own
`importmidifiles()`/collision-avoiding script-naming logic; a `.lvl`/`.json`
anywhere else opens through `App.openrecent()`, the same
unsaved-changes-guarded path a menu-driven open already uses; anything else
reports "unsupported file type". Verified with the probe harness: `dragover`
with a `Files`-typed `dataTransfer` showed `#dropzone` and reported
`defaultPrevented: true`; `dragleave` with no `relatedTarget` hid it again;
calling `dropmidi()`/`dropscripts()` directly against real temp files
imported them correctly (`midi/test.mid` present in `App.doc.midi`;
`scripts/test.lua` present with its real file content; dropping the same
script twice collision-avoided to `scripts/test_2.lua`); a synthetic `drop`
event targeting `#midis`/`#scripts`/`document.body` with fabricated `File`s
confirmed the target- and extension-based routing reaches the correct
handler in each case, including the "unsupported file type" fallback for a
`.txt`. A real OS-level drag was not reproducible in the headless harness - a
JS-constructed `File` has no disk backing for `webUtils.getPathForFile` to
resolve, so end-to-end path resolution itself is unverified here, the same
class of limitation the audit already records for BUG-12's DPI change and
VIS-06's focus ring.

---

#### VIS-03 — Colours diverge from the design file for no recorded reason

Shipped, as the finding's own "Recommended" text scoped it: `CLAUDE.md`'s
"Deviations from the design file" section now records that
`--acc`/`--acc-text` depart from the design's `#7E58BE` deliberately, for the
WCAG contrast VIS-01/VIS-02 already computed, and that the design's second,
lighter fill accent `#815AC1` has no implementation equivalent - nothing in
the app currently fills a shape with it, and introducing a token with no
consumer would violate this same file's own "introduce it with the
component that needs it" rule. No CSS values changed: `--acc`/`--acc-text`
are the already-verified, contrast-passing values VIS-01/VIS-02 shipped, and
reverting toward the design's literal `#7E58BE` would risk failing that
contrast again without a re-measurement this pass had no occasion to do.
This is a documentation-only change; verified by reading the new
`CLAUDE.md` paragraph back and confirming it names both divergences and the
reason for each.

---

#### UX-13 — Deleting an in-use script refuses instead of helping

Shipped, the "delete anyway" half of the finding's own two suggested
resolutions: `delscript()` (`app.js`) now asks a native confirmation
(`script:confirmdelete`, `main.js`) naming the script and every definition
still using it, with `Cancel`/`Delete Anyway` buttons, instead of refusing
outright. Deleting anyway leaves those definitions pointing at a script that
no longer exists in the archive - deliberately not auto-unassigned, since
`lvl.js`'s `review()` (BUG-11, done — see above) already reports exactly
this shape as `definition "…" points at missing script …` on the next open
or save, the same warning any other dangling reference produces, so nothing
new had to be taught to detect it. "Reassign to…" (a picker) was not built:
the inspector's own per-definition script dropdown already does targeted
reassignment once BUG-11's warning has named which definitions need it,
which is what a picker would ultimately delegate to anyway. Verified with
the probe harness: deleting a script still in use with the confirmation
stubbed to "Cancel" left it and its using definition untouched; with the
confirmation stubbed to "Delete Anyway" the script was removed and a
following save's warnings included `definition "custom_1" points at missing
script scripts/custom_1.lua`; deleting a script with no users proceeded with
no dialog at all, unaffected by the new check.

---

#### UX-14 — Creating a custom definition silently creates a script

Shipped, reshaped by a schema constraint the finding's own "Recommended"
text did not account for: `lvl.js`'s `validate()` requires every
`entity_definitions[].script` to be a non-empty string, so "bind to nothing,
show `(unassigned)`" is not a state the format can actually represent - a
definition left that way would fail validation the moment the user tried to
save, a worse outcome than the silent-arbitrary-bind this finding set out to
fix. `newdef()` (`panel.js`) instead always creates its own fresh script
now, via `App.newscript()`, rather than reusing whichever existing script
happened to be first in `Object.keys(App.doc.scripts)` - removing the
arbitrary-reuse case entirely rather than replacing it with an
unrepresentable one. It also announces what happened
(`App.say('created custom_1 with scripts/custom_1.lua')`) and reliably
selects the new definition in the inspector - `Grid.sel = -1` is now set
alongside `Grid.tool`, closing a latent gap where a canvas-selected entity
would otherwise keep `Panel.inspect()` showing that entity instead of the
definition just created. Verified with the probe harness: `newdef()`
produced `custom_1` with its own `scripts/custom_1.lua` (not a name shared
with any pre-existing script), `Grid.tool` pointing at it, and `#msg`
reading the announcement text.

---

#### A11Y-06 — Everything is in absolute pixels and ignores OS text scaling

Shipped, reshaped in one respect from the finding's own "Recommended" text: a
manual View → Increase/Decrease/Reset Text Size command
(`Control/CmdOrCtrl+Shift+Plus/-/0`) now exists, scaling
`--font-size`/`--font-size-sm`/`--line-box` together in `app.js`'s
`applyuiscale()` - and, through the `--row-*` bands that are `calc()`s off
`--line-box`, every row height in the chrome grows with the type it holds,
while `--space-*` (gaps and padding) stays fixed, exactly the "type scales,
spacing does not" split the finding asked for. The audit's own suggestion -
express the two font-size tokens in `rem` and let a root font-size change do
the rest - turned out not to work in this codebase: `tokens.js` reads both
with `getComputedStyle(...).getPropertyValue()`, which returns a custom
property's specified value verbatim (`"0.75rem"`), never resolved to pixels
the way an ordinary applied property is - `code.js`'s Monaco `fontSize`
option would have silently become `0.75` instead of `12`. Overriding the
three px-valued tokens directly, in place, sidesteps that without touching
what `tokens.js`/`code.js` read (Monaco's own font size is a separate,
pre-existing snapshot read once at load and does not itself follow a later
scale change - a real, documented limitation, not a regression this
introduces). `Grid.resize()` is re-run on every scale change, the same
coalesced hook BUG-12 already established for a DPI change, so the canvas
backing store stays correct. What is *not* done: any automatic response to
an OS-level text-size *setting* - Electron gives no hook to detect one, so
this is a user-invoked escape hatch, not the automatic behaviour 1.4.12
nominally asks for. Verified with the probe harness:
`getComputedStyle(document.documentElement).getPropertyValue('--line-box')`
read `18px` before, `19.8px` after one `uitextinc`, and back to `18px` after
`uitextreset`; `#tabs`'s own computed height (`--row-lg`, derived from
`--line-box`) grew from `34px` to `35.7969px` in step, confirming the row a
line of text sits in grows with it instead of clipping it.

---

#### NAT-08 — No single-instance lock

Shipped: `main.js` calls `app.requestSingleInstanceLock()` before anything
else touches app state; a losing second instance calls `app.quit()` and, per
Electron's own documented pattern for this exact problem, never registers
`app.whenReady().then(...)` at all - gated behind the same `singleinstance`
flag - rather than trusting `quit()`'s own timing to win a race against
`whenReady()`, which could otherwise flash a second window open right before
the app it belongs to closes. The winning instance's own `second-instance`
handler restores and focuses the existing window; parsing an `argv` path out
of it is done too, in a later round — see "Already completed" above, NAT-07 -
`open-file` already routes a second macOS open through Launch Services
regardless, so the lock is taken there too, for one code path on every
platform rather than two. A bare top-level `return` was tried first to skip the rest of the file
for a losing instance and rejected: ESLint parses each file as a standalone
script and does not know about Node's CommonJS module-wrapper semantics, so
it is a parse error there even though Node itself would accept it at
runtime - the `if (singleinstance) app.whenReady().then(...)` gate avoids
the question entirely. Verified with the probe harness: launching a second
process against the same `--user-data-dir` as a running first one exited in
under 0.2s with no console output at all (confirming `whenReady()`, and
therefore the renderer, was never reached), while the first instance's own
window and steps completed unaffected.

---

#### NAT-19 — No feedback for long or background operations

Shipped the finding's own "measure before changing" instruction literally,
and the measurement decided the scope: isolated from IPC and `Grid.commit()`,
a 999-row `lvl.write()` broke down as `JSON.stringify` 11ms, `zipSync` 82ms,
`writeFileSync` under 2ms, `validate()` 6ms - `zipSync`'s own compression,
not disk I/O, is what pushes a big save past the ~100ms budget this finding
set, and is the only piece converted: `lvl.js` now calls fflate's async
`zip()` instead, verified to genuinely free the main thread (a 5ms
`setInterval` kept firing throughout an async 999-row `zip()` call, where it
could not have during the old `zipSync`'s own synchronous one) rather than
merely wrapping the same blocking call in a `Promise`, which would have
fixed nothing. `fs.writeFileSync`/`renameSync` are untouched - `fs.promises`
would not have addressed the measured bottleneck at all. A 999-row *read*
measured 70ms total, under the same budget, so `unzipSync` is unconverted.
`write()` now returns a Promise; every caller (`main.js`'s `lvl:save`/
`lvl:saveas` handlers, already `async`, plus a restructured `lvl:snapshot`
using `.then()`/`.catch()`) awaits or chains it, and `tools/check.js`'s own
round-trip test does too. The progress-bar/completion-toast half of this
finding's own "Recommended" text was not built: the actual freeze - the
reason a long save needed any feedback at all - is gone, and a sub-250ms
background operation that no longer blocks anything is not disruptive enough
to justify a `Notification`, though `win.setProgressBar()` itself is done
too, in a later round — see "Already completed" above, NAT-17. Verified with the probe harness: save,
save-as, an overwrite (with its `.bak`), and a crash-recovery snapshot
(through to a real "Recover" offer on the next launch) all round-trip
correctly through the new async path; a forced validation failure still
reaches `saveerr()`'s native dialog and the inspector's `.err` block exactly
as before, confirming the mixed synchronous-throw/async-reject shape of the
new `write()` is still fully compatible with every existing `try`/`await`/
`catch` call site.

---

#### VIS-10 — Label capitalisation is inconsistent

Shipped: every in-window label, tooltip and `aria-label` (`index.html`,
`panel.js`) is lowercase now - `New Lua Script`/`Import MIDI`/`New Custom
Entity Definition`/`Zoom`/`Resize Scripts List`/`Level Canvas`/`Properties`/
`File` all went lowercase, proper nouns (`MIDI`, `Lua`) untouched. Every
OS-facing surface - the menu bar (`menu.js`), the file manager's native
context menus and the canvas's own (`main.js`'s `menu:row`/`menu:zoom`
handlers), and every dialog title and button (`main.js`) - is authored once,
in Title Case, and converted to GNOME's own Sentence case at the one place
each reaches the OS: a new `chrome.js` export, `oscase()`, extending the
platform module ARCH-03 already built rather than bypassing it. `oscase()`
keeps a string's first word and any all-caps word (the same test that
protects a real acronym like `MIDI` also happens to leave a bare number/
symbol token, a button's own `"100%"`, untouched, since upper-casing either
is a no-op) and lowercases the rest; it is a no-op on macOS/Windows, where
the authored Title Case is already the platform's own convention. Applied
to every static label; never to user-authored content (a recent file's own
basename, an entity definition id concatenated after conversion) - `mac`/
`win32`-only test coverage aside, this is the one place a filename could
have been silently re-cased by mistake, and it deliberately is not touched.
The mac App menu gained an "About"/separator/"Settings…"/separator/
"Services"/separator/"Hide"/"Hide Others"/"Unhide"/separator/"Quit" submenu
built by hand (`role: 'appMenu'` was replaced by UX-11's own Settings item,
below, and Electron does not merge a custom `submenu` with what a role would
otherwise supply, so the rest of the standard app menu had to be spelled out
alongside it); the Help menu's own now-redundant "About" is dropped on mac
only. Verified with the probe harness: every in-window string read back
lowercase after the change; `chrome.oscase('Save As…')` read `'Save As…'`
unchanged on the forced-`darwin`/`win32` branches and `'Save as…'` on the
forced-`linux` one; `npm run lint`/`npm run check` both still pass with the
new `chrome.js` export.

---

#### VIS-13 — The playtest button is permanently disabled and explains itself only in a tooltip

Shipped two of the finding's own four numbered items, deliberately leaving
the button's own design-matched rendering untouched (item 1's "visible soon
affordance" alternative): a new `#run-help` `sr-only` paragraph, referenced
by the `▶` button's own `aria-describedby`, carries the same explanation the
`title=` tooltip already gives a sighted, hovering user to every screen
reader too (item 2's remaining half - `aria-disabled` itself is already
done, A11Y-08). A disabled "Playtest" item, with a macOS `toolTip` (Electron
exposes native disabled-menu-item tooltips on macOS only), now also lives in
the View menu - a second, always-reachable route to the same explanation for
a sighted user who never hovers the tab strip or turns on a screen reader,
without touching the button's own design-matched rendering at all, which
`CLAUDE.md` already documents the reasoning for. Item 4, the eventual
game-wiring implementation, remains open - it needs `game/todo.txt` step
3.1 first, tracked in §13's own "Nice to have" list. Verified with the
probe harness: `document.getElementById('run').getAttribute('aria-describedby')
=== 'run-help'` and `document.getElementById('run-help').textContent`
carries the explanation text.

---

#### VIS-17 — Missing-texture swatches are indistinguishable from content

Shipped exactly as recommended: `blit()` (`grid.js`) now draws nothing at
all for a known id whose sprite has not decoded yet (`tex()` already
re-triggers a redraw the moment it lands, so the backdrop showing through
for a few milliseconds reads as nothing happened, not as an error) and a new
`hatch()` - a clipped, diagonal `--missing-def`-coloured stroke - for a
genuinely unknown id, replacing the old flat colour swatch that read as
content rather than as a problem. `--missing-tex`, the token the old
"decoding" fill used, is retired outright rather than kept with no reader,
per this file's own token-hygiene rule. `lvl.js`'s `review()` gained a new
warning, `block id NNN is not in this build's catalog`, scanning
`block_data` against `catalog.js`'s own `BLOCKS` table - the counterpart to
BUG-11's existing "definition points at missing script" warning, routed
through the same `App.warnings` plumbing rather than a second channel, as
the finding's own text asked. The entity-side "unknown definition" case the
finding's audit evidence pointed at turned out not to need any change: every
entity's own `def` is validated against a real `entity_definitions[].id` by
`lvl.js`'s `validate()` before the document can ever be read or written, so
the only way `blit()`'s own falsy-`t` branch is reachable at all is a block
id absent from the catalog - which is exactly what the new warning now
names. Verified with the probe harness: writing unknown ids `500`/`501`
into `Grid.a` and saving produced warnings including `"block id 500 is not
in this build's catalog"` and `"block id 501 is not in this build's
catalog"`; a screenshot of the rendered canvas shows a clear diagonal hatch
distinct from every real texture, with known blocks (brick, start, end)
rendering normally alongside it.

---

#### UX-02 — Every row menu carries the same two global commands

Shipped exactly as recommended: `main.js`'s `menu:row` handler now only adds
"New Script"/"Import MIDI" when `ctx.kind === 'panel'` (the panel background
menu, where they were already the whole menu) - a script row's own menu is
Open/Assign To `<def>`/—/Rename/Delete, a MIDI row's is Rename/Delete, and
neither carries a command that acts on neither the script nor any MIDI file
any more. Verified with the probe harness: intercepting `Menu.buildFromTemplate`
for each `ctx.kind` confirmed the exact item list per kind, with no
"New Script"/"Import MIDI" entries on a script or MIDI row's own menu and
both still present, unchanged, on the panel background menu.

---

#### UX-11 — There are no preferences

Shipped the finding's own credible list, all four: grid overlay on/off,
palette cell size 1×/2× (the `--cell` token GEO-07 built for exactly this),
editor font size, and the recovery-snapshot interval (fixed at 30s until
now, UX-10). Stored in `app.getPath('userData')/settings.json`, owned by
main (`settings:get`/`settings:set`, guard()'s own envelope) and cached in
the renderer as a plain `Settings` object, applied once at boot (before
`ui:ready`, so the very first frame already reflects it, the same reasoning
PERF-07 already established for the document itself) and again, live, on
every change (`applysettings()`). The settings surface itself is a fourth
`#props` view, `settingsview()` (`panel.js`), toggled by a new
`Panel.showsettings` flag checked ahead of the existing three
selection-driven views in `Panel.inspect()` - deliberately not
selection-driven itself, since it has to survive a click on the canvas
underneath it until the user explicitly says "done". The menu item is
`Settings…` (`⌘,`/`Ctrl+,`) in the mac App menu (built by hand for this,
see VIS-10 above) and the Windows/Linux File menu, both dispatching through
the same `cmd`/`ACTS` table as every other command; opening it switches to
the Level Editor tab first, since `#props` is hidden outright while a script
tab is open. A confirm-on-destructive-height-change toggle, floated in an
earlier draft of this finding, was correctly left out - UX-08 already
reports the consequence and warns in place instead. Verified with the probe
harness: each setting's own live effect (`--cell`'s computed value doubling,
`Settings.grid` flipping, the snapshot interval taking a new value)
confirmed immediately on change; `settings.json` correctly persisted and
was correctly re-loaded by a fresh launch seeded with it; a fresh profile
with no `settings.json` got the documented defaults.

---

#### UX-17 — Numeric inspector fields round silently

Shipped, the label-text half of the finding's own two suggested fixes (the
alternative - swapping which of the cell/pixel fields is the editable one -
would have been a larger behavioural change for the same information):
`entityview()`'s `x`/`y` labels now read `x (snaps to 100)`/`y (snaps to
100)`, and `levelview()`'s row-count label reads `rows (1-999)`, naming the
`step="100"`/`min`/`max` clamps those fields already silently enforced.
Verified by reading the rendered `#props` HTML back: both labels contain the
new text, and the fields' own existing `step`/`min`/`max` attributes are
unchanged.

---

#### A11Y-07 — System accessibility preferences are not honoured

Shipped both remaining pieces. `prefers-contrast: more` now also raises the
chrome's own contrast, not just the canvas's (VIS-16, done): a new
`@media (prefers-contrast: more)` block re-defines `--control-border` to
`--fg` (already the AA text threshold, 4.5:1, versus the ordinary 3:1
non-text boundary `--acc` clears) and `--fg-disabled` to `--dim`'s own
value (already verified at 5.12-5.91:1, VIS-01), and widens the focus ring
to 3px. `forced-colors: active` is handled too - deliberately by *not*
fighting Chromium's own automatic override on ordinary chrome, the same
"do not over-correct" reasoning NAT-15 already applies to a light theme,
since forced-colors already re-themes plain elements correctly by default.
The one real, functional risk was identified precisely: forced-colors can
strip an element's own `background-image` along with its colours unless
`forced-color-adjust: none` is set, and the level canvas's CSS box and the
palette's own sprite swatches (`.cell`) both carry content, not decoration,
through exactly that property - `canvas, .cell { forced-color-adjust: none; }`
is the one override this app makes. Verified by reading the new rules back
from `style.css` and confirming both media queries and every token override
inside them; a live capture under real forced-colors emulation was not
attempted, matching the same headless-harness limitation already recorded
for VIS-06's focus ring and BUG-12's DPI change.

---

#### ARCH-09 — Main-process filesystem work is fully synchronous

Covered under **NAT-19**, done — see above: measured first, the compression
step, not the synchronous filesystem calls this finding named, was the real
cost, and moved onto fflate's async `zip()`; the underlying `fs` calls this
finding was actually about stayed synchronous, correctly, since disk I/O
itself measured under 2ms.

---

#### PERF-05 — Full-subtree rebuilds on every refresh

Shipped exactly as recommended: `undo.js`'s `apply()` (used by both `shift()`
- undo/redo - and `Undo.cancel()`) now computes a `diffparts()` of a step's
own `before`/`after` shots - the same field-level comparison `same()`
already needed to decide "did anything change at all", now shared rather
than duplicated - and passes `{cells, info, defs, ents, bgs, scripts, midi}`
to a `App.refresh(changed)` that only rebuilds the views each flag actually
implicates: `scripts` gates the tab strip and Monaco's own sync, `scripts`/
`midi` gates the sidebar, `defs` gates the palette, `info`/`defs`/`ents`/
`bgs` gates the inspector, and `cells`/`bgs`/`ents` gates `Grid.redraw()` -
`cells` is true whenever the grid itself changed, whether by a cell diff or
a resize (`s.grid`). A plain painted-cell undo step - the common case - now
touches only the canvas. `App.refresh()` called with no argument (there is
no other caller besides `undo.js`) still defaults to "assume everything",
the previous unconditional behaviour, so nothing outside this file had to
change. Verified with the probe harness: undoing/redoing a plain paint step
left the tab strip, file lists, palette and inspector untouched while the
canvas updated correctly; undoing/redoing a script-table change (`Undo.act`
around `App.doc.scripts`) correctly rebuilt the sidebar and re-synced Monaco.

---

#### PERF-06 — `Grid.commit()` allocates one string per tile

Covered under **NAT-19**, done — see above: measured first, per this
finding's own condition ("leave unless NAT-19's measurement shows saves are
slow"). The measurement found a real problem, but not this one -
`Grid.commit()` itself measured 17ms for a 999-row level, and the actual
bottleneck was `zipSync`'s compression at 82ms, addressed there. The
precomputed-lookup-table optimisation this finding proposed remains
un-implemented, correctly: the condition that would have justified it did
not hold once the real cost was isolated.

---

#### NAT-07 — Studio cannot be launched by opening a level, and has never been packaged

Shipped: electron-builder packaging (`package.json`'s new `build` block) -
`appId: "com.pellizzolabrothers.studio"`, `productName` (already set, NAT-01),
a `.lvl` file association, and a mechanically-generated icon set
(`build/icon.icns`/`.ico`/`.png`/`icons/`) derived via nearest-neighbour
resampling from `textures/characters/leandro.png` - confirmed, via
`textures/ui/main_menu.png`'s own labelled callout, to be the game's
canonical "pellizzola brother" sprite. This is a mechanical downscale, not
hand-tuned pixel art (the finding's own stated ideal); disclosed here rather
than silently falling short of it. `asar: false`, chosen outright over
`asarUnpack` to sidestep the documented `app://`-inside-asar risk entirely.
The finding's own recommendation to exclude `textures/` from `files` was
wrong and was not followed - at 1MB it is required at runtime by every
sprite the `app://` protocol serves; the real, valuable exclusion is
`node_modules/monaco-editor/dev/**` and `/esm/**` (80MB of alternate builds
`code.js` never loads, since it only ever requires `min/vs`). `main.js` now
handles `app.on('open-file')` (macOS) and an argv path (Windows/Linux,
`argvpath()`), queued through a `pendingopen`/`winready` pair - reusing
PERF-07's own show-gating pattern - until the renderer's IPC listeners are
provably attached, and reaches the existing NAT-08 `second-instance` handler
the same way. Verified: `npx electron-builder --mac --dir` produces a
working, unsigned `.app` (Info.plist carries the correct bundle id and
`CFBundleDocumentTypes` mapping `.lvl` to `icon.icns`; the bundled
`node_modules/monaco-editor` is 16MB, not ~96MB); the packaged binary
launched and exited cleanly with no crash log. A legacy `.json` level path
passed on the command line at cold start opened correctly through
`migrate()`, confirming the argv/`pendingopen` path end to end via the probe
harness. Not shipped, and not shippable in this environment: code signing
and notarisation (macOS) and Authenticode (Windows) both require paid
developer accounts this session has no access to.

---

#### NAT-15 — No theme awareness; the app is unconditionally dark

Shipped: the app stays deliberately single-theme, as the finding itself
recommends - no light theme was built. `prefers-contrast: more` and
`forced-colors: active` were done in earlier rounds (see A11Y-07, VIS-01,
VIS-02 above). This round's remaining piece: `nativeTheme.on('updated')`
(`main.js`, Windows only) re-pushes the same fixed `titleBarOverlay` colours
via `chrome.windowoptions()` whenever the OS accent or light/dark mode
changes, so Windows cannot repaint stale caption-button colours over them.
Windows-gated (`chrome.win32`) and there is no Windows hardware in this
session to fire a live theme-change event against, so this one is verified
by code inspection and by confirming the listener installs without error
during the full regression pass, not by a live theme flip.

---

#### NAT-17 — No Dock menu or taskbar integration

Shipped exactly as recommended: `setdockmenu()` (`main.js`, macOS only)
builds "New Level" + "Open Recent ▸" from the same `loadrecent()` list
NAT-06's own File-menu submenu already reads, called after every
`addrecent()`/`clearrecent()` so the two can never disagree; `app.setUserTasks()`
installs a "New Level" Windows JumpList task (structural only - no Windows
hardware in this session to observe it in a real taskbar); `withprogress()`
wraps both `lvl:save`'s and `lvl:saveas`'s writes in
`win.setProgressBar(2)`/`(-1)`, indeterminate while writing and cleared once
done. Verified with a dedicated probe variant that intercepts
`Menu.buildFromTemplate` and `BrowserWindow#setProgressBar`: after a save,
the Dock menu's Open Recent submenu correctly listed the just-saved file, and
`setProgressBar` was called `[2, -1]`, bracketing the write.

---

#### UX-07 — The palette has no search or filter

Shipped exactly as recommended: a `#palette-filter` search input
(`index.html`, static markup so typing survives `Panel.palette()`'s own
rebuilds - the same focus-loss trap ARCH-04, done, already had to fix for the
inspector) matches against each cell's own display name, the same string its
tooltip already shows. `group()` (`panel.js`) filters each group's entries
and skips rendering the whole group - heading included - when nothing in it
matches, so a query narrows the palette instead of only greying parts of it
out. Collapsible groups, the finding's second half, were not built - the
finding itself calls that "only worth doing once custom definitions make the
list long", still true at 31 cells. Verified with the probe harness:
filtering "brick" left the matching cell plus the ever-present "new custom
entity" button and exactly one group heading; a non-matching query left only
that button and zero headings; clearing the filter restored all 31 cells.

---

#### UX-18 — MIDI files are opaque

Shipped: `midiinfo()`/`midisummary()` (`app.js`) parse the MIDI `MThd` header
chunk (format, track count, division) and combine it with file size into
each MIDI row's tooltip. "Export…" was added to the row's context menu for
MIDI rows only (`main.js`'s `menu:row` handler), backed by a new
`midi:export` IPC handler (`showSaveDialog` + `fs.writeFileSync`) and a
preload `exportmidi()` bridge, so an imported file is no longer a one-way
trip. Playback stayed out of scope, as recommended. Verified with the probe
harness: importing a synthetic 2-track MIDI file produced the tooltip
`midi/test.mid · 0.0 KB · format 1 · 2 tracks · 480 ticks/quarter`; exporting
it back out through a stubbed save dialog produced a byte-identical file.

---

#### ARCH-05 — Renderer modules share one global scope with a documented collision hazard

Shipped exactly as recommended: a new `util.js`, loaded first in
`index.html`, now owns `$()` and `esc()`, removed from `panel.js`;
`tools/check.js`'s collision grep gained `util.js`, and `CLAUDE.md`'s own
copy of that command and its file-listing table were updated to match. As
the finding itself concluded, the renderer stayed classic scripts rather than
converting to ES modules - that would change `catalog.js`'s dual-load
contract (classic script in the renderer, `require()`d by main) for no
user-facing gain. Verified: `npm run lint` (needed a `/* exported $, esc */`
comment, the same convention ARCH-07 already established, since ESLint
lints each file in isolation and cannot see the cross-file usage this
codebase's shared global scope depends on) and `npm run check` (0 collisions
among 121 top-level names across 8 files) both pass; the probe harness
confirmed `$` and `esc` still resolve correctly everywhere they were used
before the move.

---

#### PERF-03 — `entat()` is a linear scan called once per painted cell

Confirmed correct as documented; no code change. `entat()`'s linear scan
remains the right call at this codebase's scale (tens of entities per
level), matching both the audit's own conclusion and `grid.js`'s existing
comment justifying it. Left alone deliberately rather than pre-emptively
replaced with a `Map` index, since introducing one now would add a second
data structure that can fall out of sync, for a cost that has not been
measured to matter - the condition the audit itself names for revisiting
("entity counts reach the hundreds") does not currently hold.

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
for all five. Most recently of all: a rebuild of the inspector no longer
destroys the field the user was still in, whether that is the drag hot path
(already fixed, PERF-01) or an `onchange` handler rebuilding the very field
it fired from (ARCH-04); every `invoke()` channel now answers one envelope
shape, so a cancelled dialog can no longer be mistaken for a success
(ARCH-06); the app reopens the last session's document instead of an
untitled blank one every launch, with a sticky first-run hint on a genuinely
new one (UX-09), and `win.show()` waits for that document to actually be
loaded instead of racing it (PERF-07); `⌃Tab`/`⌃⇧Tab` now cycle tabs
(NAT-14); dropping a `.lvl`/`.lua`/`.mid` onto the window opens or imports it
instead of merely not losing the document to it (NAT-09); the design's
accent divergence is recorded, with a reason, in `CLAUDE.md` (VIS-03);
deleting an in-use script offers "Delete Anyway" instead of only refusing,
and a new custom entity definition always gets its own fresh script with an
announcement instead of silently binding to an arbitrary existing one
(UX-13, UX-14); and a manual View → Text Size command scales the chrome's
type and the row heights built to hold it together (A11Y-06) — see "Already
completed" above for all ten. Most recently of all: every in-window label,
tooltip and aria-label is lowercase now, and every OS-facing surface states
its own Title Case and converts to GNOME's Sentence case at one place,
`chrome.js`'s new `oscase()` (VIS-10); a settings surface finally exists -
grid overlay, palette cell size, editor font size and the recovery-snapshot
interval, all four wired to a real, live effect and persisted to
`settings.json` (UX-11); a losing second app instance now quits before ever
opening a window instead of launching a whole duplicate one (NAT-08); a
still-decoding texture draws nothing instead of a flat colour flash, and a
genuinely unknown block id draws a hatch and names itself in a save's
warnings (VIS-17); the playtest button's own explanation reaches a screen
reader and a second, always-visible route (the View menu) instead of only a
hover tooltip (VIS-13); a row's own context menu carries only the actions
that act on that row, not two global commands every row's menu used to
repeat (UX-02); the x/y and row-count fields say why they round or clamp
instead of doing it silently (UX-17); `prefers-contrast: more` and
`forced-colors: active` are both honoured on the chrome now, not just the
canvas (A11Y-07); undoing or redoing a step rebuilds only the views that
step actually touched, instead of the whole UI on every step regardless
(PERF-05); and a 999-row save's own measured bottleneck - not disk I/O,
`Grid.commit()`, or `JSON.stringify`, all measured cheap, but `zipSync`'s
compression - moved onto fflate's async `zip()`, keeping the main process
responsive during a save for the first time (NAT-19/ARCH-09/PERF-06) — see
"Already completed" above for all twelve. Most recently of all: the app is
packaged for the first time - a real `.icns`/`.ico`/icon set, a `.lvl` file
association, and an `open-file`/argv path that opens a level at launch or in
a running instance, verified end to end with the probe harness and against
a real, built `.app` bundle (NAT-07); a Windows accent-colour change now
re-pushes the same fixed `titleBarOverlay` colours instead of letting the OS
paint stale ones over them (NAT-15); a macOS Dock menu and a Windows
JumpList task exist, and both save and open now show Dock/taskbar progress
(NAT-17); the palette can be narrowed by name instead of scrolled through in
full (UX-07); a MIDI row's own size, format, track count and division are
visible in its tooltip, and an imported file can be exported back out
(UX-18); and `$()`/`esc()` moved into a `util.js` every other renderer
script's dependency on them is now explicit about (ARCH-05) — see "Already
completed" above for all six. `entat()`'s linear scan was re-examined and
confirmed correct as-is, left deliberately alone (PERF-03, see "Already
completed"). The shell has no remaining problems.

### No remaining source of perceived unpolish

Formerly three, then two: the vertical-scrollbar asymmetry this list's own
second item used to name closed first - `#vbar` mirrors `#hbar` exactly,
hidden until the level's own height exceeds the viewport (GEO-10, done — see
"Already completed") - then capitalisation, this list's own second item for
a full round, closed too: `style.css`'s in-window labels, tooltips and
aria-labels are lowercase throughout now, and every OS-facing surface -
the menu bar, native context menus, dialog titles and buttons - states its
own Title Case in the authored string and converts to GNOME's Sentence case
at the one place each reaches the OS (`chrome.js`'s `oscase()`) (VIS-10, done
— see "Already completed"). The accent divergence this list once also named
under the same item is done too - `CLAUDE.md` records why `--acc`/
`--acc-text` depart from the design's `#7E58BE`, and that the design's
second, lighter fill accent `#815AC1` has no implementation equivalent yet
(VIS-03, done — see "Already completed"). The Monaco-theme slot this list
used to describe there is closed too: every one of `code.js`'s colour keys
reads from the shared token object (VIS-18, done — see "Already completed").
Geometry's own remaining loose ends are closed too: the spacing/row/type
scale, proportional and clamped side panels, integer palette cells,
user-resizable splitters, and both in-panel splits' own content-driven
defaults are all real (GEO-01, GEO-03, GEO-04, GEO-05, GEO-06, GEO-07,
GEO-08, all done — see "Already completed"). Packaging, once the largest
remaining native gap, is closed too: window controls, context menus, the
hotbar, the window title/proxy-icon/edited-dot, window-state persistence,
recent documents and a single-instance lock are all native or OS-driven
(NAT-02, NAT-04, NAT-05, NAT-03, NAT-10, NAT-06, NAT-08, see "Already
completed"); dropping a `.lvl`/`.lua`/`.mid` onto the window opens or imports
it instead of merely not losing the document to it (NAT-09, done); and an
`open-file` handler, a file association, an icon, an electron-builder
packaging config and the `nativeTheme` re-push are all done too (NAT-07,
NAT-15, NAT-17, all done — see "Already completed"). None remain.

### The highest-impact improvements

All four of the original items — `titleBarStyle`/`titleBarOverlay` in place
of the fake dots (NAT-02), native `Menu.popup()` context menus (NAT-05), the
spacing/row/type token scale plus proportional, user-resizable panels
(GEO-01/VIS-04, GEO-03/GEO-04), and bundling JetBrains Mono as a woff2
(VIS-05) — are now done, see "Already completed" above. Nothing remains in
this list; §13's roadmap is the next place to look, where nothing remains in
any tier.

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
size. Every rebuild used to destroy focus, scroll position and caret; the
entity-drag case, the file manager's inline-rename case, and every remaining
`onchange` handler that rebuilt the very field it was fired from
(`p_rows`/`p_def`/`p_script`/`p_id`) are all done now — see "Already
completed", PERF-01, UX-15, ARCH-04.

### Existing design system

Done — see "Already completed", GEO-01/VIS-04. `style.css` `:root` is now a
real token system: colour (unchanged from VIS-01/VIS-02's already-shipped
retune, plus the surfaces VIS-04 added), spacing, row heights derived from the
line box, radius, elevation, motion and z-index each have exactly one
definition. `tokens.js` reads the colour custom properties once into a plain
object; `grid.js`'s canvas draw calls and `code.js`'s Monaco `THEME` both
consume it instead of restating their own copies of the same values (the
Monaco keys that were not a restatement of an existing token - `code.js`'s own
`#150f24`/`#2e2049`/`#1e1633` - were unaffected at the time; giving them a
considered relationship to the surrounding chrome was VIS-18's own remaining
scope, done in a later round - see "Already completed"). `main.js`'s
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
(NAT-02) already keys off it. The label capitalisation this note used to
flag as not yet ported is done now too, straight off this same module:
`chrome.js` gained `oscase()`, converting a Title-Case-authored OS-facing
label to GNOME's own Sentence case (VIS-10, done - see "Already completed"),
extending the abstraction this finding built rather than bypassing it.
`CmdOrCtrl` already carried the ⌘/Ctrl handling before this note was
written - Electron's own accelerator string resolves it without a platform
branch on either side. NAT-20's scrollbar
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
top of data loss is worthless. Every finding ever listed in this category,
including its last remaining member BUG-13 (path containment), is now done —
see "Already completed" above. Nothing remains in this section.

---

### 4.2 Native platform (NAT)

Every finding ever listed in this category, including its last remaining
members NAT-07 (packaging and open-with), NAT-15 (theme awareness) and
NAT-17 (Dock menu and taskbar integration), is now done — see "Already
completed" above. Nothing remains in this section.

---

### 4.3 Layout and geometry (GEO)

The brief asks that arbitrary geometry be eliminated. This section identifies
every instance and states what should determine the value instead. The design
tokens that come out of it are collected in §6. Every finding ever listed in
this category, including its last remaining member GEO-10 (vertical
scrollbar), is now done — see "Already completed" above. Nothing remains in
this section.

---

### 4.4 Visual consistency (VIS)

---

### 4.5 UX and quality of life (UX)

Every finding ever listed in this category, including its last remaining
members UX-07 (palette search) and UX-18 (MIDI metadata and export), is now
done — see "Already completed" above. Nothing remains in this section.

---

### 4.6 Accessibility (A11Y)

The brief asks that accessibility be treated as part of "professional and
polished", not as a separate workstream. Three accessibility findings —
VIS-01 (contrast), VIS-02 (control borders), VIS-06 (focus indicators) — are
already shipped (see "Already completed") and are not repeated here.

---

### 4.7 Architecture and code quality (ARCH)

The codebase is small, consistently formatted, and unusually well commented —
the module comments in `grid.js`, `undo.js`, `lvl.js` and `catalog.js` explain
decisions rather than restating code, which is exactly right and should be
preserved. Every finding ever listed in this category, including its last
remaining member ARCH-05 (the shared-global-scope hazard), is now done — see
"Already completed" above. Nothing remains in this section.

---

### 4.8 Performance (PERF)

The renderer's hot path is already well-engineered: viewport culling
(`grid.js:233-236`), `requestAnimationFrame` coalescing (`grid.js:205-211`),
whole-device-pixel snapping (`grid.js:238-244`), and a texture cache
(`catalog.js:85-98`). Every finding ever listed in this category, including
its last remaining member PERF-03 (`entat()`'s linear scan, confirmed correct
as-is), is now done — see "Already completed" above. Nothing remains in this
section.

---

## 5. Native platform improvements

This section is the platform-by-platform view of §4.2. Nothing new is
introduced; the findings are re-cut by the audience that has to live with them.

### 5.1 macOS

Studio currently reads as a web app on macOS. The gap is almost entirely in the
window and menu layers.

| Area | Do this | Finding |
|---|---|---|
| App identity | `.icns`; bundle id `com.pellizzolabrothers.studio` (`productName`, `app.setName()` and `setAboutPanelOptions` are already shipped, NAT-01) — done, see "Already completed" | NAT-07, NAT-17 |
| Window chrome | `titleBarStyle: 'hiddenInset'` + `trafficLightPosition`; the fake dots are deleted; the green button is real full screen, not `maximize()` — done, see "Already completed" | NAT-02 |
| Title | Document name only; `setRepresentedFilename` for the proxy icon; `setDocumentEdited` for the close-button dot. Not a path, not an asterisk — done, see "Already completed" | NAT-03 |
| Toolbar | The New/Open/Save hotbar is gone — the menu bar carries File regardless of window framing — done, see "Already completed" | NAT-04 |
| Context menus | `Menu.popup()`, including the canvas's own; Ctrl+click no longer erases — done, see "Already completed" | NAT-05 |
| Open Recent | `addRecentDocument` feeds both the File menu's own submenu and the Dock icon's system "Recent" behaviour — done, see "Already completed". A custom Dock menu (`app.dock.setMenu`, "New Level"/"Open Recent ▸") is done too. | NAT-17 |
| File association | `CFBundleDocumentTypes` for `.lvl` via electron-builder; `app.on('open-file')`, including before `whenReady` — done, see "Already completed" | NAT-07 |
| Trackpad | Two-finger scroll pans; pinch (`wheel` + `ctrlKey`) zooms — done, see "Already completed". This was the single biggest day-to-day usability defect on a Mac. | NAT-11 |
| Shortcuts | `CmdOrCtrl` accelerators from the menu; drop the hand-rolled `Ctrl+Y` — done, see "Already completed"; `⌃Tab`/`⌃⇧Tab` tab switching is done too (NAT-14). Settings is **⌘,**, in the App menu, and is called "Settings" — done, see "Already completed". | — |
| Scrollbars | Respect the overlay/classic setting; `scrollbar-gutter: stable` so layout does not depend on it — done, see "Already completed" | NAT-20 |
| Dialogs | "Don't Save", not "Discard"; sheet-parented; `detail` added — done, see "Already completed" | NAT-21 |
| Distribution | `hardenedRuntime` is done (see "Already completed", NAT-07); code signing and notarisation remain out of reach without a paid Apple developer account — an unsigned build is blocked by Gatekeeper. | NAT-07 |
| Accessibility | Native menus (NAT-05), real controls in the palette/file lists/tabs (A11Y-01), the status bar's live region (A11Y-05), headings/landmarks for the title bar, section headers and inspector (A11Y-02), and the canvas's own keyboard editing and naming (A11Y-03) are all done — see "Already completed". Manual View → Text Size commands, scaling the chrome's type and row heights together, are done too (A11Y-06); `prefers-contrast: more` and `forced-colors: active` on the chrome itself are done too (A11Y-07) — everything this row ever asked for is shipped. | — |

### 5.2 Windows

| Area | Do this | Finding |
|---|---|---|
| Window chrome | `titleBarStyle: 'hidden'` + `titleBarOverlay: {color, symbolColor, height}` so Windows draws its own caption buttons, correctly placed top-right and themed — done, see "Already completed" (implemented against Electron's documented behaviour; not yet run on real Windows hardware). Re-pushing the colours on an OS theme change is done too (`nativeTheme.on('updated')`), structurally verified only, same caveat. | NAT-02, NAT-15 |
| Toolbar | The hotbar stays, since `titleBarStyle: 'hidden'` shows no visible menu bar - now a real `role="toolbar"` with accelerator tooltips and roving tabindex — done, see "Already completed" (implemented against Electron's documented behaviour; not yet run on real Windows hardware). A hamburger that calls `Menu.popup()` was not added. | NAT-04 |
| Title | `Document — Pellizzola Brothers Studio`, with dirty state reflected in the OS title, not only in the DOM — done, see "Already completed" (implemented against Electron's documented `titleBarOverlay`/`setTitle` behaviour; not yet run on real Windows hardware) | NAT-03 |
| File association | Registry entries + `.ico` via electron-builder; the path in `process.argv` **and** in `second-instance` (the handler itself already existed and already restored/focused the running window - NAT-08, done, see "Already completed" - it now parses that `argv` too) — done, see "Already completed" | NAT-07 |
| Single instance | Required — without it every double-clicked `.lvl` launches a whole new app — done, see "Already completed": verified with the probe harness, a second process against the same `--user-data-dir` exited in under 0.2s without ever reaching `whenReady()`, while the first instance's own window and steps ran unaffected. | — |
| JumpList | `setUserTasks` ("New Level") plus automatic recent documents now that the association exists - `app.addRecentDocument()` itself already runs on every open/save-as (NAT-06, done) - done, see "Already completed" (structural verification only; not yet run on real Windows hardware). | NAT-07, NAT-17 |
| Dialogs | Button order Save / Don't Save / Cancel; `noLink: true` so they are push buttons, not command links; `title` set — done, see "Already completed" | NAT-21 |
| Scrollbars | Classic scrollbars consume layout width — this is where NAT-20's `scrollbar-gutter: stable` fix (done, see "Already completed") matters most, though not yet exercised on real Windows hardware. | NAT-20 |
| High contrast | `forced-colors: active` is a real, commonly-enabled Windows mode — done, see "Already completed": the level canvas and the palette's own sprite swatches keep their own colours and background-images under it (`forced-color-adjust: none`, the two places losing them would be a functional break, not a cosmetic one), everything else adopts the system palette automatically, the correct default this app does not fight. The canvas's own indicators also stay visible regardless (VIS-16, done). Not yet run on real Windows hardware. | — |
| Mixed DPI | Per-monitor scaling is common; the canvas goes soft when the window moves between displays — done, see "Already completed" (implemented against the documented `matchMedia`/`devicePixelRatio` mechanism; not yet run on real per-monitor-DPI Windows hardware) | BUG-12 |
| Distribution | NSIS/zip targets are configured (electron-builder, done, see "Already completed"); Authenticode signing remains out of reach without a paid code-signing certificate. | NAT-07 |

### 5.3 Linux

Linux is where a custom implementation is legitimate — but as a *fallback*,
chosen deliberately, not as the default the other two inherit.

| Area | Do this | Finding |
|---|---|---|
| Window chrome | Landed as `frame: true`, not `titleBarOverlay` — done, see "Already completed": Electron's Linux `titleBarOverlay` support is inconsistent across desktops and was untestable on the machine this shipped from, so guessing at it was judged worse than the documented fallback, which the audit itself names as correct here. Letting the WM decorate also means the fake macOS dots never applied on Linux at all, on this platform or any other. | NAT-02 |
| Button layout | Resolved as a side effect of the `frame: true` choice above: `org.gnome.desktop.wm.preferences.button-layout` is now entirely the WM's own to honour, since Studio no longer draws window controls itself on any platform. | NAT-02 |
| Toolbar | Same as Windows — a real toolbar, not four bare buttons — done, see "Already completed" (not run on real Linux hardware); GNOME may also surface parts of the menu itself in the shell. | NAT-04 |
| Context menus | Native menus inherit the GTK theme — the fastest single change to stop looking foreign — done, see "Already completed" (not run on real Linux hardware). | NAT-05 |
| Dialogs | GNOME convention: destructive action leftmost, "Discard" is the right word here (unlike macOS/Windows) — done, see "Already completed", NAT-21. Sentence case elsewhere is done too now: `chrome.js`'s `oscase()` converts every Title-Case-authored menu/dialog label at the one place each reaches the OS. | VIS-10 |
| File association | `.desktop` file + MIME XML (`application/x-pellizzola-level`) + hicolor icons via electron-builder; `process.argv` handled — done, see "Already completed" (not yet run on real Linux hardware) | NAT-07 |
| Recent files | `addRecentDocument` writes `recently-used.xbel`, honoured by GTK file choosers — done, see "Already completed" (not yet run on real GTK hardware). | — |
| Single instance | Required — done, see "Already completed" (not yet run on real Linux hardware). | — |
| Fonts | The `DejaVu Sans Mono` fallback was the *only* one likely to be present, and differed in metrics from JetBrains Mono — bundling the font (done, see "Already completed") matters most here, since Linux had no other realistic path to it. | VIS-05 |
| Wayland | Fractional scaling changes `devicePixelRatio` without a CSS resize — done, see "Already completed" (not yet run on real Wayland hardware) | BUG-12 |
| DE variance | State explicitly in `CLAUDE.md` which desktops were tested. "Linux" is not one target. | — |

### 5.4 Cross-platform Electron improvements

| Improvement | Finding |
|---|---|
| `will-navigate`, `setWindowOpenHandler`, `sandbox: true` — done, see "Already completed" (NAT-18); dropping a `.lvl`/`.lua`/`.mid` now opens or imports it too — done, see "Already completed" (NAT-09) | — |
| Window state persistence with display validation — done, see "Already completed" | NAT-10 |
| Display-derived default window size — done, see "Already completed" (folds in GEO-12) | NAT-10 |
| DPI-change handling for the canvas — done, see "Already completed" (BUG-12) | — |
| Recovery snapshots and `.bak` in `userData` — done, see "Already completed" | UX-10 |
| One `chrome.js` for every platform branch; `api.platform` to the renderer — done, see "Already completed" | ARCH-03 |
| electron-builder config, icons, associations — done, see "Already completed"; signing remains out of reach without paid certificates | NAT-07 |
| Lazy Monaco - done, see "Already completed"; narrowed packaged files done too, in a later round (NAT-07) | ARCH-08 |

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

Rows 11-14 are done too - see "Already completed", GEO-08: `.tab`'s
`max-width` is `24ch` with a `min-width: 6ch` floor; `#props textarea`'s
height is `calc(var(--line-box) * 3)`; `.acts`'/`#title`'s two gaps are both
`var(--space-5)`; `.grp`/`#props h4`/`#props .hint`'s `10px` font-size is
`var(--font-size-sm)` (`.run`'s own `13px` was already dead by the time this
row was reached, VIS-11 having made it icon-only).

| # | Value | Where | What should determine it | Finding |
|---|---|---|---|---|
| 15 | `li` indent has no icon to hang from | `style.css:123` | `--space-4 + --icon` once rows get a file-type icon (the padding/height itself is `--row` now — GEO-01/GEO-02, done; the row's own hit area is done too, A11Y-04; the `--icon` token itself now exists too, VIS-11, done — but giving file-manager rows their own icon was explicitly out of VIS-11's shipped scope, so this row is still open) | — |

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
| **Typography** | Fixed — the app renders in its own bundled font now, identically on all three platforms, and the two `<b>`-plus-`font-weight: normal` layout hacks are `<span>`s instead (VIS-05, done — see "Already completed"); font sizes down to one scale, `10px`/`13px` gone too (GEO-01, GEO-08, done — see "Already completed") | — |
| **Spacing** | Fixed — a 7-step scale now covers the whole stylesheet, `.acts`'/`#title`'s two gaps included (GEO-01, GEO-08, done — see "Already completed") | — |
| **Rows / heights** | Fixed — `--row-sm`/`--row`/`--row-lg`, derived from the 18px line box, now cover the title bar, tab strip, section headers, status bar and file-manager rows (GEO-01, GEO-02, done — see "Already completed"); every hit area below the 24 px platform minimum is padded up to it too (A11Y-04, done — see "Already completed") | A file-type icon per row is the remaining, unrelated piece (row 15, §6.1) |
| **Colour** | Fixed — one `:root` definition, consumed by `grid.js`'s canvas and `code.js`'s Monaco theme through `tokens.js` instead of each restating it (VIS-04, done — see "Already completed") | — |
| **Contrast** | Fixed — resting and accent text, control borders, and disabled text (VIS-01, VIS-02, VIS-07, all done — see "Already completed"); `.mi.off` is moot, its `<div>` menu deleted by NAT-05 | — |
| **Borders** | `--line` is now split from `--control-border` (VIS-02, done); still one width only, no distinct strong/emphasis weight | Add `--border-strong` |
| **Radius** | Fixed — `--radius-1` (inputs, palette cells, inline controls) and `--radius-2` (standalone action buttons, and the active tab's own corner flare) both have real consumers now; `--radius-3` stays unconsumed, deliberately, until a dialog or popover exists (VIS-09, GEO-13, done — see "Already completed") | — |
| **Shadows** | Fixed — both side panels carry `--elev-1`, per the design's own drop-shadow filters; `--elev-2` stays unconsumed, deliberately, for the same reason as `--radius-3` (VIS-09, GEO-13, done — see "Already completed") | — |
| **Scrollbars** | Fixed — all five containers now share one tokenised treatment with `scrollbar-gutter: stable` (NAT-20/GEO-09, done — see "Already completed"); Monaco's own scrollbar keys now agree too (VIS-18, done — see "Already completed") | — |
| **Hover** | Fixed — every button, row and tab gets a `--surface-hover` tint, text unchanged (VIS-07, done — see "Already completed") | — |
| **Active / pressed** | Fixed — a deeper `--surface-active` tint on `:active` (VIS-07, done — see "Already completed") | — |
| **Focus** | Fixed — a global `:focus-visible` ring, 2 px + 2 px offset, now applies everywhere including the canvas (VIS-06, done — see "Already completed") | — |
| **Disabled** | Fixed — `--fg-disabled` at ≥3:1 replaces `opacity: .35` everywhere, including `#props`'s read-only fields (VIS-07, done — see "Already completed"); `aria-disabled` now sits alongside the native `disabled` attribute on all three disabled controls too (A11Y-08, done — see "Already completed"); the playtest button's own reason now reaches a screen reader too (`aria-describedby`, VIS-13, done — see "Already completed") | — |
| **Selected** | Fixed — one treatment across `li.on`/`.tab.on`/`.cell.on`: accent text (or border, for the palette's icon swatches) + surface fill + a leading-edge marker (VIS-07, done — see "Already completed") | — |
| **Icons** | Fixed, for the five sites that were broken — an inline-SVG set, `currentColor`, one `--icon` token replaces the three `+`s, the `×` and the `▶` (VIS-11, done — see "Already completed"); file-manager rows and block/entity/warning/error remain text/colour-only, deliberately, for lack of a demonstrated consumer | — |
| **Text alignment** | `.hdr` left in the file manager, right in the inspector — deliberate mirroring per the design; keep | — |
| **Capitalisation** | Fixed — lowercase throughout every in-window label, tooltip and aria-label; every OS-facing surface states Title Case and converts to GNOME's Sentence case at the one place each reaches the OS (`chrome.js`'s `oscase()`); proper nouns (`MIDI`, `Lua`) survive the conversion since it only lowercases non-acronym words (VIS-10, done — see "Already completed") | — |
| **Cursor** | Fixed — seven states on the canvas (`crosshair`/`copy`/`grab`/`grabbing`/`not-allowed`) driven by `Grid.cursor()` (NAT-13, done — see "Already completed"), and `col-resize`/`row-resize` on the four splitters (GEO-04, done — see "Already completed") | — |
| **Tooltips** | Fixed — every in-window tooltip is lowercase now, matching every other in-window label (VIS-10, done — see "Already completed"); still absent on tabs and rows | Add the missing ones |
| **Loading** | Fixed for the editor — Monaco now shows a plain "loading editor…" text while it lazy-loads (ARCH-08, done — see "Already completed"); a long save no longer blocks the main process at all - the measured bottleneck, `zipSync`'s own compression, moved onto fflate's async `zip()` (NAT-19, done — see "Already completed") - though it still gives no visible progress indicator while it runs | Progress indicator for long ops |
| **Empty states** | Fixed — one line of secondary text plus one affordance per list, replacing the two blank voids every fresh launch used to show (VIS-12, done — see "Already completed") | — |
| **Error states** | Fixed — an aria-hidden `⚠` glyph now sits alongside `var(--danger)` on both `#msg.bad` and `App.fail()`'s `.err` block, so neither relies on colour alone; save failures reach a native dialog regardless of tab (BUG-07, shipped), and every error is announced to a screen reader (A11Y-05, shipped) (VIS-14, A11Y-08, done — see "Already completed") | — |
| **Context menus** | Fixed — native `Menu.popup()`, real keyboard navigation and platform appearance (NAT-05, done — see "Already completed") | — |
| **Dialogs** | The unsaved-changes prompt now has a per-platform template, `detail`, `noLink`, and string verdicts (NAT-21, BUG-10, done — see "Already completed") | — |
| **Forms** | Fixed — borders now visible via `--control-border` (VIS-02, done); the inline rename input is the same `.field` component `#props input` uses now, not a second, different text field, and now validates as the user types (VIS-15/UX-15, done — see "Already completed"); the level view's `<select>` is restyled with `appearance: none` to match, its dropdown itself still native (NAT-16, done — see "Already completed") | — |
| **Buttons** | One shared hover/active/disabled treatment now (VIS-07, done — see "Already completed"); one-off dimensions are onto the scale too (GEO-08, done — see "Already completed"); still no border except `.act`, and `.acts`/`.hdr button`/`#add` remain differently sized | One button component with size variants |
| **Resizers / splitters** | Fixed — four keyboard-operable splitters (GEO-04, done — see "Already completed") | — |
| **Panels** | Widths are proportional, clamped and user-resizable now, the file manager's own split is content-driven by default, and both carry the design's own drop-shadow now too (GEO-03/GEO-04/GEO-05, VIS-09/GEO-13, done — see "Already completed"); still not collapsible | Collapsible sections |
| **Overlays** | NAT-05 (done) removed the app's only `z-index` along with the DOM context menu it belonged to; `--z-*` is defined (GEO-01, done) with nothing to convert yet | — |
| **Animation** | Fixed — hover/active/selected tints, the focus ring and the inline rename field all transition now, with the mandatory `prefers-reduced-motion` companion in the same commit (VIS-08, done — see "Already completed") | — |
| **Canvas indicators** | Fixed — the selection ring, level bounds, hover cell and keyboard cursor are all two-tone or difference-composited now, guaranteeing visibility over any content, and `prefers-contrast: more` thickens the selection stroke (VIS-16, done — see "Already completed") | — |
| **Missing assets** | Fixed — a cell whose texture has not decoded yet draws nothing (the backdrop shows through) instead of a flat colour flash; a genuinely unknown id draws a diagonal hatch instead, and a save's warnings name it (`lvl.js`'s `review()`) (VIS-17, done — see "Already completed") | — |
| **Editor (Monaco)** | Fixed — every colour key now reads from the shared token object, and the keys that used to leak VS Code's own blue (scrollbar, suggestion list, bracket-match, selection-match, errors/warnings, focus) are all themed (VIS-18, done — see "Already completed") | — |

---

## 8. UX / QOL summary

Grouped by the workflow they unblock. Detail in §4.5.

**Opening and starting work** — restoring the last session's document, and a
sticky first-run hint on a genuinely blank one, are shipped (UX-09, see
"Already completed"; a start view offering New/Open/Recent in place of the
canvas was scoped out of it, still open); recent documents in the File menu
and (macOS) the Dock icon's own Recent submenu are shipped too (NAT-06, see
"Already completed") - a custom Dock menu and the Windows JumpList are
shipped too (NAT-17, NAT-07, see "Already completed"); dropping a `.lvl`/`.lua`/`.mid` onto the window opens
or imports it now too (NAT-09, see "Already completed") - double-clicking a
`.lvl` in a file manager, or on the Dock icon, now opens it too, via the
`.lvl` file association electron-builder registers (NAT-07, see "Already
completed").

**Editing** — rectangle fill, arrow-key nudge and duplicate are shipped
(UX-05, see "Already completed"); flood fill is UX-05's one deliberately
deferred piece, since it needs a new persistent palette tool rather than a
modifier on a gesture that already exists; trackpad scroll now pans instead of
zooming, and pinch/Ctrl+wheel zooms (NAT-11, shipped, see "Already
completed"); the canvas now shows a cursor for every gesture - crosshair,
copy, grab, grabbing, not-allowed (NAT-13, shipped, see "Already completed");
zoom now has controls, an indicator, and a fit that targets the scene nearest
the camera instead of an unfittable whole level (UX-04, shipped, see "Already
completed"); the palette now has a search field that narrows both cells and
group headings to a name match (UX-07, see "Already completed"); Escape
cancelling and reverting a gesture, and a right click that
never dragged opening the canvas's own context menu instead of erasing, are
shipped too (UX-12, NAT-12, see "Already completed"); the canvas is
keyboard-operable now too - arrow keys move a cursor cell (or nudge a selected
entity, UX-05), Return/Space paints the current tool, Delete erases, and the
tool itself is finally named somewhere - the status bar (A11Y-03, UX-06, see
"Already completed").

**Navigating** — a vertical scrollbar mirroring `#hbar`, hidden until the level
needs it, is shipped (GEO-10, see "Already completed"); resizable panels that
remember their size are shipped too (GEO-04, see "Already completed"); tabs
now scroll instead of vanishing past the strip's own width, with the active
one scrolled into view on every switch, a pinned Level Editor tab and
middle-click-to-close (UX-16, see "Already completed") - `⌃Tab`/`⌃⇧Tab`
keyboard switching is shipped too (NAT-14, see "Already completed"); an
overflow chevron listing hidden tabs and `⌘1…⌘9` numbered jumps (`⌘9` was
already spoken for, View → Fit Scene, UX-04) remain open.

**Files and scripts** — double-click to open a script is shipped (UX-01, see
"Already completed"); row menus now carry only the actions that act on that
row - "New Script"/"Import MIDI" moved out to the panel background menu,
their only other route already, so a script row's own menu no longer offers
two commands that act on neither it nor any MIDI file (UX-02, done, see
"Already completed"); rename
now validates as you type and keeps a rejected edit's text intact instead of
discarding it (UX-15, see "Already completed" - MIDI renaming no longer
mangles the name either, BUG-06, shipped); deleting an in-use script now
offers a native "Delete Anyway" instead of only refusing (UX-13, see "Already
completed"); creating a custom entity definition now says what it did and
never binds to an arbitrary existing script (UX-14, see "Already completed");
MIDI rows now show size, format, track count and division in their tooltip
and can be exported back out through the row menu (UX-18, see "Already
completed").

**Trust and recovery** — atomic saves, an honest dirty flag, save failures that
are impossible to miss, a `.bak` on overwrite, crash-recovery snapshots,
playability warnings before the game rejects the level, and destructive
actions that report what they did are all shipped (BUG-02, BUG-03, BUG-07,
UX-10, BUG-11, UX-08 — see "Already completed").

**Feedback** — status messages that auto-clear, errors that persist with a
non-colour cue, and persistent zoom/dimensions/entity-count/tool fields
separated from the transient message by a divider are all shipped (VIS-14,
UX-06, UX-04 — see "Already completed"); a long save no longer blocks the
app at all, though it still shows no progress indicator while it runs
(NAT-19, done — see "Already completed"); undo and redo are visible in the Edit menu now, and now say what
they would act on ("Undo Paint", "Redo Move Entity") in both the menu and the
status bar ("undid paint") instead of a step count read backwards (NAT-01,
UX-03, both shipped, see "Already completed").

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
| 1.4.12 Text Spacing | Partial — a manual View → Text Size command now scales type and, with it, the row heights built to hold a line of it, together, so the two do not go out of sync at any of the scale's supported steps (A11Y-06, done); Electron gives no hook to detect and follow an OS-level text-size *setting* automatically | — |
| 2.1.1 Keyboard | Fixed — the palette, file rows and tabs are operable (A11Y-01); arrow keys, Return/Space and Delete now drive the canvas itself too, the one surface that used to require a pointer (A11Y-03) | A11Y-01, A11Y-03, done |
| 2.4.3 Focus Order | Fixed — roving tabindex gives the palette, file lists and tab strip one Tab stop each, in a defined title-bar-to-status-bar order | A11Y-01, done |
| 2.4.7 Focus Visible | Fixed — global `:focus-visible` rule, nothing left to suppress it | VIS-06, done |
| 2.5.8 Target Size | Fixed — `li` rows are 30 px (GEO-01, done); window controls are the OS's own (NAT-02, done); the `.tab` close glyph and `.hdr button` are padded to a 24px hit area too (A11Y-04, done) | A11Y-04, done |
| 4.1.2 Name, Role, Value | Fixed — the palette, file lists and tab strip carry `role`/`aria-*` (A11Y-01); the title bar is a `<header>`, section headers are real `<h2>`s their lists point back to with `aria-labelledby`, `#props` is a labelled region (A11Y-02), and the canvas itself carries `role="application"` with a name and description (A11Y-03) | A11Y-01, A11Y-02, A11Y-03, done |
| 4.1.3 Status Messages | Fixed — `#msg` carries `role="status"`, `App.fail()`'s error block carries `role="alert"`, and both now announce the keyboard cursor's own position as it moves (A11Y-03) | A11Y-05, A11Y-03, done |
| 2.3.3 Animation from Interactions | Fixed — `prefers-reduced-motion: reduce` collapses every transition/animation to 1ms, shipped in the same commit as the first one | VIS-08, done |
| System high contrast | Fixed — `forced-colors: active` now adopts the system palette automatically everywhere except the canvas and the palette's own sprite swatches (`forced-color-adjust: none`, since losing their own colours/background-images there would be a functional break); `prefers-contrast: more` is honoured on the canvas (VIS-16, done) and the chrome (`--control-border`/`--fg-disabled`/focus-ring width, A11Y-07, done) | A11Y-07, done |

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
A11Y-05 already gave the status bar. A manual text-scale command is also done
now (A11Y-06, done — see "Already completed"); `forced-colors` and
`prefers-contrast` on the chrome itself are done too (A11Y-07, done — see
"Already completed") - system-preference handling, the one thing left
after A11Y-01/A11Y-05, is now fully covered.

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

**Fix.** Nothing remains open in this table - see "Already completed" below.

Prefix-only path containment in the protocol handler is fixed too - done, see
"Already completed" (BUG-13). Full innerHTML rebuilds on a drag hot path and
every `onchange` handler that used to destroy the field it fired from, three
IPC naming conventions with two response shapes and a forgettable `cancel`
check, and `App.open_`'s trailing underscore are all done too - see "Already
completed" (PERF-01, ARCH-04, ARCH-06). Synchronous main-process I/O is
resolved too, in the sense the measurement it was always conditioned on
justified: a 999-row save's own compression, measured as the actual
bottleneck, moved onto fflate's async `zip()`; disk I/O itself measured
under 2ms and was left synchronous, and a 999-row *read* measured under the
~100ms budget altogether, so `unzipSync` is untouched (ARCH-09/NAT-19, done
— see "Already completed").

**Explicitly do not do.** Do not introduce a framework, a bundler, TypeScript
or ES modules. Do not convert the flat global scope. Do not add a state
container. Do not index the entity list until entity counts justify it
(PERF-03). Do not build a light theme (NAT-15). A custom `<select>` popup was
the wrong idea for the same reason - done differently, restyling only the
closed control and leaving the dropdown itself native (NAT-16, done — see
"Already completed"). Each of these would add more than it removes at this
size.

---

## 11. Performance summary

The renderer is already carefully built. Every real problem this section
originally listed is done now - see "Already completed": PERF-01, PERF-02
and PERF-04 first, then PERF-05 (`Undo.apply()`'s own before/after shots
report which of info/defs/ents/bgs/scripts/midi/cells a step actually
touched, and `App.refresh()` rebuilds only those - a plain cell-diff step,
the common case, now touches only `Grid.redraw()`), PERF-07 (`win.show()`
waits for the renderer's own `ui:ready` signal instead of racing
`api.init()`), and PERF-06/NAT-19 together (measured first: a 999-row
save's own compression - not `Grid.commit()`, not disk I/O, both measured
cheap - was the actual bottleneck, and moved onto fflate's async `zip()`;
`Grid.commit()`'s own lookup-table optimisation was reassessed as
unnecessary once the actual bottleneck turned out to lie elsewhere).

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
| App name / identity in the menu, taskbar and Dock | ✅ shipped (NAT-01, NAT-07) | ✅ shipped (NAT-01, NAT-07) | ✅ shipped (NAT-01, NAT-07) | — |
| Window controls | ✅ shipped (NAT-02) | ✅ shipped, not run on real hardware (NAT-02) | ✅ shipped, not run on real hardware (NAT-02) | — |
| Green button semantics | ✅ shipped - real full screen, not `maximize()` (NAT-02) | n/a | n/a | — |
| Window title | ✅ shipped - document name only (NAT-03) | ✅ shipped, not run on real hardware (NAT-03) | ✅ shipped, not run on real hardware (NAT-03) | — |
| Proxy icon / edited dot | ✅ shipped (NAT-03) | n/a | n/a | — |
| Context menus | ✅ shipped (NAT-05) | ✅ shipped, not run on real hardware (NAT-05) | ✅ shipped, not run on real hardware (NAT-05) | — |
| File dialogs | ✅ | ✅ | ✅ | — |
| Save extension handling | ✅ shipped (BUG-04, BUG-05) | ✅ shipped (BUG-04, BUG-05) | ✅ shipped (BUG-04, BUG-05) | — |
| Unsaved-changes dialog | ✅ shipped (NAT-21, BUG-10) | ✅ shipped (NAT-21, BUG-10) | ✅ shipped (NAT-21, BUG-10) | — |
| Recent documents | ✅ shipped - File menu, and the Dock icon's own Recent submenu for free (NAT-06) | ✅ shipped - `addRecentDocument` runs, and now feeds the JumpList too (NAT-06, NAT-07) | ✅ shipped (NAT-06) | — |
| File association / launch by file | ✅ shipped - `.lvl` opens via Finder, Dock drop, or cold-start argv, verified with the probe harness (NAT-07) | ✅ shipped, not run on real hardware (NAT-07) | ✅ shipped, not run on real hardware (NAT-07) | — |
| Single instance | ✅ shipped - harmless here since Launch Services already routes a second open through `open-file` (NAT-08) | ✅ shipped - verified with the probe harness: a second process quit in under 0.2s without reaching `whenReady()` (NAT-08) | ✅ shipped, not run on real hardware (NAT-08) | — |
| Drag and drop | ✅ shipped - no longer navigates away (NAT-18); a `.lvl`/`.lua`/`.mid` drop opens or imports it (NAT-09) | ✅ same | ✅ same | — |
| Dock / taskbar integration | ✅ shipped - recent documents (NAT-06) plus a custom Dock menu, "New Level"/"Open Recent ▸" (NAT-17), verified with a probe variant intercepting `Menu.buildFromTemplate`; `win.setProgressBar()` around save/open, `[2, -1]` verified bracketing the write | ✅ shipped - JumpList "New Level" task (structural verification only, not run on real hardware) plus `win.setProgressBar()`, verified (NAT-17) | ⚠️ `win.setProgressBar()` runs (only visibly effective on launchers that support it, e.g. Unity); no Linux equivalent of a Dock/JumpList menu exists to build | NAT-17 |
| Window state persistence | ✅ shipped - position, size, maximized and fullscreen survive a restart, with a disconnected-display fallback (NAT-10) | ✅ shipped, not run on real hardware (NAT-10) | ✅ shipped, not run on real hardware (NAT-10) | — |
| Default window size | ✅ shipped - 80% of the display's work area, clamped (NAT-10) | ✅ shipped, not run on real hardware (NAT-10) | ✅ shipped, not run on real hardware (NAT-10) | — |
| Mixed-DPI / scaling | ✅ shipped (BUG-12) | ✅ shipped, not run on real per-monitor-DPI hardware (BUG-12) | ✅ shipped, not run on real Wayland hardware (BUG-12) | — |
| Trackpad scroll vs pinch | ✅ shipped (NAT-11) | ✅ shipped (NAT-11) | ✅ shipped (NAT-11) | — |
| Right-click semantics | ✅ shipped - Ctrl+click no longer erases on a drag, and a right click that never dragged deletes directly, or opens the canvas's own menu when there is nothing under it to delete (NAT-12) | ✅ shipped (NAT-12) | ✅ shipped (NAT-12) | — |
| Keyboard shortcuts | ✅ shipped - layout-aware `CmdOrCtrl` accelerators from the menu (NAT-01); `⌃Tab`/`⌃⇧Tab` tab switching (NAT-14) | ✅ same | ✅ same | — |
| Scrollbars | ✅ shipped - one tokenised treatment, `scrollbar-gutter: stable` (NAT-20) | ✅ shipped, not run on real hardware (NAT-20) | ✅ shipped, not run on real hardware (NAT-20) | — |
| Fonts | ✅ shipped - bundled, identically on all three platforms (VIS-05) | ✅ shipped (VIS-05) | ✅ shipped (VIS-05) | — |
| High contrast / forced colours | ✅ shipped - `prefers-contrast: more`/`forced-colors: active` both honoured on the chrome now (A11Y-07) | ✅ shipped, not run on real hardware (A11Y-07) | ✅ shipped, not run on real hardware (A11Y-07) | — |
| Reduced motion | ✅ shipped - `prefers-reduced-motion: reduce` collapses every transition/animation, landed in the same commit as the first one (VIS-08) | ✅ shipped (VIS-08) | ✅ shipped (VIS-08) | — |
| Screen reader | ✅ shipped - the palette, file lists and tab strip are named and role-bearing (A11Y-01), status/error messages are announced (A11Y-05), the title bar, section headers and inspector carry real semantics (A11Y-02), the canvas itself is named, described and keyboard-operable with its cursor announced (A11Y-03), and system-preference handling (high contrast, forced colours) is honoured too (A11Y-07) — see "Already completed" for all five. | ✅ same for Narrator | ✅ same for Orca | — |
| Notifications | ⚠️ - a long save no longer blocks the app while it runs (NAT-19, done), and now shows a Dock/taskbar progress bar while it does (NAT-17, done), but still shows no completion toast | ⚠️ same | ⚠️ same | — |
| Full screen | ✅ shipped - a new View menu carries `role: 'togglefullscreen'`, closing the regression NAT-01's own menu opened by shipping without a View menu (UX-04) | ✅ shipped (UX-04) | ✅ shipped (UX-04) | — |
| Quit / lifecycle | ✅ ⌘Q works (`role: 'appMenu'`, NAT-01); a hung/dirty renderer no longer wedges close (BUG-09, shipped) | ✅ shipped (BUG-09) | ✅ shipped (BUG-09) | — |
| Packaging / signing | ✅ shipped, unsigned - electron-builder produces a working `.app`, verified by building and launching it; code signing/notarisation need a paid developer account this environment has no access to | ✅ shipped, unsigned - NSIS/zip targets configured, not run on real hardware; Authenticode needs a paid certificate | ✅ shipped, unsigned - AppImage/deb targets configured, not run on real hardware | NAT-07 |

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

Every item ever listed at this tier is now done: NAT-04, NAT-05, NAT-11,
NAT-20, ARCH-02, ARCH-03, ARCH-08, BUG-12, GEO-01, GEO-03, GEO-04, GEO-07,
GEO-11, NAT-03, NAT-10, NAT-13, PERF-01, VIS-04, VIS-05, VIS-07, UX-04 and
NAT-07 (packaging, icons and file association - see "Already completed";
code signing and notarisation across three platforms remain the one piece
this pass had no infrastructure, paid certificates, to complete). Nothing
remains in this tier.

### Medium — real friction, contained fixes

Every item ever listed at this tier is now done: BUG-13, NAT-06, NAT-16,
GEO-10, UX-01, UX-03, UX-05 (its one deliberately deferred piece, flood
fill, aside), UX-15, UX-16, PERF-02, NAT-09, NAT-14 (its own deliberately
deferred piece, region operations and numbered tab jumps, aside), VIS-03,
UX-09 (its own deliberately deferred piece, a start view in place of the
canvas, aside), A11Y-06, ARCH-04, ARCH-06, NAT-08 and VIS-10 — see "Already
completed". Nothing remains in this tier.

### Low

Every item ever listed at this tier is now done: NAT-15 (`nativeTheme`
re-push on a Windows accent change; `prefers-contrast`/`forced-colors` were
already shipped, A11Y-07), NAT-17 (Dock menu, JumpList tasks - About panel
and recent documents were already shipped, NAT-01, NAT-06), UX-18 (MIDI
metadata and export) and ARCH-05 (global scope hygiene, `util.js`) — see
"Already completed". Nothing remains in this tier.

### Nice to have — genuinely optional, none of it required to call Studio polished

- Minimap / overview strip rendered into the `#hbar` track - floated in
  UX-04's own text (done, see "Already completed") as the real answer for
  540-column levels, scoped out here as a separate, larger feature.
- Collapsible palette groups - UX-07's own search half is done, see "Already
  completed"; collapsing groups remains optional, and only worth doing once
  custom definitions make the list long enough to want it.
- Flood fill - a bucket tool the palette has no slot for yet; UX-05's own
  three other prioritised verbs (rectangle fill, arrow-key nudge, duplicate)
  are done, see "Already completed".
- Rectangular selection, clipboard, multi-select entities — changes
  `Grid.sel`'s shape; scope deliberately (this was UX-05's own explicit
  "defer until there is a reason", not part of what shipped; NAT-14's own
  "region operations" - select-all/copy/paste - names the same scope and is
  deferred for the same reason, having shipped only the tab-switching half of
  its own remaining scope, see "Already completed"). Tool cycling, NAT-14's
  other deferred piece, has no concrete key binding proposed anywhere in this
  document to implement against.
- Playtest, once the game can load `.lvl` (`game/todo.txt` 3.1) - VIS-13's
  own remaining scope, the actual game-wiring implementation; the
  communication half (a visible-without-hovering route, a screen-reader
  explanation) is done, see "Already completed".
- Level templates and a starter library.
- PERF-03's entity index — only if entity counts reach the hundreds; see
  "Already completed" for why that condition does not currently hold.

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
that BUG-01's own fix did not cover; **NAT-09** itself (actually opening a
dropped file) is done too, in a later round - see "Already completed" -
double-clicking one in a file manager now opens it too, via the file
association **NAT-07** registers, done in this round.
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

5. **NAT-06** recent documents is done — see "Already completed": it built
   directly on the `doc` module (BUG-08, done) exactly as scheduled. **NAT-09**
   drag and drop is done too, and turned out not to need NAT-07 as a
   prerequisite after all - only the Dock-icon-drop and double-click-to-open
   cases did, and both are done too, now that **NAT-07** has registered the
   file association. **NAT-08** single instance is done too, on the same
   basis - the lock and its `second-instance` handler needed no file
   association to be correct, only a path to parse out of one once it
   existed, which it now does. **NAT-07** itself - packaging, icons, the
   file association and the `open-file`/argv wiring - is done too, in this
   round - see "Already completed".

### Phase 3 — Design system made real

The contrast/focus-ring step originally scheduled here (VIS-01, VIS-02,
VIS-06) is done — see "Already completed". **VIS-05** (bundle JetBrains Mono
- everything measured in the real typeface from here on) and **VIS-07** (the
five-state contract, applied to every interactive surface) are also done —
see "Already completed" for both.

8. **VIS-11** icons is done — see "Already completed": one inline-SVG set,
   `currentColor`, one `--icon` token, for the five sites that were
   demonstrably broken. **VIS-10** capitalisation is done too, in a later
   round - see "Already completed". **VIS-09**
   (radius and elevation) and **VIS-08** (motion, with its mandatory
   `prefers-reduced-motion` companion) are done — see "Already completed" for
   both.
9. **NAT-20 / GEO-09** — done, see "Already completed": one scrollbar
   treatment across all five containers. **VIS-18** Monaco theme fully
   aligned with the surrounding chrome (its own colour duplication is
   resolved, VIS-04, done) is done too — see "Already completed".
10. **GEO-07** — done, see "Already completed": integer palette cells.
    **GEO-08** the remaining one-offs onto the scale is done too — see
    "Already completed".
11. **VIS-15 / VIS-16** — done, see "Already completed": the rename field is
    the same `.field` component `#props input` uses, and the canvas's
    selection ring, level bounds, hover cell and keyboard cursor are all
    contrast-guaranteed two-tone/difference indicators now. **VIS-17**
    missing-texture treatment is done too, in a later round - see "Already
    completed": a still-decoding cell draws nothing, a genuinely unknown id
    draws a hatch and a save warning names it. **VIS-12** empty states and
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
14. **GEO-10** vertical scrollbar is done — see "Already completed": its
    prerequisite, NAT-11's wheel scroll, was already in place.
15. **NAT-12** canvas context menu and Ctrl+click, and **UX-12** gesture
    cancel, are both done — see "Already completed" (**NAT-13** cursors is
    done too).
16. **PERF-01** — done, see "Already completed": `Panel.update()` now exists
    and the drag hot path uses it. **ARCH-04** is done too, in a later round -
    every `onchange` handler that used to rebuild the field it fired from now
    either reuses `Panel.update()` (the `p_x`/`p_y` case) or has its focus
    restored after the rebuild (`p_rows`/`p_def`/`p_id`/`p_script`); retiring
    `esc()` was reassessed and left as-is, since it already escapes everything
    an HTML-injection risk needs escaped. **PERF-02** cached rect and refs is
    done too.
17. **UX-16** tab overflow is done — see "Already completed": scrolling,
    active-tab-into-view, a pinned Level Editor tab and middle-click-close.
    **NAT-14**'s `⌃Tab`/`⌃⇧Tab` tab switching is done too - see "Already
    completed" (zoom itself was already done, UX-04; the menu/shortcut
    consolidation was already done, NAT-01) - numbered `⌘1…⌘9` jumps and
    region operations (select-all/copy/paste) remain open, the latter
    tracked under the same deferred scope as UX-05's own clipboard work
    (§13, "Nice to have").

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
20. **A11Y-06** is done too - see "Already completed": a manual View → Text
    Size command, scaling type and row heights together. **A11Y-07** system
    preferences (`forced-colors`/`prefers-contrast` on the chrome) is done
    too - see "Already completed": every system-preference gap this phase
    ever named is now closed.

### Phase 6 — Reliability and remaining QOL

**UX-10** (recovery snapshots and `.bak`) and **BUG-11** (playability
warnings) are also done - see "Already completed"; both built directly on
BUG-02's atomic write and BUG-08's `doc` module, as scheduled.

21. **ARCH-08** — done, see "Already completed": lazy Monaco. **PERF-07** is
    done too: `win.show()` now waits for the renderer's own `ui:ready` signal
    (with a fallback timer) instead of racing `api.blank()`/`api.init()`.
    **PERF-05** refresh granularity is done too, in a later round - see
    "Already completed": `Undo.apply()` reports which parts of a step's own
    before/after shots actually differ, and `App.refresh()` rebuilds only
    those.
22. **BUG-13** path containment is done — see "Already completed". **ARCH-06**
    is done too: every `invoke()` handler now answers one envelope shape, and
    `app.js`'s `call()` is the one place that unwraps it. **ARCH-09 / NAT-19**
    async I/O is done too, in a later round - see "Already completed": measured
    first, per this phase's own rule - a 999-row save's own compression, not
    disk I/O, was the real cost, and moved onto fflate's async `zip()`.
    **PERF-06**'s own lookup-table idea, conditioned on that same measurement,
    turned out not to be needed once the actual bottleneck was found elsewhere
    - see "Already completed".
23. **UX-01**, **UX-03** and **UX-15** are done — see "Already completed":
    double-click to open a script; Undo/Redo labelled with the action's own
    name in both the menu and the status bar; inline rename validated live
    with a rejected edit's text kept intact. **UX-09**, **UX-13** and
    **UX-14** are done too - see "Already completed": restoring the last
    session's document, offering "Delete Anyway" on an in-use script instead
    of only refusing, and a new custom definition always getting its own
    fresh script with an announcement instead of silently binding to an
    arbitrary existing one. **UX-02** and **UX-17** are done too - see
    "Already completed": row menus that carry only the actions that act on
    that row, and a "(snaps to 100)"/"(1-999)" hint on the fields that round
    or clamp silently. **UX-06** active-tool indicator and **UX-08**
    destructive-action reporting are both done too - see "Already completed".
24. **UX-11** preferences is done too, in a later round - see "Already
    completed": `settings.json`, a fourth `#props` view alongside the level/
    entity/definition ones, and all four of the finding's own credible
    settings (grid overlay, palette cell size, editor font size, the
    recovery-snapshot interval) wired to a real effect. **NAT-15**, **NAT-17**
    and **UX-18** — the remaining low-priority tail — are done too, in this
    round: NAT-15's `forced-colors` piece was already shipped (A11Y-07, see
    "Already completed"), and the Windows `nativeTheme` accent re-push
    closed the rest of it; NAT-17's About panel and recent documents were
    already shipped (NAT-01, NAT-06), and the Dock menu, JumpList task and
    save/open progress bar closed the rest of it; UX-18's tooltip metadata
    and row-menu export closed all of it. **ARCH-05** (`util.js`) and
    **PERF-03** (confirmed correct, left alone) are done too, in this same
    round.

### Dependency summary

```
Done and no longer on this graph: VIS-05 (font, done) unblocked every
type-metric-dependent step that follows it, needing nothing from this graph
itself; GEO-03 (done) unblocked GEO-04 (also done - the min/max/proportion
tokens a splitter drag needs to constrain against already existed by the time
the splitters themselves were built); ARCH-07 (checks) unblocked everything below
it by making every later change verifiable at all; BUG-08 (doc state)
unblocked NAT-03, NAT-06, NAT-07, NAT-08, NAT-10, UX-10, all of which could
then build on it directly - NAT-03, NAT-06, NAT-10, NAT-08 and NAT-07 have
since shipped, done — see "Already completed" (NAT-08 in the end needed
nothing from NAT-07, though it now parses the `argv` NAT-07's file
association hands it); BUG-09 closed the live gap NAT-01 opened;
VIS-01/VIS-02/VIS-06 unblocked nothing else in this graph; NAT-18 closed
NAT-09's navigation hole without needing any of the above, and NAT-09 itself
has since shipped straight off it, needing nothing further from this graph;
NAT-21/BUG-10 and
UX-10/BUG-11 each shipped straight off BUG-08's `doc` module and BUG-02's
atomic write, also without needing ARCH-03; ARCH-03 (platform) unblocked
NAT-02 (also done) and VIS-10, which has since shipped straight off it -
`chrome.js` gained `oscase()`, the OS-facing capitalisation convention this
note once said was not yet ported - and NAT-02 in turn
unblocked NAT-03 and NAT-04 (both now done); NAT-05 deleted an entire
inaccessible subsystem rather than fixing it in place, independently of the
rest of this graph; NAT-11 unblocked GEO-10 (the wheel now scrolls, and GEO-10
itself has since shipped straight off it, done — see "Already completed") and
named two of GEO-11's eight constants; A11Y-01 (also done, needing nothing from
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
shipped, also needing nothing further from this graph); GEO-08 and VIS-18
have since shipped on the same basis too; A11Y-07's own `forced-colors`/
`prefers-contrast` chrome work (which NAT-15's own text asked for too) has
since shipped straight off the same token block, needing nothing further
from this graph; PERF-04 and
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
- [x] Double-clicking a `.lvl` in Finder, Explorer and a Linux file manager
      opens it in a running (single) instance. (NAT-08/NAT-07 — the
      single-instance lock and the `.lvl` file association are both done,
      see "Already completed": a losing second instance quits before ever
      reaching `whenReady()`, verified with the probe harness; a cold-start
      argv path (the double-click case on Windows/Linux, and a second
      instance's own argv) was verified end to end opening a legacy `.json`
      level through `migrate()`; the macOS `open-file` path is exercised by
      the same `openpath()`/`pendingopen` code, not separately re-verified
      live on this machine since macOS's own Launch Services routes it)
- [x] Recent documents appear in File → Open Recent, the macOS Dock menu, and
      the Windows JumpList. (NAT-06/NAT-17 — File → Open Recent and macOS's
      own Dock "Recent" behaviour are done, see "Already completed"; a
      custom Dock menu was verified with a probe variant intercepting
      `Menu.buildFromTemplate` — after a save, its Open Recent submenu
      correctly listed the file; the Windows JumpList task is structurally
      implemented but not run on real Windows hardware)
- [x] Dropping a `.lvl` on the window or the Dock icon opens it; dropping
      anything never navigates the shell away. (NAT-09/NAT-07 — dropping a
      `.lvl`/`.json`/`.lua`/`.mid` on the window itself opens or imports it,
      and dropping anything never navigates the shell away, done, see
      "Already completed"; a Dock-icon drop now arrives as `open-file`, done
      too, via the file association NAT-07 registers - not separately
      re-verified live on this machine, since it is the same `openpath()`
      code path NAT-08/NAT-07's own verification above already exercised)
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
      all three platforms and launch on a clean machine. (NAT-07 — packaging
      itself is done, see "Already completed": `electron-builder --mac --dir`
      produces a working, unsigned `.app` that launched and exited cleanly;
      Windows/Linux targets are configured but not built or run on real
      hardware. Signing and notarisation remain unchecked: they require paid
      developer accounts/certificates this environment has no access to)

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
- [x] The Monaco editor's palette matches the surrounding chrome, including
      scrollbars, widgets and lists. (VIS-18 — `THEME.colors` grew to
      nineteen keys, all sourced from `Tokens`/`tokens.js`, covering the
      scrollbar, suggestion widget, list states, bracket-match and
      error/warning colours that used to leak `vs-dark`'s own blue; verified
      with the probe harness, a script tab opened and Monaco loaded:
      `editor.background` read `"#0b0813"` matching `--canvas-bg` exactly,
      and the live editor's own `fontSize`/`lineHeight` read `12`/`18`
      matching `--font-size`/`--line-box`)
- [ ] `CLAUDE.md`'s "Deviations from the design file" section records every
      remaining divergence from `Pellizzola Brothers.svg`, with a reason.
      (VIS-03 — the accent divergence is recorded now, done, see "Already
      completed"; the box stays unchecked pending a full pass confirming no
      other undocumented divergence remains)

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
      and OS text scaling. (`prefers-contrast: more` is fully done now: the
      canvas's own indicators - selection ring, level bounds, hover cell,
      keyboard cursor - are two-tone/difference-composited so they stay
      visible regardless, and the selection stroke itself thickens under the
      query (VIS-16, done); `--control-border`/`--fg-disabled`/the focus
      ring on the chrome itself now respond to it too (A11Y-07, done).
      `forced-colors: active` is done too (A11Y-07): the system palette is
      adopted everywhere except the level canvas and the palette's own
      sprite swatches, which keep their own colours and background-images
      deliberately (`forced-color-adjust: none` - losing them would be a
      functional break). All done, see "Already completed". OS text scaling
      itself has a manual escape hatch now - a View → Text Size command
      scales type and row heights together, A11Y-06, done, see "Already
      completed" - but nothing here follows an OS text-size *setting*
      automatically, which is what this box is actually checking, so it
      stays unchecked on that one remaining clause alone)
- [ ] A VoiceOver, Narrator and Orca pass each reach and describe the file
      list, tabs, palette, inspector and canvas.

### Correctness and reliability

- [x] It is not possible to lose unsaved work through reload, navigation,
      drag-drop, quit, window close, or a renderer crash. (BUG-01, BUG-09,
      NAT-18 — dropping a file can no longer navigate the shell away; NAT-09,
      done, see "Already completed" — a drop now opens or imports the file
      too, through the same unsaved-changes guard any other open crosses)
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
      (NAT-07 — verified for macOS: `npx electron-builder --mac --dir`
      produced a working, unsigned `.app` that launched and exited cleanly;
      Windows (NSIS/zip) and Linux (AppImage/deb) targets are configured in
      `package.json`'s `build` block but were not built or run on this
      machine, so the box stays unchecked)
- [x] `CLAUDE.md` is updated to describe the new architecture — main-owned
      document state, the menu, the platform module, the token system — so the
      next reader does not have to rediscover any of it. (BUG-08/ARCH-01,
      NAT-01, ARCH-03 for the first three; GEO-01/VIS-04 added the token
      system paragraph and the `tokens.js` row in the file table)

### Performance

- [ ] Dragging an entity across a level holds 60 fps with the inspector open.
- [x] Panning and zooming perform no forced synchronous layout per frame.
      (PERF-02 — `Grid.rect` is cached at `Grid.init()`/`doresize()` instead of
      re-read by `clamp()`/`fit()`/`at()`/`onwheel()` and friends on every
      call, the four scrollbar-track elements are looked up once instead of
      by `getElementById()` on every `syncbar()`/`syncvbar()`, and
      `hspace`/`vspace`'s own `style.width`/`height` are written only when the
      value actually changes. Verified with the probe harness: instrumenting
      `getBoundingClientRect` and driving a synthetic ten-move pan counted
      **0** calls; instrumenting the `hspace` style setter the same way
      counted **0** writes during a pan at constant zoom)
- [ ] Dragging a splitter does not stutter. (GEO-04's splitters exist now and
      drive the canvas resize through the same `requestAnimationFrame`-
      coalesced path PERF-04 already built for exactly this; not yet backed
      by a dedicated frame-timing measurement, so the box stays unchecked)
- [ ] Cold start to an interactive Level Editor is under one second on a
      mid-range machine, with Monaco loaded lazily. (Monaco loaded lazily is
      done, ARCH-08; the under-one-second cold-start figure itself has not
      been measured with a timer, so the box stays unchecked)
- [x] Saving a 999-row level completes without the window becoming
      unresponsive, or shows honest progress if it cannot. (NAT-19/ARCH-09/
      PERF-06 — measured first: `Grid.commit()` 17ms, `JSON.stringify` 11ms,
      `zipSync` 82ms, `writeFileSync` under 2ms, of a ~104ms `lvl.write()`
      total in isolation (~200ms including the full IPC/`Grid.commit()`
      round trip); compression, not disk I/O, was the real cost, and moved
      onto fflate's async `zip()`. Verified with the probe harness and a
      standalone Node timing script: a 5ms `setInterval` kept firing
      throughout an async 999-row `zip()` call (proof the main thread stayed
      free), where it could not have during the old `zipSync`'s own
      synchronous call; save/save-as/overwrite-with-`.bak`/recovery-snapshot
      all still round-trip correctly through the new async path. A Dock/
      taskbar progress indicator was added too, in a later round -
      `win.setProgressBar()` brackets both `lvl:save` and `lvl:saveas`,
      verified `[2, -1]` around a save with a probe variant intercepting
      `BrowserWindow#setProgressBar` - see "Already completed", NAT-17)
