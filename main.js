/* main.js - window, file dialogs and every filesystem touch.
 *
 * The renderer owns no fs access; it asks for work over the channels below.
 * Pages are served from app://studio/ rather than file:// so that Monaco's
 * web workers get a real, same-origin base URL to import from. */
'use strict';

const {app, protocol, net, ipcMain, dialog, BrowserWindow, Menu, screen, nativeTheme} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {pathToFileURL} = require('url');
const lvl = require('./lvl');
const menu = require('./menu');
const chrome = require('./chrome');

const ROOT = __dirname;
/* Bare .json is a deliberately supported *read* format (lvl.js migrate()
 * opens it directly) but write() always emits a ZIP, so offering it on save
 * would produce a .json file that is secretly a ZIP - hence two filters. */
const OPENFILTERS = [{name: 'Level', extensions: ['lvl', 'json']}];
const SAVEFILTERS = [{name: 'Level', extensions: ['lvl']}];
const NAME = 'Pellizzola Brothers Studio';

/* NAT-10: MINW/MINH are the layout's declared floor, unchanged pending
 * GEO-03 making the side panels proportional (that is the point at which a
 * true content-driven minimum becomes derivable rather than a guess).
 * MAXW/MAXH cap the *default* size at what the UI was actually designed and
 * tested at, so a big display does not open a window nobody has looked at -
 * a user who wants more can still resize past it. */
const MINW = 960, MINH = 620, MAXW = 1600, MAXH = 950;

/* `productName` in package.json is only honoured once the app is packaged,
 * and `npm start` never is - so the app is called "Electron" everywhere
 * (menu bar, About panel, Dock) until this runs, and it must run before
 * whenReady() to take effect there. */
app.setName(NAME);

/* NAT-08: without this, double-clicking a second .lvl (once NAT-07 registers
 * the file association) launches a whole second copy of the app - a second
 * Monaco, a second document, no knowledge of the first. Must run before
 * whenReady() and before anything else touches app state, so a losing second
 * instance quits as early as possible rather than doing any of that work
 * only to throw it away. macOS does not strictly need this - Launch Services
 * already routes a second open to the running instance via `open-file` - but
 * taking the lock there too is harmless and keeps one code path on every
 * platform rather than two. */
/* Named so the app.whenReady() call far below (which actually shows a
 * window) can be skipped outright rather than relying on quit()'s own
 * timing - quit() only *schedules* a quit, and whether a 'ready' Electron
 * has not yet fired can still land before that takes effect is not this
 * file's to gamble on. Electron's own documented pattern for this same
 * problem gates whenReady() the same way, for the same reason. */
const singleinstance = app.requestSingleInstanceLock();
if (!singleinstance)
	app.quit();
else
	app.on('second-instance', (e, argv) => {
		if (!win)
			return;
		if (win.isMinimized())
			win.restore();
		win.focus();
		const p = argvpath(argv);
		if (p)
			openpath(p);
	});

let win = null;
let menustate = {tab: 'level', canUndo: false, canRedo: false};

/* Document identity: which file is open, and whether the renderer has
 * unsaved changes.  Owned here rather than passed by the renderer on every
 * save (which is what let it write to any path it named) or hung off the
 * BrowserWindow as an ad-hoc `win.dirty` property (which vanished with the
 * window, and was never really a window property to begin with). */
const doc = {path: null, dirty: false, name: null};

/* NAT-07: a path to open, from macOS's own `open-file`, a second instance's
 * argv (NAT-08's own handler, above), or this instance's own initial argv
 * (Windows/Linux, launched by double-clicking a file). `winready` - true
 * only once the renderer itself has signalled `ui:ready` (PERF-07), not
 * merely once `win` exists - is what decides whether to send it now or
 * queue it: `open-file` in particular can fire before the window exists at
 * all, and even once it does, its own IPC listeners are not attached until
 * DOMContentLoaded has run, so a message sent any earlier would simply be
 * lost. `openpath()` reuses NAT-06's own `open-recent` channel rather than
 * inventing a second one - both are "a path the main process already knows,
 * that still has to cross the renderer's own unsaved-changes guard before
 * it replaces the open document." */
