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
const chrome = require('./chrome');

const mac = chrome.mac;

/* state: {tab, canUndo, canRedo} - mirrors what the renderer can currently do. */
function template(win, state)
{
	const send = name => () => win.webContents.send('cmd', name);
	const onlevel = state.tab === 'level';

	const file = {
		label: 'File',
		submenu: [
			{label: 'New Level', accelerator: 'CmdOrCtrl+N', click: send('new')},
			{label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open')},
			{type: 'separator'},
			{label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save')},
			{label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveas')},
			{type: 'separator'},
			{label: 'Close Tab', accelerator: 'CmdOrCtrl+W', enabled: !onlevel, click: send('closetab')}
		]
	};
	if (!mac)
		file.submenu.push({type: 'separator'}, {role: 'quit', label: 'Exit'});

	const edit = {
		label: 'Edit',
		submenu: [
			{label: 'Undo', accelerator: 'CmdOrCtrl+Z', enabled: onlevel && state.canUndo, click: send('undo')},
			{label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', enabled: onlevel && state.canRedo, click: send('redo')},
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
function set(win, state)
{
	Menu.setApplicationMenu(Menu.buildFromTemplate(template(win, state)));
}

module.exports = {set};
