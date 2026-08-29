/* menu.js - the application's real menu bar (main process only).
 *
 * Replaces Electron's default menu, which shipped the app as "Electron",
 * exposed Reload and DevTools to end users, and gave Reload (CmdOrCtrl+R) no
 * unsaved-changes guard at all - the app's own commands never appeared in it.
 *
 * Rebuilt from scratch on every renderer state change rather than mutated in
 * place: the template is small, and a disabled item's accelerator is also
 * inert, which is what lets Undo/Redo hand CmdOrCtrl+Z back to Monaco while a
 * script tab is open instead of racing it. */
'use strict';

const {app, Menu} = require('electron');
const path = require('path');
const chrome = require('./chrome');

const mac = chrome.mac;

/* VIS-10: the menu bar is an OS-facing surface, so every label below is
 * authored once, in Title Case (macOS/Windows own convention), and L()
 * converts it to GNOME's own Sentence case at the one place each reaches
 * the OS - chrome.oscase() is a no-op on macOS/Windows. Never applied to
 * `recent`'s own entries (path.basename(p), below): those are filenames,
 * not chrome text, and must reach the OS exactly as written on disk. */
const L = chrome.oscase;

/* state: {tab, canUndo, canRedo, undoLabel, redoLabel} - mirrors what the
 * renderer can currently do. `recent` is main's own persisted path list
 * (NAT-06) - existence-filtered by loadrecent() before it ever reaches here,
 * so nothing further needs checking at build time. `onclear` empties it. */