let pendingopen = null;
let winready = false;

function openpath(p)
{
	if (winready)
		win.webContents.send('open-recent', p);
	else
		pendingopen = p;
}

/* A packaged app's own argv is [electron binary, ...args]; a dev launch
 * (`electron .`) additionally carries the app path itself as one of those
 * args - either way, the level path (if any) is whichever argument actually
 * names one. */
function argvpath(argv)
{
	return argv.find(a => /\.(lvl|json)$/i.test(a));
}

/* Can fire before whenReady() - the classic bug in this area - which is
 * exactly why openpath() queues rather than assumes `win` exists yet. */
app.on('open-file', (e, p) => {
	e.preventDefault();
	openpath(p);
});

/* NAT-03: title, proxy icon and edited-dot conventions, all driven from doc
 * rather than from anything the renderer passes at the moment it happens -
 * every site that changes doc.path/dirty/name calls this afterwards.  macOS
 * wants the document name alone, with the full path behind the proxy icon
 * and unsaved state as a dot in the close button; Windows wants
 * "name — app" in the OS-drawn title, since titleBarOverlay means
 * document.title is what the taskbar actually shows; Linux gets the bare
 * name, matching macOS's convention in the absence of a single Linux one. */
function retitle()
{
	if (!win)
		return;
	const name = doc.name || 'untitled';

	win.setTitle(name + (chrome.win32 ? ' — ' + NAME : ''));
	if (chrome.mac) {
		win.setRepresentedFilename(doc.path || '');
		win.setDocumentEdited(doc.dirty);
	}
}

/* NAT-10 / GEO-12: window geometry is a fixed constant today (1600x950,
 * every launch) - four literals in main.js that fit neither a 1366x768
 * laptop nor a user's own resize, since nothing is ever persisted. */
function windowstatepath() { return path.join(app.getPath('userData'), 'window.json'); }

function loadwindowstate()
{
	try {
		return JSON.parse(fs.readFileSync(windowstatepath(), 'utf8'));
	} catch (e) {
		return null;
	}
}

/* UX-09: `path` rides in the same file window geometry already persists to,
 * rather than a second one - both are per-machine view state written once,
 * on close, and read back once, at the next launch's lvl:init (below). */
function savewindowstate()
{
	if (!win)
		return;
	try {
		fs.writeFileSync(windowstatepath(), JSON.stringify({
			bounds: win.getNormalBounds(),
			maximized: win.isMaximized(),
			fullscreen: win.isFullScreen(),
			path: doc.path
		}));
	} catch (e) { /* best-effort: a failed write must not block closing */ }
}

/* NAT-06: the only way back to yesterday's level used to be navigating the
 * open dialog from scratch, which also started wherever the OS last left it -
 * no memory of anything Studio itself opened.  Persisted the same way window
 * state is (a small JSON file in userData), most-recent-first, capped at 10
 * and deduplicated by path; a path that no longer exists on disk is filtered
 * lazily, at menu-build time, rather than watched or pruned eagerly. */
function recentpath() { return path.join(app.getPath('userData'), 'recent.json'); }

function loadrecent()
{
	try {
		const list = JSON.parse(fs.readFileSync(recentpath(), 'utf8'));
		return Array.isArray(list) ? list.filter(p => fs.existsSync(p)) : [];
	} catch (e) {
		return [];
	}
}

function saverecent(list)
{
	try {
		fs.writeFileSync(recentpath(), JSON.stringify(list));
	} catch (e) { /* best-effort: a failed write must not block the caller */ }
}

/* UX-11: the credible list the finding names - grid overlay, palette cell
 * size, editor font size, the recovery-snapshot interval (fixed at 30s
 * until now) - four real settings, which is what justified building this at
 * all rather than adding a preference for one of them alone. View state
 * (panel widths, the last zoom, open tabs) is deliberately not here - it
 * belongs with window.json, silent and per-session, not a setting the user
 * chooses once and expects to stick. */
