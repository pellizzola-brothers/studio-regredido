/* preload.js - the renderer's entire view of the outside world. */
'use strict';

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('api', {
	/* ARCH-03: the only platform fact the renderer gets, stamped onto
	 * <html data-platform> at boot so CSS can key off it declaratively -
	 * nothing in the renderer's own JS branches on process.platform. */
	platform:	process.platform,
	dirty:		v => ipcRenderer.send('dirty', v),
	forceclose:	() => ipcRenderer.send('forceclose'),
	blank:		() => ipcRenderer.invoke('lvl:new'),
	open:		() => ipcRenderer.invoke('lvl:open'),
	save:		doc => ipcRenderer.invoke('lvl:save', doc),
	saveas:		(doc, name) => ipcRenderer.invoke('lvl:saveas', doc, name),
	midi:		() => ipcRenderer.invoke('midi:import'),
	discard:	name => ipcRenderer.invoke('ask:discard', name),
	snapshot:	doc => ipcRenderer.send('lvl:snapshot', doc),
	onrecover:	fn => ipcRenderer.on('recover:load', (e, r) => fn(r)),
	onclose:	fn => ipcRenderer.on('req:close', () => fn()),
	menustate:	s => ipcRenderer.send('menu:state', s),
	oncmd:		fn => ipcRenderer.on('cmd', (e, name) => fn(name)),
	/* NAT-05: native context menus.  `rowmenu` sends the context captured at
	 * click time; `onrowcmd` delivers back whichever item the user chose. */
	rowmenu:	ctx => ipcRenderer.send('menu:row', ctx),
	onrowcmd:	fn => ipcRenderer.on('rowcmd', (e, a) => fn(a))
});
