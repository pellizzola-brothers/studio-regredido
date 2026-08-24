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
const menu = require('./menu');

const ROOT = __dirname;
/* Bare .json is a deliberately supported *read* format (lvl.js migrate()
 * opens it directly) but write() always emits a ZIP, so offering it on save
 * would produce a .json file that is secretly a ZIP - hence two filters. */
const OPENFILTERS = [{name: 'Level', extensions: ['lvl', 'json']}];
const SAVEFILTERS = [{name: 'Level', extensions: ['lvl']}];
const NAME = 'Pellizzola Brothers Studio';

/* `productName` in package.json is only honoured once the app is packaged,
 * and `npm start` never is - so the app is called "Electron" everywhere
 * (menu bar, About panel, Dock) until this runs, and it must run before
 * whenReady() to take effect there. */
app.setName(NAME);

let win = null;
let menustate = {tab: 'level', canUndo: false, canRedo: false};

/* Document identity: which file is open, and whether the renderer has
 * unsaved changes.  Owned here rather than passed by the renderer on every
 * save (which is what let it write to any path it named) or hung off the
 * BrowserWindow as an ad-hoc `win.dirty` property (which vanished with the
 * window, and was never really a window property to begin with). */
const doc = {path: null, dirty: false};

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

let closetimer = null;

/* A renderer that is gone or wedged will never answer 'req:close', which
 * otherwise leaves the window - and on Windows/Linux the whole app, since
 * window-all-closed never fires - permanently unclosable.  Once the renderer
 * can no longer be trusted to answer, stop waiting on it and ask natively. */
function deadrenderer(detail)
{
	clearTimeout(closetimer);
	if (!win)
		return;
	doc.dirty = false;
	dialog.showMessageBox(win, {
		type: 'warning', buttons: ['Reopen', 'Close'], defaultId: 0, cancelId: 1,
		message: 'Studio stopped responding.', detail: detail
	}).then(r => {
		if (!win)
			return;
		if (r.response === 0)
			win.reload();
		else
			win.close();
	});
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
		if (!doc.dirty)
			return;
		e.preventDefault();			/* let the renderer ask first */
		win.webContents.send('req:close');
		/* Time-bound the round trip rather than wait on a renderer that may
		 * never answer; forceclose() (below) clears this once it does. */
		clearTimeout(closetimer);
		closetimer = setTimeout(
			() => deadrenderer('The window did not respond to a close request.'),
			3000);
	});
	win.webContents.on('render-process-gone', (e, details) =>
		deadrenderer('The window\'s process exited (' + details.reason + ').'));
	win.webContents.on('unresponsive', () =>
		deadrenderer('The window is not responding.'));
	win.on('closed', () => { win = null; });
	menu.set(win, menustate);
}

app.whenReady().then(() => {
	protocol.handle('app', serve);
	app.setAboutPanelOptions({
		applicationName: NAME,
		applicationVersion: app.getVersion(),
		copyright: 'Pellizzola Brothers'
	});
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

ipcMain.handle('lvl:new', guard(async () => {
	doc.path = null;
	return {doc: lvl.blank()};
}));

ipcMain.handle('lvl:open', guard(async () => {
	const r = await dialog.showOpenDialog(win, {
		title: 'Open level', filters: OPENFILTERS, properties: ['openFile']
	});
	if (r.canceled)
		return {cancel: true};
	const d = lvl.read(r.filePaths[0]);
	doc.path = r.filePaths[0];
	return {path: doc.path, doc: d};
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

ipcMain.handle('lvl:save', guard(async (e, d) => {
	if (!doc.path)
		throw new Error('no file to save to');
	try {
		lvl.write(doc.path, d);
	} catch (err) {
		saveerr(err);
		throw err;
	}
	return {path: doc.path};
}));

/* GTK's save dialog does not append a filter's extension the way macOS's and
 * Windows' do, so a typed "mylevel" would otherwise be written extensionless -
 * matching neither this app's own open filter nor the OS file association.
 * Forcing it here makes the three platforms agree. */
function forcelvl(p)
{
	return path.extname(p).toLowerCase() === '.lvl' ? p : p + '.lvl';
}

ipcMain.handle('lvl:saveas', guard(async (e, d, name) => {
	const r = await dialog.showSaveDialog(win, {
		title: 'Save level as', filters: SAVEFILTERS,
		defaultPath: (name || 'untitled') + '.lvl'
	});
	if (r.canceled)
		return {cancel: true};
	const p = forcelvl(r.filePath);
	try {
		lvl.write(p, d);
	} catch (err) {
		saveerr(err);
		throw err;
	}
	doc.path = p;
	return {path: p};
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

ipcMain.on('dirty', (e, v) => { doc.dirty = v; });

ipcMain.on('menu:state', (e, state) => {
	menustate = state;
	if (win)
		menu.set(win, menustate);
});

ipcMain.on('forceclose', () => {
	clearTimeout(closetimer);
	doc.dirty = false;
	if (win)
		win.close();
});