function settingspath() { return path.join(app.getPath('userData'), 'settings.json'); }
const SETTINGS_DEFAULTS = {grid: true, cellsize: 1, editorfontsize: 12, snapshotinterval: 30};

function loadsettings()
{
	try {
		return Object.assign({}, SETTINGS_DEFAULTS, JSON.parse(fs.readFileSync(settingspath(), 'utf8')));
	} catch (e) {
		return Object.assign({}, SETTINGS_DEFAULTS);
	}
}

function savesettings(s)
{
	try {
		fs.writeFileSync(settingspath(), JSON.stringify(s));
	} catch (e) { /* best-effort: a failed write must not block the caller */ }
}

/* NAT-17: the Dock's own custom menu (New Level, Open Recent) - mirrors the
 * File menu's own Open Recent submenu from the same persisted list (NAT-06)
 * so the two can never disagree, and routes both actions through the same
 * guarded paths as the menu bar: `cmd`/`new` for App.new(), openpath() for
 * a recent file, since a Dock click deserves the same unsaved-changes
 * protection a menu click already gets. macOS only - Windows' equivalent is
 * the JumpList, entirely automatic (`app.setUserTasks()`, `addRecentDocument()`
 * below) and has no custom-menu concept to build here. */
function setdockmenu()
{
	if (!chrome.mac)
		return;
	const recent = loadrecent();
	app.dock.setMenu(Menu.buildFromTemplate([
		{label: 'New Level', click: () => { if (win) win.webContents.send('cmd', 'new'); }},
		{
			label: 'Open Recent',
			submenu: recent.length ?
				recent.map(p => ({label: path.basename(p), click: () => openpath(p)})) :
				[{label: 'No Recent Documents', enabled: false}]
		}
	]));
}

/* macOS: also populates the Dock icon's own Recent submenu, for free, and
 * (setdockmenu(), above) the custom Dock menu's own Open Recent list.
 * Windows: feeds the taskbar JumpList's own automatic Recent category, now
 * that NAT-07's file association exists for it to key off. */
function addrecent(p)
{
	app.addRecentDocument(p);
	saverecent([p, ...loadrecent().filter(x => x !== p)].slice(0, 10));
	if (win)
		menu.set(win, menustate, loadrecent(), clearrecent);
	setdockmenu();
}

function clearrecent()
{
	app.clearRecentDocuments();
	saverecent([]);
	if (win)
		menu.set(win, menustate, [], clearrecent);
	setdockmenu();
}

/* A saved rectangle may belong to a monitor that is no longer connected -
 * the classic bug in this area - so it is only trusted if it still overlaps
 * some currently-attached display's work area. */
function fitsdisplay(b)
{
	return b && screen.getAllDisplays().some(d => {
		const w = d.workArea;
		return b.x + b.width > w.x && b.x < w.x + w.width &&
			b.y + b.height > w.y && b.y < w.y + w.height;
	});
}

/* 80% of the *work area* (screen.getPrimaryDisplay().workAreaSize already
 * excludes the menu bar, Dock and taskbar), clamped to the layout's own
 * floor and to the size it was designed at - never below what the UI needs,
 * never above what anyone has actually seen it laid out at. */
function defaultbounds()
{
	const wa = screen.getPrimaryDisplay().workAreaSize;

	return {
		width: Math.min(MAXW, Math.max(MINW, Math.round(wa.width * 0.8))),
		height: Math.min(MAXH, Math.max(MINH, Math.round(wa.height * 0.8))),
		center: true
	};
}

protocol.registerSchemesAsPrivileged([{
	scheme: 'app',
	privileges: {standard: true, secure: true, supportFetchAPI: true}
}]);

function serve(req)
{
	const u = new URL(req.url);
	const p = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));

	/* BUG-13: a bare startsWith(ROOT) also matches a sibling directory whose
	 * name happens to extend ROOT's (…/studio-backup) - path.sep after ROOT
	 * is what makes this a real prefix-of-path-segments check. */
	if (p !== ROOT && !p.startsWith(ROOT + path.sep))
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
		type: 'warning', buttons: [chrome.oscase('Reopen'), chrome.oscase('Close')], defaultId: 0, cancelId: 1,
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

