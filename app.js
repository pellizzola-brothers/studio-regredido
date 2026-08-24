/* app.js - document state, tabs, the file manager and keyboard commands.
 *
 * One .lvl is open at a time.  App.doc is the whole archive in memory: the
 * parsed level.json plus its scripts and MIDI blobs.  Nothing is written until
 * a save, and main.js refuses to write a level that fails validation. */
'use strict';

/* `textdirty` covers edits Undo never sees: Monaco keeps its own history for
 * scripts (CLAUDE.md), so a script edit cannot be read off Undo.depth() the
 * way a level edit can. */
const App = {doc: null, path: null, dirty: false, textdirty: false, tab: 'level', open: []};

App.touch = function ()
{
	if (!App.dirty) {
		App.dirty = true;
		api.dirty(true);
	}
	App.retitle();
};

/* The authority on whether the level itself is dirty: true unless the undo
 * history is sitting at the depth it was at when the document was opened or
 * last saved.  Used after undo/redo, where App.touch()'s "anything happened"
 * model was wrong - undoing back to that depth must clear dirty again. */
App.recheck = function ()
{
	const d = Undo.depth() !== Undo.clean || App.textdirty;
	if (App.dirty !== d) {
		App.dirty = d;
		api.dirty(d);
	}
	App.retitle();
};

/* Tells main which menu items are honest to enable: Undo/Redo apply to the
 * level, not to a script tab, and there is nothing to redo/undo until an
 * edit exists. */
App.syncmenu = function ()
{
	api.menustate({
		tab: App.tab,
		canUndo: Undo.past.length > 0,
		canRedo: Undo.future.length > 0
	});
};

App.say = function (m, bad)
{
	const el = $('msg');
	el.textContent = m || '';
	el.classList.toggle('bad', !!bad);
};

App.status = function (cx, cy)
{
	$('cursor').textContent = cx >= 0 && cx < W && cy >= 0 && cy < Grid.h
		? cx + ', ' + cy : '';
};

App.inspect = function () { Panel.inspect(); };

App.retitle = function ()
{
	const n = App.doc.json.level.information.name || 'untitled';

	$('name').textContent = n + (App.path ? '  —  ' + App.path : '') +
		(App.dirty ? ' *' : '');
	document.title = n + ' - Pellizzola Brothers Studio';
	tabs();
};

App.fail = function (err)
{
	Panel.inspect();
	const d = document.createElement('div');
	d.className = 'err';
	d.textContent = err;
	$('props').prepend(d);
	App.say(err.split('\n')[0], true);
};

/* Adding an entity of a built-in kind pulls its definition into the level, so
 * that entity_definitions always covers every def the entities reference. */
App.usedef = function (id)
{
	const defs = App.doc.json.level.entity_definitions;
	if (defs.some(d => d.id === id))
		return;

	const c = entdefs.get(id);
	defs.push({id: id, script: c ? c.script : id + '_ai'});
};

/* ---- tabs ---- */

function tabs()
{
	const el = $('tablist');
	el.innerHTML = '';
	tab('level', 'Level Editor', false);
	for (const p of App.open)
		tab(p, p, true);
	document.body.classList.toggle('text', App.tab !== 'level');
}

function tab(id, label, closable)
{
	const t = document.createElement('div');

	t.className = 'tab' + (App.tab === id ? ' on' : '');
	t.innerHTML = '<b></b>';
	t.firstChild.textContent = label;
	t.onclick = () => App.select(id);
	if (closable) {
		const x = document.createElement('i');
		x.textContent = '×';
		x.onclick = e => { e.stopPropagation(); App.closetab(id); };
		t.appendChild(x);
	}
	$('tablist').appendChild(t);
}

App.select = function (id)
{
	App.tab = id;
	tabs();
	if (id === 'level')
		Grid.resize();
	else
		Code.show(id);
	sidebar();
	App.syncmenu();
};

App.opentab = function (p)
{
	if (!App.open.includes(p))
		App.open.push(p);
	App.select(p);
};

