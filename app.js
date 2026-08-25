/* app.js - document state, tabs, the file manager and keyboard commands.
 *
 * One .lvl is open at a time.  App.doc is the whole archive in memory: the
 * parsed level.json plus its scripts and MIDI blobs.  Nothing is written until
 * a save, and main.js refuses to write a level that fails validation. */
'use strict';

/* `textdirty` covers edits Undo never sees: Monaco keeps its own history for
 * scripts (CLAUDE.md), so a script edit cannot be read off Undo.depth() the
 * way a level edit can. */
const App = {doc: null, path: null, dirty: false, textdirty: false, tab: 'level', open: [],
	warnings: []};

/* ARCH-03: the one platform fact the renderer has, driving [data-platform]
 * CSS selectors (macOS traffic-light padding, NAT-02's #title inset) - set
 * as early as possible, before the platform-dependent chrome first paints. */
document.documentElement.dataset.platform = api.platform;

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

/* Semantic warnings (BUG-11) never block a save - lvl.js's review() only
 * says what the game would trip on: missing start/end, dangling script
 * references, out-of-bounds entities.  Recomputed by main on every
 * new/open/save, alongside the level itself. */
App.setwarnings = function (list)
{
	App.warnings = list || [];
	const n = App.warnings.length;
	$('warnings').textContent = n ? n + ' warning' + (n > 1 ? 's' : '') : '';
	Panel.inspect();
};

App.inspect = function () { Panel.inspect(); };

/* NAT-03: the in-window name is now the document name plus a dirty dot only
 * - not the full path, not an asterisk - with the path moved to a tooltip.
 * The OS window title itself (macOS/Linux: name alone; Windows: "name —
 * app", since titleBarOverlay means the taskbar reads document.title) is
 * main's to set, from the same {path, dirty} it already owns (BUG-08); main
 * has no way to know the level's own display name, though, so that much
 * still comes from here on every call. */
App.retitle = function ()
{
	const n = App.doc.json.level.information.name || 'untitled';
	const el = $('name');

	el.textContent = n + (App.dirty ? ' •' : '');
	el.title = App.path || '';
	api.retitle(n);
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
		li.onclick = ev => rowmenu(ev, k, isscript);
		li.oncontextmenu = ev => rowmenu(ev, k, isscript);
		ul.appendChild(li);
	}
}

/* ---- menus ----
 *
 * NAT-05: native Menu.popup() (main.js's 'menu:row' handler) replaced the
 * hand-rolled <div id="menu"> that used to live here - no keyboard
 * navigation, no platform appearance, and it clamped near a window edge
 * instead of flipping the way a real menu does.  Only the context is sent;
 * `e.entityDef` is read now, at the moment of the click, rather than left for
 * main to ask again later, since Grid.sel can change before the async popup
 * resolves and the user picks an item. */

function rowmenu(ev, k, isscript)
{
	ev.preventDefault();
	ev.stopPropagation();
	const e = App.doc.json.level.entities[Grid.sel];
	api.rowmenu({kind: isscript ? 'script' : 'midi', key: k, entityDef: e ? e.def : null});
}

function panelmenu(ev)
{
	ev.preventDefault();
	api.rowmenu({kind: 'panel'});
}

/* The row a menu action named by key belongs to, re-found rather than kept
 * from click time - popup() is asynchronous and the list could in principle
 * have rebuilt in between, though in practice nothing else does. */
function rowbykey(k, isscript)
{
	for (const li of $(isscript ? 'scripts' : 'midis').children)
		if (li.title === k)
			return li;
	return null;
}

/* Electron has no window.prompt, so names are typed in place.  `isscript` is
 * the row's own kind, forwarded by the caller rather than re-derived from
 * `old`'s prefix - `old === null` (a brand new row) is only ever a script,
 * since MIDI is always added by import, never by inline entry. */
function edit(li, b, old, isscript)
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
		if (old === null) {
			const v = cleanscript(inp.value);
			if (v)
				App.newscript(v, true);
		} else if (isscript) {
			const v = cleanscript(inp.value);
			if (v && 'scripts/' + v !== old)
				renscript(old, 'scripts/' + v);
		} else {
			const v = cleanmidi(inp.value, old);
			if (v && 'midi/' + v !== old)
				renmidi(old, 'midi/' + v);
		}
		sidebar();
	};
}

function cleanscript(s)
{
	s = s.trim().replace(/[\\/]/g, '');
	if (!s)
		return '';
	return /\.lua$/i.test(s) ? s : s + '.lua';
}

/* Preserves whichever of .mid/.midi the file already used; a bare name
 * defaults to .mid, since that is what MIDI import writes. */