/* PERF-07: 'ready-to-show' only means the renderer painted a first
 * compositor frame, which can still be an empty chrome - that frame lands
 * before app.js's own api.init() round trip (UX-09) has resolved and called
 * App.setdoc().  win.show() waits instead for the renderer's own 'ui:ready'
 * signal, sent once a real document is loaded, with a fallback timer in case
 * something upstream of it throws and the signal never arrives: a window
 * that never appears is a worse failure than the blank flash this replaces.
 * `shown`/`showtimer` are local to each createwin() call (module-level `win`
 * itself is reassigned per call already) so a macOS re-open through
 * 'activate' after every window closed starts this over cleanly. */
function createwin()
{
	const state = loadwindowstate();
	const restore = state && fitsdisplay(state.bounds);
	const geometry = restore ? state.bounds : defaultbounds();
	let shown = false, showtimer = null;
	winready = false;		/* a fresh window needs its own fresh ui:ready */

	function showwin()
	{
		if (shown || !win)
			return;
		shown = true;
		clearTimeout(showtimer);
		win.show();
		maybeRecover();
		/* NAT-07: only safe to send a queued open-file/argv path once the
		 * renderer's own IPC listeners are definitely attached - the same
		 * moment PERF-07 already established for "the document is real". */
		winready = true;
		if (pendingopen) {
			openpath(pendingopen);
			pendingopen = null;
		}
	}

	win = new BrowserWindow({
		...geometry, minWidth: MINW, minHeight: MINH,
		/* Duplicates style.css's --frame (VIS-04's one sanctioned exception,
		 * documented at tokens.js): the window must be told its background
		 * before any CSS has loaded, so it cannot read the token itself.
		 * Change both together. */
		backgroundColor: '#1c1d20', show: false,
		...chrome.windowoptions(),
		webPreferences: {
			preload: path.join(ROOT, 'preload.js'),
			contextIsolation: true,
			sandbox: true
		}
	});
	if (restore) {
		if (state.maximized)
			win.maximize();
		if (state.fullscreen)
			win.setFullScreen(true);
	}
	retitle();
	win.loadURL('app://studio/index.html');
	win.once('ready-to-show', () => { showtimer = setTimeout(showwin, 2000); });
	/* Named rather than passed inline, so a window closed before it ever
	 * signals 'ui:ready' (a very slow or crashed boot) does not leave a
	 * listener registered forever - removed below alongside the other
	 * per-window listeners once this window actually closes. */
	function onready() { showwin(); }
	ipcMain.once('ui:ready', onready);
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
		savewindowstate();
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
	win.on('closed', () => { win = null; clearTimeout(showtimer); ipcMain.removeListener('ui:ready', onready); });
	menu.set(win, menustate, loadrecent(), clearrecent);
}

/* NAT-08: a losing second instance already called app.quit() above; not
 * registering this at all, rather than trusting that call to win a race
 * against Electron's own 'ready' event, is what actually guarantees no
 * second window ever gets created. */
if (singleinstance)
	app.whenReady().then(() => {
		protocol.handle('app', serve);
		app.setAboutPanelOptions({
			applicationName: NAME,
			applicationVersion: app.getVersion(),
			/* NAT-07/NAT-17: build/icon.png exists once packaged (electron-builder
			 * copies buildResources alongside the app); a dev `npm start` has no
			 * `build/` next to the running app root the way a packaged one does,
			 * so this is best-effort and silently absent rather than broken there. */
			iconPath: path.join(ROOT, 'build', 'icon.png'),
			copyright: 'Pellizzola Brothers'
		});
		/* NAT-07: Windows/Linux hand the opened file's path on the command
		 * line rather than through open-file - process.argv[0] is the
		 * Electron binary itself, so this is exactly argvpath()'s own
		 * "whichever argument actually names one" search over the rest. */
		const p = argvpath(process.argv);
		if (p)
			pendingopen = p;
		setdockmenu();
		/* NAT-17: the one JumpList entry that is not already automatic -
		 * recent documents populate their own category for free, once
		 * addRecentDocument() (NAT-06) has something to feed it. */
		if (chrome.win32)
			app.setUserTasks([{
				program: process.execPath,
				arguments: '',
				iconPath: process.execPath,
				iconIndex: 0,
				title: 'New Level',
				description: 'Create a new level'
			}]);
		createwin();
		app.on('activate', () => {
			if (!BrowserWindow.getAllWindows().length)
				createwin();
		});
	});