App.closetab = function (p)
{
	App.open = App.open.filter(v => v !== p);
	if (App.tab === p)
		App.select(App.open[0] || 'level');
	else
		tabs();
};

/* ---- file manager ---- */

function sidebar()
{
	list($('scripts'), Object.keys(App.doc.scripts).sort(), true);
	list($('midis'), Object.keys(App.doc.midi).sort(), false);
}

function list(ul, keys, isscript)
{
	ul.innerHTML = '';
	for (const k of keys) {
		const li = document.createElement('li');
		const b = document.createElement('b');

		b.textContent = k.replace(/^[^/]+\//, '');
		li.className = App.tab === k ? 'on' : '';
		li.title = k;
		li.appendChild(b);
		li.onclick = ev => {
			ev.stopPropagation();
			rowmenu(ev, li, b, k, isscript);
		};
		li.oncontextmenu = ev => {
			ev.preventDefault();
			ev.stopPropagation();
			rowmenu(ev, li, b, k, isscript);
		};
		ul.appendChild(li);
	}
}

/* ---- menus ---- */

/* Items are {label, fn} or null for a separator; `off` greys one out. */
function menu(x, y, items)
{
	const m = $('menu');

	m.innerHTML = '';
	for (const it of items) {
		if (!it) {
			m.appendChild(document.createElement('hr'));
			continue;
		}
		const b = document.createElement('div');
		b.className = 'mi' + (it.off ? ' off' : '');
		b.textContent = it.label;
		if (!it.off)
			b.onclick = () => { closemenu(); it.fn(); };
		m.appendChild(b);
	}
	m.style.display = 'block';
	m.style.left = Math.max(2, Math.min(x, innerWidth - m.offsetWidth - 4)) + 'px';
	m.style.top = Math.max(2, Math.min(y, innerHeight - m.offsetHeight - 4)) + 'px';
}

function closemenu() { $('menu').style.display = 'none'; }

function rowmenu(ev, li, b, k, isscript)
{
	const e = App.doc.json.level.entities[Grid.sel];
	const items = [];

	if (isscript) {
		items.push({label: 'open', fn: () => App.opentab(k)});
		items.push({
			label: e ? 'assign to ' + e.def : 'assign to entity',
			off: !e,
			fn: () => Panel.assign(e.def, k)
		});
	}
	items.push({label: 'rename', fn: () => edit(li, b, k)});
	items.push({label: 'delete', fn: () => (isscript ? delscript : delmidi)(k)});
	items.push(null);
	items.push({label: 'new script', fn: addscript});
	items.push({label: 'import midi', fn: addmidi});
	menu(ev.clientX, ev.clientY, items);
}

function panelmenu(ev)
{
	ev.preventDefault();
	menu(ev.clientX, ev.clientY, [
		{label: 'new script', fn: addscript},
		{label: 'import midi', fn: addmidi}
	]);
}

/* Electron has no window.prompt, so names are typed in place. */
function edit(li, b, old)
{
	const inp = document.createElement('input');

	inp.value = b.textContent;
	inp.style.cssText = 'width:100%;border:1px solid var(--acc);background:#17102a;color:var(--fg);font:inherit';
	li.replaceChild(inp, b);
	inp.focus();
	inp.select();
	inp.onkeydown = e => {
		if (e.key === 'Enter')
			inp.blur();
		else if (e.key === 'Escape') { inp.onblur = null; sidebar(); }
		e.stopPropagation();
	};
	inp.onmousedown = e => e.stopPropagation();
	inp.onclick = e => e.stopPropagation();
	inp.onblur = () => {
		const v = clean(inp.value);
		if (v && old === null)
			App.newscript(v, true);
		else if (v && old !== null && old.startsWith('midi/'))
			renmidi(old, 'midi/' + inp.value.trim().replace(/[\\/]/g, ''));
		else if (v && old !== null && 'scripts/' + v !== old)
			renscript(old, 'scripts/' + v);
		sidebar();
	};
}

function clean(s)
{
	s = s.trim().replace(/[\\/]/g, '');
	if (!s)
		return '';
	return /\.lua$/i.test(s) ? s : s + '.lua';
}

/* Start an inline entry at the end of the script list. */
function addscript()
{
	const ul = $('scripts');
	const li = document.createElement('li');
	const b = document.createElement('b');

	b.textContent = '';
	li.appendChild(b);
	ul.appendChild(li);
	edit(li, b, null);
}

App.newscript = function (name, opentoo)
{
	let p = 'scripts/' + clean(name || 'script.lua');
	let n = 2;
	while (App.doc.scripts[p] !== undefined)
		p = 'scripts/' + clean((name || 'script').replace(/\.lua$/i, '') + '_' + n++);

	Undo.act(() => {
		App.doc.scripts[p] = '-- ' + p + '\n';
		App.touch();
	});
	sidebar();
	if (opentoo)
		App.opentab(p);
	return p;
};

function renscript(old, p)
{
	if (App.doc.scripts[p] !== undefined) {
		App.say('a script named ' + p + ' already exists', true);
		return;
	}
	Undo.act(() => {
		App.doc.scripts[p] = App.doc.scripts[old];
		delete App.doc.scripts[old];
		for (const d of App.doc.json.level.entity_definitions)
			if (d.script === old)
				d.script = p;
		App.touch();
	});
	Code.drop(old);
	App.open = App.open.map(v => v === old ? p : v);
	if (App.tab === old)
		App.tab = p;
	App.select(App.tab);
	Panel.inspect();
}

function renmidi(old, p)
{
	if (p === old || App.doc.midi[p] !== undefined)
		return;
	Undo.act(() => {
		App.doc.midi[p] = App.doc.midi[old];
		delete App.doc.midi[old];
		App.touch();
	});
}

function delscript(p)
{
	const used = App.doc.json.level.entity_definitions.filter(d => d.script === p);
	if (used.length) {
		App.say(p + ' is still used by ' + used.map(d => d.id).join(', '), true);
		return;
	}
	Undo.act(() => {
		delete App.doc.scripts[p];
		App.touch();
	});
	Code.drop(p);
	App.closetab(p);
	sidebar();
}

function delmidi(p)
{
	Undo.act(() => {
		delete App.doc.midi[p];
		App.touch();
	});
	sidebar();
}

async function addmidi()
{
	const r = await api.midi();
	if (!r.ok)
		return App.fail(r.err);
	if (r.cancel)
		return;

	Undo.act(() => {
		for (const f of r.files)
			App.doc.midi[f.name] = f.data;
		App.touch();
	});
	sidebar();
	App.say('imported ' + r.files.length + ' file(s)');
}

/* ---- documents ---- */

/* Rebuild every view from the document.  Undo calls this after swapping the
 * level out from under the UI. */
App.refresh = function ()
{
	App.open = App.open.filter(p => App.doc.scripts[p] !== undefined);
	if (App.tab !== 'level' && App.doc.scripts[App.tab] === undefined)
		App.tab = App.open[0] || 'level';

	Code.sync();
	tabs();
	sidebar();
	Panel.palette();
	Panel.inspect();
	Grid.redraw();
	App.recheck();
	if (App.tab !== 'level')
		Code.show(App.tab);
};

App.setdoc = function (doc, path)
{
	App.doc = doc;
	App.path = path || null;
	App.dirty = false;
	App.textdirty = false;
	api.dirty(false);
	App.open = [];
	App.tab = 'level';
	Code.reset();
	Undo.clear();			/* also resets Undo.clean to 0, matching depth 0 */
	Grid.fitted = false;
	Grid.load();
	Panel.palette();
	Panel.inspect();
	sidebar();
	App.select('level');
	Grid.fit();
	App.retitle();
};

/* True if it is safe to throw the current document away. */
async function guard()
{
	if (!App.dirty)
		return true;

	const r = await api.discard(App.doc.json.level.information.name || 'untitled');
	if (r === 2)
		return false;
	if (r === 1)
		return true;
	await App.save();
	return !App.dirty;
}

App.new = async function ()
{
	if (!await guard())
		return;
	const r = await api.blank();
	if (!r.ok)
		return App.fail(r.err);
	App.setdoc(r.doc, null);
	App.say('new level');
};

App.open_ = async function ()
{
	if (!await guard())
		return;
	const r = await api.open();
	if (!r.ok)
		return App.fail(r.err);
	if (r.cancel)
		return;
	App.setdoc(r.doc, r.path);
	App.say('opened ' + r.path);
};

App.save = async function ()
{
	Grid.commit();
	if (!App.path)
		return App.saveas();

	const r = await api.save(App.path, App.doc);
	if (!r.ok)
		return App.fail(r.err);
	saved(r.path);
};

App.saveas = async function ()
{
	Grid.commit();
	const r = await api.saveas(App.doc, App.doc.json.level.information.name);
	if (!r.ok)
		return App.fail(r.err);
	if (r.cancel)
		return;
	saved(r.path);
};

function saved(p)
{
	App.path = p;
	App.dirty = false;
	App.textdirty = false;
	Undo.clean = Undo.depth();		/* this depth now matches disk */
	api.dirty(false);
	App.retitle();
	App.say('saved ' + p);
}

/* ---- wiring ----
 *
 * Every global command lives here once, named the same way whether it was
 * triggered by the menu (main.js sends 'cmd', see menu.js) or the hotbar. The
 * accelerators that used to be hand-matched against e.key in this file now
 * belong to the menu template, which is layout-aware where e.key never was. */

const ACTS = {
	'new':		() => App.new(),
	open:		() => App.open_(),
	save:		() => App.save(),
	saveas:		() => App.saveas(),
	undo:		() => Undo.undo(),
	redo:		() => Undo.redo(),
	closetab:	() => { if (App.tab !== 'level') App.closetab(App.tab); },
	/* Reload must cross the same unsaved-changes guard as closing the window
	 * (BUG-01) - a bare location.reload() would silently discard the level
	 * exactly like the default menu's Reload item used to. */
	reload:		async () => { if (await guard()) location.reload(); }
};

/* Canvas-local keys only: Escape and Delete apply to the selection, not to
 * any command the menu already owns. */
function keys(e)
{
	if (App.tab !== 'level' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
		return;
	if (e.key === 'Escape') {
		closemenu();
		Grid.sel = -1;
		Panel.inspect();
		Grid.redraw();
	} else if ((e.key === 'Delete' || e.key === 'Backspace') && Grid.sel >= 0) {
		Undo.act(() => {
			App.doc.json.level.entities.splice(Grid.sel, 1);
			Grid.sel = -1;
			App.touch();
		});
		Panel.inspect();
		Grid.redraw();
	}
}

async function tryclose()
{
	if (await guard())
		api.forceclose();
}

addEventListener('DOMContentLoaded', () => {
	Grid.init($('cv'));

	for (const b of document.querySelectorAll('.acts button'))
		b.onclick = () => ACTS[b.dataset.act]();
	$('wclose').onclick = tryclose;
	$('wmin').onclick = () => api.ctl('min');
	$('wmax').onclick = () => api.ctl('max');
	$('add').onclick = addscript;
	$('addmidi').onclick = ev => { ev.stopPropagation(); addmidi(); };
	$('side').onclick = panelmenu;
	$('side').oncontextmenu = panelmenu;
	addEventListener('mousedown', ev => {		/* a press anywhere else */
		const t = ev.target;
		if (!(t instanceof Element) || !t.closest('#menu'))
			closemenu();
	}, true);
	addEventListener('keydown', keys, true);
	api.onclose(tryclose);
	api.oncmd(name => { if (ACTS[name]) ACTS[name](); });

	Code.init(() => {
		if (App.tab !== 'level')
			Code.show(App.tab);
	});

	api.blank().then(r => {
		App.setdoc(r.doc, null);
		App.say('ready');
	});
});
