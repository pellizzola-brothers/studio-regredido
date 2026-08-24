/* main.js - window, file dialogs and every filesystem touch.
 *
 * The renderer owns no fs access; it asks for work over the channels below.
 * Pages are served from app://studio/ rather than file:// so that Monaco's
 * web workers get a real, same-origin base URL to import from. */
'use strict';

const {app, protocol, net, ipcMain, dialog, BrowserWindow} = require('electron');
const path = require('path');
const fs = require('fs');
const {pathToFileURL} = require('url');
const lvl = require('./lvl');

const ROOT = __dirname;
const FILTERS = [{name: 'Level', extensions: ['lvl', 'json']}];

let win = null;

protocol.registerSchemesAsPrivileged([{
	scheme: 'app',
	privileges: {standard: true, secure: true, supportFetchAPI: true}
}]);

function serve(req)
{
	const u = new URL(req.url);
	const p = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));

	if (!p.startsWith(ROOT))
		return new Response('forbidden', {status: 403});
	return net.fetch(pathToFileURL(p).toString());
}

function createwin()
{
	win = new BrowserWindow({
		width: 1600, height: 950, minWidth: 960, minHeight: 620,
		frame: false, backgroundColor: '#1c1d20', show: false,
		webPreferences: {
			preload: path.join(ROOT, 'preload.js'),
			contextIsolation: true,
			sandbox: false
		}
	});
	win.loadURL('app://studio/index.html');
	win.once('ready-to-show', () => win.show());
	win.on('close', e => {
		if (!win.dirty)
			return;
		e.preventDefault();			/* let the renderer ask first */
		win.webContents.send('req:close');
	});
	win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
	protocol.handle('app', serve);
	createwin();
	app.on('activate', () => {
		if (!BrowserWindow.getAllWindows().length)
			createwin();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin')
		app.quit();
});

/* Every handler answers {ok: true, ...} or {ok: false, err: "<message>"} so the
 * renderer can put the failure in the inspector instead of dying. */
function guard(fn)
{
	return async (...a) => {
		try {
			return Object.assign({ok: true}, await fn(...a));
		} catch (e) {
			return {ok: false, err: String(e.message || e)};
		}
	};
}

ipcMain.on('win:ctl', (e, a) => {
	if (!win)
		return;
	if (a === 'min')
		win.minimize();
	else if (a === 'max')
		win.isMaximized() ? win.unmaximize() : win.maximize();
	else if (a === 'close')
		win.close();
});

ipcMain.handle('lvl:new', guard(async () => ({doc: lvl.blank()})));

ipcMain.handle('lvl:open', guard(async () => {
	const r = await dialog.showOpenDialog(win, {
		title: 'Open level', filters: FILTERS, properties: ['openFile']
	});
	if (r.canceled)
		return {cancel: true};
	return {path: r.filePaths[0], doc: lvl.read(r.filePaths[0])};
}));

/* A save failure is otherwise easy to miss entirely: the Text Editor tab
 * hides the whole inspector, where the validator's output normally lands
 * (style.css `body.text #right { display: none }`).  A native dialog reaches
 * the user regardless of which tab is open; the inspector still gets the
 * persistent record once the renderer sees the error come back. */
function saveerr(err)
{
	dialog.showMessageBox(win, {
		type: 'error', title: 'Save failed',
		message: 'Could not save the level',
		detail: String(err.message || err)
	});
}

ipcMain.handle('lvl:save', guard(async (e, p, doc) => {
	try {
		lvl.write(p, doc);
	} catch (err) {
		saveerr(err);
		throw err;
	}
	return {path: p};
}));

ipcMain.handle('lvl:saveas', guard(async (e, doc, name) => {
	const r = await dialog.showSaveDialog(win, {
		title: 'Save level as', filters: FILTERS,
		defaultPath: (name || 'untitled') + '.lvl'
	});
	if (r.canceled)
		return {cancel: true};
	try {
		lvl.write(r.filePath, doc);
	} catch (err) {
		saveerr(err);
		throw err;
	}
	return {path: r.filePath};
}));

ipcMain.handle('midi:import', guard(async () => {
	const r = await dialog.showOpenDialog(win, {
		title: 'Import MIDI', properties: ['openFile', 'multiSelections'],
		filters: [{name: 'MIDI', extensions: ['mid', 'midi']}]
	});
	if (r.canceled)
		return {cancel: true};
	return {files: r.filePaths.map(p => ({
		name: 'midi/' + path.basename(p),
		data: new Uint8Array(fs.readFileSync(p))
	}))};
}));

/* Asked before closing a dirty document.  0 save, 1 discard, 2 cancel. */
ipcMain.handle('ask:discard', async (e, name) => {
	const r = await dialog.showMessageBox(win, {
		type: 'warning', buttons: ['Save', 'Discard', 'Cancel'],
		defaultId: 0, cancelId: 2,
		message: '"' + name + '" has unsaved changes.'
	});
	return r.response;
});

ipcMain.on('dirty', (e, v) => {
	if (win)
		win.dirty = v;
});

ipcMain.on('forceclose', () => {
	if (win) {
		win.dirty = false;
		win.close();
	}
});