app.on('window-all-closed', () => {
	if (!chrome.mac)
		app.quit();
});

/* NAT-15: titleBarOverlay's own colours (chrome.js's windowoptions()) are
 * the app's fixed dark palette, not derived from the OS theme - this app is
 * deliberately single-theme (see this finding's own "do not build a light
 * theme" text) - but Windows can still repaint its own caption buttons over
 * top of them when the system accent or light/dark mode changes, unless the
 * same values are asserted again. Re-pushing the *same* colours, not new
 * ones, is the whole fix. */
if (chrome.win32)
	nativeTheme.on('updated', () => {
		if (win)
			win.setTitleBarOverlay(chrome.windowoptions().titleBarOverlay);
	});

/* ARCH-06: every invoke() handler used to answer one of three shapes - guard's
 * own {ok: true, ...spread} / {ok: false, err}, a bare {cancel: true} spread
 * into that same envelope by the handlers that wrap a dialog, and ask:discard's
 * unwrapped string - so a caller had to remember two different checks
 * (!r.ok, then r.cancel) and a missed one silently treated a cancelled dialog
 * as a success.  One shape now: {status: 'ok'|'cancel'|'error', data, message}.
 * A handler returns CANCEL, the one sentinel value guard() itself recognises,
 * to signal a dialog was dismissed; anything else it returns becomes `data`;
 * a thrown error becomes `message`.  app.js's own call() is the one place
 * that unwraps this, so no renderer call site can forget either check again. */
const CANCEL = Symbol('cancel');

function guard(fn)
{
	return async (...a) => {
		try {
			const data = await fn(...a);
			return data === CANCEL ? {status: 'cancel'} : {status: 'ok', data};
		} catch (e) {
			return {status: 'error', message: String(e.message || e)};
		}
	};
}

/* NAT-05: the file manager's context menus, native instead of the hand-rolled
 * <div> menu that used to live in app.js - no keyboard navigation, no
 * platform appearance, and it clamped near a window edge instead of flipping
 * the way every real menu does.  `ctx` (kind, key, entityDef) is whatever the
 * renderer had selected at the moment of the click; popup() is asynchronous,
 * so building the item labels from it now, rather than asking the renderer
 * again later, is what keeps a stale selection from leaking into the choice
 * (grid.js's Grid.sel can change before the user picks an item). */
