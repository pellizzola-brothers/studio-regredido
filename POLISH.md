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

The fifteen items below have shipped and are removed from the findings
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
(zoom, fit), the Edit menu's Cut/Copy/Paste roles operate on focused text
fields only (no canvas region clipboard exists to wire them to), and
`chrome.js`/`api.platform` (ARCH-03) — `menu.js` branches on
`process.platform` itself rather than consuming a shared platform module,
which does not yet exist.

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
desktop application's clothes. It draws fake macOS traffic lights on every
platform, builds its own context menus out of `<div>`s, invents its own title
bar, and has never been packaged. Its geometry is a collection of unrelated
pixel constants. And the font it was designed in is neither installed nor
bundled, so the app has never actually been seen in its own typeface. It now
ships a real application menu under its own name rather than Electron's
default one (NAT-01, see "Already completed" above), which also closed the
⌘R data-loss bug and three other data-safety findings; document identity now
lives in main rather than split across the process boundary (BUG-08/ARCH-01);
a dead or wedged renderer can no longer leave the window permanently
unclosable (BUG-09); and the resting text, accent text and control-boundary
colours all now clear WCAG AA/1.4.11 contrast (VIS-01, VIS-02), with a real
focus ring restored everywhere (VIS-06) — see "Already completed" above for
all of these. The shell's remaining problems are below.

### The three biggest remaining sources of perceived unpolish

1. **Geometry is arbitrary.** The stylesheet contains 23 distinct pixel
   literals with no scale: chrome bands of 34/32/24/22/13 px unrelated to the
   18 px line box; side panels pinned at 184 px and 212 px that consume 41 % of
   the 960 px minimum window; `#props { flex: 0 1 46% }`; `#scripts { flex: 1 1
   60% }`; a palette of `repeat(4, 1fr)` that computes to **42.25 px cells for
   32 px sprites** — a fractional, shimmering scale factor of 1.32 (GEO-01,
   GEO-03, GEO-07).
2. **Nothing is native but the file dialogs, the menu and the About panel.**
   Custom window controls, custom title, DOM context menus, no recent
   documents, no `open-file` handler, no file association, no single-instance
   lock, no drag-and-drop, no window-state persistence, no icon, no packaging
   config, no `setDocumentEdited`, no `setRepresentedFilename`, no
   `nativeTheme`. Most of the Electron APIs that exist precisely to make this
   application feel native are still unreferenced anywhere in the tree
   (verified by grep).
3. **The typeface is a fiction.** Measured in the running app: the strings
   `"JetBrains Mono"`, `"DejaVu Sans Mono"`, `ui-monospace`, `monospace` and
   the deliberately bogus `"NoSuchFontXYZ"` all render at **exactly
   103.341796875 px** for the same test string. Every entry falls through to
   the platform default. Studio has never been seen in the font it was designed
   for, and it looks materially different on macOS (SF Mono), Windows
   (Consolas) and Linux (DejaVu Sans Mono) (VIS-05).

### The highest-impact improvements

In order of user-visible payoff per unit of work:

| # | Change | Why |
|---|--------|-----|
| 1 | Bundle JetBrains Mono as a woff2 | The app finally looks like its own design, identically on all three platforms |
| 2 | `titleBarStyle: 'hiddenInset'` on macOS / `titleBarOverlay` on Windows; delete the fake dots | Real window controls, real focus dimming, real double-click-to-zoom |
| 3 | One spacing/size scale derived from the 18 px line box; proportional panels with splitters | Removes every arbitrary dimension at once |
| 4 | Native `Menu.popup()` for context menus | Keyboard navigation, screen-reader support, platform look, for less code than the DOM version |

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
| **Window controls (min/max/close)** | **renderer** → `win:ctl` IPC | **No** — see NAT-02 |
| Application menu | `menu.js` (main), rebuilt on renderer state | Yes — done, NAT-01 |
| **Context menus** | **renderer DOM** (`#menu`, `menu()` in `app.js`) | **No** — see NAT-05 |
| Level document, undo, canvas, palette, inspector, Monaco | renderer | Yes |

The preload (`preload.js`, now 19 lines) is a clean, minimal, correctly-shaped
bridge: named functions, no object passthrough, no `ipcRenderer`
exposure. It is the best-designed file in the project. Its only gap is that it
exposes no platform information, which is why the renderer cannot adapt to the
host OS (ARCH-03).

### UI architecture

Five global-scope modules, coordinated by `App`:

- `App` (`app.js`) owns the document, tab strip, file manager, key bindings and
  the DOM context menu. `App.refresh()` is the universal "rebuild everything"
  entry point; `Undo` calls it after every history step.
- `Grid` (`grid.js`) owns the canvas: camera, `Uint16Array` mirror, culled
  draw, all pointer gestures.
- `Panel` (`panel.js`) owns the palette and inspector, both rebuilt from
  scratch via `innerHTML` on every call.
- `Code` (`code.js`) owns Monaco, one model per script.
- `Undo` (`undo.js`) owns history.

Rendering is entirely imperative full-subtree rebuilds. There is no diffing,
no component model and no reactive layer, which is the right choice at this
size — but it means every rebuild destroys focus, scroll position and caret,
which matters in the two places it happens on a hot path (PERF-01, UX-15).

### Existing design system

There is a **token seed, not a system**. `style.css` `:root` defines nine
colour tokens and four layout tokens. Against that:

- Sixteen further colours are written as literals in `style.css`, `grid.js`
  (`#0b0813`, `rgba(123,86,186,.14)`, `rgba(200,170,255,.75)`, `#7b56ba`,
  `#4a3a6a`, `#803050`) and `panel.js`/`app.js` inline `cssText`.
- `code.js` `THEME` is an entirely independent, hand-transcribed copy of the
  palette for Monaco (11 more literals).
- There are **no** tokens for spacing, radius, border width, shadow,
  typography, icon size, duration, easing, or z-index. Twenty-three distinct
  pixel literals appear in the stylesheet.
- There is exactly **one** shadow (`0 6px 20px rgba(0,0,0,.55)`), **one**
  non-circular radius (`6px`, on the scrollbar thumb), and **zero**
  transitions or animations in the entire application.

### Existing platform abstractions

None in the renderer. `process.platform` now appears twice in the main
process (`main.js`, the `window-all-closed` guard; `menu.js`, macOS vs.
everyone-else menu shape — the second use NAT-01 introduced, and exactly the
kind of branch ARCH-03 asks to consolidate into one module rather than let
multiply). The renderer still has no way to know what OS it is on. Every
platform-specific decision in the UI — the traffic lights, the ⌘/Ctrl
handling, the label capitalisation, the scrollbar assumptions — is therefore
either hard-coded to one platform or silently wrong on the others.

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

#### BUG-10 — The discard dialog's result is a magic integer coupled to button order

**Category** Code quality · **Severity** Low · **Priority** P2 · **Affects** Architecture

**Current.** `main.js:135-142` returns `r.response` — 0/1/2 — and `app.js:401`
decodes it positionally (`if (r === 2) … if (r === 1) …`), with the meaning
documented only in a comment in the *other* file. Reordering the buttons for a
platform convention (Windows conventionally orders affirmative-first,
GNOME orders destructive-left) silently inverts save and discard.

**Recommended.** Return a string: `'save' | 'discard' | 'cancel'`. Map from the
index inside `main.js`, next to the array that defines the order, so the two
can never drift.

**Related.** The dialog itself needs work (NAT-21).

---

#### BUG-11 — Nothing checks that a level is playable

**Category** Correctness · **Severity** Medium · **Priority** P2 · **Affects** UX

**Current.** `lvl.js validate()` checks the *schema* — types, row widths, id
formats, definition references, background presets. It does not check level
*semantics*. Studio will happily save a level with no start block, no end
block, four start blocks, or entities referencing a script file that is not in
the archive.

**Why it's a problem.** `textures/README.md` states the contract explicitly:
tile 1 is "**Unique** spawn point per level", tile 4 is "**Unique** goal per
level". A level with neither is one the game cannot run, and the author finds
out from the game, not the editor.

**Evidence.** `lvl.js:22-88` (no tile-semantic checks); `textures/README.md`
blocks table; `catalog.js:16,19` (ids 1 and 4).

**Recommended.** A second tier: `validate()` stays as-is and gates writes;
`review()` returns *warnings* that are shown but never block a save. Warn on:
zero or multiple tile-1 blocks; zero or multiple tile-4; a definition whose
`script` is a `scripts/…` path not present in `doc.scripts`; entities outside
`W × h`; unreferenced scripts; unreferenced entity definitions.

**Implementation.** `lvl.js` (so it stays the single source of truth per
`CLAUDE.md`), returned alongside the document on read and on save. Surface in
the inspector as a "level" section and as a count in the status bar
("2 warnings"), clickable to expand.

**Platforms.** None.

**Risks.** Do not let warnings block saving — an author mid-build legitimately
has no end block yet. Warnings that block get disabled; warnings that inform
get read.

---

#### BUG-12 — Moving the window to a different-DPI display leaves the canvas blurry

**Category** Correctness · **Severity** Medium · **Priority** P2 · **Affects** UI

**Current.** `Grid.dpr` is read only inside `Grid.resize()` (`grid.js:88`),
which runs only from the `ResizeObserver` on `#wrap` (`grid.js:75`). Dragging
the window from a 1× display to a 2× display does not change `#wrap`'s CSS
size, so the observer does not fire, `Grid.dpr` stays 1, and the canvas backing
store stays at half the needed resolution. Everything the app is proudest of —
the whole-device-pixel edge snapping at `grid.js:238-244` that keeps pixel art
seamless — is defeated.

**Evidence.** `grid.js:84-98`; `devicePixelRatio` measured as 1 in the probe
run, confirming it is read but never re-read.

**Recommended.** Listen for DPI changes and re-run `Grid.resize()`.

**Implementation.** The portable idiom in the renderer:
```
function watchdpr()
{
	matchMedia('(resolution: ' + devicePixelRatio + 'dppx)')
		.addEventListener('change', () => { Grid.resize(); watchdpr(); },
			{once: true});
}
```
Each media query is valid only for the current ratio, hence the re-arm.
Alternatively, main can forward `screen.on('display-metrics-changed')` — better
if other parts of the app grow DPI-dependent behaviour, but heavier for one
consumer.

**Platforms.** All three. Most visible on Windows, where mixed-DPI multi-monitor
setups with per-monitor scaling are common; also affects macOS
built-in-Retina + external-1080p, and Wayland fractional scaling on Linux.

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

#### NAT-02 — Fake macOS traffic lights are drawn on every platform

**Category** Native · **Severity** High · **Priority** P0 · **Affects** UI, UX

**Current.** `main.js:38` creates the window with `frame: false`.
`index.html:7-9` draws three `<i>` elements; `style.css:55-63` makes them 12 px
circles coloured `#ff736a` / `#ffbe2f` / `#2bc840`; `app.js:523-525` wires them
to `tryclose` and `api.ctl('min'|'max')`.

**Why it's a problem.** This is the clearest instance of the app fighting the
OS rather than cooperating with it.

