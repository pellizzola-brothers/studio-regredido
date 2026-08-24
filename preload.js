/* preload.js - the renderer's entire view of the outside world. */
'use strict';

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('api', {
	ctl:		a => ipcRenderer.send('win:ctl', a),
	dirty:		v => ipcRenderer.send('dirty', v),
	forceclose:	() => ipcRenderer.send('forceclose'),
	blank:		() => ipcRenderer.invoke('lvl:new'),
	open:		() => ipcRenderer.invoke('lvl:open'),
	save:		(p, doc) => ipcRenderer.invoke('lvl:save', p, doc),
	saveas:		(doc, name) => ipcRenderer.invoke('lvl:saveas', doc, name),
	midi:		() => ipcRenderer.invoke('midi:import'),
	discard:	name => ipcRenderer.invoke('ask:discard', name),
	onclose:	fn => ipcRenderer.on('req:close', () => fn())
});