ipcMain.on('menu:row', (e, ctx) => {
	if (!win)
		return;
	const send = action => () =>
		win.webContents.send('rowcmd', Object.assign({action}, ctx));

	/* NAT-12: the canvas's own menu, reached now only by a right click that
	 * never dragged and had nothing under it to delete - one outside the
	 * level's own bounds, where grid.js's onup() resolves every other right
	 * click into an instant delete instead of asking first. "Fit View" is
	 * the one action that still applies out there. It does not fall through
	 * to the "New Script"/"Import MIDI" pair every other menu carries
	 * below - neither belongs to a right click on the level. */
	if (ctx.kind === 'canvas') {
		Menu.buildFromTemplate([
			{label: chrome.oscase('Fit View'), click: send('fitview')}
		]).popup({window: win});
		return;
	}

	const items = [];

	/* VIS-10: a native Menu.popup() is an OS-facing surface like the menu
	 * bar (chrome.oscase(), above) - Title Case authored, Sentence case on
	 * Linux. "Assign To " keeps its own capitalisation regardless of
	 * platform; ctx.entityDef is user-authored content (a definition id),
	 * not chrome text, so it is concatenated after the case conversion. */
	if (ctx.kind === 'script') {
		items.push({label: chrome.oscase('Open'), click: send('open')});
		items.push({
			label: ctx.entityDef ? chrome.oscase('Assign To') + ' ' + ctx.entityDef : chrome.oscase('Assign To Entity'),
			enabled: !!ctx.entityDef, click: send('assign')
		});
		items.push({type: 'separator'});
	}
	if (ctx.kind === 'script' || ctx.kind === 'midi') {
		items.push({label: chrome.oscase('Rename'), click: send('rename')});
		items.push({label: chrome.oscase('Delete'), click: send('delete')});
	}
	/* UX-18: a MIDI file's own way back out - an import is otherwise a
	 * one-way trip into the archive. */
	if (ctx.kind === 'midi')
		items.push({label: chrome.oscase('Export…'), click: send('export')});
	/* UX-02: "New Script"/"Import MIDI" used to close every row's own menu
	 * too, so a menu about one script or MIDI file also always offered two
	 * commands that act on neither - global create actions belong only on
	 * the panel background menu (`kind: 'panel'`, panelmenu() in app.js),
	 * where they are still the whole menu, unchanged. A row's own menu is
	 * now just the actions that act on that row. */
	if (ctx.kind === 'panel') {
		items.push({label: chrome.oscase('New Script'), click: send('newscript')});
		items.push({label: chrome.oscase('Import MIDI'), click: send('importmidi')});
	}
	/* No x/y: popup() defaults to the current cursor position, which is
	 * exactly where the click that triggered this happened. */
	Menu.buildFromTemplate(items).popup({window: win});
});

/* UX-04: the status bar's zoom indicator, clicked - the same five commands
 * the View menu carries, dispatched through the one 'cmd' channel every menu
 * command already goes through rather than a second, parallel one. */
ipcMain.on('menu:zoom', () => {
	if (!win)
		return;
	const send = name => () => win.webContents.send('cmd', name);
	Menu.buildFromTemplate([
		{label: '25%', click: send('zoom25')},
		{label: '50%', click: send('zoom50')},
		{label: '100%', click: send('zoom100')},
		{label: '200%', click: send('zoom200')},
		{type: 'separator'},
		{label: chrome.oscase('Fit'), click: send('fitall')}
	]).popup({window: win});
});

ipcMain.handle('lvl:new', guard(async () => {
	doc.path = null;
	doc.name = null;
	retitle();
	const d = lvl.blank();
	return {doc: d, warnings: lvl.review(d)};
}));

/* Shared by lvl:open and lvl:openpath (NAT-06's Open Recent) - both end at the
 * same document identity update and recent-list bump, one from a dialog's own
 * choice and the other from a path the menu already knew. */
function openfile(p)
{
	const d = lvl.read(p);
	doc.path = p;
	doc.name = d.json.level.information.name || null;
	retitle();
	addrecent(p);
	return {path: doc.path, doc: d, warnings: lvl.review(d)};
}

ipcMain.handle('lvl:open', guard(async () => {
	const r = await dialog.showOpenDialog(win, {
		title: chrome.oscase('Open Level'), filters: OPENFILTERS, properties: ['openFile']
	});
	if (r.canceled)
		return CANCEL;
	return openfile(r.filePaths[0]);
}));

/* NAT-06: File -> Open Recent (menu.js) sends the chosen path to the
 * renderer rather than calling this directly - it still has to cross the
 * renderer's own unsaved-changes guard first, exactly like any other open. */
ipcMain.handle('lvl:openpath', guard(async (e, p) => openfile(p)));

/* UX-09: a document-based app reopens what was open last, not an untitled
 * blank every launch. Asked once at boot (app.js's api.init(), before the
 * window is ever shown - PERF-07, above); only trusted if the file is still
 * there, and if opening it throws (moved onto a corrupted level, say) this
 * falls back to blank exactly like a first run rather than failing the
 * whole boot. */