- **On macOS** it is an imitation that fails every detail the real control
  gets right: no ⌃/–/+ glyphs on hover; no dimming when the window loses key
  focus; no ⌥-click behaviours; no "Reduce transparency"/"Increase contrast"
  response; wrong colours (see below); wrong size (12 px vs the design's 14 px
  and the system's 12 px at a different pitch); and — importantly — the green
  button calls `win.maximize()`, whereas the real green button enters
  **full screen**, with *zoom* on ⌥-click. The imitation therefore behaves
  differently from every other window on the user's Mac.
- **On Windows** window controls belong at the **top right**, are rectangular,
  are ~46 × 32 px, use the Segoe Fluent glyph set, and the close button turns
  red on hover. Three coloured dots at the top left are simply wrong there.
- **On Linux** button placement, order and presence are a *user preference*
  (`org.gnome.desktop.wm.preferences.button-layout`), and many WMs use
  server-side decorations. Hard-coding macOS's layout ignores the user's
  configuration.

**Evidence.** `index.html:6-17`, `style.css:46-65`, `app.js:523-525`,
`main.js:38`. Colours: the design file specifies `#FF736A / #FEBC2E / #19C332`;
the implementation uses `#ff736a / #ffbe2f / #2bc840` — the amber and green
diverge from the reference for no recorded reason (VIS-03).

**Recommended.** Delete the fake dots and the `win:ctl` channel. Per platform:

- **macOS** — `titleBarStyle: 'hiddenInset'` plus
  `trafficLightPosition: {x, y}` computed from the title-bar token so the real
  controls sit exactly where the design places them. Real controls, real
  behaviour, less code.
- **Windows** — `titleBarStyle: 'hidden'` plus
  `titleBarOverlay: {color, symbolColor, height}` fed from the same tokens.
  Windows draws its own caption buttons, correctly placed and themed, over the
  app's title bar.
- **Linux** — `titleBarOverlay` is supported on Linux in current Electron;
  prefer it. Where it is unavailable or the desktop uses server-side
  decorations, fall back to `frame: true` and let the WM decorate, hiding the
  in-app title row entirely. Do **not** fall back to the macOS dots.

**Implementation.** One `chrome.js` module in main that returns the
`BrowserWindow` options for `process.platform`, and one `api.platform` value
exposed through the preload so `style.css` can key off
`html[data-platform="darwin"]` for the inset padding the real traffic lights
need. That is the *only* platform branch the renderer should contain
(ARCH-03).

**Depends on.** The design-token work (GEO-01) supplies the height and colours
that `trafficLightPosition` and `titleBarOverlay` need.

**Risks.** `titleBarOverlay` colours do not follow a theme change automatically
— call `win.setTitleBarOverlay()` from a `nativeTheme.on('updated')` handler
(NAT-15). On macOS, `hiddenInset` reserves ~78 px on the left; the layout must
derive its left padding from that rather than assume it.

---

#### NAT-03 — Window title, dirty state and proxy icon ignore every OS convention

**Category** Native · **Severity** High · **Priority** P1 · **Affects** UI, UX

**Current.** `App.retitle()` (`app.js:34-42`) builds
`name + '  —  ' + App.path + ' *'` into a `<div id="name">` and separately sets
`document.title = name + ' - Pellizzola Brothers Studio'`. Probed live:
`getRepresentedFilename()` is `""` and `isDocumentEdited()` is `false`, always.

**Why it's a problem.** Three conventions are being ignored and one string is
being duplicated:
- **macOS** expects the title to be the **document name only**, with the
  full path reachable via ⌘-click on the **proxy icon**
  (`win.setRepresentedFilename(p)`), and unsaved state shown as a **dot in the
  close button** (`win.setDocumentEdited(true)`). Studio shows the entire
  absolute path inline and an asterisk, both non-native.
- **Windows** expects `Document — Application`; the taskbar shows the window
  title, so `document.title` matters and currently omits dirty state entirely
  — the DOM title has the `*`, the OS title does not. Two titles, two truths.
- **Linux** varies, but the window title is what appears in the overview,
  the taskbar and the window switcher; the same inconsistency applies.

**Evidence.** `app.js:34-42`; probe output `DOCEDITED false REPFILE ""`, window
title `"untitled - Pellizzola Brothers Studio"` while `#name` reads
`"untitled"`.

**Recommended.** Main owns the title, derived from main's document state
(`doc = {path, dirty}` in `main.js`, done — see "Already completed", BUG-08):
- always `win.setTitle(name + (platform === 'win32' ? ' — Pellizzola Brothers Studio' : ''))`;
- macOS additionally `setRepresentedFilename(path || '')` and
  `setDocumentEdited(dirty)`;
- the in-window `#name` element shows the **document name plus a dirty dot**
  (not an asterisk, not the path) and nothing else; the path belongs in a
  tooltip and in the status bar.

**Implementation.** Delete `document.title` assignment from the renderer; move
it behind the `doc` module's setters in main. Keep `#name` as pure display fed
by a `doc:state` event.

**Platforms.** As above. On macOS the proxy icon only appears with a real title
bar or `hiddenInset` — another reason NAT-02 comes first.

---

#### NAT-04 — The custom hotbar duplicates what belongs in the menu

**Category** Native · **Severity** Medium · **Priority** P1 · **Affects** UI, UX

**Current.** `index.html:11-16` renders four text buttons — `new`, `open`,
`save`, `save as` — in the title bar, wired at `app.js:521-522`. `CLAUDE.md`
records the reasoning: "The window is frameless, so there is no native menu bar
to hang them on."

**Why it's a problem.** The premise is only true on Windows and Linux. On macOS
the menu bar is at the top of the *screen*, entirely independent of window
framing, so a frameless window is no reason to duplicate File commands inside
the content area. Meanwhile on all three platforms the commands are *only*
reachable there — they are not in any menu — so the app has one command surface
where it should have two complementary ones.

**Recommended.** The menu (shipped, see "Already completed") is the canonical
command surface on every platform. The hotbar's fate is per-platform:
- **macOS** — remove the four text buttons. Everything they do is in File, with
  the same shortcuts. The title bar becomes: real traffic lights, document
  name, dirty dot. This is what a Mac app looks like.
- **Windows / Linux** — keep an in-window command surface, because with
  `titleBarStyle: 'hidden'` there is no visible menu bar. But make it a proper
  toolbar: icon buttons with tooltips carrying the accelerator
  ("Save (Ctrl+S)"), a `role="toolbar"` with arrow-key roving tabindex, and the
  same `ACTS` dispatch as the menu. Optionally offer a "hamburger" menu button
  that calls `Menu.popup()` with the full application menu — the pattern VS
  Code and Windows Terminal both use.

**Implementation.** `body[data-platform]` gates hotbar visibility in CSS; the
buttons keep working through the shared command table.

**Risks.** Discoverability on macOS: users who learned the buttons lose them.
Acceptable — they move to the place users look first.

---

#### NAT-05 — Context menus are `<div>`s instead of native menus

**Category** Native · **Severity** High · **Priority** P1 · **Affects** UI, UX, Accessibility

**Current.** `app.js:154-209` implements a menu from scratch: `#menu` is a
fixed-position div, items are `.mi` divs with `onclick`, separators are `<hr>`,
disabled items get a class, and `menu()` positions it by clamping
`offsetWidth/Height` against `innerWidth/innerHeight`.

**Why it's a problem.** The re-implementation is missing essentially everything
the native menu provides:
- **No keyboard**: arrow keys, Home/End, type-ahead, Return, Escape — none.
- **No accessibility**: no `role`, no focus management; a screen reader sees
  three unlabelled divs (A11Y-02).
- **No platform appearance**: it does not match the OS in font, metrics,
  corner radius, shadow, highlight colour, or animation, on any of the three.
- **No accelerator column**, no checkmarks, no radio groups, no submenus, no
  icons — all of which the file-manager and canvas menus will want.
- **Cannot escape the window.** A native menu can extend past the window edge;
  this one clamps to `innerWidth - offsetWidth - 4`, so near the bottom-right
  it is squeezed inward rather than flipped, which is not what any platform
  does. (Probed: opening at (1595, 945) in a 1600 × 950 window produced a menu
  at x 1446–1596, y 910–946 — clamped, not flipped.)
- Roughly 55 lines of renderer code exist to do worse what one main-process
  call does.

**Recommended.** `Menu.buildFromTemplate(template).popup({window: win})` in the
main process, triggered by an IPC message carrying the context (which row, what
kind, what is selected). Delete `#menu`, `menu()`, `closemenu()`, the `.mi`
styles, and the global capture-phase `mousedown` dismisser (`app.js:530-534`).

**Implementation.**
1. Renderer sends `menu:show` with `{kind: 'script'|'midi'|'panel'|'canvas',
   key, selection}`.
2. Main builds the template — this is where "assign to <def>" gets its
   `enabled: false` honestly, where the separator is `{type: 'separator'}`, and
   where accelerators are displayed.
3. Chosen item comes back on the `cmd` channel and the renderer's `ACTS` table
   — both already exist (the menu bar uses them, see "Already completed") — so
   this reuses the dispatcher rather than adding a second one. Commands this
   menu needs that `ACTS` does not yet have (rename, delete, assign) are new
   entries in the same table, not a parallel mechanism.
4. Keep the documented left-click-to-open-menu behaviour (`CLAUDE.md`
   "Deviations": it was asked for explicitly) — `popup()` works from a
   left-click just as well.

**Platforms.** All three benefit. On Linux the native menu inherits the GTK
theme, which is the single fastest way to stop looking foreign there.

**Risks.** `popup()` is asynchronous and the renderer loses the ability to
inspect the menu; make sure `Grid.sel` and the row key are captured at popup
time, not read later.

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
as window state (NAT-10).

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
  `monaco-editor` package do not ship (ARCH-08).
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

#### NAT-10 — Window geometry is a fixed constant and is never remembered

**Category** Native · **Severity** Medium · **Priority** P1 · **Affects** UX, UI

**Current.** `main.js:37` — `width: 1600, height: 950, minWidth: 960,
minHeight: 620`. Four literals with no derivation and no persistence. Probed:
the window opens at `{x: 160, y: 25, width: 1600, height: 950}` every time.

**Why it's a problem.**
- **1600 × 950 does not fit a 1366 × 768 laptop** — still the second most
  common desktop resolution — nor a 13" MacBook Air's 1440 × 900 usable area
  once the menu bar and Dock are subtracted. Electron will shrink it to fit,
  but the *layout* was never designed for what it shrinks to.
- Resizing and repositioning are discarded on every launch, which is one of the
  most noticeable "this is not a real app" signals.
- The minimum, 960 × 620, is where the fixed side panels consume 41 % of the
  width (GEO-03) — the minimum is set below the size at which the layout still
  works.

**Recommended.** Derive the default from the display, and persist the actual.
- Default size: a fraction of the **work area** (`screen.getPrimaryDisplay()
  .workAreaSize`, which already excludes the menu bar, Dock and taskbar) —
  e.g. 80 % of each axis, clamped to a maximum design width so a 5 K display
  does not open a 4 000 px window, and clamped to the minimum.
- Default position: `center: true`, letting the OS place it.
- Persist `getNormalBounds()` plus `isMaximized()`/`isFullScreen()` to
  `app.getPath('userData')/window.json` on `close`; restore on launch **only
  after validating** the saved rectangle still intersects a currently-connected
  display (`screen.getAllDisplays()`), otherwise fall back to the derived
  default. This is the multi-monitor case that breaks naive implementations:
  the saved position may be on a monitor that is no longer attached.
- Minimum size: derive from the layout's own needs once GEO-03 makes the panels
  proportional — the true minimum is "canvas still usable at the smallest panel
  widths", which the token system can express, rather than a guess.

**Platforms.** All three. On macOS also persist fullscreen state, since
fullscreen is a space and restoring into it is expected. On Linux, some WMs
ignore programmatic positioning; treat restore as a request, not a guarantee.

**Risks.** Restoring onto a disconnected display is the classic bug — validate.

---

#### NAT-11 — The mouse wheel always zooms; trackpad gestures are not understood

**Category** Native · **Severity** High · **Priority** P1 · **Affects** UX

**Current.** `onwheel` (`grid.js:352-365`) treats every wheel event as zoom:
`c.z *= Math.exp(-ev.deltaY * 0.0015)`. `ev.deltaX` is ignored entirely.
`ev.ctrlKey` is not checked. `ev.deltaMode` is not checked.

**Why it's a problem.** On macOS — and on Windows/Linux precision touchpads —
a two-finger swipe is a **scroll**, and the OS synthesises a *pinch* as a wheel
event with `ctrlKey: true`. Studio has this exactly backwards: two-finger
scrolling zooms wildly (and with inertia, so it keeps zooming after the fingers
lift), while pinch-to-zoom is indistinguishable from it. For a trackpad user
the canvas is close to unusable, and this is the most common way a Mac user
will first touch the app.

Additionally, `deltaY` is compared against a fixed factor without checking
`deltaMode`: `DOM_DELTA_LINE` (some Windows/Linux mice) and `DOM_DELTA_PAGE`
report in lines/pages, not pixels, so the same physical notch produces a
wildly different zoom step depending on the device.

**Recommended.**
```
wheel with ctrlKey        -> zoom about the pointer     (pinch, and Ctrl+wheel)
wheel without ctrlKey     -> pan by (deltaX, deltaY)    (two-finger / wheel)
shift+wheel               -> pan horizontally           (classic convention)
```
Normalise the delta by `deltaMode` first (`LINE → × line-height`,
`PAGE → × viewport`). Keep the exponential zoom curve — it is the right
model — but name the constant and express it as "zoom doubles per N pixels of
travel", which is a statement a reader can check, rather than `0.0015`.

**Platforms.** macOS is where this is worst. Windows precision touchpads behave
the same way. Traditional mice on all platforms send `ctrlKey: false`, so
Ctrl+wheel remains the conventional zoom there — which the rule above gives for
free.

**Depends on.** GEO-11 (naming the zoom constants).

**Risks.** Some Linux setups deliver horizontal scroll as buttons 6/7 rather
than `deltaX`; that arrives as a wheel event with a non-zero `deltaX` under
Chromium, so the rule still holds.

---

#### NAT-12 — Right-click erases, which collides with Ctrl-click on macOS and blocks a canvas menu

**Category** Native · **Severity** Medium · **Priority** P2 · **Affects** UX

**Current.** `grid.js:79` suppresses `contextmenu` on the canvas, and
`ondown` (`grid.js:380`) treats `button === 2` as "erase / delete entity".

**Why it's a problem.** On macOS, **Ctrl+click is a right-click** at the OS
level. A user Ctrl-clicking to get a context menu — the reflex on a
single-button trackpad — instead erases a block or deletes an entity. There is
also no canvas context menu at all, so the operations a user most expects to
find there (Delete Entity, Duplicate, Assign Script, Fit View, Toggle Grid) are
unreachable by that route.

**Recommended.**
- Keep right-drag-to-erase — it is a genuinely good level-editor gesture and
  the palette's air/eraser cell (`panel.js:29`) is the discoverable
  alternative.
- Add a **canvas context menu** on right-*click* without drag: if the pointer
  did not move between `mousedown` and `mouseup`, and the press did not modify
  anything, show the native menu (NAT-05) instead of treating it as an erase.
  This makes the two gestures distinguishable by intent rather than by button.
- On macOS specifically, do not treat `ctrlKey + button 0` as erase.
- Document the erase gesture in a status-bar hint on first hover of the canvas,
  and in Help.

---

#### NAT-13 — No cursor feedback anywhere

**Category** Native · **Severity** Medium · **Priority** P1 · **Affects** UI, UX

**Current.** `style.css:30` sets `cursor: default` on `body`; buttons and rows
get `cursor: pointer`. The **canvas never changes its cursor** — painting,
erasing, dragging an entity, and panning all show the same arrow.

**Why it's a problem.** The cursor is the primary modeless feedback channel in
a direct-manipulation editor. Without it the user cannot tell which tool is
active, that Alt will pan, that they are over an entity that can be dragged, or
that a drag is in progress.

**Recommended.** A cursor for each state, set on `#cv`:

| State | Cursor |
|---|---|
| Block tool over the level | `crosshair` |
| Air/eraser tool | `crosshair` (plus an eraser-tinted hover cell) |
| Entity tool | `copy` |
| Hovering an existing entity | `grab` |
| Dragging an entity | `grabbing` |
| Panning (middle/Alt held) | `grabbing` |
| Outside the level bounds | `not-allowed` |

**Implementation.** One `Grid.cursor()` that derives the value from
`{tool, hoverEntity, pan, moving, inBounds}` and writes it only when it
changes. Call it from `onmove` alongside the existing hover update. All of
these are standard CSS cursors, so each platform renders its own native
artwork.

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
2. `Escape` clears the selection but does **not** cancel an in-progress drag
   or paint stroke (UX-12).

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
   free once the rest of the token block (GEO-01) exists.
2. **`forced-colors: active`** (Windows High Contrast) — Chromium overrides
   colours wholesale; make sure the layout does not collapse and that
   canvas-drawn content, which forced colours cannot reach, gets a fallback
   outline. Currently untested and certain to be broken.
3. **`prefers-reduced-motion`** — currently vacuous (there are zero
   transitions), but VIS-09 adds some, and the media query must land in the
   same commit.
Also: `nativeTheme.on('updated')` must re-push `titleBarOverlay` colours on
Windows (NAT-02) if the OS accent/theme changes.

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
build a custom listbox (that would repeat NAT-05's mistake and cost the
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
Ensure the focus ring (A11Y-03) applies.

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

#### NAT-18 — Renderer hardening left on the table

**Category** Security · **Severity** Low · **Priority** P2 · **Affects** Architecture

**Current.** `webPreferences` is `{preload, contextIsolation: true,
sandbox: false}`. Missing: `setWindowOpenHandler`, `will-navigate` guard.

**Assessment.** `contextIsolation: true` and default-off `nodeIntegration` are
right, the preload surface is minimal and well-shaped, the CSP in
`index.html:2` is tight and correctly scoped (the `'unsafe-inline'` is confined
to `style-src`, which Monaco genuinely requires). Three cheap improvements:

1. **`sandbox: true`.** `sandbox: false` is present with no recorded reason.
   `preload.js` requires only `electron` and uses only `contextBridge` and
   `ipcRenderer` — all available in a sandboxed preload. Turn it on and verify:
   the app:// pages, the Monaco worker blob, and the preload should all be
   unaffected. If something does break, record *why* in a comment rather than
   silently leaving it off.
2. **`webContents.setWindowOpenHandler(() => ({action: 'deny'}))`** — nothing
   in Studio opens a window; deny by default so a stray `target=_blank`
   (Monaco's link handling can produce one) cannot spawn an uncontrolled
   BrowserWindow.
3. **`webContents.on('will-navigate', e => e.preventDefault())`** — closes the
   drag-and-drop navigation hole (NAT-09) and any accidental `location`
   assignment. BUG-01's own reload path is already guarded a different way
   (the menu's Reload item routes through the renderer's unsaved-changes
   check before calling `location.reload()`), but this hook is still the
   right backstop for navigation triggered by anything other than that one
   menu item.

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

#### NAT-20 — Only one of four scroll containers is styled

**Category** Native / Visual · **Severity** Medium · **Priority** P1 · **Affects** UI

**Current.** `style.css:153-156` styles `#hbar`'s scrollbar — height 12 px,
`--chrome` track, `#3b285b` thumb with a 3 px `--chrome` border and 6 px
radius, `--acc` on hover. **Four other elements scroll and are unstyled**:
`#scripts`, `#midis`, `#palette` (`overflow: auto`), and `#props`.

Measured in the running app: `#palette` has `scrollHeight 463` against
`clientHeight 438` — it scrolls today, at the default window size, with only
the built-in catalog loaded. The screenshot shows the resulting light-grey
system scrollbar running down the right edge of the purple panel.

**Why it's a problem.** It is the exact failure the brief names: one element
carefully themed, its siblings left default, which reads as unfinished. It is
also a **layout** problem, not only a cosmetic one: on macOS with "Show scroll
bars: Always" (and on Windows/Linux, where classic scrollbars are the default),
a 15 px classic scrollbar is subtracted from the palette's content width, so
the four fixed columns (GEO-07) get narrower on those platforms than on a Mac
with overlay scrollbars. The palette's geometry silently differs by platform
and by an accessibility setting.

**Recommended.**
1. One shared scrollbar treatment applied to a `.scroll` class (or to
   `#scripts, #midis, #palette, #props, #hbar` collectively), with the metrics
   coming from tokens rather than repeated literals.
2. Use `scrollbar-gutter: stable` on the vertical containers so the reserved
   width does not change between overlay and classic modes — this is what makes
   the layout platform-independent.
3. Keep the styling restrained: a themed scrollbar is fine in an editor, but it
   must still be the right *width* for the platform and must still respond to
   the OS's "always show" setting. Set `::-webkit-scrollbar` width from a token
   and do not fight the overlay behaviour.
4. Monaco has its own scrollbar implementation and its own theme keys
   (`scrollbarSlider.background` / `hoverBackground` / `activeBackground`) —
   currently unset in `code.js`'s `THEME`, so the editor's scrollbars are
   VS Code's defaults. Add them from the same tokens (VIS-18).

**Platforms.** macOS overlay scrollbars hide the problem for most Mac users and
expose it for anyone who has changed the setting; Windows and Linux see it
always.

---

#### NAT-21 — The unsaved-changes dialog is not written to any platform's convention

**Category** Native · **Severity** Medium · **Priority** P1 · **Affects** UX

**Current.** `main.js:135-142`:
```
dialog.showMessageBox(win, {
        type: 'warning', buttons: ['Save', 'Discard', 'Cancel'],
        defaultId: 0, cancelId: 2,
        message: '"' + name + '" has unsaved changes.'
});
```

**Problems.**
- **No `detail`.** Every platform's convention is a short bold `message` plus
  an explanatory `detail`; a one-line dialog with three buttons and no
  explanation of consequences is under-specified.
- **"Discard" is not the platform word.** macOS and Windows both use
  **"Don't Save"**. GNOME uses "Discard". Getting this right per platform costs
  one ternary.
- **Button order is hard-coded.** macOS wants the affirmative rightmost
  (Cancel, Don't Save, Save reading left→right, with Save default); Windows
  wants Save, Don't Save, Cancel; GNOME wants the destructive action leftmost.
  Electron reorders macOS buttons by `defaultId`/`cancelId` only partially —
  supply the order explicitly per platform.
- **No `noLink: true`**, so on Windows the buttons may render as command links
  rather than push buttons, which is not what a three-way save prompt should
  look like.
- The **document name** is quoted into `message` with no fallback beyond
  `'untitled'` from the caller (`app.js:401`), and no path context.

**Recommended.** Build the button array per platform, add a `detail`
("Your changes will be lost if you don't save them."), add `noLink: true`, set
`title` (used on Windows/Linux; ignored on macOS where it is a sheet), and
return a **string** verdict rather than an index (BUG-10).

**Platforms.** All three, differently — this is a textbook case for a single
`platformbuttons()` helper in main next to the other platform branching
(NAT-02), not a scattered `process.platform` check.

---

### 4.3 Layout and geometry (GEO)

The brief asks that arbitrary geometry be eliminated. This section identifies
every instance and states what should determine the value instead. The design
tokens that come out of it are collected in §6.

---

#### GEO-01 — There is no spacing, sizing or type scale

**Category** Design system · **Severity** High · **Priority** P0 · **Affects** UI, Maintainability

**Current.** Counted across `style.css`, the pixel literals are:

```
1px ×10   12px ×9   10px ×8   4px ×7   6px ×6   8px ×5   14px ×3
3px ×2    2px ×2    18px ×2   13px ×2  5px ×1   11px ×1  16px ×1
20px ×1   22px ×1   24px ×1   32px ×1  34px ×1  48px ×1
150px ×1  184px ×1  212px ×1  260px ×1
```

Twenty-three distinct values, of which 2, 3, 5, 11, 13, 14, 18, 22 and 34 are
one-offs. There is no relationship between them and nothing names them.

**Why it's a problem.** Every new component invents its own spacing, so
consistency has to be maintained by hand and cannot be. It is also the root
cause of most findings in §4.4: mismatched paddings, unaligned rows,
inconsistent gutters and inconsistent control heights are all downstream of
having no scale.

**Recommended.** One scale, derived from the type, since this is a
text-dominant tool UI:

```
--font-size:  12px            /* the design's body size */
--line:       18px            /* 12 × 1.5, the existing line-height */
--space-1:     2px            /* hairline separation, icon nudges  */
--space-2:     4px
--space-3:     6px
--space-4:     8px            /* the base gutter                   */
--space-5:    12px            /* = --font-size; panel padding      */
--space-6:    16px
--space-7:    24px
```
A 2/4/6/8/12/16/24 progression: dense enough for a tool UI, coarse enough that
neighbouring steps are visibly different. Not a geometric series for its own
sake — the steps are the ones the design actually uses, deduplicated.

Control heights derive from the line box:

```
--row-sm: calc(var(--line) + var(--space-2) * 2)   /* 22px — status bar     */
--row:    calc(var(--line) + var(--space-3) * 2)   /* 30px — list rows      */
--row-lg: calc(var(--line) + var(--space-4) * 2)   /* 34px — title bar, tabs*/
```
This replaces `--bar: 34px` (which becomes `--row-lg`, and is now *explained*),
`--tabs: 32px`, `.hdr` 24 px, `#status` 22 px, and the `li` padding — five
unrelated numbers become three named rows with a stated origin.

**Implementation.** Introduce the tokens, then convert one component per
commit, deleting literals as you go. When a literal resists conversion, that is
a finding: either the scale is wrong or the component is.

---

#### GEO-02 — Chrome band heights are unrelated to each other and to the type

**Category** Layout · **Severity** Medium · **Priority** P1 · **Affects** UI

**Current.** `--bar: 34px` (title), `--tabs: 32px` (tab strip), `.hdr`
`flex: 0 0 24px` (section headers), `#status` `flex: 0 0 22px`, `#hbar`
`flex: 0 0 13px`. The 12 px/1.5 body text gives an 18 px line box; none of the
five is 18 plus a symmetric padding.

Specifically, `.hdr` at 24 px gives 3 px of leading above and below an 18 px
line — visually tight and not a value on any scale. `#status` at 22 px with
11 px text (`style.css:249`) gives a 16.5 px line box in 22 px — 2.75 px
leading, a fractional number that lands text on a half-pixel.

**Recommended.** As GEO-01: `--row-lg` for the title bar and tab strip,
`--row-sm` for section headers and the status bar, computed from the line box
so text is always vertically centred on a whole pixel. The scrollbar band
becomes `--scrollbar` (see GEO-09).

---

#### GEO-03 — Side panels are fixed pixel widths and consume 41 % of the minimum window

**Category** Layout · **Severity** High · **Priority** P1 · **Affects** UI, UX

**Current.** `--side: 184px`, `--right: 212px`, applied as
`flex: 0 0 var(--side)` / `flex: 0 0 var(--right)`. Measured in the running
app: `184 / 212 / win 1600` — 11.5 % and 13.25 % at the default size. At the
declared minimum window width of 960 px they become **19.2 % and 22.1 %,
together 41.3 %**, leaving the canvas 563 px — roughly five and a half tiles at
100 % zoom.

**Why it's a problem.** The canvas is the document. Fixed side panels mean the
document's share of the window shrinks exactly when the window is smallest and
the document needs it most.

**Evidence for the intended proportion.** The design file
(`Pellizzola Brothers.svg`, a 3 146 × 990 canvas holding two window mock-ups)
places the window at x 48 → 1552 (1 504 wide), the left sidebar at x 48 → 205
(**157 px = 10.44 %**) and the right panel at x 2 901 → 3 098 within the second
mock-up's 1 505 px window (**197 px = 13.09 %**). The implementation's ratios
at the default size (11.5 % / 13.25 %) are close to the design's — the *ratio*
was the design intent; freezing it into pixels is what broke it.

**Recommended.** Express panel widths as clamped percentages of the body:

```
#side  { flex: 0 0 clamp(var(--side-min), 10.5%, var(--side-max)); }
#right { flex: 0 0 clamp(var(--right-min), 13%,  var(--right-max)); }
```

- The **percentage** is the design's proportion, now stated as such.
- The **minimum** is content-driven: the width at which the palette still fits
  its integer-sized cells (GEO-07) and a script name is still legible —
  a computable number, not a guess.
- The **maximum** stops the panels ballooning on an ultrawide display, where a
  13 % right panel would be 500 px of empty inspector.

Then make them **user-resizable** (GEO-04) and persist the user's choice, which
overrides the proportion once set — the proportion is the *default*, not a
cage.

---

#### GEO-04 — Panels cannot be resized

**Category** Layout / UX · **Severity** High · **Priority** P1 · **Affects** UI, UX

**Current.** No splitters exist. The file manager, canvas and inspector widths
are fixed by CSS; the scripts/MIDI split and the palette/inspector split are
fixed percentages (GEO-05, GEO-06).

**Why it's a problem.** This is the single most requested affordance in any
editor with side panels, and its absence is felt constantly: a level author
working on scripts wants a wide file list; one placing tiles wants the panels
out of the way. Every comparable tool — VS Code, Aseprite, Tiled, Blender —
has draggable splitters.

**Recommended.** Four splitters: `#side | #stage`, `#stage | #right`,
`#scripts | #midis`, `#palette | #props`.

**Implementation.** Convert `#body` to CSS Grid with named columns
(`grid-template-columns: var(--side-w) var(--split) 1fr var(--split)
var(--right-w)`), and the two `aside`s to grid rows likewise. A splitter is a
`<div role="separator" tabindex="0" aria-orientation="vertical"
aria-valuenow=…>`; pointer-drag updates the custom property; **arrow keys move
it too** (that is what makes `role="separator"` honest and the layout
keyboard-accessible). Double-click resets to the design proportion. Persist to
`localStorage` — this is per-user view state, not document state, so it must
not go anywhere near the `.lvl`.

The splitter's hit area must be larger than its visual width: a 1 px rule with
a 6–8 px transparent grab zone, and `cursor: col-resize` / `row-resize`
(NAT-13). Constrain against the min/max from GEO-03.

**Risks.** `Grid.resize()` is driven by a `ResizeObserver` on `#wrap`
(`grid.js:75`), so the canvas follows automatically — but every drag frame
reallocates the canvas backing store (PERF-04). Fix PERF-04 in the same change
or dragging a splitter will stutter.

---

#### GEO-05 — `#scripts` 60 % / `#midis` 40 % is arbitrary and ergonomically backwards

**Category** Layout · **Severity** Medium · **Priority** P2 · **Affects** UI, UX

**Current.** `style.css:116-117` — `#scripts { flex: 1 1 60% }`,
`#midis { flex: 1 1 40% }`.

**Why it's a problem.** Both fractions are unexplained, and the split ignores
content entirely. A level typically has a handful of scripts and zero or one
MIDI files; the screenshot shows the consequence — the `midi` header sits at
the vertical centre of the panel with two large empty regions above and below
it, in a brand-new document with nothing in either list. Forty per cent of the
file manager is permanently reserved for a list that is usually empty.

**Recommended.** Content-driven with a floor and a ceiling:
```
#scripts, #midis { flex: 0 1 auto; min-height: calc(var(--row) * 3); }
#scripts { max-height: 70%; }
```
so each section is as tall as its contents, both stay scrollable, neither can
collapse to nothing, and the free space goes to whichever list is longer.
Combined with the `#scripts | #midis` splitter (GEO-04) and collapsible section
headers (a disclosure triangle on `.hdr`), which also gives the empty MIDI
section somewhere to go.

**Depends on.** VIS-12 (empty states) — an empty list should say so, not be a
void.

---

#### GEO-06 — `#props { flex: 0 1 46% }` is an unexplained fraction

**Category** Layout · **Severity** Low · **Priority** P2 · **Affects** UI

**Current.** `style.css:191`. The inspector takes 46 % of the right column;
the palette takes the rest.

**Evidence of intent.** The design splits the right panel at y = 486 within a
body running 122 → 815: items 364 px (52.5 %), properties 329 px (47.5 %).
So 46 % is an approximation of a design value that was never written down.

**Recommended.** Either state the design ratio as a named token
(`--right-split: 47.5%`, with a comment pointing at the SVG), or — better —
make it content-driven like GEO-05: the inspector is as tall as its fields,
the palette takes the remainder, with a splitter and a minimum. The inspector's
height genuinely varies (the level view has seven controls, the entity view
has six, the definition view three), so a fixed fraction is wrong for at least
two of the three states.

---

#### GEO-07 — The palette produces fractional cells for 32 px sprites

**Category** Layout / Visual · **Severity** High · **Priority** P1 · **Affects** UI

**Current.** `style.css:163-171` — `grid-template-columns: repeat(4, 1fr)`,
`gap: 4px`, `padding: 8px`, inside a 212 px panel. `.cell` has
`aspect-ratio: 1` and `background: … center/contain no-repeat` with
`image-rendering: pixelated`.

Measured in the running app: `gridTemplateColumns: "42.25px 42.25px 42.25px
42.25px"`. Every source sprite is **32 × 32** (verified for
`blocks/bricks.png`, `enemies/chapeleira.png`, `interactives/pizza.png`,
`icons/placeholder.png`).

**Why it's a problem.** 42.25 / 32 = **1.3203125**. Scaling pixel art by a
non-integer factor with `image-rendering: pixelated` means each source pixel
occupies either one or two destination pixels depending on where it falls —
so the sprites in the palette have visibly uneven pixel widths, and the
unevenness *shifts* whenever the panel width changes. Worse, `.25` of a pixel
means the cells do not sit on device-pixel boundaries at all, so the borders
(`.cell:hover`, `.cell.on`) are drawn at fractional positions and antialias to
grey. This is precisely the failure the canvas renderer goes to great lengths
to avoid (`grid.js:238-244` snaps every tile edge to a whole device pixel) —
the palette undoes it three inches to the right.

**Recommended.** Size the cells at an **integer multiple of the sprite**, and
let the column count follow from the panel width:

```
--sprite: 32px;                      /* every texture is 32×32 */
--cell:   calc(var(--sprite) * 1);   /* or ×2 for a large palette */
#palette { grid-template-columns: repeat(auto-fill, var(--cell)); }
```
With `auto-fill` the palette gains a column when the panel is widened
(GEO-04) instead of stretching its cells, which is also the correct
*behavioural* answer: a palette should show more items when given more room,
not bigger ones. Add `justify-content: space-between` (or `start` with the
gap token) so the leftover space is distributed between columns, not inside
cells.

Offer 1× and 2× cell sizes as a view preference — pixel art at 32 px is small
on a HiDPI display, and this is the one place where a user-configurable size is
genuinely warranted (UX-11).

**Depends on.** GEO-01 (tokens), GEO-03 (panel min width must accommodate at
least three columns plus padding and the scrollbar gutter, NAT-20).

---

#### GEO-08 — Assorted one-off dimensions

**Category** Layout · **Severity** Low · **Priority** P2 · **Affects** UI

Each of these is a single literal with no stated origin. Collected rather than
given its own finding.

| Value | Location | What should determine it |
|---|---|---|
| `max-width: 260px` on `.tab` | `style.css:79` | A character count (`ch` units) — tabs hold filenames, so `max-width: 24ch` is a statement about content; 260 px is not. Add `min-width` too, so a one-character name is not a sliver. |
| `min-width: 150px` on `#menu` | `style.css:227` | Moot — the menu becomes native (NAT-05) and the OS sizes it. |
| `2` / `4` px clamps in `menu()` | `app.js:175-176` | Moot with NAT-05; until then, one `--menu-margin` token, and *flip* rather than clamp near an edge. |
| `height: 48px` on `#props textarea` | `style.css:208` | `calc(var(--line) * 3)` — "three lines of description", which is a decision; 48 px is 2.67 lines, which is not. |
| `width: 12px; height: 12px` on `.dots i` | `style.css:57` | Moot — real traffic lights (NAT-02). |
| `gap: 8px` on `.dots`, `gap: 14px` on `.acts`, `gap: 10px` on `#title`, `gap: 18px` on `#status`, `gap: 6px` on `li`, `gap: 8px` on `.tab` | `style.css` passim | All become spacing tokens. Six different gutters in one title bar and status bar is the definition of unsystematic. |
| `padding: 1px 10px 1px 18px` on `li` | `style.css:123` | Asymmetric top/bottom (1 px) gives a 20 px row — below the 24 px minimum hit target (A11Y-08). The 18 px left indent is a hanging indent with no icon to hang; once rows get a file-type icon (VIS-12) the indent becomes `--space-4 + --icon`. |
| `font-size: 10px` on `.grp`, `.hint`, `#props h4`; `11px` on `#status`; `13px` on `.run` | `style.css` passim | Four ad-hoc sizes below the 12 px body. Two are enough: `--font-size` and `--font-size-sm` (11 px). 10 px is below the practical legibility floor for a UI face and should go. |

---

#### GEO-09 — The horizontal scrollbar band is three mismatched numbers

**Category** Layout · **Severity** Low · **Priority** P2 · **Affects** UI

**Current.** `#hbar { flex: 0 0 13px; border-top: 1px solid var(--line) }`
with `#hbar::-webkit-scrollbar { height: 12px }` and a thumb with
`border: 3px solid var(--chrome)` and `border-radius: 6px`. Measured height:
13 px. So: 13 = 12 + 1 border, and the thumb's visible height is 12 − 6 = 6 px,
matching the 6 px radius by coincidence rather than by construction.

**Recommended.** One token, one relationship:
```
--scrollbar:      12px;                          /* track thickness */
--scrollbar-pad:   3px;                          /* inset around the thumb */
--scrollbar-thumb: calc(var(--scrollbar) - var(--scrollbar-pad) * 2);
   /* radius = thumb / 2, i.e. a capsule, stated as such */
```
Shared with the other four scroll containers (NAT-20) so all five agree.

---

#### GEO-10 — There is no vertical scrollbar for the level

**Category** Layout / UX · **Severity** Medium · **Priority** P2 · **Affects** UI, UX

**Current.** `#hbar` gives the level a real horizontal scrollbar
(a genuinely good decision — `CLAUDE.md` explains the reasoning and it is
sound). There is no vertical equivalent, even though `Grid.setheight()`
(`grid.js:134`) permits up to **999 rows**. Vertical navigation is
middle-drag, Alt-drag, or the wheel — which currently zooms rather than scrolls
(NAT-11).

**Why it's a problem.** Asymmetry that the user cannot explain: one axis has a
scrollbar and shows its position, the other has neither. On a 200-row level
there is no indication of where in the level the viewport is.

**Recommended.** Mirror the `#hbar` mechanism on the vertical axis, using the
same spacer technique and the same `Grid.syncbar()` reconciliation. `Grid.clamp()`
already maintains a well-defined vertical range (`grid.js:177-179`), including
the "shorter than the viewport" case, so the range the bar must represent
already exists. Hide it (`visibility: hidden`, not `display: none`, so the
layout does not shift) when the level fits the viewport.

**Depends on.** NAT-11 (once the wheel scrolls, the vertical bar has something
to reflect).

---

#### GEO-11 — Canvas magic numbers

**Category** Layout / Code quality · **Severity** Medium · **Priority** P1 · **Affects** UI, Maintainability

`grid.js` is the best-reasoned file in the project, and it still carries eight
unnamed constants:

| Literal | Location | What it means / what should determine it |
|---|---|---|
| `2 * B` in `Grid.fit()` | `grid.js:163` | One block of margin above and below the level. Name it `FITPAD = B` and write `Grid.h * B + 2 * FITPAD`, which then reads as the sentence it is. |
| `0.03` and `1` in `Grid.fit()` | `grid.js:163` | Minimum and maximum fit zoom. The maximum of 1 means "never fit *above* 100 %", which is a real decision worth stating; 0.03 is the same floor as the wheel clamp and should be one shared `ZMIN`. |
| `0.03` and `3` in `onwheel()` | `grid.js:361` | `ZMIN`/`ZMAX`. Derive `ZMIN` from something real: the zoom at which the whole 540-column level fits the narrowest supported viewport (`minWidth − panels`) — currently 0.03 is *below* that, so the user can zoom out into empty space. |
| `0.0015` in `onwheel()` | `grid.js:361` | Zoom sensitivity. Express as a halving distance: `Math.LN2 / ZOOM_PX_PER_DOUBLING`, with `ZOOM_PX_PER_DOUBLING = 462` reproducing today's feel — a number a reader can reason about and tune. |
| `B * z >= 10` grid-line threshold | `grid.js:257` | "Stop drawing grid lines once tiles are smaller than 10 device px." A legitimate decision; name it `GRIDMIN` and comment *why* (below this the lines outweigh the content). |
| `sx + 1, sy + 1, s - 2, s - 2` selection inset | `grid.js:277` | Half of `lineWidth: 2`, so the 2 px stroke lands inside the tile. Derive it: `const w = SELW; strokeRect(sx + w/2, …, s - w)`. |
| `+ .5` offsets | `grid.js:261-262, 287, 292` | Correct and idiomatic — a 1 px canvas stroke centred on a half-pixel. Keep; add a one-line comment, as it is the one magic number here that *should* stay. |
| `1` px tolerance in `syncbar`/`onbar` | `grid.js:191, 199` | The documented re-entrancy tolerance (`CLAUDE.md` explains the reasoning, which is good). Name it `BARSLOP = 1` so both sites provably use the same value. |

**Recommended.** A `const` block at the top of `grid.js` with a comment per
entry, in the style the file already uses for `B` and `W` in `catalog.js`.
None of these should become a formula; they should become named, explained
constants. That is the distinction the brief draws, and this is the file where
it matters most.

---

#### GEO-12 — Initial and minimum window size are not derived from the display

Covered as **NAT-10**; listed here because it is also a geometry finding. The
short version: `1600 × 950` and `960 × 620` are four literals in `main.js:37`
that should come from `screen.getPrimaryDisplay().workAreaSize` and from the
layout's own content minimums respectively.

---

#### GEO-13 — Design-file proportions that were not carried over

**Category** Layout / Visual · **Severity** Low · **Priority** P3 · **Affects** UI

Parsed from `Pellizzola Brothers.svg`, three deliberate design decisions are
absent from the implementation:

1. **Rounded top corners on the chrome.** The design's tab-strip band is
   `M48 111C48 96.64 59.64 85 74 85H205V122H48V111Z` — a **26 px corner
   radius** at the top of the window, and a matching 26 px flare on the right
   edge of the active tab (`M463 85H469C483.36 85 495 96.64 495 111V122H463V85Z`).
   The implementation has square corners everywhere and no radius token at all
   (VIS-09). Whether to adopt the 26 px window radius depends on NAT-02 (with
   `hiddenInset`/`titleBarOverlay` the OS owns the window's corners, and
   `roundedCorners` handles macOS); the **tab flare** is purely internal and
   should be honoured.
2. **A 36 px section-header band** (`122 → 158` in every panel). The
   implementation uses 24 px (`style.css:107`), which is why the headers read
   as cramped labels rather than as the panel headers the design draws.
3. **Panel elevation.** The design wraps both side panels in
   `filter0_dd`/`filter1_dd` drop-shadow filters, separating them from the
   frame. The implementation has one shadow in the entire app, on the context
   menu (VIS-09).

**Recommended.** Reconcile deliberately: adopt (2) and (3) via the radius and
elevation tokens; adopt the tab flare from (1); document any conscious
departure in `CLAUDE.md`'s "Deviations from the design file" section, which
already exists for exactly this purpose and is the right home for the record.

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

**Assessment.** The dot colours become moot with NAT-02 (real traffic lights
have the OS's colours, which is the point). The **accent** divergence is the
one that matters: `#7b56ba` is not the design's `#7E58BE`, nobody recorded why,
and the design also uses a second, lighter accent `#815AC1` for filled
elements that the implementation has no equivalent of.

**Recommended.** Pick one accent deliberately. The contrast retune already
shipped `--acc` (non-text, 3:1) and `--acc-text` (text, 4.5:1) — see "Already
completed" — so what is left is recording the mapping to the design's
`#7E58BE` / `#815AC1` in `CLAUDE.md`. Then update the SVG or the deviations
note so the two artefacts agree — a design file that silently disagrees with
the build is worse than no design file.

---

#### VIS-04 — Colour is defined in four independent places

**Category** Design system · **Severity** High · **Priority** P1 · **Affects** Maintainability, UI

**Current.** The palette exists in four unconnected forms:

1. `style.css :root` — nine tokens.
2. **Literals in `style.css`** — `#17102a` (×4: `.cell` background, form field
   background, `#menu` background, and again inline in `app.js:217`),
   `#3b285b` (scrollbar thumb), `#251a3a` (`.cell.on`), `#1d1530`/`#120d1f`
   (the air checkerboard), `#ff8f8f` (×2: `.err`, `#msg.bad`).
3. **Literals in `grid.js`** — `#0b0813` (canvas clear, line 228),
   `rgba(123,86,186,.14)` (grid lines — `--acc` in decimal, line 258),
   `#7b56ba` (selection ring — `--acc` again, as a literal, line 275),
   `rgba(123,86,186,.5)` (level bounds, line 290),
   `rgba(200,170,255,.75)` (hover cell, line 285), `#4a3a6a` / `#803050`
   (missing-texture swatches, line 304).
4. **`code.js` `THEME`** — eleven more literals hand-transcribed for Monaco
   (`b9a6d6`, `150f24`, `1a122c`, `2e2049`, `7b56ba`, `3b285b`, `1e1633`…),
   two of which (`b9a6d6`, `7b56ba`) are `--fg` and `--acc` duplicated a third
   time.

Plus `backgroundColor: '#1c1d20'` in `main.js:38`, a fifth copy of `--frame`.

**Why it's a problem.** Changing the accent — which the VIS-01 retune already
had to do once, see "Already completed" — means finding and editing it in five
files, with no way to know you got them all. `rgba(123,86,186,.14)` will not be
found by a search for `#7b56ba`.

**Recommended.** One source of truth, consumed three ways:

1. `style.css :root` remains the **definition**, extended with the missing
   surfaces (`--surface-raised: #17102a`, `--canvas-bg: #0b0813`,
   `--danger: #ff8f8f`, `--scroll-thumb`, `--checker-a/b`, `--missing-tex`,
   `--missing-def`).
2. A tiny `tokens.js` reads them **once** at startup via
   `getComputedStyle(document.documentElement).getPropertyValue()`, caching
   into a plain object with numeric variants where the canvas needs alpha
   (`rgba(var(--acc-rgb), .14)` — store the accent as an `r, g, b` triple so
   both CSS and canvas can compose alpha from one definition). `grid.js` reads
   from that object. Re-read on `nativeTheme` change if NAT-15 ever adds one.
3. `code.js`'s `THEME` is **generated** from the same object rather than
   transcribed.
4. `main.js`'s `backgroundColor` is the one legitimate duplicate — it must be
   known before the page loads — so keep it, with a comment naming `--frame` as
   its source and a note that the two must be changed together. That is the
   documented-exception pattern the brief asks for.

---

#### VIS-05 — The application has never been rendered in its own typeface

**Category** Visual · **Severity** High · **Priority** P1 · **Affects** UI

**Current.** `style.css:28` — `font: 12px/1.5 'JetBrains Mono',
'DejaVu Sans Mono', ui-monospace, monospace`. `code.js:48` repeats a variant of
the same stack for Monaco. Neither font is bundled; there is no `@font-face`
anywhere and no font file in the tree.

**Evidence.** Measured in the running app with a canvas metrics probe on the
string `mmmmmmmmmmlli` at 12 px:

```
"JetBrains Mono"     103.341796875
"DejaVu Sans Mono"   103.341796875
"ui-monospace"       103.341796875
"monospace"          103.341796875
"NoSuchFontXYZ"      103.341796875
```

Identical to the last decimal, including for a deliberately non-existent
family. Every entry falls through to the platform default.

**Why it's a problem.** The design is specified in JetBrains Mono; the app has
never been seen in it. Worse, the fallback differs by platform — macOS resolves
`monospace` to Menlo/SF Mono, Windows to Consolas, Linux to whatever
fontconfig picks — so the app's metrics, weight and character width differ on
every platform, which cascades into every `ch`-based or text-width-dependent
layout decision made afterwards.

**Recommended.** Bundle the font. JetBrains Mono is OFL-licensed, so
redistribution is permitted with the licence file included.

**Implementation.**
1. Add `fonts/JetBrainsMono-Regular.woff2` (and `-Bold` if any weight above 400
   is ever used — currently `font-weight: normal` is forced in two places,
   `style.css:87` and `:129`, which is itself a smell: `<b>` is being used for
   layout and then de-bolded. Use a `<span>` and delete the override).
2. `@font-face { font-family: 'JetBrains Mono'; src: url(fonts/…) format('woff2');
   font-display: block; }` — `block` rather than `swap`, because a reflow of
   the entire chrome after first paint is worse than a few milliseconds of
   invisible text in a local app with a local font.
3. The CSP already permits it: `font-src 'self' app: data:` (`index.html:2`).
4. Keep the fallback stack for safety, but it should now never be reached.
5. Point Monaco at the same family (`code.js:48` already does) so the editor
   and the chrome match — today they both fall back, so they match by accident.
6. Include the OFL licence in the repo and in the packaged app (NAT-07).

**Risks.** ~90 KB per weight. Subset to Latin + the few glyphs the UI uses
(`×`, `▶`, `+`) if size matters; measure first.

---

#### VIS-07 — There is no interaction-state system

**Category** Visual · **Severity** Medium · **Priority** P1 · **Affects** UI

**Current.** The only interaction state in the entire application is `:hover`,
and it is always the same mechanism: swap the text colour from `--dim` to
`--fg`. There is:

- no `:active` / pressed state on any control;
- no distinct **selected** state — `li.on`, `.tab.on` and `.cell.on` each use
  a different mechanism (colour only; colour + background; border + background)
  for the same semantic;
- a **disabled** state that is only `opacity: .35` (`style.css:41`), applied
  to a colour that already fails contrast — the disabled `▶` button computes
  to roughly **1.5:1**, effectively invisible (A11Y-08);
- `.mi.off` compounding it further: `color: var(--dim)` *and* `opacity: .45`,
  landing near **1.3:1**.

**Recommended.** A five-state contract, applied identically to every
interactive surface (rows, tabs, palette cells, buttons, menu items):

| State | Treatment |
|---|---|
| rest | `--fg` text on the surface colour |
| hover | surface tint (`--surface-hover`), text unchanged |
| active/pressed | deeper tint, no transform |
| selected | `--acc-text` text + `--surface-selected` + a 2 px accent marker on the leading edge |
| focus-visible | the ring already shipped (VIS-06, see "Already completed"), composable with any of the above |
| disabled | `--fg-disabled` at ≥3:1, **plus** `cursor: default`, **plus** `aria-disabled`; never opacity alone |

Selected-and-focused must be distinguishable from selected-alone — that is what
the composable ring buys.

---

#### VIS-08 — There is no motion at all

**Category** Visual · **Severity** Low · **Priority** P2 · **Affects** UI

**Current.** Zero `transition`, `animation` or `@keyframes` declarations in
`style.css` (verified by grep). Every state change — hover, tab switch, panel
show/hide, menu open — is an instantaneous swap.

**Why it's a problem.** Not because animation is inherently good; because
instantaneous changes give the eye nothing to track, which is what makes an
interface feel abrupt rather than responsive. A 100 ms tint on hover is the
difference between a control that acknowledges the pointer and one that
flickers.

**Recommended.** Deliberately minimal, tokenised:
```
--dur-fast: 90ms;    /* hover/active tints, focus ring        */
--dur:     140ms;    /* panel and tab transitions             */
--ease:    cubic-bezier(.2, 0, 0, 1);   /* standard decelerate */
```
Apply to: hover/active/selected background tints, the focus ring, the inline
rename field appearing, the status-bar message changing, and panel show/hide.

**Do not animate:** the canvas (it is redrawn on `requestAnimationFrame`
already, and the camera should stay 1:1 with the pointer), tab content swaps,
or anything on the save path.

**Mandatory companion:**
```
@media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { transition-duration: 1ms !important;
                                 animation-duration: 1ms !important; }
}
```
This must land in the same commit as the first transition, not later.

---

#### VIS-09 — No radius, border-width or elevation scale

**Category** Design system · **Severity** Medium · **Priority** P2 · **Affects** UI

**Current.** Radius: `50%` (the dots) and `6px` (the scrollbar thumb). That is
the complete set — every other surface in the application is a hard rectangle.
Elevation: one shadow, `0 6px 20px rgba(0, 0, 0, .55)`, on `#menu`. Border
width: `1px` everywhere except the 2 px canvas selection ring.

The design file, by contrast, specifies a 26 px window/tab radius, 1 px `rx` on
the inspector's small controls, and drop-shadow filters on both side panels
(GEO-13).

**Recommended.**
```
--radius-1: 2px;   /* inputs, palette cells, small controls   */
--radius-2: 4px;   /* buttons, menu, popovers                 */
--radius-3: 8px;   /* dialogs / overlays if any appear        */
--border:   1px;
--border-strong: 2px;   /* focus ring, canvas selection       */
--elev-1: 0 1px 2px rgba(0,0,0,.4);        /* panels          */
--elev-2: 0 6px 20px rgba(0,0,0,.55);      /* menus, popovers */
```
Three radius steps is enough; more is decoration. Two elevations is enough,
because the app has exactly two layers above the surface.

**Note.** With NAT-05 the context menu becomes native and `--elev-2` loses its
only consumer — keep the token for future popovers, or drop it. Prefer
dropping it until something needs it.

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

**Why it's a problem.** Text glyphs inherit the text font, so they change shape
with the fallback (VIS-05), do not align optically with adjacent labels, cannot
be sized independently of the text, and centre inconsistently — visible in the
screenshot, where the palette's `+` sits low in its cell.

**Recommended.** A small inline-SVG icon set with one size token
(`--icon: 16px`) and `currentColor` fill, so icons take the text colour and
therefore participate in the state system (VIS-07) for free. Use SVG, not the
PNGs: `textures/icons/*.png` are 32 px pixel-art assets meant for the *game's*
UI, and scaling them into a 16 px chrome button will alias (the same fractional
scaling problem as GEO-07). Where a pixel-art icon is genuinely wanted, size it
at exactly 16 or 32 px with `image-rendering: pixelated`.

Needed icons: new, open, save, save-as, new-script, import, close, play,
script-file, midi-file, block, entity, warning, error.

---

#### VIS-12 — Empty states are blank voids

**Category** Visual / UX · **Severity** Medium · **Priority** P1 · **Affects** UI, UX

**Current.** With a fresh document — the state the app *always starts in*
(`app.js:543`) — `#scripts` and `#midis` are empty `<ul>`s occupying 60 % and
40 % of a 184 px column (GEO-05). The screenshot shows the result: two large
empty purple regions with a floating `midi` header between them, and no
indication that anything can be put there or how.

`#props` in its level view is never empty, and the palette never is, so this is
confined to the file manager — but it is the first thing a new user sees.

**Recommended.** An empty-state block per list: one line of secondary text
naming what goes there and one affordance to create it —
"No scripts yet · **New script**", "No MIDI files · **Import…**" — centred in
the list's minimum height, using `--dim` (already readable — the VIS-01
retune is shipped, see "Already completed") at `--font-size-sm`. Not an
illustration; one line and one link.

**Depends on.** GEO-05 (so the empty state sits in a sensibly-sized region).

---

#### VIS-13 — The playtest button is permanently disabled and explains itself only in a tooltip

**Category** Visual / UX · **Severity** Low · **Priority** P2 · **Affects** UI, UX

**Current.** `index.html:23-24` — a `▶` button, `disabled`, with
`title="Playtest is inert: the game cannot load .lvl archives yet
(game/todo.txt 3.1)"`. Rendered at `opacity: .35` over `--acc`, it computes to
roughly 1.5:1 — a barely-visible glyph in the corner of the tab strip
(confirmed in the screenshot).

`CLAUDE.md` documents the reasoning and it is honest: the button renders per
the design, and the game genuinely cannot load `.lvl` yet (`game/todo.txt`
step 3.1, minizip + jansson).

**Recommended.** Keep it, fix its communication:
1. A disabled control the user cannot ever enable should say why **without
   hovering**. Give it a visible "soon" affordance or move it behind a
   `View → Playtest` menu item that is disabled with an explanatory
   `toolTip` — native menus support disabled items with tooltips and are the
   right home for a not-yet-implemented command.
2. `aria-disabled` plus `aria-describedby` pointing at the explanation, so the
   reason reaches a screen reader (A11Y-08).
3. Raise the disabled contrast to ≥3:1 (VIS-07).
4. When the game does gain `.lvl` support, the implementation is: write the
   document to `app.getPath('temp')`, spawn the game binary with it, and stream
   its stderr into the status bar. Worth recording in `CLAUDE.md` next to the
   existing note so the eventual implementer does not have to rediscover it.

---

#### VIS-14 — Status messages are transient information rendered permanently

**Category** Visual / UX · **Severity** Low · **Priority** P2 · **Affects** UX

**Current.** `App.say()` (`app.js:19-24`) writes to `#msg` and nothing ever
clears it. `saved /Users/…/level.lvl` stays on screen for the rest of the
session. Errors and successes use the same slot, distinguished only by
`#msg.bad` turning the text `#ff8f8f`.

**Recommended.**
- Transient confirmations ("saved", "imported 3 files", "undo") auto-clear
  after ~4 s, with the transition from VIS-08.
- **Errors do not auto-clear** — they persist until the next action, and they
  get an icon plus the `--danger` colour, not colour alone (a colour-only
  distinction fails WCAG 1.4.1).
- Add `aria-live="polite"` to `#msg` and `aria-live="assertive"` for errors so
  the message is announced (A11Y-05).
- The status bar should also carry **persistent** information that currently
  has nowhere to live: zoom percentage, level dimensions, entity count, and the
  active tool (UX-06). Separate the persistent fields from the transient
  message slot with a divider so they do not compete.

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
  surfacing (BUG-11).

Name both colours as tokens if they survive.

---

#### VIS-18 — The Monaco theme is a fifth, drifting copy of the design

**Category** Visual · **Severity** Medium · **Priority** P2 · **Affects** UI, Maintainability

**Current.** `code.js:10-26` defines eleven colour keys by hand. Two of them
(`#b9a6d6`, `#7b56ba`) duplicate `--fg` and `--acc`; the rest
(`#150f24`, `#2e2049`, `#1e1633`) are values that exist nowhere else in the
app — so the editor's background is a *different* dark violet from every panel
around it.

Unset keys fall through to `vs-dark`'s defaults, which is why the editor's
scrollbars (NAT-20), find widget, suggestion list, bracket-match highlights,
error squiggles and selection-match highlights are all VS Code blue inside a
purple application.

**Recommended.**
1. Generate `THEME` from the token object (VIS-04).
2. Set the keys that currently leak VS Code's defaults into a themed app:
   `scrollbarSlider.*`, `editorWidget.border`, `editorSuggestWidget.*`,
   `list.hoverBackground`, `list.activeSelectionBackground`,
   `editorBracketMatch.*`, `editor.selectionHighlightBackground`,
   `editorError.foreground`, `editorWarning.foreground`, `focusBorder`.
3. Align `editor.background` with the surface it sits in — currently `#150f24`
   floats between `--panel` `#100a1a` and `--tab` `#1a122c` for no reason.
4. Set Monaco's own options to match the chrome: `lineHeight` from `--line`,
   `fontSize` from `--font-size`, and `renderLineHighlight` consistent with the
   app's selection treatment.

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
nothing to discoverability because the menu still exists. Also make Return open
the focused row once rows are focusable (A11Y-01).

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

#### UX-04 — Zoom has no controls, no indicator, and no fit-width

**Category** UX · **Severity** Medium · **Priority** P1 · **Affects** UX

**Current.** Zoom is wheel-only (NAT-11). There is no numeric indicator, no
zoom in/out command, no 100 % command, and `Grid.fit()` fits the **height**
only (`grid.js:163`).

**Why fit-height alone is a problem.** A level is 540 columns × 100 px = 54 000
world pixels wide. In the measured default window, `Grid.fit()` on a 12-row
level produced `z = 0.606`, at which the visible canvas (1 204 CSS px) shows
1 204 / 0.606 ≈ 1 986 world px — **3.7 % of the level's width**. The user's
first view of any level is a narrow slice, with no overview and no indication
that 96 % of the level is off-screen to the right.

**Recommended.**
- **Zoom indicator** in the status bar showing the percentage, clickable to
  open a menu of 25/50/100/200 % and Fit.
- **Commands** for zoom in/out (⌘+/⌘−), 100 % (⌘0 or ⇧⌘0), Fit Height, Fit
  Width, Fit All — in a new View menu, following the same `cmd`/`ACTS`
  dispatch the shipped menu (NAT-01, see "Already completed") already uses for
  File and Edit; there is no View menu yet.
- **`Grid.fit()` should fit the level, not one axis** by default: take the
  smaller of the width-fit and height-fit scales, clamped to `ZMIN`. Keep
  fit-height as an explicit command since it is the useful one while editing.
- A **minimap or overview strip** is the real answer for 540-column levels.
  Scope it as a follow-up (§13, Nice-to-have), but the horizontal scrollbar
  (`#hbar`) is already the right place to host one: render a downsampled level
  strip into its track.

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

#### UX-06 — The active tool is barely indicated

**Category** UX · **Severity** Low · **Priority** P2 · **Affects** UX

**Current.** The selected palette cell gets `border-color: var(--acc)` and a
slightly lighter background (`style.css:187`) — a 1 px purple border on a
42.25 px fractional cell (GEO-07), which the screenshot shows is easy to miss
among 31 similar cells.

**Recommended.** Strengthen the selected state per VIS-07 (accent border **and**
a filled corner marker **and** a background step), and mirror it in the status
bar: `tool: brick` / `tool: air (eraser)` / `tool: chapeleira`. The status bar
is already the right place and is currently carrying only a cursor position and
a stale message.

---

#### UX-07 — The palette has no search or filter

**Category** UX · **Severity** Low · **Priority** P3 · **Affects** UX

**Current.** 31 cells today (measured), unbounded as custom definitions are
added, in a 4-column scrolling grid with 10 px group headings.

**Recommended.** A one-line filter field at the top of the palette matching
block and definition names, plus collapsible groups. Only worth doing once
custom definitions make the list long — flag as a follow-up, not now.

---

#### UX-08 — Destructive actions have no confirmation and no undo affordance

**Category** UX · **Severity** Medium · **Priority** P1 · **Affects** UX

Two cases, both silent and both surprising:

1. **`remove definition`** (`panel.js:281-293`) deletes the definition *and
   every entity of that kind* in the level. A user who placed forty enemies and
   clicks it loses all forty with no prompt and no indication of what happened.
2. **Reducing the level height** (`Grid.setheight`, `grid.js:146-149`) splices
   out every entity whose `pos[1] >= h * B`, silently. Typing `8` into the rows
   field where there was `12` can delete entities the user cannot see.

Both *are* undoable (`Undo.act` wraps them correctly), which is the mitigating
factor — but the user is not told that anything happened.

**Recommended.** Do not add a modal confirmation — that is friction on an
undoable action. Instead:
- **Report the consequence**: `removed 'goomba' and 40 entities · ⌘Z to undo`
  in the status bar; `level shortened to 8 rows, 3 entities removed`.
- **Warn before** the destructive variant, in-place: the rows field shows
  `3 entities below row 8 will be removed` as a hint before commit.
- Reserve real confirmation dialogs for genuinely irreversible actions. There
  are currently none, which is a good property to keep.

---

#### UX-09 — First run drops the user into an untitled void

**Category** UX · **Severity** Medium · **Priority** P1 · **Affects** UX

**Current.** `app.js:543-546` calls `api.blank()` on load and shows an
untitled 12-row empty level. No recent files (NAT-06), no template, no
onboarding, no indication of what the tool does or how to place the first
block. The file manager is two empty voids (VIS-12). The palette's first cell
is the *eraser*, selected-by-default tool is `{kind: 'block', id: 2}` (brick),
and nothing says so.

**Recommended.** A restrained first-run:
- Restore the **last session's document** if it still exists on disk and was
  saved — this is what a document-based app does, and it is one line now that
  main owns the path (BUG-08, done — see "Already completed") once it also
  persists it beside the window state (NAT-10).
- Otherwise show a **start view** in place of the canvas: New Level · Open… ·
  Recent (list) — reusing the same commands, no new surfaces.
- Empty states in the file manager (VIS-12).
- A single status-bar hint on the empty canvas: `click to place · right-drag
  to erase · alt-drag to pan`, dismissed on the first edit.

Do not build a tour, a modal, or a settings wizard. One screen, three commands.

---

#### UX-10 — No autosave, no crash recovery, no backup

**Category** UX / Data safety · **Severity** High · **Priority** P1 · **Affects** UX, Architecture

**Current.** The document lives only in renderer memory until an explicit save.
A crash, a power loss, or a `render-process-gone` event still loses everything
since the last save — BUG-09 (shipped, see "Already completed") stops such an
event from also wedging the window shut, but does nothing to recover the
document itself, which is what this finding is about (⌘R no longer risks this
either — BUG-01 is shipped). There is no `.bak`, no journal, no recovery prompt.

**Recommended.** A recovery snapshot, not a full autosave (autosaving over the
user's file is a different and more opinionated decision):
- Every N seconds while dirty (N ≈ 30, idle-triggered so it never runs mid-drag),
  main writes the current document to
  `app.getPath('userData')/recovery/<hash-of-path>.lvl` — the same
  `lvl.write()` path, which is already validated and atomic (BUG-02, shipped).
- Delete the snapshot on a successful save and on a clean quit.
- On launch, if a snapshot exists, offer: "Studio closed unexpectedly. Recover
  unsaved changes to <name>?" — native dialog, Recover / Discard.
- Additionally, on overwrite-save, keep one `<name>.lvl.bak` beside the file
  (the previous contents), which costs one `copyFile` and covers "I saved over
  something good".

**Depends on.** BUG-08 (main owns the document) and BUG-02's atomic write are
both already in place, so a recovery snapshot only needs to reuse them.

**Risks.** The snapshot must not run while the renderer is mid-gesture; gate it
on `!Grid.pan && Grid.paint < 0 && !Grid.moving`, and on `Grid.commit()` having
run (`CLAUDE.md`: **every save path must call `Grid.commit()` first**).

---

#### UX-11 — There are no preferences

**Category** UX · **Severity** Low · **Priority** P3 · **Affects** UX

**Current.** Nothing is configurable and nothing is persisted — not panel
widths, not the last directory, not zoom, not grid visibility.

**Recommended.** Keep it small and justified. A preferences surface is worth
adding only once there are ≥4 real settings; the credible list is:
grid overlay on/off, palette cell size 1×/2× (GEO-07), editor font size,
autosave interval (UX-10), and confirm-on-destructive-height-change (UX-08).

Store in `app.getPath('userData')/settings.json`, owned by main, exposed
read/write through the preload. On macOS the item is
`Pellizzola Brothers Studio → Settings… (⌘,)`; on Windows/Linux it is
`Edit → Preferences` or `File → Preferences`. Use the platform's word —
"Settings" on macOS and modern Windows, "Preferences" on GNOME.

**View state** (panel widths, last zoom, open tabs) is *not* preferences and
should persist separately and silently, per-document where it makes sense.

---

#### UX-12 — Escape does not cancel an in-progress gesture

**Category** UX · **Severity** Low · **Priority** P2 · **Affects** UX

**Current.** `keys()` (`app.js:495-499`) handles Escape by closing the menu,
clearing `Grid.sel` and redrawing. It does not touch `Grid.pan`, `Grid.paint`,
`Grid.moving` or the open `Undo` step. Pressing Escape mid-drag therefore
deselects the entity that is *currently being dragged*, and the drag continues
with `Grid.sel === -1` — `onmove`'s move branch (`grid.js:448`) then silently
stops applying, leaving the entity wherever it was when Escape was pressed and
the undo step still open until `mouseup`.

**Recommended.** Escape during a gesture **cancels and reverts** it: close the
`Undo` step and immediately undo it, reset `pan`/`paint`/`moving`/`last`,
release pointer capture, redraw. Escape with no gesture in progress keeps the
current deselect behaviour. This is one small function, `Grid.cancel()`, called
from the Escape branch and from `blur`.

**Related.** `onup` (`grid.js:469`) is bound on `window`, so a mouseup outside
the window ends the gesture correctly — good. But there is no `blur` handler,
so alt-tabbing away mid-drag leaves the gesture live; `Grid.cancel()` on
`window.blur` fixes that too.

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
(NAT-20), plus: scroll the active tab into view on `App.select()`; a
`⌘1…⌘9` / `⌃Tab` keyboard route (NAT-14); and an overflow chevron listing
hidden tabs via the native menu (NAT-05). Also add middle-click-to-close, which
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

#### A11Y-01 — Most of the interface is not reachable by keyboard

**Category** Accessibility · **Severity** Critical · **Priority** P0 · **Affects** UI, UX

**Current.** Measured in the running app: **17** focusable elements exist in
the whole document, against **31** palette cells alone. The non-focusable
interactive elements are:

| Control | Built as | Location |
|---|---|---|
| Palette cells (31+) | `<div class="cell">` + `onclick` | `panel.js:60-78` |
| File-manager rows | `<li>` + `onclick` | `app.js:130-152` |
| Tabs | `<div class="tab">` + `onclick` | `app.js:78-93` |
| Tab close buttons | `<i>` + `onclick` | `app.js:87-90` |
| Context-menu items | `<div class="mi">` + `onclick` | `app.js:167-172` |
| Window controls | `<i>` + `onclick` | `index.html:8` |
| Section headers | `<div class="hdr">` | `index.html:29, 31` |

None can be reached with Tab; none respond to Return or Space; none appear in
the focus order at all. The application is operable only with a pointer.

**Recommended.** Use the right element rather than adding ARIA to the wrong one
— the brief is explicit that native semantics beat ARIA:

- **Palette cells** → `<button>` inside a container with
  `role="listbox"`/`option` semantics, or simply `<button aria-pressed>` in a
  `role="group"`. Arrow keys move within the grid (roving `tabindex`), Return
  or Space selects, so the palette is one Tab stop rather than 31.
- **File rows** → `<li>` inside `role="listbox"` with `role="option"`,
  `aria-selected`, roving `tabindex`, Return to open (UX-01), F2/Return to
  rename, Delete to delete, arrow keys and type-ahead to navigate.
- **Tabs** → `role="tablist"` / `role="tab"` / `aria-selected` /
  `aria-controls`, as real `<button>`s, with left/right arrows moving between
  them and one Tab stop for the strip. The panels get `role="tabpanel"`.
- **Tab close** → a real `<button>` with `aria-label="Close <name>"`, and a
  hit target meeting A11Y-08.
- **Menu items** → moot; the menu becomes native (NAT-05), which is the single
  biggest accessibility win available here.
- **Window controls** → moot; they become the OS's own (NAT-02).

**Implementation note.** Roving `tabindex` is the right pattern for all three
lists: exactly one item carries `tabindex="0"`, the rest `-1`, and arrow keys
move it. That keeps the Tab order short (title bar → tabs → file list →
canvas → palette → inspector → status) which is itself an accessibility
property.

---

#### A11Y-02 — The DOM has no semantics

**Category** Accessibility · **Severity** High · **Priority** P1 · **Affects** UI

**Current.** `index.html` is 58 lines of `<div>`s and two `<aside>`s. There are
**zero** `role` or `aria-*` attributes in the entire application (verified by
grep across HTML and JS). A screen reader encounters: an unlabelled group of
three unlabelled items, an unlabelled list of unlabelled clickable divs, a
canvas with no name, and a grid of 31 unlabelled divs.

**Recommended.** Correct elements first, ARIA only where HTML cannot express
the pattern:
- `<header>` for the title bar; the tab strip as a `role="tablist"` (no HTML
  element exists for it, so this is legitimate ARIA); `<nav>` or
  `role="listbox"` for the file lists; `<main>` for the stage (already
  `<main>` — good); `<aside>` for both panels (already correct — good).
- Each section header becomes a real heading (`<h2>`) and the list it labels
  gets `aria-labelledby` pointing at it, so "scripts" and "midi" become
  navigable landmarks.
- The status bar gets `role="status"` and `aria-live` (A11Y-05).
- `#props` gets `role="region" aria-label="Properties"` and its `h4`s become
  real headings, so an inspector user can jump between sections.
- The disabled `▶` gets `aria-disabled` and `aria-describedby` (VIS-13).

**Do not** add `role="button"` to the divs — replace them with buttons
(A11Y-01). Adding ARIA to compensate for the wrong element is the anti-pattern
the brief warns against.

---

#### A11Y-03 — The canvas is inaccessible and unnamed

**Category** Accessibility · **Severity** High · **Priority** P2 · **Affects** UI, UX

**Current.** `<canvas id="cv" tabindex="0">` (`index.html:36`) — focusable, so
it appears in the tab order and (since VIS-06, shipped) now shows a visible
focus ring, but still has no accessible name, no description, and **no
keyboard interaction whatsoever**. A keyboard user can focus the level editor
and then do nothing with it.

**Recommended.** A canvas-based editor cannot be made fully screen-reader
navigable without an enormous parallel DOM, and that is not a reasonable ask
here. What *is* reasonable, and is what comparable tools do:

1. **Name and describe it**: `role="application"` (justified — it is a custom
   interaction surface), `aria-label="Level canvas"`,
   `aria-describedby` pointing at a visually-hidden paragraph describing the
   available keys.
2. **Keyboard editing**: arrows move a **keyboard cursor** cell (drawn like the
   hover cell); Return/Space paints the current tool; Delete erases; Tab-into
   announces the cursor position. This makes the core verb — place a tile —
   keyboard-operable, which is the meaningful bar.
3. **Announce position and content** through the status bar's live region
   (A11Y-05) as the cursor moves: `column 14, row 2 — brick`.
4. Keep the pointer gestures exactly as they are.

**Depends on.** UX-06 (a tool indicator); VIS-06's focus ring, which step 2
needs to be usable, is already shipped.

---

#### A11Y-04 — Hit targets are below the platform minimums

**Category** Accessibility · **Severity** Medium · **Priority** P1 · **Affects** UI

**Current, measured or computed:**

| Target | Size | Minimum |
|---|---|---|
| `.dots i` window controls | 12 × 12 px | 24 × 24 (WCAG 2.5.8 AA); macOS HIG 28×28 |
| `.tab i` close glyph (`×`) | ~7 × 18 px | 24 × 24 |
| `li` file rows | ~20 px tall (`padding: 1px 10px 1px 18px` + 18 px line) | 24 |
| `.hdr button` (`+`) | ~12 × 12 px | 24 × 24 |
| `#hbar` scrollbar | 12 px tall | acceptable for a scrollbar (exempt as an inline control, but see NAT-20) |

**Recommended.** Every target reaches at least 24 × 24 px of *hit area*, which
does not require 24 px of *visual* area — pad the clickable element, or use a
transparent `::before` overlay, so the visual density the design wants is
preserved while the target grows. `li` rows go to `--row` (30 px) from GEO-01,
which also fixes the cramped list in the screenshot. Window controls become the
OS's (NAT-02) and inherit correct sizing for free.

---

#### A11Y-05 — Nothing is announced

**Category** Accessibility · **Severity** Medium · **Priority** P1 · **Affects** UX

**Current.** Every piece of feedback in the application is a silent visual
change: `App.say()` writes text into a `<span>`; `App.fail()` prepends a div;
validation errors, save confirmations, undo results and import counts are all
invisible to assistive technology.

**Recommended.**
- `#status` → `role="status"` (implicit `aria-live="polite"`) for confirmations
  and cursor position.
- Errors → a separate `aria-live="assertive"` region, or `role="alert"` on the
  `.err` block, so a failed save interrupts.
- Ensure the live region exists **in the DOM at load**, empty, rather than
  being created when the first message arrives — a live region inserted at
  announcement time is frequently missed by screen readers. `#msg` already
  satisfies this; the `.err` block created in `App.fail()` (`app.js:47`) does
  not, and should become a permanent, empty container that gets filled.

---

#### A11Y-06 — Everything is in absolute pixels and ignores OS text scaling

**Category** Accessibility · **Severity** Medium · **Priority** P2 · **Affects** UI

**Current.** Every dimension and every font size in `style.css` is in `px`.
Chromium's page zoom used to be reachable through the default menu's Zoom
In/Out roles (⌘+/⌘−); NAT-01's replacement menu (shipped) carries no such
role, so that particular exposure is currently closed as a side effect rather
than by design — there is still no `View → Zoom` of any kind, and nothing
would handle it correctly if one were added: `Grid.dpr` is read from
`devicePixelRatio`, which page zoom multiplies, while `Grid.resize()` only
fires on a CSS-size change (BUG-12). The underlying problem this finding is
about — an all-`px` layout with no response to OS text-size settings — is
unaffected by the menu change.

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
   correct. This is the same fix as BUG-12 and should be one code path.

---

#### A11Y-07 — System accessibility preferences are not honoured

**Category** Accessibility · **Severity** Low · **Priority** P2 · **Affects** UI

**Current.** No `prefers-reduced-motion` (vacuous today, mandatory with VIS-08),
no `prefers-contrast`, no `forced-colors`. Windows High Contrast mode is
untested and will produce a broken result: Chromium force-overrides CSS colours
but cannot touch canvas pixels, so the chrome would flip to the system palette
while the canvas stays purple, and the canvas-drawn selection ring (VIS-16)
would become invisible.

**Recommended.** Three media queries, each small:
- `prefers-reduced-motion: reduce` → durations to ~0 (VIS-08).
- `prefers-contrast: more` → `--control-border` to `--fg`, focus ring to 3 px,
  disabled text to ≥4.5:1, canvas selection stroke thickened (VIS-16).
- `forced-colors: active` → `forced-color-adjust: none` on the canvas and the
  palette swatches (so they keep showing the artwork), system colours
  (`Canvas`, `CanvasText`, `Highlight`, `ButtonBorder`) everywhere else, and
  ensure every state that currently relies on colour alone also has a
  non-colour cue (border, icon, or weight).

---

#### A11Y-08 — Disabled and error states are communicated by colour alone

**Category** Accessibility · **Severity** Low · **Priority** P2 · **Affects** UI

**Current.** Disabled = `opacity: .35`. Error = the text turns `#ff8f8f`.
Selected = the text turns `--acc`. Each is a colour-only distinction, failing
WCAG 1.4.1 (Use of Colour), and each is invisible under forced colours.

**Recommended.** Pair every state with a non-colour cue: disabled gets
`aria-disabled` and a cursor change; errors get an icon and a prefix; selection
gets a leading-edge marker (VIS-07). None of these costs layout.

---

### 4.7 Architecture and code quality (ARCH)

The codebase is small, consistently formatted, and unusually well commented —
the module comments in `grid.js`, `undo.js`, `lvl.js` and `catalog.js` explain
decisions rather than restating code, which is exactly right and should be
preserved. The findings below are targeted, not a call for restructuring.

---

#### ARCH-02 — `W` is defined twice and `H` only once

**Category** Code quality · **Severity** Medium · **Priority** P1 · **Affects** Maintainability

**Current.** `catalog.js:13` defines `const W = 540` and exports it
(`catalog.js:105`). `lvl.js:14` **re-defines** `const W = 540` with its own
comment, while `lvl.js:12` already does `require('./catalog')`. The constant
that `CLAUDE.md` calls a cross-repo contract ("Every `block_data` row holds
**exactly 540** entries") therefore exists in two places, one of which imports
the other and ignores it.

Meanwhile `H = 12` (rows in a fresh level) exists only in `lvl.js:15` and is
exported but never used by the renderer, and `B = 100` exists only in
`catalog.js` and is used by `lvl.js` as `cat.B` (`lvl.js:143`) — so the three
constants are handled three different ways.

**Recommended.** `catalog.js` owns all three (`B`, `W`, `H`), since it is
already the shared module and already carries the cross-repo contract comment.
`lvl.js` uses `cat.W`, `cat.H`, `cat.B` uniformly. Delete `lvl.js:14-15`.

**Risks.** None — `catalog.js`'s `module.exports` guard (`catalog.js:104`) and
the "nothing above it may touch a browser global" rule (`CLAUDE.md`) already
make it safe to require from main, and it already is.

---

#### ARCH-03 — There is no platform abstraction and no way for the renderer to know its platform

**Category** Architecture · **Severity** Medium · **Priority** P1 · **Affects** Architecture, UI

**Current.** `process.platform` appears twice in main (`main.js`'s
`window-all-closed` guard; `menu.js`'s macOS-vs-rest menu shape, added when
NAT-01 shipped) and the preload still exposes no platform information, so the
renderer cannot adapt. This is why the traffic lights are macOS-shaped
everywhere (NAT-02), the hotbar exists on macOS where it should not (NAT-04),
the capitalisation follows no platform convention (VIS-10), and the scrollbar
assumptions are macOS-overlay-shaped (NAT-20). `menu.js`'s branch is a preview
of exactly the drift this finding warns about: a second platform check already
exists outside `main.js`, and every later platform-specific module will add
another unless they consolidate here.

**Recommended.** Two places, and only two:
1. **`chrome.js` in main** — the single home for every platform branch that
   affects the window: `BrowserWindow` options, `titleBarStyle`/
   `titleBarOverlay`/`trafficLightPosition`, dialog button order and labels
   (NAT-21), `menu.js`'s macOS/rest split, and the "Settings" vs "Preferences"
   word (UX-11).
2. **`api.platform`** exposed through the preload, stamped onto the root as
   `<html data-platform="darwin|win32|linux">` at boot, so CSS can key off it
   declaratively (`[data-platform="darwin"] .acts { display: none }`) with no
   JavaScript branching in the renderer at all.

That is the whole abstraction. Resist anything larger.

---

#### ARCH-04 — `Panel` rebuilds its entire DOM for every change

**Category** Code quality / Performance · **Severity** Medium · **Priority** P1 · **Affects** UI, Performance

**Current.** `Panel.inspect()` (`panel.js:103`) dispatches to one of three
functions, each of which assigns a freshly-concatenated HTML string to
`p.innerHTML` and then re-binds every handler by `getElementById`. The same
pattern is used by `Panel.palette()`, `tabs()` and `list()`.

For most call sites this is fine and appropriately simple. Two call sites make
it a defect:
1. **`onmove()` calls `App.inspect()` on every cell crossed while dragging an
   entity** (`grid.js:458`) — see PERF-01.
2. **Any rebuild while a field has focus destroys the caret.** `bind()`
   (`panel.js:299-305`) works around this for the three level-info text fields
   by binding `oninput` without rebuilding — a good, documented workaround —
   but `p_x`, `p_y`, `p_rows`, `p_def` and `p_script` all call
   `Panel.inspect()` from their `onchange`, so the element the user just
   interacted with is destroyed and recreated underneath them.

**Recommended.** Do not introduce a framework. Two targeted changes:
- A `Panel.update()` that writes **values** into the existing fields when the
  view's *shape* has not changed, used by the drag path and the `onchange`
  handlers. `Panel.inspect()` stays for shape changes (selection kind changed).
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
(`lvl:new`, `lvl:open`, `win:ctl`, `midi:import`, `ask:discard`, `req:close`)
and bare (`dirty`, `forceclose`). Two response shapes coexist: the `guard()`
envelope `{ok, …}` / `{ok: false, err}` (`main.js:72-81`) for most handlers,
and a raw integer from `ask:discard` (BUG-10). Cancellation is signalled by an
extra `{cancel: true}` field that every caller must remember to check
(`app.js:428`, `:451`, `app.js:341`) and that is easy to forget — a missed
check treats a cancelled dialog as a success.

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

#### ARCH-08 — Monaco is loaded eagerly and shipped whole

**Category** Architecture / Performance · **Severity** Medium · **Priority** P1 · **Affects** Performance, Architecture

**Current.** `Code.init()` is called unconditionally at `DOMContentLoaded`
(`app.js:538`), pulling in the AMD loader and `vs/editor/editor.main` — several
megabytes of JavaScript, plus theme registration and editor construction —
even though the default and most common tab is the **Level Editor**, which
never touches it. Packaging would ship the entire `monaco-editor` package
(including the `esm/` and `dev/` trees, tens of megabytes) unless `files` is
narrowed (NAT-07).

**Recommended.**
- **Lazy-load** on the first script-tab activation. `Code.show()` already
  guards on `Code.ready` (`code.js:78`), so the plumbing is nearly there:
  make `Code.init()` idempotent and call it from `App.select()` when the target
  is not `'level'`. Show a brief loading state in the editor area.
- Narrow the packaged files to `node_modules/monaco-editor/min/vs/**`.
- Measure the startup delta before and after; if it is under ~150 ms the lazy
  load is still worth it for the packaged size alone, but say so with numbers.

**Risks.** The `MonacoEnvironment.getWorkerUrl` blob shim (`code.js:35-40`)
computes `base` from `location.href`; it must still resolve after packaging
(NAT-07's asar note). Test the lazy path and the packaged path together.

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

#### PERF-01 — The inspector is rebuilt from an HTML string on every cell of an entity drag

**Category** Performance · **Severity** High · **Priority** P1 · **Affects** UI, Performance

**Current.** `onmove()` (`grid.js:448-460`), in the entity-move branch, calls
`App.touch()`, `App.inspect()` and `Grid.redraw()` **every time the entity
crosses a cell boundary**. `App.inspect()` → `Panel.inspect()` →
`entityview()` (`panel.js:152`) concatenates a ~1 KB HTML string containing a
`<select>` with one `<option>` per known definition plus one per script,
assigns it to `innerHTML`, and re-binds seven event handlers by
`getElementById`.

At a fast drag across a level this is a full parse-and-reflow of the inspector
several dozen times per second, in the same frame as the canvas redraw. It also
destroys and recreates two `<select>` elements each time, which is one of the
more expensive things Chromium can be asked to build.

**Recommended.** During a drag, update only what changed: the `x`, `y` and
`cell` field values. That is three `element.value` writes. Use the
`Panel.update()` split from ARCH-04. Call the full `Panel.inspect()` once, on
`mouseup`.

**Expected effect.** Removes the dominant per-frame cost of entity dragging.
Verify with a performance capture before and after — this is the one finding
here where the effect should be visible in a profile.

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

#### PERF-04 — Canvas resize is uncoalesced

**Category** Performance · **Severity** Medium · **Priority** P2 · **Affects** Performance

**Current.** `Grid.resize()` (`grid.js:84-98`) is the `ResizeObserver`
callback and unconditionally reallocates the canvas backing store
(`cv.width = …` discards and reallocates the surface) and then draws
synchronously. During a window resize — and, once GEO-04 lands, during every
splitter drag — this runs on every observed frame.

**Recommended.** Coalesce through `requestAnimationFrame` like `Grid.redraw()`
already does, and **skip the reallocation when the pixel dimensions have not
changed** (a devicePixelRatio-only change still needs it, so compare the
computed target dimensions rather than the CSS ones).

**Depends on.** GEO-04 makes this necessary rather than merely tidy.

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
(`app.js:543`). So the first frame is an empty chrome with no canvas content,
and Monaco is loading in parallel (ARCH-08).

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
| Window chrome | `titleBarStyle: 'hiddenInset'` + `trafficLightPosition`. Delete the fake dots. The green button must be **full screen**, not zoom. | NAT-02 |
| Title | Document name only; `setRepresentedFilename` for the proxy icon; `setDocumentEdited` for the close-button dot. Not a path, not an asterisk. | NAT-03 |
| Toolbar | Remove the New/Open/Save hotbar — it duplicates File, and the menu bar exists regardless of window framing. | NAT-04 |
| Context menus | `Menu.popup()`. Ctrl+click must not erase. | NAT-05, NAT-12 |
| Open Recent | `addRecentDocument` — feeds both the File menu and the Dock icon menu. | NAT-06, NAT-17 |
| File association | `CFBundleDocumentTypes` for `.lvl` via electron-builder; handle `app.on('open-file')`, including before `whenReady`. | NAT-07 |
| Trackpad | Two-finger scroll pans; pinch (`wheel` + `ctrlKey`) zooms. This is the single biggest day-to-day usability defect on a Mac. | NAT-11 |
| Shortcuts | `CmdOrCtrl` accelerators from the menu; drop the hand-rolled `Ctrl+Y`. Settings is **⌘,** and is called "Settings". | NAT-14, UX-11 |
| Scrollbars | Respect the overlay/classic setting; `scrollbar-gutter: stable` so layout does not depend on it. | NAT-20 |
| Dialogs | "Don't Save", not "Discard"; sheet-parented (already correct); add `detail`. | NAT-21 |
| Distribution | `hardenedRuntime`, code signing, notarisation — without these an unsigned build is blocked by Gatekeeper. | NAT-07 |
| Accessibility | VoiceOver reaches nothing today; native menus (NAT-05) and real controls (A11Y-01) fix most of it at once. | A11Y-01, A11Y-02 |

### 5.2 Windows

| Area | Do this | Finding |
|---|---|---|
| Window chrome | `titleBarStyle: 'hidden'` + `titleBarOverlay: {color, symbolColor, height}` so Windows draws its own caption buttons, correctly placed top-right and themed. Re-push on theme change. | NAT-02, NAT-15 |
| Toolbar | The application menu is already set unconditionally (NAT-01, shipped) so its accelerators work even with no visible menu bar; keep an in-window toolbar as the visible surface, since `titleBarStyle: 'hidden'` shows none. Consider a hamburger that calls `Menu.popup()`. | NAT-04 |
| Title | `Document — Pellizzola Brothers Studio`, with dirty state reflected in the OS title, not only in the DOM. | NAT-03 |
| File association | Registry entries + `.ico` via electron-builder; handle the path in `process.argv` **and** in `second-instance`. | NAT-07, NAT-08 |
| Single instance | Required — without it every double-clicked `.lvl` launches a whole new app. | NAT-08 |
| JumpList | `setUserTasks` ("New Level") plus automatic recent documents once the association exists. | NAT-06, NAT-17 |
| Dialogs | Button order Save / Don't Save / Cancel; `noLink: true` so they are push buttons, not command links; set `title`. | NAT-21 |
| Scrollbars | Classic scrollbars consume layout width — this is where NAT-20's unstyled palette scrollbar is most visible and where `scrollbar-gutter` matters most. | NAT-20 |
| High contrast | `forced-colors: active` is a real, commonly-enabled Windows mode; currently untested and certain to break the canvas indicators. | A11Y-07, VIS-16 |
| Mixed DPI | Per-monitor scaling is common; the canvas goes soft when the window moves between displays. | BUG-12 |
| Distribution | Authenticode signing; NSIS or MSI. | NAT-07 |

### 5.3 Linux

Linux is where a custom implementation is legitimate — but as a *fallback*,
chosen deliberately, not as the default the other two inherit.

| Area | Do this | Finding |
|---|---|---|
| Window chrome | Prefer `titleBarOverlay`. Where the desktop uses server-side decorations (KDE, XFCE, most tiling WMs) or the overlay is unavailable, fall back to `frame: true` and let the WM decorate — hiding the in-app title row entirely. **Never** fall back to the macOS dots. | NAT-02 |
| Button layout | On GNOME, control placement and order are a user setting (`org.gnome.desktop.wm.preferences.button-layout`). A custom title bar that hard-codes a layout overrides the user's explicit configuration. This is the strongest argument for `frame: true` on Linux. | NAT-02 |
| Toolbar | The application menu is already set (NAT-01, shipped) and GNOME may surface parts of it in the shell; keep the in-window toolbar as on Windows. | NAT-04 |
| Context menus | Native menus inherit the GTK theme — the fastest single change to stop looking foreign. | NAT-05 |
| Dialogs | GNOME convention: destructive action leftmost, "Discard" is the right word here (unlike macOS/Windows). Sentence case, not Title Case. | NAT-21, VIS-10 |
| File association | `.desktop` file + MIME XML (`application/x-pellizzola-level`) + hicolor icons via electron-builder; handle `process.argv`. | NAT-07 |
| Recent files | `addRecentDocument` writes `recently-used.xbel`, honoured by GTK file choosers. | NAT-06 |
| Single instance | Required. | NAT-08 |
| Fonts | The `DejaVu Sans Mono` fallback is the *only* one likely to be present, and it differs in metrics from JetBrains Mono — bundling the font matters most here. | VIS-05 |
| Wayland | Fractional scaling changes `devicePixelRatio` without a CSS resize. | BUG-12 |
| DE variance | State explicitly in `CLAUDE.md` which desktops were tested. "Linux" is not one target. | — |

### 5.4 Cross-platform Electron improvements

| Improvement | Finding |
|---|---|
| `will-navigate` + `setWindowOpenHandler` (BUG-01's own reload path is already guarded a different way, see "Already completed") | NAT-09, NAT-18 |
| `sandbox: true` (verify, or document why not) | NAT-18 |
| Window state persistence with display validation | NAT-10 |
| Display-derived default window size | NAT-10, GEO-12 |
| DPI-change handling for the canvas | BUG-12, A11Y-06 |
| Recovery snapshots in `userData` | UX-10 |
| One `chrome.js` for every platform branch; `api.platform` to the renderer | ARCH-03 |
| Consistent IPC envelope, string verdicts, one unwrap helper | ARCH-06, BUG-10 |
| electron-builder config, icons, associations, signing | NAT-07 |
| Lazy Monaco; narrowed packaged files | ARCH-08 |

---

## 6. Layout and proportionality audit

### 6.1 Every instance of arbitrary geometry

| # | Value | Where | What should determine it | Finding |
|---|---|---|---|---|
| 1 | `--bar: 34px` | `style.css:14` | `--row-lg` = line box + 2 × `--space-4` | GEO-01, GEO-02 |
| 2 | `--tabs: 32px` | `style.css:15` | `--row-lg` (same band as the title bar) | GEO-02 |
| 3 | `.hdr` `24px` | `style.css:107` | `--row-sm`; design says 36 px | GEO-02, GEO-13 |
| 4 | `#status` `22px` | `style.css:242` | `--row-sm` | GEO-02 |
| 5 | `#hbar` `13px` | `style.css:148` | `--scrollbar` + `--border` | GEO-09 |
| 6 | `--side: 184px` | `style.css:16` | `clamp(min, 10.5%, max)` — the design's ratio | GEO-03 |
| 7 | `--right: 212px` | `style.css:17` | `clamp(min, 13%, max)` — the design's ratio | GEO-03 |
| 8 | `#scripts 60%` / `#midis 40%` | `style.css:116-117` | Content height, with a floor and a splitter | GEO-05 |
| 9 | `#props 46%` | `style.css:191` | Content height, or the design's 47.5 % as a named token | GEO-06 |
| 10 | `repeat(4, 1fr)` palette | `style.css:170` | `repeat(auto-fill, N × --sprite)` — integer sprite scale | GEO-07 |
| 11 | `.tab max-width: 260px` | `style.css:79` | `24ch` — a statement about filenames | GEO-08 |
| 12 | `#menu min-width: 150px` | `style.css:227` | Moot (native menu) | NAT-05, GEO-08 |
| 13 | `textarea height: 48px` | `style.css:208` | `calc(var(--line) * 3)` | GEO-08 |
| 14 | `.dots i 12px`, `gap 8px` | `style.css:55-57` | Moot (real traffic lights) | NAT-02 |
| 15 | Gaps 4/6/8/10/12/14/16/18 px | `style.css` passim | `--space-*` scale | GEO-01 |
| 16 | Font sizes 10/11/12/13 px | `style.css` passim | `--font-size`, `--font-size-sm`; drop 10 px | GEO-08 |
| 17 | `li padding 1px 10px 1px 18px` | `style.css:123` | `--row` height; indent from icon width | GEO-08, A11Y-04 |
| 18 | `1600 × 950`, `960 × 620` window | `main.js:37` | Display work area; content minimums | NAT-10, GEO-12 |
| 19 | `2 * B` fit padding | `grid.js:163` | `FITPAD = B`, named | GEO-11 |
| 20 | `0.03` / `1` / `3` zoom clamps | `grid.js:163, 361` | `ZMIN` derived from "level fits narrowest viewport"; `ZMAX` named | GEO-11 |
| 21 | `0.0015` wheel factor | `grid.js:361` | `Math.LN2 / ZOOM_PX_PER_DOUBLING` | GEO-11, NAT-11 |
| 22 | `B * z >= 10` grid threshold | `grid.js:257` | `GRIDMIN`, named and commented | GEO-11 |
| 23 | `1` px bar tolerance | `grid.js:191, 199` | `BARSLOP`, shared by both sites | GEO-11 |
| 24 | Selection inset `1`/`2` | `grid.js:275-277` | Derived from `SELW` | GEO-11 |
| 25 | Menu clamp `2`/`4` px | `app.js:175-176` | Moot (native menu) | NAT-05 |
| 26 | `backgroundColor '#1c1d20'` | `main.js:38` | `--frame`, documented as a necessary duplicate | VIS-04 |

### 6.2 Design tokens that should exist

```css
:root {
	/* ---- type ------------------------------------------------------ */
	--font:            'JetBrains Mono', 'DejaVu Sans Mono', ui-monospace, monospace;
	--font-size:       12px;   /* the design's body size                */
	--font-size-sm:    11px;   /* status bar, hints — the 10px is dropped */
	--line-height:     1.5;
	--line:            18px;   /* = font-size × line-height; the unit
	                              every row height is derived from      */

	/* ---- spacing --------------------------------------------------- */
	--space-1:  2px;  --space-2:  4px;  --space-3:  6px;
	--space-4:  8px;  --space-5: 12px;  --space-6: 16px;  --space-7: 24px;

	/* ---- rows (derived from the line box, not chosen) -------------- */
	--row-sm:  calc(var(--line) + var(--space-2) * 2);  /* 26px */
	--row:     calc(var(--line) + var(--space-3) * 2);  /* 30px */
	--row-lg:  calc(var(--line) + var(--space-4) * 2);  /* 34px */

	/* ---- panels (proportions from the design file) ----------------- */
	--side-ratio:   10.5%;   /* SVG: 157 / 1504 = 10.44%               */
	--right-ratio:    13%;   /* SVG: 197 / 1505 = 13.09%               */
	--side-min / --side-max / --right-min / --right-max: content-derived
	--split:         1px;    /* splitter rule; 7px transparent grab zone */

	/* ---- sprites --------------------------------------------------- */
	--sprite:  32px;                          /* every texture is 32×32 */
	--cell:    var(--sprite);                 /* ×1 or ×2, never fractional */
	--icon:    16px;

	/* ---- colour: surfaces ------------------------------------------ */
	--frame / --chrome / --tab / --panel / --hdr        (existing)
	--surface-raised:  #17102a;   /* inputs, cells, popovers — was ×4 literal */
	--surface-hover / --surface-selected                (new, VIS-07)
	--canvas-bg:       #0b0813;                          /* was in grid.js */
	--checker-a / --checker-b                            /* was literal */

	/* ---- colour: text and lines --------------------------------- */
	/* --fg, --dim, --acc, --acc-text, --line and --control-border are
	   shipped already (VIS-01/VIS-02, see "Already completed") with the
	   values below; --control-border there is aliased to --acc (#7b56ba,
	   3.1-3.6:1) rather than the alternate #77599f this block originally
	   proposed, per the audit's own "if a single value must clear 3:1 on
	   all three" fallback.  --fg-disabled and --danger are still open. */
	--fg:              #b9a6d6;   /* 7.6–8.8:1 — the DEFAULT text       */
	--dim:             #9b7fd4;   /* 5.1–5.9:1 — secondary text         */
	--acc:             #7b56ba;   /* 3.1–3.6:1 — NON-TEXT only          */
	--acc-text:        #9a74e0;   /* 4.8–5.5:1 — accent text            */
	--fg-disabled:                /* ≥3:1, never opacity alone          */
	--line:            #241938;   /* decorative separators only         */
	--control-border:  var(--acc);/* ≥3:1 — inputs, buttons (WCAG 1.4.11) */
	--danger:          #ff8f8f;   /* 8.8:1 — was literal ×2             */

	/* ---- borders, radius, elevation -------------------------------- */
	--border: 1px;  --border-strong: 2px;
	--radius-1: 2px;  --radius-2: 4px;  --radius-3: 8px;
	--elev-1: 0 1px 2px rgba(0,0,0,.4);
	--elev-2: 0 6px 20px rgba(0,0,0,.55);

	/* ---- scrollbars (one treatment for all five containers) -------- */
	--scrollbar: 12px;  --scrollbar-pad: 3px;
	--scrollbar-thumb: calc(var(--scrollbar) - var(--scrollbar-pad) * 2);

	/* ---- motion ---------------------------------------------------- */
	--dur-fast: 90ms;  --dur: 140ms;  --ease: cubic-bezier(.2, 0, 0, 1);

	/* ---- layering (currently one z-index: 10 on #menu) ------------- */
	--z-panel: 1;  --z-splitter: 5;  --z-overlay: 10;  --z-modal: 20;
}
```

JavaScript-side constants that belong in a named block, not inline
(`grid.js`): `FITPAD`, `ZMIN`, `ZMAX`, `ZOOM_PX_PER_DOUBLING`, `GRIDMIN`,
`SELW`, `BARSLOP`.

### 6.3 Values that must stay fixed, and why

Per the brief, each surviving literal is documented rather than removed.

| Value | Where | Why it cannot be derived | Platform-specific? | Configurable later? |
|---|---|---|---|---|
| `B = 100` | `catalog.js:12` | A cross-repo contract: `game/src/main.c` draws blocks 100 × 100 and spaces them `i * 100`. Changing it here alone desynchronises the studio from the game. | No | **No** — changing it is a three-repo change |
| `W = 540` | `catalog.js:13` | The on-disk format: every `block_data` row holds exactly 540 entries. | No | No |
| `H = 12` | `lvl.js:15` | Rows in a fresh level — a product decision, not a derivation. Should move to `catalog.js` (ARCH-02). | No | Yes, as a preference |
| `999` max rows | `grid.js:134` | Bound implied by the three-digit id format's sibling conventions and by memory (999 × 540 × 2 B ≈ 1 MB grid). Name it `HMAX` and state the reason. | No | No |
| `--sprite: 32px` | new | Every texture in the library is 32 × 32; verified. It is a fact about the asset library, not a design choice. | No | No |
| `backgroundColor: '#1c1d20'` | `main.js:38` | Must be known before the page and its CSS load, so it cannot read `--frame`. Duplicate deliberately, with a comment naming its source and the requirement to change both together. | No | No |
| `--scrollbar: 12px` | new | Chromium's `::-webkit-scrollbar` needs a concrete length; there is no CSS-side access to the platform's metric. | Effectively — macOS overlay vs classic; mitigate with `scrollbar-gutter: stable` | No |
| `+ .5` canvas offsets | `grid.js` passim | A 1 px canvas stroke is centred on the coordinate, so a half-pixel offset is what lands it on a whole device pixel. Correct as written; comment it. | No | No |
| `trafficLightPosition` | new, macOS | Derived from `--row-lg`, but must be passed to `BrowserWindow` as a number before CSS exists — the same class of exception as `backgroundColor`. | **Yes, macOS only** | No |

---

## 7. Visual consistency audit

A component-by-component pass. Each row states the current inconsistency and
the finding that resolves it.

| Area | Current state | Resolution |
|---|---|---|
| **Typography** | One family that never loads (VIS-05); four sizes (10/11/12/13 px) with no scale; `font-weight: normal` forced onto `<b>` in two places, so `<b>` is being used purely for layout | Bundle the font; two sizes; replace `<b>` with `<span>` and delete the overrides (VIS-05, GEO-08) |
| **Spacing** | 23 pixel literals, 9 of them one-offs; six different gaps between the title bar and status bar alone | One 7-step scale (GEO-01) |
| **Rows / heights** | Five unrelated band heights, none derived from the 18 px line box; `li` rows 20 px tall | Three `--row-*` tokens derived from the line box (GEO-01, GEO-02, A11Y-04) |
| **Colour** | Nine tokens plus ~16 literals in CSS, 7 in `grid.js`, 11 in `code.js`, 1 in `main.js` | One definition, three consumers (VIS-04) |
| **Contrast** | Resting and accent text, and control borders, are fixed (VIS-01, VIS-02, done — see "Already completed"); still failing: disabled ≈1.5:1, `.mi.off` ≈1.3:1 | `--fg-disabled` at ≥3:1, never opacity alone (VIS-07) |
| **Borders** | `--line` is now split from `--control-border` (VIS-02, done); still one width only, no distinct strong/emphasis weight | Add `--border-strong` |
| **Radius** | `50%` and `6px`, nothing else; design specifies 26 px window/tab radius | Three-step radius scale; adopt the tab flare (VIS-09, GEO-13) |
| **Shadows** | Exactly one, on the context menu, which is about to become native | Two-step elevation; panel `--elev-1` per the design's filters (VIS-09, GEO-13) |
| **Scrollbars** | One of five containers styled; unstyled palette scrollbar visible in the default window; layout width varies by platform and by an OS setting | One treatment, tokenised metrics, `scrollbar-gutter: stable`, Monaco keys set (NAT-20, GEO-09, VIS-18) |
| **Hover** | The only state; always the same mechanism (text colour swap) | Surface tint, text unchanged (VIS-07) |
| **Active / pressed** | Does not exist | Deeper tint (VIS-07) |
| **Focus** | Fixed — a global `:focus-visible` ring, 2 px + 2 px offset, now applies everywhere including the canvas (VIS-06, done — see "Already completed") | — |
| **Disabled** | `opacity: .35` only; ≈1.5:1; reason lives only in `title` | `--fg-disabled` at ≥3:1 + `aria-disabled` + cursor (VIS-07, VIS-13, A11Y-08) |
| **Selected** | Three different mechanisms for one semantic (`li.on`, `.tab.on`, `.cell.on`) | One treatment: accent text + surface + leading-edge marker (VIS-07) |
| **Icons** | Five text glyphs at four effective sizes, three of them `+`; an unused icon set exists in `textures/icons/` | Inline-SVG set, `currentColor`, one `--icon` token (VIS-11) |
| **Text alignment** | `.hdr` left in the file manager, right in the inspector — deliberate mirroring per the design; keep | — |
| **Capitalisation** | Four conventions, `midi`/`MIDI` in one interface | Lowercase in-window, platform convention on OS surfaces, proper nouns always (VIS-10) |
| **Cursor** | `default` everywhere; the canvas never changes | Seven states on the canvas; `col-resize` on splitters (NAT-13, GEO-04) |
| **Tooltips** | Native `title=` on some controls, absent on tabs, window controls and rows; Title Case among lowercase labels | Keep native `title` (correct choice — it is the platform's tooltip); add the missing ones; include accelerators on toolbar buttons (NAT-04, VIS-10) |
| **Loading** | None; Monaco loads eagerly so its absence is never visible; long saves block silently | Editor loading state (ARCH-08); progress for long ops (NAT-19) |
| **Empty states** | Two blank voids in the file manager on every launch | One line + one action per list (VIS-12) |
| **Error states** | `#ff8f8f` text, colour-only; save failures now reach a native dialog regardless of tab (BUG-07, shipped) but are still colour-only and unannounced otherwise | Icon + colour; live region (VIS-14, A11Y-05, A11Y-08) |
| **Context menus** | DOM divs, no keyboard, no semantics, clamps instead of flipping | Native `Menu.popup()` (NAT-05) |
| **Dialogs** | One message box, no `detail`, non-platform wording and button order | Per-platform template (NAT-21) |
| **Forms** | Borders now visible via `--control-border` (VIS-02, done); still: a native `<select>` among flat custom fields; the inline rename input is a second, different text field | `appearance: none` on the select control only; one shared `.field` class (NAT-16, VIS-15) |
| **Buttons** | Text-only, no border except `.act`, no pressed state, `.acts` and `.hdr button` and `#add` all differently sized | One button component with size variants (VIS-07, GEO-08) |
| **Resizers / splitters** | Do not exist | Four splitters, keyboard-operable (GEO-04) |
| **Panels** | Flat, no elevation, fixed widths, not collapsible | Elevation, proportional widths, collapsible sections (GEO-03, GEO-05, VIS-09) |
| **Overlays** | One `z-index: 10`, no layering rule | `--z-*` scale (GEO-01 token block) |
| **Animation** | None at all | Three tokens, applied to states and panels, with `prefers-reduced-motion` (VIS-08) |
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
zoom controls, an indicator, and a fit that actually fits (UX-04); a visible
active tool (UX-06); cursor feedback for every gesture (NAT-13); Escape cancels
and reverts a gesture (UX-12); trackpad scroll pans instead of zooming
(NAT-11).

**Navigating** — a vertical scrollbar (GEO-10); resizable panels that remember
their size (GEO-04); tabs that overflow into a scroller instead of vanishing
(UX-16); keyboard tab switching (NAT-14).

**Files and scripts** — double-click to open a script (UX-01); row menus that
carry row actions only (UX-02); rename that validates as you type and does not
throw away your text (UX-15 — MIDI renaming no longer mangles the name,
BUG-06, shipped, see "Already completed"); delete-in-use offering reassignment
instead of refusal (UX-13); MIDI export and metadata (UX-18).

**Trust and recovery** — atomic saves, an honest dirty flag, and save failures
that are impossible to miss are shipped (BUG-02, BUG-03, BUG-07 — see "Already
completed"). Still open: a `.bak` on overwrite and crash-recovery snapshots
(UX-10); playability warnings before the game rejects the level (BUG-11);
destructive actions that report what they did (UX-08).

**Feedback** — status messages that expire, errors that do not, plus persistent
zoom/size/entity-count/tool fields (VIS-14, UX-06); progress for long
operations (NAT-19); undo and redo are visible in the Edit menu now (NAT-01,
shipped) but still need to say what they undid rather than how many steps
remain (UX-03).

---

## 9. Accessibility summary

Studio is currently **not operable without a pointer**. Contrast and focus
visibility — previously the main reason the interface read as unfinished —
are fixed (VIS-01, VIS-02, VIS-06, see "Already completed").

| Requirement | Status | Fix |
|---|---|---|
| 1.4.1 Use of Colour | Fail — disabled, error and selected states are colour-only | A11Y-08, VIS-07 |
| 1.4.3 Contrast (Minimum) | Fixed — was 2.5–2.9:1, now 4.77–5.91:1 for the affected text | VIS-01, done |
| 1.4.11 Non-text Contrast | Fixed — was 1.18:1, now 3.12–3.59:1 for control borders | VIS-02, done |
| 1.4.12 Text Spacing | Fail — all-`px` layout, no response to OS text size | A11Y-06 |
| 2.1.1 Keyboard | Fail — palette, rows, tabs, menu, canvas all unreachable | A11Y-01, A11Y-03 |
| 2.4.3 Focus Order | Fail — 17 focusable elements, no defined order | A11Y-01 |
| 2.4.7 Focus Visible | Fixed — global `:focus-visible` rule, nothing left to suppress it | VIS-06, done |
| 2.5.8 Target Size | Fail — 12 px window controls, ~7 px tab close, 20 px rows | A11Y-04 |
| 4.1.2 Name, Role, Value | Fail — zero `role`/`aria-*` in the application | A11Y-02 |
| 4.1.3 Status Messages | Fail — nothing is announced | A11Y-05 |
| 2.3.3 Animation from Interactions | N/A today; becomes required with VIS-08 | VIS-08, A11Y-07 |
| System high contrast | Untested; will break canvas indicators | A11Y-07, VIS-16 |

The highest-leverage accessibility work remaining is not ARIA. It is, in
order: **(1)** replace clickable `<div>`s with real controls (A11Y-01) — this
is where the effort is, and it fixes keyboard, focus order and semantics
together; **(2)** adopt native menus (NAT-05), which deletes an entire
inaccessible subsystem rather than fixing it.

---

## 10. Architecture and code quality summary

**Keep.** The process split; `lvl.js` as the single validator; the `Uint16Array`
mirror and `Grid.commit()` contract; the cell-diff undo model; viewport culling
and device-pixel snapping; the `app://` protocol and its documented reason; the
minimal preload surface; the comment style that explains decisions rather than
code; the flat global scope with its documented collision grep.

**Fix.**

| Problem | Finding |
|---|---|
| `W` defined twice, `H`/`B` handled three different ways | ARCH-02 |
| No platform abstraction; no platform info in the renderer | ARCH-03 |
| Full innerHTML rebuilds on a drag hot path; hand-rolled `esc()` | ARCH-04, PERF-01 |
| Three IPC naming conventions, two response shapes, forgettable `cancel` | ARCH-06 |
| Magic integers crossing the IPC boundary | BUG-10 |
| Renderer implementing window controls and title logic (the menu moved to main, NAT-01, shipped) | NAT-02, NAT-03, NAT-05 |
| Monaco eager and shipped whole | ARCH-08 |
| Synchronous main-process I/O | ARCH-09, NAT-19 |
| Colour defined in four places | VIS-04 |
| Two components styling themselves with inline `cssText` | VIS-15 |
| `App.open_`'s trailing underscore | ARCH-06 |
| Prefix-only path containment in the protocol handler | BUG-13 |
| No `will-navigate` / `setWindowOpenHandler` / `sandbox: true` | NAT-18 |

**Explicitly do not do.** Do not introduce a framework, a bundler, TypeScript
or ES modules. Do not convert the flat global scope. Do not add a state
container. Do not index the entity list until entity counts justify it
(PERF-03). Do not build a light theme (NAT-15) or a custom `<select>` popup
(NAT-16). Each of these would add more than it removes at this size.

---

## 11. Performance summary

The renderer is already carefully built. Four real problems, three
non-problems, in priority order.

**Fix:**
1. **PERF-01** — the inspector's HTML is rebuilt from a string on every cell of
   an entity drag. The one measurable hot-path defect.
2. **PERF-02** — `getBoundingClientRect` and `getElementById` called on every
   frame, with a style write between the read and the next read (layout
   thrash), during every pan and drag.
3. **PERF-04** — canvas backing store reallocated on every `ResizeObserver`
   callback; becomes a stutter as soon as splitters exist (GEO-04).
4. **ARCH-08** — Monaco loaded eagerly at startup for a tab most sessions never
   open, and packaged whole.

**Also worth doing:**
5. **PERF-05** — `App.refresh()` rebuilds every view for every undo step; walk
   back a long history and the whole UI is rebuilt per step.
6. **PERF-07** — the window is shown before the document exists.

**Measure before touching:**
7. **PERF-06** / **NAT-19** — `Grid.commit()` + `JSON.stringify` + `zipSync` on
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
| Window controls | ⚠️ fake dots | ❌ wrong side, wrong shape | ❌ ignores user's button-layout setting | NAT-02 |
| Green button semantics | ❌ zooms, should full-screen | n/a | n/a | NAT-02 |
| Window title | ⚠️ shows full path + `*` | ⚠️ no dirty state in OS title | ⚠️ same | NAT-03 |
| Proxy icon / edited dot | ❌ | n/a | n/a | NAT-03 |
| Context menus | ❌ DOM | ❌ DOM | ❌ DOM (ignores GTK theme) | NAT-05 |
| File dialogs | ✅ | ✅ | ✅ | — |
| Save extension handling | ✅ shipped (BUG-04, BUG-05) | ✅ shipped (BUG-04, BUG-05) | ✅ shipped (BUG-04, BUG-05) | — |
| Unsaved-changes dialog | ⚠️ wrong wording | ⚠️ wrong order, may render as links | ⚠️ wrong case | NAT-21 |
| Recent documents | ❌ | ❌ | ❌ | NAT-06 |
| File association / launch by file | ❌ | ❌ | ❌ | NAT-07 |
| Single instance | ❌ n/a in practice | ❌ | ❌ | NAT-08 |
| Drag and drop | ❌ navigates away, losing work | ❌ | ❌ | NAT-09 |
| Dock / taskbar integration | ❌ | ❌ | ❌ | NAT-06, NAT-17 |
| Window state persistence | ❌ | ❌ | ❌ | NAT-10 |
| Default window size | ⚠️ too large for 13" | ⚠️ too large for 1366×768 | ⚠️ | NAT-10 |
| Mixed-DPI / scaling | ⚠️ blurry on move | ⚠️ blurry (most common here) | ⚠️ Wayland fractional | BUG-12 |
| Trackpad scroll vs pinch | ❌ scroll zooms | ❌ precision touchpad same | ⚠️ | NAT-11 |
| Right-click semantics | ❌ Ctrl+click erases | ✅ | ✅ | NAT-12 |
| Keyboard shortcuts | ⚠️ conflicts with default menu; layout-dependent | ⚠️ same | ⚠️ same | NAT-14 |
| Scrollbars | ⚠️ hidden by overlay default | ❌ visible and unstyled | ❌ visible and unstyled | NAT-20 |
| Fonts | ⚠️ falls back to SF Mono | ⚠️ Consolas | ⚠️ DejaVu | VIS-05 |
| High contrast / forced colours | ⚠️ Increase Contrast ignored | ❌ untested, will break | ⚠️ | A11Y-07 |
| Reduced motion | n/a (no motion) → required with VIS-08 | same | same | VIS-08, A11Y-07 |
| Screen reader | ❌ VoiceOver reaches nothing | ❌ Narrator | ❌ Orca | A11Y-01, A11Y-02 |
| Notifications | ❌ | ❌ | ❌ | NAT-19 |
| Full screen | ❌ regression: the default menu's Toggle Full Screen (⌃⌘F) had no replacement when NAT-01's own menu shipped without a View menu | ⚠️ | ⚠️ | needs a new View menu item, unfiled |
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

| ID | Title |
|---|---|
| NAT-02 | Fake macOS traffic lights on every platform |
| A11Y-01 | Most of the interface is unreachable by keyboard |

BUG-01, BUG-02, BUG-07, NAT-01, VIS-01, VIS-02 and VIS-06, the other six items
that were listed here, are done — see "Already completed" at the top of this
document.

### High — the difference between "works" and "finished"

| ID | Title |
|---|---|
| BUG-12 | DPI change leaves the canvas blurry |
| NAT-03 | Title, dirty state and proxy icon ignore every convention |
| NAT-04 | Hotbar duplicates what belongs in the menu |
| NAT-05 | DOM context menus instead of native |
| NAT-07 | No packaging, icons, or file association |
| NAT-10 | Window geometry fixed and never remembered |
| NAT-11 | Wheel always zooms; trackpad gestures misread |
| NAT-13 | No cursor feedback |
| NAT-20 | One of five scroll containers styled |
| NAT-21 | Unsaved-changes dialog written to no platform's convention |
| GEO-01 | No spacing, sizing or type scale |
| GEO-03 | Fixed side panels consume 41 % of the minimum window |
| GEO-04 | Panels cannot be resized |
| GEO-07 | Palette produces fractional cells for 32 px sprites |
| GEO-11 | Canvas magic numbers |
| VIS-04 | Colour defined in four independent places |
| VIS-05 | The app has never rendered in its own typeface |
| VIS-07 | No interaction-state system |
| UX-04 | Zoom has no controls, indicator, or working fit |
| UX-10 | No autosave, crash recovery, or backup |
| ARCH-02 | `W` defined twice |
| ARCH-03 | No platform abstraction |
| ARCH-08 | Monaco eager and shipped whole |
| PERF-01 | Inspector rebuilt from a string on every drag cell |

### Medium — real friction, contained fixes

| ID | Title |
|---|---|
| BUG-10 | Magic integers across IPC |
| BUG-11 | Nothing checks that a level is playable |
| BUG-13 | Prefix-only path containment |
| NAT-06 | No recent documents |
| NAT-08 | No single-instance lock |
| NAT-09 | No drag and drop (and drop currently navigates away) |
| NAT-12 | Right-click erases; Ctrl+click collision on macOS |
| NAT-14 | Command set is thin: zoom, tab switching, region operations |
| NAT-16 | Native `<select>` among custom fields |
| NAT-18 | `sandbox`, `will-navigate`, `setWindowOpenHandler` |
| GEO-02, GEO-05, GEO-06, GEO-08, GEO-09 | Band heights, list splits, one-offs |
| GEO-10 | No vertical scrollbar |
| VIS-03, VIS-08, VIS-09, VIS-10, VIS-11 | Design divergence, motion, radius/elevation, capitalisation, icons |
| VIS-12, VIS-14, VIS-15, VIS-16, VIS-18 | Empty states, status messages, inline `cssText`, canvas indicators, Monaco theme |
| UX-01, UX-03, UX-05, UX-06, UX-08, UX-09, UX-12, UX-15, UX-16 | Editing and navigation friction |
| A11Y-02, A11Y-03, A11Y-04, A11Y-05, A11Y-06 | Semantics, canvas, targets, announcements, scaling |
| ARCH-04, ARCH-06 | Panel rebuilds, IPC shape |
| PERF-02, PERF-04, PERF-07 | Layout thrash, resize coalescing, startup paint |

### Low

| ID | Title |
|---|---|
| NAT-15 | System preference handling (contrast, forced colours) |
| NAT-17 | Dock menu, JumpList tasks (About panel already shipped, NAT-01) |
| NAT-19 | Feedback for long operations |
| GEO-12, GEO-13 | Window sizing (folded into NAT-10); unadopted design proportions |
| VIS-13, VIS-17 | Playtest button communication; missing-texture swatches |
| UX-02, UX-11, UX-13, UX-14, UX-17, UX-18 | Menu contents, preferences, in-use script deletion, silent script creation, numeric rounding, MIDI opacity |
| A11Y-07, A11Y-08 | System accessibility preferences; colour-only states |
| ARCH-05, ARCH-09 | Global scope hygiene; synchronous I/O |
| PERF-05, PERF-06 | Refresh granularity; commit allocation |

### Nice to have — genuinely optional, none of it required to call Studio polished

- Minimap / overview strip rendered into the `#hbar` track (UX-04).
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
it.

1. **ARCH-03** — `chrome.js` in main, `api.platform` to the renderer,
   `<html data-platform>`. Unblocks NAT-02, NAT-04, NAT-21, VIS-10. Also
   folds in `menu.js`'s own `process.platform` branch, which NAT-01 added
   outside this module and which is exactly the drift this step exists to stop.
2. **GEO-01 + VIS-04** — the token block, in one commit: spacing, rows, type,
   radius, elevation, motion, z-index, plus the `tokens.js` reader that
   `grid.js` and `code.js` consume. The colour half of this block (VIS-01,
   VIS-02) is already shipped — see "Already completed" — so this step is
   narrower than originally scoped: everything except colour. Unblocks every
   remaining visual finding. Nothing in §7 should be attempted before this
   lands.
3. **ARCH-02** — one definition of `W`/`H`/`B`. Trivial, do it while touching
   `lvl.js`.

### Phase 2 — Native shell

**NAT-01** (menu template + `productName` + `setName` + About panel, Reload/
DevTools behind `!app.isPackaged`) is done and **closed BUG-01** — see
"Already completed". **BUG-09** (renderer-death handling) is also done, so the
wedge risk that a hung renderer posed under NAT-01's ⌘Q → `app.quit()` path is
already closed.

4. **NAT-18** `will-navigate`, `setWindowOpenHandler`, `sandbox: true` — closes
   the drag-and-drop navigation hole (NAT-09) that BUG-01's own fix did not
   cover.
5. **NAT-02** real window chrome per platform; delete the fake dots and
   `win:ctl`.
6. **NAT-03** title, represented filename, edited dot (needs 5; document
   identity itself is already in main, BUG-08, done).
7. **NAT-04** hotbar per platform (needs 1; the menu itself no longer blocks
   this).
8. **NAT-05** native context menus; delete `#menu` and ~55 lines of `app.js`.
   Reuse the `cmd`/`ACTS` dispatcher NAT-01 already built rather than adding a
   second one.
9. **NAT-21** dialog per platform; **BUG-10** string verdicts.
10. **NAT-10** window state persistence with display validation.
11. **NAT-07** packaging, icons, associations; **NAT-08** single instance;
    **NAT-06** recent documents; **NAT-09** drag and drop. These four are one
    coherent piece of work and share prerequisites — all can build directly on
    the `doc` module (BUG-08, done).

### Phase 3 — Design system made real

The contrast/focus-ring step originally scheduled here (VIS-01, VIS-02,
VIS-06) is done — see "Already completed" — so this phase starts one step
later than originally scoped.

12. **VIS-05** bundle JetBrains Mono. Everything after this is measured in the
    real typeface, so it must precede any type-metric work.
13. **VIS-07** the five-state contract, applied to every interactive surface.
14. **VIS-09 / VIS-08 / VIS-11 / VIS-10** radius and elevation, motion, icons,
    capitalisation.
15. **NAT-20 / GEO-09** one scrollbar treatment across all five containers;
    **VIS-18** Monaco theme generated from tokens.
16. **GEO-07** integer palette cells; **GEO-02 / GEO-08** band heights and
    one-offs onto the scale.
17. **VIS-12 / VIS-14 / VIS-15 / VIS-16 / VIS-17** empty states, status
    messages, `.field`/`.cell.add` classes, canvas indicators, missing-texture
    treatment.

### Phase 4 — Layout and interaction

18. **PERF-04** resize coalescing — **before** GEO-04, or splitter drags will
    stutter.
19. **GEO-03 / GEO-04** proportional panels and four keyboard-operable
    splitters; **GEO-05 / GEO-06** content-driven list and inspector heights.
20. **NAT-11** wheel semantics; **GEO-11** named canvas constants;
    **GEO-10** vertical scrollbar; **UX-04** zoom controls and a real fit,
    including the new View menu that also gives Toggle Full Screen a home
    again (see §12, "Full screen").
21. **NAT-13** cursors; **NAT-12** canvas context menu and Ctrl+click;
    **UX-12** gesture cancel.
22. **PERF-01** `Panel.update()` split (with **ARCH-04**); **PERF-02** cached
    rect and refs.
23. **UX-16** tab overflow; **NAT-14** the remaining missing commands (zoom,
    tab switching, region operations — the menu/shortcut consolidation itself
    is done, NAT-01).

### Phase 5 — Accessibility completion

24. **A11Y-01** real controls with roving tabindex — palette, rows, tabs. The
    largest single piece of work in this document.
25. **A11Y-02** semantics and landmarks; **A11Y-05** live regions.
26. **A11Y-04** hit targets (mostly free once GEO-01's `--row` lands).
27. **A11Y-03** canvas keyboard cursor (its focus-ring dependency, VIS-06, is
    already in place); **A11Y-06** scaling; **A11Y-07** system preferences;
    **A11Y-08** non-colour cues.

### Phase 6 — Reliability and remaining QOL

28. **UX-10** recovery snapshots and `.bak` (its dependencies, BUG-02's atomic
    write and BUG-08's `doc` module, are already in place); **BUG-11**
    playability warnings.
29. **ARCH-08** lazy Monaco; **PERF-07** show-after-ready; **PERF-05** refresh
    granularity.
30. **ARCH-06** IPC envelope; **BUG-13** path containment; **ARCH-09 / NAT-19**
    async I/O *if* measurement justifies it.
31. **UX-01 / UX-02 / UX-03 / UX-05 / UX-06 / UX-08 / UX-09 / UX-13 / UX-14 /
    UX-15 / UX-17** — the remaining workflow items, each independent. UX-03 is
    narrower than originally scoped: the menu items themselves already exist
    (NAT-01), only per-action labelling is left. UX-15 is also narrower: the
    contrast and MIDI-collision problems it cited are already fixed (VIS-01,
    BUG-06).
32. **NAT-15 / NAT-17 / UX-11 / UX-18 / VIS-13** — the low-priority tail.
    NAT-17 is narrower too: the About panel already shipped (NAT-01), only the
    Dock menu and JumpList tasks are left.

### Dependency summary

```
ARCH-03 (platform) ───┬─► NAT-02 ─► NAT-03, NAT-04
                      ├─► NAT-21, VIS-10
                      └─► absorbs menu.js's own process.platform branch (NAT-01)
GEO-01 + VIS-04 ──────┬─► VIS-07, VIS-08, VIS-09
   (tokens; colour     ├─► GEO-02, GEO-07, GEO-08, GEO-09, NAT-20, VIS-18
   half already done)  └─► NAT-02 (traffic-light position, overlay colours)
VIS-05 (font) ────────► anything depending on type metrics
PERF-04 ──────────────► GEO-04 (splitters)
A11Y-01 ──────────────► A11Y-02, A11Y-03, A11Y-04
NAT-05 ───────────────► deletes an entire inaccessible subsystem

Done and no longer on this graph: ARCH-07 (checks) unblocked everything below
it by making every later change verifiable at all; BUG-08 (doc state)
unblocked NAT-03, NAT-06, NAT-07, NAT-08, NAT-10, UX-10, all of which can now
build on it directly; BUG-09 closed the live gap NAT-01 opened;
VIS-01/VIS-02/VIS-06 unblocked nothing else in this graph (the rest of
GEO-01/VIS-04 does not depend on them).
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
- [ ] macOS uses real traffic lights via `hiddenInset`; Windows uses
      `titleBarOverlay`; Linux uses `titleBarOverlay` or a WM-decorated frame.
      The fake dots do not exist in the codebase.
- [ ] The window title follows each platform's convention; macOS shows a proxy
      icon and an edited dot.
- [ ] Every context menu is a native `Menu.popup()`.
- [ ] Double-clicking a `.lvl` in Finder, Explorer and a Linux file manager
      opens it in a running (single) instance.
- [ ] Recent documents appear in File → Open Recent, the macOS Dock menu, and
      the Windows JumpList.
- [ ] Dropping a `.lvl` on the window or the Dock icon opens it; dropping
      anything never navigates the shell away.
- [ ] Window size, position, maximised and fullscreen state survive a restart,
      and a saved position on a disconnected display falls back gracefully.
- [ ] The default window fits within the primary display's work area on a
      1366 × 768 screen without being resized by the OS.
- [ ] On a trackpad, two-finger scroll pans and pinch zooms.
- [ ] Packaged, signed and notarised/Authenticode-signed artefacts exist for
      all three platforms and launch on a clean machine.

### Geometry

- [ ] No pixel literal exists in `style.css` outside the `:root` token block,
      except values documented in §6.3 with a stated reason.
- [ ] No unnamed numeric constant exists in `grid.js`'s camera, zoom or render
      paths.
- [ ] Every band height derives from the line box.
- [ ] Side panels are proportional, clamped, user-resizable, and their sizes
      persist.
- [ ] Palette cells are an integer multiple of 32 px, and the column count —
      not the cell size — changes with the panel width.
- [ ] The layout is coherent and usable at the minimum window size, at
      1366 × 768, at 2560 × 1440, and maximised on an ultrawide.
- [ ] The canvas is pixel-crisp at 1×, 2× and fractional scaling, and stays
      crisp when the window moves between displays of different DPI.

### Visual

- [ ] Colour, type, spacing, radius, elevation, motion and z-index each have
      exactly one definition; `grid.js` and `code.js` consume it rather than
      restating it.
- [ ] The app renders in JetBrains Mono, bundled, identically on all three
      platforms.
- [ ] Every interactive surface implements the same five states (rest, hover,
      active, selected, disabled), plus a composable focus ring.
- [ ] All five scroll containers share one treatment, and the layout does not
      shift between overlay and classic scrollbars.
- [ ] Motion is tokenised and honours `prefers-reduced-motion`.
- [ ] Every list has an empty state; every error has an icon, a colour and a
      message that persists until acted on.
- [ ] The Monaco editor's palette matches the surrounding chrome, including
      scrollbars, widgets and lists.
- [ ] `CLAUDE.md`'s "Deviations from the design file" section records every
      remaining divergence from `Pellizzola Brothers.svg`, with a reason.

### Accessibility

- [ ] Every function of the application is reachable and operable with the
      keyboard alone, including placing and erasing tiles.
- [ ] A visible focus indicator appears on every focusable element, and focus
      order is logical.
- [ ] All text meets WCAG AA (4.5:1, or 3:1 at ≥18.66 px bold / 24 px);
      all control boundaries and focus indicators meet 3:1. Verified with a
      contrast checker, not by eye.
- [ ] No state is communicated by colour alone.
- [ ] All hit targets are at least 24 × 24 px.
- [ ] Status messages and errors are announced by a screen reader.
- [ ] The app is usable under Windows High Contrast, `prefers-contrast: more`,
      and OS text scaling.
- [ ] A VoiceOver, Narrator and Orca pass each reach and describe the file
      list, tabs, palette, inspector and canvas.

### Correctness and reliability

- [ ] It is not possible to lose unsaved work through reload, navigation,
      drag-drop, quit, window close, or a renderer crash.
- [ ] Saves are atomic; a previous good file is never replaced by a partial
      one; an overwrite leaves a `.bak`.
- [x] A save failure is impossible to miss from any tab. (BUG-07)
- [x] The dirty indicator is true: undoing to the opened state clears it,
      redoing past it restores it. (BUG-03)
- [ ] Recovery snapshots exist and a crash offers to restore them.
- [ ] The editor warns — without blocking — about levels the game cannot run
      (missing or duplicate start/end, dangling script references,
      out-of-bounds entities).
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
- [ ] Exactly two places contain platform branches: `chrome.js` in main, and
      `[data-platform]` selectors in CSS.
- [ ] `W`, `H` and `B` are each defined once.
- [ ] `npm run dist` produces installable artefacts for all three platforms.
- [ ] `CLAUDE.md` is updated to describe the new architecture — main-owned
      document state, the menu, the platform module, the token system — so the
      next reader does not have to rediscover any of it.

### Performance

- [ ] Dragging an entity across a level holds 60 fps with the inspector open.
- [ ] Panning and zooming perform no forced synchronous layout per frame.
- [ ] Dragging a splitter does not stutter.
- [ ] Cold start to an interactive Level Editor is under one second on a
      mid-range machine, with Monaco loaded lazily.
- [ ] Saving a 999-row level completes without the window becoming
      unresponsive, or shows honest progress if it cannot.
