/* main.js - window, file dialogs and every filesystem touch.
 *
 * The renderer owns no fs access; it asks for work over the channels below.
 * Pages are served from app://studio/ rather than file:// so that Monaco's
 * web workers get a real, same-origin base URL to import from. */
'use strict';

const {app, protocol, net, ipcMain, dialog, BrowserWindow} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {pathToFileURL} = require('url');
const lvl = require('./lvl');
const menu = require('./menu');

const ROOT = __dirname;
const mac = process.platform === 'darwin';
const win32 = process.platform === 'win32';
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
			sandbox: true
		}
	});
	win.loadURL('app://studio/index.html');
	win.once('ready-to-show', () => { win.show(); maybeRecover(); });
	/* Nothing in Studio ever opens a second window; deny by default so a stray
	 * target=_blank (Monaco's link handling can produce one) cannot spawn an
	 * uncontrolled BrowserWindow. */
	win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
	/* Dropping a file onto the window, or any other stray navigation, would
	 * otherwise replace the app with a view of that file - losing the open
	 * document exactly like BUG-01's unguarded Reload did.  A reload of the
	 * app's own page (the Develop menu's guarded Reload item) is a
	 * will-navigate to the same app://studio/ origin and must still work, so
	 * only navigation to somewhere else is blocked. */
	win.webContents.on('will-navigate', (e, url) => {
		if (!url.startsWith('app://studio/'))
			e.preventDefault();
	});
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
	const d = lvl.blank();
	return {doc: d, warnings: lvl.review(d)};
}));

ipcMain.handle('lvl:open', guard(async () => {
	const r = await dialog.showOpenDialog(win, {
		title: 'Open level', filters: OPENFILTERS, properties: ['openFile']
	});
	if (r.canceled)
		return {cancel: true};
	const d = lvl.read(r.filePaths[0]);
	doc.path = r.filePaths[0];
	return {path: doc.path, doc: d, warnings: lvl.review(d)};
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

/* Overwriting a good file with a bad save is a different failure than BUG-02's
 * (a crash mid-write); this is "the write succeeded and it was the wrong
 * content".  One copy of the previous bytes costs one copyFile. */
function backup(p)
{
	try {
		if (fs.existsSync(p))
			fs.copyFileSync(p, p + '.bak');
	} catch (e) { /* best-effort: a failed backup must not block the save */ }
}

/* ---- crash recovery ----
 *
 * The document lives only in renderer memory until an explicit save, so a
 * crash or power loss loses everything since the last one.  While dirty, the
 * renderer periodically pushes a snapshot here (still through lvl.write(),
 * so it is validated and atomic like any other save) keyed by a hash of the
 * path being edited - 'untitled' for a level that has never been saved, since
 * there is at most one such document open at a time.  A tiny index.json next
 * to the snapshots remembers which path and display name each key belongs to,
 * since the .lvl bytes alone do not say where they came from. */
function recoverydir() { return path.join(app.getPath('userData'), 'recovery'); }
function snapkey(p) { return p ? crypto.createHash('sha1').update(p).digest('hex') : 'untitled'; }
function snappath(key) { return path.join(recoverydir(), key + '.lvl'); }
function indexpath() { return path.join(recoverydir(), 'index.json'); }

function readindex()
{
	try {
		return JSON.parse(fs.readFileSync(indexpath(), 'utf8'));
	} catch (e) {
		return {};
	}
}

function writeindex(idx)
{
	fs.mkdirSync(recoverydir(), {recursive: true});
	fs.writeFileSync(indexpath(), JSON.stringify(idx));
}

function clearsnapshot(p)
{
	const key = snapkey(p);
	try { fs.unlinkSync(snappath(key)); } catch (e) { /* nothing to remove */ }
	const idx = readindex();
	if (idx[key]) {
		delete idx[key];
		writeindex(idx);
	}
}

ipcMain.on('lvl:snapshot', (e, d) => {
	try {
		fs.mkdirSync(recoverydir(), {recursive: true});
		const key = snapkey(doc.path);
		lvl.write(snappath(key), d);
		const idx = readindex();
		idx[key] = {
			path: doc.path,
			name: d.json.level.information.name || 'untitled',
			time: Date.now()
		};
		writeindex(idx);
	} catch (e) { /* a failed recovery snapshot must stay invisible to the user */ }
});

/* Asked once after the window first shows.  Studio edits one document at a
 * time, so only the most recent snapshot can ever be offered; any others are
 * from an even older crash and are cleared rather than accumulated forever. */
function maybeRecover()
{
	const idx = readindex();
	const keys = Object.keys(idx);
	if (!keys.length)
		return;
	keys.sort((a, b) => idx[b].time - idx[a].time);
	const [best, ...stale] = keys;
	for (const k of stale)
		try { fs.unlinkSync(snappath(k)); } catch (e) { /* nothing to remove */ }
	if (stale.length) {
		const kept = {[best]: idx[best]};
		writeindex(kept);
	}

	const entry = idx[best];
	dialog.showMessageBox(win, {
		type: 'warning', buttons: ['Recover', 'Discard'], defaultId: 0,
		cancelId: 1, noLink: true, title: 'Recover Level',
		message: 'Studio closed unexpectedly.',
		detail: 'Recover unsaved changes to "' + (entry.name || 'untitled') + '"?'
	}).then(r => {
		if (r.response !== 0) {
			clearsnapshot(entry.path);
			return;
		}
		try {
			const d = lvl.read(snappath(best));
			doc.path = entry.path || null;
			doc.dirty = true;
			win.webContents.send('recover:load', {doc: d, path: doc.path,
				warnings: lvl.review(d)});
		} catch (err) {
			clearsnapshot(entry.path);	/* corrupted snapshot: nothing to offer again */
		}
	});
}

ipcMain.handle('lvl:save', guard(async (e, d) => {
	if (!doc.path)
		throw new Error('no file to save to');
	try {
		backup(doc.path);
		lvl.write(doc.path, d);
	} catch (err) {
		saveerr(err);
		throw err;
	}
	clearsnapshot(doc.path);
	return {path: doc.path, warnings: lvl.review(d)};
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
		backup(p);
		lvl.write(p, d);
	} catch (err) {
		saveerr(err);
		throw err;
	}
	clearsnapshot(doc.path);	/* the old path's recovery slot, before it moves */
	doc.path = p;
	return {path: p, warnings: lvl.review(d)};
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

/* Button words and order follow each platform's own convention rather than
 * one hard-coded array: macOS wants the affirmative rightmost and says
 * "Don't Save"; Windows wants Save/Don't Save/Cancel, also "Don't Save"; GNOME
 * orders the destructive action leftmost and says "Discard".  `map` says which
 * verdict each button index means, so the two can never drift apart the way a
 * bare response index (BUG-10) invited them to. */
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

/* Asked before closing a dirty document.  Returns 'save' | 'discard' | 'cancel'
 * rather than the response index, so no caller has to remember button order. */
ipcMain.handle('ask:discard', async (e, name) => {
	const b = discardbuttons();
	const r = await dialog.showMessageBox(win, {
		type: 'warning', buttons: b.buttons, defaultId: b.defaultId,
		cancelId: b.cancelId, noLink: true, title: 'Unsaved Changes',
		message: '"' + name + '" has unsaved changes.',
		detail: 'Your changes will be lost if you don\'t save them.'
	});
	return b.map[r.response];
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
	clearsnapshot(doc.path);	/* explicit discard, or already saved: either way, done */
	if (win)
		win.close();
});