ipcMain.handle('lvl:init', guard(async () => {
	const state = loadwindowstate();
	if (state && state.path && fs.existsSync(state.path)) {
		try {
			return Object.assign({restored: true}, openfile(state.path));
		} catch (e) { /* fall through to blank, below */ }
	}
	doc.path = null;
	doc.name = null;
	retitle();
	const d = lvl.blank();
	return {restored: false, doc: d, warnings: lvl.review(d), path: null};
}));

ipcMain.handle('settings:get', guard(async () => loadsettings()));
ipcMain.handle('settings:set', guard(async (e, s) => { savesettings(s); return s; }));

/* A save failure is otherwise easy to miss entirely: the Text Editor tab
 * hides the whole inspector, where the validator's output normally lands
 * (style.css `body.text #right { display: none }`).  A native dialog reaches
 * the user regardless of which tab is open; the inspector still gets the
 * persistent record once the renderer sees the error come back. */
function saveerr(err)
{
	dialog.showMessageBox(win, {
		type: 'error', title: chrome.oscase('Save Failed'),
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

/* NAT-19: lvl.write() is async now (done, see "Already completed") - this
 * was already a fire-and-forget handler (ipcMain.on, not .handle), so
 * nothing here had to start awaiting anything that did not already tolerate
 * running in the background; the .catch() below is exactly the same
 * silent-failure contract the old try/catch gave a snapshot write. */
ipcMain.on('lvl:snapshot', (e, d) => {
	try {
		fs.mkdirSync(recoverydir(), {recursive: true});
	} catch (e) { return; /* a failed recovery snapshot must stay invisible to the user */ }
	const key = snapkey(doc.path);
	lvl.write(snappath(key), d).then(() => {
		const idx = readindex();
		idx[key] = {
			path: doc.path,
			name: d.json.level.information.name || 'untitled',
			time: Date.now()
		};
		writeindex(idx);
	}).catch(() => { /* a failed recovery snapshot must stay invisible to the user */ });
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
		type: 'warning', buttons: [chrome.oscase('Recover'), chrome.oscase('Discard')], defaultId: 0,
		cancelId: 1, noLink: true, title: chrome.oscase('Recover Level'),
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
			doc.name = d.json.level.information.name || null;
			retitle();
			win.webContents.send('recover:load', {doc: d, path: doc.path,
				warnings: lvl.review(d)});
		} catch (err) {
			clearsnapshot(entry.path);	/* corrupted snapshot: nothing to offer again */
		}
	});
}

/* NAT-17: a real, if coarse, progress indicator during the one operation
 * long enough to want one (NAT-19's own async write()) - 2 is Electron's
 * own documented "indeterminate" value, since fflate's zip() gives no
 * finer-grained progress to report; -1 removes the bar again regardless of
 * whether the save succeeded or failed, so a failed save never leaves a
 * stuck taskbar/Dock indicator behind. */
async function withprogress(fn)
{
	if (win)
		win.setProgressBar(2);
	try {
		return await fn();
	} finally {
		if (win)
			win.setProgressBar(-1);
	}
}

ipcMain.handle('lvl:save', guard(async (e, d) => {
	if (!doc.path)
		throw new Error('no file to save to');
	try {
		backup(doc.path);
		await withprogress(() => lvl.write(doc.path, d));
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
		title: chrome.oscase('Save Level As'), filters: SAVEFILTERS,
		defaultPath: (name || 'untitled') + '.lvl'
	});
	if (r.canceled)
		return CANCEL;
	const p = forcelvl(r.filePath);
	try {
		backup(p);
		await withprogress(() => lvl.write(p, d));
	} catch (err) {
		saveerr(err);
		throw err;
	}
	clearsnapshot(doc.path);	/* the old path's recovery slot, before it moves */
	doc.path = p;
	doc.name = d.json.level.information.name || null;
	retitle();
	addrecent(p);
	return {path: p, warnings: lvl.review(d)};
}));

ipcMain.handle('midi:import', guard(async () => {
	const r = await dialog.showOpenDialog(win, {
		title: chrome.oscase('Import MIDI'), properties: ['openFile', 'multiSelections'],
		filters: [{name: 'MIDI', extensions: ['mid', 'midi']}]
	});
	if (r.canceled)
		return CANCEL;
	return {files: r.filePaths.map(p => ({
		name: 'midi/' + path.basename(p),
		data: new Uint8Array(fs.readFileSync(p))
	}))};
}));

