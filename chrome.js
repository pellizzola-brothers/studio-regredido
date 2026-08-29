/* chrome.js - every branch on process.platform that affects the window, in
 * one place (main process only).
 *
 * Before this module existed, the same distinction (macOS vs. everyone else)
 * was made independently wherever a feature needed it: main.js's
 * window-all-closed guard, main.js's own discardbuttons() (NAT-21), and
 * menu.js's appMenu/windowMenu split (added when NAT-01 shipped) - three
 * sites that could each drift out of step with the other two.  This is now
 * the only one.  The renderer's own platform awareness comes from
 * `api.platform` (preload.js) and the `<html data-platform>` attribute it
 * drives, so no JavaScript in the renderer branches on process.platform at
 * all - only `[data-platform=...]` CSS selectors do (ARCH-03). */
'use strict';

const mac = process.platform === 'darwin';
const win32 = process.platform === 'win32';

/* --row-lg in style.css: the height every platform's native window controls
 * must line up with.  Duplicated here for the same reason main.js's
 * `backgroundColor` duplicates --frame (VIS-04, done - see "Already
 * completed" in POLISH.md) - real window chrome has to be described to the
 * OS before any CSS has loaded. */
const BAR = 34;

/* Real per-platform window controls (NAT-02) in place of the hand-drawn
 * traffic-light dots every platform used to get regardless of which OS it
 * was: macOS gets its own inset traffic lights, Windows draws its own
 * caption buttons over the title bar, and Linux - where control placement
 * and order are a user-configurable desktop setting
 * (org.gnome.desktop.wm.preferences.button-layout on GNOME), not something
 * an app should hard-code - keeps a real WM-decorated frame. */
function windowoptions()
{
	if (mac)
		return {
			titleBarStyle: 'hiddenInset',
			/* 14px traffic lights (the design's own size, POLISH.md VIS-03)
			 * centred in the BAR-tall title row, 12px in from the left edge
			 * to match #title's own padding. */
			trafficLightPosition: {x: 12, y: (BAR - 14) / 2}
		};
	if (win32)
		return {
			titleBarStyle: 'hidden',
			titleBarOverlay: {color: '#1c1d20', symbolColor: '#b9a6d6', height: BAR}
		};
	/* Electron's titleBarOverlay support on Linux is inconsistent across
	 * desktops (Wayland-only in practice, as of this writing) and untestable
	 * on the machine this shipped from - guessing at it wrong would be worse
	 * than not trying.  frame: true (Electron's default - no key needed) is
	 * the fallback the audit itself asks for: it hands window controls back
	 * to the WM, which is correct on every desktop, unlike either overlay
	 * mode or the old hard-coded macOS-shaped dots. */
	return {};
}

/* Button words, order, defaultId and cancelId for the unsaved-changes dialog
 * (NAT-21): macOS wants the affirmative rightmost and says "Don't Save";
 * Windows wants the same words in Save/Don't Save/Cancel order; GNOME orders
 * the destructive action leftmost and says "Discard".  `map` says which
 * verdict each button index means, so the two can never drift apart the way
 * a bare response index (BUG-10) once invited them to. */
function discardbuttons()
{
	if (mac)
		return {buttons: ['Cancel', 'Don\'t Save', 'Save'],
			map: ['cancel', 'discard', 'save'], defaultId: 2, cancelId: 0};
	if (win32)
		return {buttons: ['Save', 'Don\'t Save', 'Cancel'],
			map: ['save', 'discard', 'cancel'], defaultId: 0, cancelId: 2};
	return {buttons: ['Discard', 'Cancel', 'Save'],
		map: ['discard', 'cancel', 'save'], defaultId: 2, cancelId: 1};
}

/* VIS-10: OS-facing surfaces (the menu bar, native context menus, dialog
 * titles and buttons) want each platform's own capitalisation convention -
 * Title Case on macOS and Windows, Sentence case on GNOME - so every one of
 * those strings is authored once, in Title Case, and this converts it for
 * Linux at the one place each reaches the OS (menu.js's template, main.js's
 * dialog/native-menu calls). Only the first word (already correctly
 * capitalised) and an all-caps word are left alone - the same test that
 * protects a real acronym (MIDI) also happens to leave a bare number or
 * symbol token (a button's own "100%") untouched, since upper-casing either
 * is a no-op. Never applied to user-authored content (a filename, an entity
 * definition id) - callers concatenate that in afterward, unconverted. */
function oscase(s)
{
	if (mac || win32)
		return s;
	return s.split(' ').map((w, i) => i === 0 || w === w.toUpperCase() ? w : w.toLowerCase()).join(' ');
}

module.exports = {mac, win32, platform: process.platform, windowoptions, discardbuttons, oscase};
