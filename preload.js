/* preload.js - the renderer's entire view of the outside world. */
'use strict';

const {contextBridge, ipcRenderer, webUtils} = require('electron');

contextBridge.exposeInMainWorld('api', {
	/* ARCH-03: the only platform fact the renderer gets, stamped onto
	 * <html data-platform> at boot so CSS can key off it declaratively -
	 * nothing in the renderer's own JS branches on process.platform. */
	platform:	process.platform,
	dirty:		v => ipcRenderer.send('dirty', v),
	/* NAT-03: the level's display name, the one part of the window title main
	 * cannot derive from {path, dirty} alone. */
	retitle:	name => ipcRenderer.send('doc:name', name),
	forceclose:	() => ipcRenderer.send('forceclose'),
	blank:		() => ipcRenderer.invoke('lvl:new'),
	/* UX-09: the boot-time call - restores the last session's document if one
	 * is on record and still on disk, otherwise the same blank lvl:new would
	 * have produced. */
	init:		() => ipcRenderer.invoke('lvl:init'),
	/* UX-11: settings.json is main's to own, like every other on-disk file -
	 * the renderer only ever sees it through this round trip. */
	getsettings:	() => ipcRenderer.invoke('settings:get'),
	setsettings:	s => ipcRenderer.invoke('settings:set', s),
	/* PERF-07: sent once a real document is loaded and the level view has
	 * rendered, so main can hold win.show() until there is something worth
	 * showing instead of racing app.js's own api.init() round trip. */
	uiready:	() => ipcRenderer.send('ui:ready'),
	open:		() => ipcRenderer.invoke('lvl:open'),
	/* NAT-06: File -> Open Recent (menu.js) sends the chosen path here rather
	 * than opening it directly in main - it still has to cross the
	 * renderer's own unsaved-changes guard first, like any other open. */
	openpath:	p => ipcRenderer.invoke('lvl:openpath', p),
	onopenrecent:	fn => ipcRenderer.on('open-recent', (e, p) => fn(p)),
	save:		doc => ipcRenderer.invoke('lvl:save', doc),
	saveas:		(doc, name) => ipcRenderer.invoke('lvl:saveas', doc, name),
	midi:		() => ipcRenderer.invoke('midi:import'),
	/* UX-18: exports one already-imported MIDI file back out to a real
	 * path the user picks - the renderer holds the bytes (App.doc.midi),
	 * main owns writing them. */
	exportmidi:	(name, bytes) => ipcRenderer.invoke('midi:export', name, bytes),
	/* NAT-09: a drop's real filesystem path can only be resolved here, in the
	 * preload - File.path is deprecated in favour of webUtils.getPathForFile,
	 * which Electron only exposes to preload scripts. */
	droppath:	file => webUtils.getPathForFile(file),
	importmidipaths:	paths => ipcRenderer.invoke('midi:importpaths', paths),
	importscriptpaths:	paths => ipcRenderer.invoke('script:importpaths', paths),
	/* UX-13: lists which definitions still use a script about to be deleted;
	 * resolves true for "delete anyway", false for "cancel". */
	confirmdeletescript:	(name, users) => ipcRenderer.invoke('script:confirmdelete', name, users),
	discard:	name => ipcRenderer.invoke('ask:discard', name),
	snapshot:	doc => ipcRenderer.send('lvl:snapshot', doc),
	onrecover:	fn => ipcRenderer.on('recover:load', (e, r) => fn(r)),
	onclose:	fn => ipcRenderer.on('req:close', () => fn()),
	menustate:	s => ipcRenderer.send('menu:state', s),
	oncmd:		fn => ipcRenderer.on('cmd', (e, name) => fn(name)),
	/* NAT-05: native context menus.  `rowmenu` sends the context captured at
	 * click time; `onrowcmd` delivers back whichever item the user chose. */
	rowmenu:	ctx => ipcRenderer.send('menu:row', ctx),
	onrowcmd:	fn => ipcRenderer.on('rowcmd', (e, a) => fn(a)),
	/* UX-04: the status bar's zoom quick-menu (25/50/100/200%/Fit) - a native
	 * popup like NAT-05's row menus, dispatching back over the same 'cmd'
	 * channel the View menu's own zoom items use rather than a second one. */
	zoommenu:	() => ipcRenderer.send('menu:zoom')
});