/* UX-18: the other half of "not a one-way trip" - the bytes themselves live
 * in the renderer's own App.doc.midi (they arrive here as a plain argument,
 * structured-clone over IPC), since main owns every filesystem write. */
ipcMain.handle('midi:export', guard(async (e, name, bytes) => {
	const r = await dialog.showSaveDialog(win, {
		title: chrome.oscase('Export MIDI'), defaultPath: path.basename(name),
		filters: [{name: 'MIDI', extensions: ['mid', 'midi']}]
	});
	if (r.canceled)
		return CANCEL;
	fs.writeFileSync(r.filePath, Buffer.from(bytes));
	return {path: r.filePath};
}));

/* NAT-09: the dialog-driven midi:import above and this one differ only in
 * where the paths come from - a system Open dialog there, a drop onto #midis
 * in the renderer here (app.js's dropmidi()).  Same shape back, so both
 * funnel through App's own importmidifiles(). */
ipcMain.handle('midi:importpaths', guard(async (e, paths) => ({
	files: paths.map(p => ({
		name: 'midi/' + path.basename(p),
		data: new Uint8Array(fs.readFileSync(p))
	}))
})));

/* NAT-09: a .lua dropped onto #scripts - read as text (unlike MIDI's raw
 * bytes) since Monaco and App.doc.scripts both want the script as a string,
 * the same shape App.newscript()'s own template string already uses. */
ipcMain.handle('script:importpaths', guard(async (e, paths) => ({
	files: paths.map(p => ({
		name: 'scripts/' + path.basename(p),
		data: fs.readFileSync(p, 'utf8')
	}))
})));

/* UX-13: delscript() (app.js) used to refuse outright, in the status bar,
 * leaving the user to find and reassign each definition by hand through the
 * inspector.  A native confirmation at least turns that dead end into one
 * choice - delete anyway, leaving the definitions pointing at a script that
 * no longer exists, which lvl.js's review() already surfaces as a warning
 * (BUG-11) exactly like any other dangling reference, so nothing new needs
 * to detect it. */
ipcMain.handle('script:confirmdelete', guard(async (e, name, users) => {
	const r = await dialog.showMessageBox(win, {
		type: 'warning', buttons: [chrome.oscase('Cancel'), chrome.oscase('Delete Anyway')], defaultId: 0,
		cancelId: 0, noLink: true, title: chrome.oscase('Script In Use'),
		message: '"' + name + '" is still used by ' + users.join(', ') + '.',
		detail: 'Deleting it leaves ' + (users.length > 1 ? 'those definitions' : 'that definition') +
			' pointing at a missing script - reassign one from the inspector to fix it, or delete anyway.'
	});
	return r.response === 1;
}));

/* Asked before closing a dirty document.  Returns 'save' | 'discard' | 'cancel'
 * rather than the response index, so no caller has to remember button order. */
ipcMain.handle('ask:discard', async (e, name) => {
	const b = chrome.discardbuttons();
	const r = await dialog.showMessageBox(win, {
		type: 'warning', buttons: b.buttons, defaultId: b.defaultId,
		cancelId: b.cancelId, noLink: true, title: chrome.oscase('Unsaved Changes'),
		message: '"' + name + '" has unsaved changes.',
		detail: 'Your changes will be lost if you don\'t save them.'
	});
	return b.map[r.response];
});

ipcMain.on('dirty', (e, v) => { doc.dirty = v; retitle(); });
ipcMain.on('doc:name', (e, name) => { doc.name = name || null; retitle(); });

ipcMain.on('menu:state', (e, state) => {
	menustate = state;
	if (win)
		menu.set(win, menustate, loadrecent(), clearrecent);
});

ipcMain.on('forceclose', () => {
	clearTimeout(closetimer);
	doc.dirty = false;
	clearsnapshot(doc.path);	/* explicit discard, or already saved: either way, done */
	if (win)
		win.close();
});