function template(win, state, recent, onclear)
{
	const send = name => () => win.webContents.send('cmd', name);
	const onlevel = state.tab === 'level';

	/* NAT-06: a path the menu already knows still has to reach the renderer's
	 * own unsaved-changes guard before it replaces the open document - a
	 * dedicated channel rather than 'cmd', which carries no arguments. */
	const openrecent = {
		label: L('Open Recent'),
		submenu: recent.length ?
			recent.map(p => ({
				label: path.basename(p),
				click: () => win.webContents.send('open-recent', p)
			})).concat([{type: 'separator'}, {label: L('Clear Menu'), click: onclear}]) :
			[{label: L('No Recent Documents'), enabled: false}]
	};

	const file = {
		label: L('File'),
		submenu: [
			{label: L('New Level'), accelerator: 'CmdOrCtrl+N', click: send('new')},
			{label: L('Open…'), accelerator: 'CmdOrCtrl+O', click: send('open')},
			openrecent,
			{type: 'separator'},
			{label: L('Save'), accelerator: 'CmdOrCtrl+S', click: send('save')},
			{label: L('Save As…'), accelerator: 'CmdOrCtrl+Shift+S', click: send('saveas')},
			{type: 'separator'},
			{label: L('Close Tab'), accelerator: 'CmdOrCtrl+W', enabled: !onlevel, click: send('closetab')}
		]
	};
	if (!mac)
		/* UX-11: "Settings" on Windows (the finding's own word choice - not
		 * "Preferences", which it reserves for GNOME); the mac item lives in
		 * the App menu instead, below, which is that platform's own
		 * convention for it. */
		file.submenu.push({type: 'separator'}, {label: L('Settings…'), accelerator: 'CmdOrCtrl+,', click: send('settings')},
			{type: 'separator'}, {role: 'quit', label: L('Exit')});

	/* UX-03: "Undo"/"Redo" alone said nothing about what they would act on -
	 * cap() gives each step's own lowercase label ("paint", "move entity")
	 * the Title Case the rest of this OS-facing menu already uses; L() then
	 * carries that whole string (app-generated vocabulary, not user data,
	 * so safe to convert) through the same GNOME sentence-case pass as
	 * every other item here. */
	const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
	const edit = {
		label: L('Edit'),
		submenu: [
			{label: L('Undo' + (state.undoLabel ? ' ' + cap(state.undoLabel) : '')),
				accelerator: 'CmdOrCtrl+Z', enabled: onlevel && state.canUndo, click: send('undo')},
			{label: L('Redo' + (state.redoLabel ? ' ' + cap(state.redoLabel) : '')),
				accelerator: 'CmdOrCtrl+Shift+Z', enabled: onlevel && state.canRedo, click: send('redo')},
			{type: 'separator'},
			/* UX-05: duplicates the selected entity; a no-op with nothing
			 * selected (App.say()s so, ACTS.duplicate -> Grid.duplicate()) -
			 * the menu has no way to know whether one is selected, matching
			 * how Undo/Redo are gated only by tab, not by document state the
			 * renderer alone tracks. */
			{label: L('Duplicate'), accelerator: 'CmdOrCtrl+D', enabled: onlevel, click: send('duplicate')},
			{type: 'separator'},
			{role: 'cut'},
			{role: 'copy'},
			{role: 'paste'},
			{role: 'selectAll'}
		]
	};

	/* UX-04: zoom had no command surface at all - wheel-only, no indicator, no
	 * fit that actually fit the level.  Also gives Toggle Full Screen a home
	 * again: the default menu's own Toggle Full Screen item had no replacement
	 * once NAT-01's menu shipped without a View menu at all. */
	const view = {
		label: L('View'),
		submenu: [
			{label: L('Zoom In'), accelerator: 'CmdOrCtrl+Plus', enabled: onlevel, click: send('zoomin')},
			{label: L('Zoom Out'), accelerator: 'CmdOrCtrl+-', enabled: onlevel, click: send('zoomout')},
			{label: L('Actual Size'), accelerator: 'CmdOrCtrl+0', enabled: onlevel, click: send('zoom100')},
			{type: 'separator'},
			{label: L('Fit Height'), enabled: onlevel, click: send('fitheight')},
			{label: L('Fit Scene Width'), enabled: onlevel, click: send('fitwidth')},
			{label: L('Fit Scene'), accelerator: 'CmdOrCtrl+9', enabled: onlevel, click: send('fitall')},
			{type: 'separator'},
			/* A11Y-06: independent of the canvas zoom above - this scales the
			 * chrome's own type (and, with it, the row heights built to hold a
			 * line of it), for OS text-size settings Electron gives no other
			 * hook into. CmdOrCtrl+Shift+ rather than the bare Plus/-/0 the
			 * canvas zoom already owns above. */
			{label: L('Increase Text Size'), accelerator: 'CmdOrCtrl+Shift+Plus', click: send('uitextinc')},
			{label: L('Decrease Text Size'), accelerator: 'CmdOrCtrl+Shift+-', click: send('uitextdec')},
			{label: L('Reset Text Size'), accelerator: 'CmdOrCtrl+Shift+0', click: send('uitextreset')},
			{type: 'separator'},
			/* NAT-14: Ctrl+Tab, not CmdOrCtrl+Tab - the bare Ctrl form is the
			 * cross-app convention for cycling tabs within a window (browsers,
			 * terminals) on every platform including macOS, where
			 * CmdOrCtrl+Tab is the OS's own application switcher and must not
			 * be shadowed. Lives here rather than in a new Window menu, which
			 * on macOS would collide with the native {role: 'windowMenu'}
			 * already pushed below under the same label. */
			{label: L('Next Tab'), accelerator: 'Control+Tab', click: send('nexttab')},
			{label: L('Previous Tab'), accelerator: 'Control+Shift+Tab', click: send('prevtab')},
			{type: 'separator'},
			/* VIS-13: a second, always-reachable route to the same explanation
			 * the tab strip's own ▶ button carries in its title= - unlike a
			 * tooltip, a disabled menu item never needs a hover to be seen at
			 * all, and toolTip (macOS only; Electron does not expose a native
			 * disabled-item tooltip on Windows/Linux) reaches a sighted mouse
			 * user who never taps Tab into the tab strip either. The button
			 * itself is left exactly as the design draws it (CLAUDE.md) -
			 * this adds a route, it does not replace one. */
			{label: L('Playtest'), enabled: false,
				toolTip: 'The game cannot load .lvl archives yet (game/todo.txt 3.1).'},
			{role: 'togglefullscreen'}
		]
	};

	const t = [];
	/* UX-11: `role: 'appMenu'` builds this whole submenu automatically, but
	 * specifying `submenu` at all - the only way to insert "Settings…" into
	 * it, macOS's own convention for where a Settings item lives - replaces
	 * that default outright rather than extending it, so About/Services/
	 * Hide/Quit are spelled out by hand here to keep everything the
	 * automatic version already gave for free. */
	if (mac)
		t.push({
			label: app.name,
			submenu: [
				{role: 'about'},
				{type: 'separator'},
				{label: 'Settings…', accelerator: 'Cmd+,', click: send('settings')},
				{type: 'separator'},
				{role: 'services'},
				{type: 'separator'},
				{role: 'hide'},
				{role: 'hideOthers'},
				{role: 'unhide'},
				{type: 'separator'},
				{role: 'quit'}
			]
		});
	t.push(file, edit, view);
	if (mac)
		t.push({role: 'windowMenu'});
	/* Reload and DevTools are development tools, not application features -
	 * a production build must not expose them (BUG-01: the default menu's
	 * unguarded Reload silently discarded the open level).  Even here Reload
	 * goes through the renderer's own unsaved-changes guard rather than a
	 * bare role: 'reload', which would bypass it exactly the same way. */
	if (!app.isPackaged)
		t.push({
			label: L('Develop'),
			submenu: [
				{label: L('Reload'), accelerator: 'CmdOrCtrl+R', click: send('reload')},
				{role: 'toggleDevTools'}
			]
		});
	/* About already lives in the App menu on mac (built above) - a Help menu
	 * whose only item was that same About was a Windows/Linux convention
	 * this platform never needed, now that the App menu is hand-built
	 * rather than the automatic `role: 'appMenu'` this finding's own
	 * Settings item had to replace. */
	if (!mac)
		t.push({label: L('Help'), submenu: [{role: 'about'}]});
	return t;
}

/* Cheaper and far simpler than mutating items in place, and state changes
 * (tab switch, undo depth) are infrequent. */
function set(win, state, recent, onclear)
{
	Menu.setApplicationMenu(Menu.buildFromTemplate(template(win, state, recent || [], onclear)));
}

module.exports = {set};