function cleanmidi(s, old)
{
	s = s.trim().replace(/[\\/]/g, '');
	if (!s)
		return '';
	if (/\.midi?$/i.test(s))
		return s;
	return s + (old && /\.midi$/i.test(old) ? '.midi' : '.mid');
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
	edit(li, b, null, true);
}

App.newscript = function (name, opentoo)
{
	let p = 'scripts/' + cleanscript(name || 'script.lua');
	let n = 2;
	while (App.doc.scripts[p] !== undefined)
		p = 'scripts/' + cleanscript((name || 'script').replace(/\.lua$/i, '') + '_' + n++);

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
	if (p === old)
		return;
	if (App.doc.midi[p] !== undefined) {
		App.say('a MIDI file named ' + p + ' already exists', true);
		return;
	}
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
	if (r === 'cancel')
		return false;
	if (r === 'discard')
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
	App.setwarnings(r.warnings);
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
	App.setwarnings(r.warnings);
	App.say('opened ' + r.path);
};

App.save = async function ()
{
	Grid.commit();
	if (!App.path)
		return App.saveas();

	const r = await api.save(App.doc);
	if (!r.ok)
		return App.fail(r.err);
	saved(r.path, r.warnings);
};

App.saveas = async function ()
{
	Grid.commit();
	const r = await api.saveas(App.doc, App.doc.json.level.information.name);
	if (!r.ok)
		return App.fail(r.err);
	if (r.cancel)
		return;
	saved(r.path, r.warnings);
};

function saved(p, warnings)
{
	App.path = p;
	App.dirty = false;
	App.textdirty = false;
	Undo.clean = Undo.depth();		/* this depth now matches disk */
	api.dirty(false);
	App.retitle();
	App.setwarnings(warnings);
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
	$('add').onclick = addscript;
	$('addmidi').onclick = ev => { ev.stopPropagation(); addmidi(); };
	$('side').onclick = panelmenu;
	$('side').oncontextmenu = panelmenu;
	addEventListener('keydown', keys, true);
	api.onclose(tryclose);
	api.oncmd(name => { if (ACTS[name]) ACTS[name](); });
	/* NAT-05: the item main.js's native popup sent back, dispatched by the
	 * action name main built it with. */
	api.onrowcmd(a => {
		if (a.action === 'open')
			App.opentab(a.key);
		else if (a.action === 'assign' && a.entityDef)
			Panel.assign(a.entityDef, a.key);
		else if (a.action === 'rename') {
			const li = rowbykey(a.key, a.kind === 'script');
			if (li)
				edit(li, li.querySelector('b'), a.key, a.kind === 'script');
		} else if (a.action === 'delete')
			(a.kind === 'script' ? delscript : delmidi)(a.key);
		else if (a.action === 'newscript')
			addscript();
		else if (a.action === 'importmidi')
			addmidi();
	});
	/* Clicking the warning count shows the level's own inspector view, where
	 * the list lives - clear any entity/definition selection standing in the
	 * way of it. */
	$('warnings').onclick = () => {
		Grid.sel = -1;
		if (Grid.tool.kind === 'entity' && !entdefs.has(Grid.tool.id))
			Grid.tool = {kind: 'block', id: 0};
		Panel.palette();
		Panel.inspect();
	};
	/* A recovered document (UX-10) replaces whatever api.blank() loaded below,
	 * whenever main decides there is a crash snapshot to offer - which can
	 * land well after 'ready', since it waits on a native dialog. */
	api.onrecover(r => {
		App.setdoc(r.doc, r.path);
		Undo.clean = -1;		/* no depth here matches what is on disk */
		App.dirty = true;
		api.dirty(true);
		App.retitle();
		App.setwarnings(r.warnings);
		App.say('recovered unsaved changes - save to keep them', true);
	});

	Code.init(() => {
		if (App.tab !== 'level')
			Code.show(App.tab);
	});

	api.blank().then(r => {
		App.setdoc(r.doc, null);
		App.setwarnings(r.warnings);
		App.say('ready');
	});

	/* Snapshot the document for crash recovery (UX-10) roughly every 30s while
	 * dirty.  Idle-triggered - never mid-gesture - so it can never observe a
	 * torn edit, and Grid.commit() runs first per CLAUDE.md's rule that every
	 * save path must call it before touching level.block_data. */
	setInterval(() => {
		if (!App.dirty || Grid.pan || Grid.paint >= 0 || Grid.moving)
			return;
		Grid.commit();
		api.snapshot(App.doc);
	}, 30000);
});
