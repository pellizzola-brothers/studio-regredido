/* tools/probe.js - drives the real app headlessly for manual verification.
 * Documented in CLAUDE.md ("Driving the app headlessly"); kept here as a
 * real command instead of a snippet to copy out by hand.
 *
 * Stubs the native dialogs so open/save/discard can be scripted, then runs
 * PB_STEPS (a JSON array of [name, js] pairs) through executeJavaScript once
 * the renderer has loaded - the renderer scripts share one global scope
 * (CLAUDE.md), so Grid/App/Panel/Code/Undo and their internals are reachable
 * from there.
 *
 * Env vars:
 *   PB_OPEN     path returned by a stubbed Open dialog
 *   PB_SAVEAS   path returned by a stubbed Save As dialog
 *   PB_ANSWER   button index returned by a stubbed message box (default 1)
 *   PB_STEPS    JSON array of [name, js] pairs to run in the renderer
 *   PB_SHOT     if set, a PNG of the window is written here before exit
 *   PB_WAIT     ms to wait after did-finish-load before running steps (3500) */
'use strict';

const {app, dialog} = require('electron');
const fs = require('fs');
const path = require('path');

dialog.showOpenDialog = async () => ({canceled: false, filePaths: [process.env.PB_OPEN]});
dialog.showSaveDialog = async () => ({canceled: false, filePath: process.env.PB_SAVEAS});
dialog.showMessageBox = async () => ({response: +(process.env.PB_ANSWER || 1)});

app.on('browser-window-created', (e, w) => {
	w.webContents.on('console-message', ev => ev.level >= 1 && console.log(ev.message));
	w.webContents.on('did-finish-load', () => setTimeout(async () => {
		for (const [n, js] of JSON.parse(process.env.PB_STEPS || '[]'))
			console.log(n, await w.webContents.executeJavaScript(js, true));
		if (process.env.PB_SHOT)
			fs.writeFileSync(process.env.PB_SHOT, (await w.capturePage()).toPNG());
		app.exit(0);
	}, +(process.env.PB_WAIT || 3500)));
});

require(path.join(__dirname, '..', 'main.js'));
