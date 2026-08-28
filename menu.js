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
		label: 'Open Recent',
		submenu: recent.length ?
			recent.map(p => ({
				label: path.basename(p),
				click: () => win.webContents.send('open-recent', p)
			})).concat([{type: 'separator'}, {label: 'Clear Menu', click: onclear}]) :
			[{label: 'No Recent Documents', enabled: false}]
	};

	const file = {
		label: 'File',
		submenu: [
			{label: 'New Level', accelerator: 'CmdOrCtrl+N', click: send('new')},
			{label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open')},
			openrecent,
			{type: 'separator'},
			{label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save')},
			{label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveas')},
			{type: 'separator'},
			{label: 'Close Tab', accelerator: 'CmdOrCtrl+W', enabled: !onlevel, click: send('closetab')}
		]
	};
	if (!mac)
		file.submenu.push({type: 'separator'}, {role: 'quit', label: 'Exit'});

	/* UX-03: "Undo"/"Redo" alone said nothing about what they would act on -
	 * cap() gives each step's own lowercase label ("paint", "move entity")
	 * the Title Case the rest of this OS-facing menu already uses. */
	const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
	const edit = {
		label: 'Edit',
		submenu: [
			{label: 'Undo' + (state.undoLabel ? ' ' + cap(state.undoLabel) : ''),
				accelerator: 'CmdOrCtrl+Z', enabled: onlevel && state.canUndo, click: send('undo')},
			{label: 'Redo' + (state.redoLabel ? ' ' + cap(state.redoLabel) : ''),
				accelerator: 'CmdOrCtrl+Shift+Z', enabled: onlevel && state.canRedo, click: send('redo')},
			{type: 'separator'},
			/* UX-05: duplicates the selected entity; a no-op with nothing
			 * selected (App.say()s so, ACTS.duplicate -> Grid.duplicate()) -
			 * the menu has no way to know whether one is selected, matching
			 * how Undo/Redo are gated only by tab, not by document state the
			 * renderer alone tracks. */
			{label: 'Duplicate', accelerator: 'CmdOrCtrl+D', enabled: onlevel, click: send('duplicate')},
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
		label: 'View',
		submenu: [
			{label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', enabled: onlevel, click: send('zoomin')},
			{label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', enabled: onlevel, click: send('zoomout')},
			{label: 'Actual Size', accelerator: 'CmdOrCtrl+0', enabled: onlevel, click: send('zoom100')},
			{type: 'separator'},
			{label: 'Fit Height', enabled: onlevel, click: send('fitheight')},
			{label: 'Fit Scene Width', enabled: onlevel, click: send('fitwidth')},
			{label: 'Fit Scene', accelerator: 'CmdOrCtrl+9', enabled: onlevel, click: send('fitall')},
			{type: 'separator'},
			{role: 'togglefullscreen'}
		]
	};

	const t = [];
	if (mac)
		t.push({role: 'appMenu'});
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
			label: 'Develop',
			submenu: [
				{label: 'Reload', accelerator: 'CmdOrCtrl+R', click: send('reload')},
				{role: 'toggleDevTools'}
			]
		});
	t.push({label: 'Help', submenu: [{role: 'about'}]});
	return t;
}

/* Cheaper and far simpler than mutating items in place, and state changes
 * (tab switch, undo depth) are infrequent. */
function set(win, state, recent, onclear)
{
	Menu.setApplicationMenu(Menu.buildFromTemplate(template(win, state, recent || [], onclear)));
}

module.exports = {set};
