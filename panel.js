/* panel.js - the palette (top right) and the property inspector (bottom right).
 *
 * The inspector shows exactly one thing, chosen by what is selected: an entity
 * on the canvas, a custom definition in the palette, or the level itself. */
'use strict';

const Panel = {};

function $(id) { return document.getElementById(id); }

function esc(s)
{
	return String(s).replace(/[&<>"]/g, c =>
		({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
}

/* A11Y-01: roving tabindex for a list of focusable items sharing one Tab
 * stop - exactly one carries tabindex 0 (the current item, if any, else the
 * first), the rest -1, and the arrow keys move both the tab stop and focus.
 * `cols` is the row length for a 2D grid (the palette); 1 for a plain list
 * or a horizontal strip, where up/down and left/right end up equivalent,
 * which is harmless. Shared by the palette (panel.js), and the file lists
 * and tab strip (app.js). */
function roving(container, items, cols)
{
	for (const el of items)
		el.tabIndex = -1;
	const cur = items.find(el => el.classList.contains('on')) || items[0];
	if (cur)
		cur.tabIndex = 0;

	container.onkeydown = e => {
		const i = items.indexOf(document.activeElement);
		if (i < 0)
			return;
		let j;
		if (e.key === 'ArrowRight') j = i + 1;
		else if (e.key === 'ArrowLeft') j = i - 1;
		else if (e.key === 'ArrowDown') j = i + cols;
		else if (e.key === 'ArrowUp') j = i - cols;
		else if (e.key === 'Home') j = 0;
		else if (e.key === 'End') j = items.length - 1;
		else return;
		e.preventDefault();
		if (j < 0 || j >= items.length)
			return;
		items[i].tabIndex = -1;
		items[j].tabIndex = 0;
		items[j].focus();
	};
}

/* Definitions the level carries that the catalog does not know about. */
function customdefs()
{
	return App.doc.json.level.entity_definitions.filter(d => !entdefs.has(d.id));
}

/* PALCOLS must match style.css's grid-template-columns: repeat(4, 1fr) - the
 * roving tabindex helper needs the row length to move focus up/down a grid
 * that CSS alone lays out. */
const PALCOLS = 4;

Panel.palette = function ()
{
	const el = $('palette');
	el.innerHTML = '';
	el.setAttribute('role', 'group');
	el.setAttribute('aria-label', 'palette');
	const items = [];

	group(el, 'blocks');
	items.push(cell(el, 'block', 0, 'air (eraser)', null));
	for (const t of BLOCKS)
		items.push(cell(el, 'block', t.id, t.name, t.file));

	group(el, 'items');
	for (const t of ITEMS)
		items.push(cell(el, 'entity', t.id, t.id, t.file));

	group(el, 'entities');
	for (const e of ENTS)
		items.push(cell(el, 'entity', e.id, e.id, e.file));
	for (const d of customdefs())
		items.push(cell(el, 'entity', d.id, d.id + ' (custom)', PLACEHOLDER));

	const add = document.createElement('button');
	add.type = 'button';
	add.className = 'cell add';
	add.textContent = '+';
	add.title = 'New custom entity definition';
	add.setAttribute('aria-label', 'New custom entity definition');
	add.onclick = newdef;
	el.appendChild(add);
	items.push(add);

	roving(el, items, PALCOLS);
};

function group(parent, name)
{
	const g = document.createElement('div');
	g.className = 'grp';
	g.textContent = name;
	parent.appendChild(g);
}

/* A11Y-01: a real <button> rather than a clickable <div> - Enter/Space
 * activate it for free, and it is reachable through the roving-tabindex
 * group roving() sets up over Panel.palette()'s full return value. */
function cell(parent, kind, id, name, file)
{
	const c = document.createElement('button');
	const on = Grid.tool.kind === kind && Grid.tool.id === id;

	c.type = 'button';
	c.className = 'cell' + (file ? '' : ' air') + (on ? ' on' : '');
	c.title = name;
	c.setAttribute('aria-label', name);
	c.setAttribute('aria-pressed', on ? 'true' : 'false');
	if (file)
		c.style.backgroundImage = 'url("' + texurl(file) + '")';
	c.onclick = () => {
		Grid.tool = {kind: kind, id: id};
		Grid.sel = -1;
		Panel.palette();
		Panel.inspect();
		Grid.redraw();
		Grid.cursor(Grid.hov);
	};
	parent.appendChild(c);
	return c;
}

/* A custom definition needs a script to point at, so make one if the level has
 * none yet: an empty definition would fail validation on the game's side. */
function newdef()
{
	const defs = App.doc.json.level.entity_definitions;
	let n = 1;
	while (defs.some(d => d.id === 'custom_' + n))
		n++;

	const id = 'custom_' + n;
	let script = Object.keys(App.doc.scripts)[0];
	if (!script)
		script = App.newscript(id + '.lua');

	Undo.act(() => {
		defs.push({id: id, script: script});
		Grid.tool = {kind: 'entity', id: id};
		App.touch();
	});
	Panel.palette();
	Panel.inspect();
}

Panel.inspect = function ()
{
	const p = $('props');
	const es = App.doc.json.level.entities;

	if (Grid.sel >= 0 && es[Grid.sel])
		entityview(p, es[Grid.sel]);
	else if (Grid.tool.kind === 'entity' && !entdefs.has(Grid.tool.id))
		defview(p, Grid.tool.id);
	else
		levelview(p);
};

function levelview(p)
{
	const l = App.doc.json.level;
	const i = l.information;
	const warn = (App.warnings || []).length ?
		'<h4>warnings</h4><ul class="warn">' +
		App.warnings.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '';

	p.innerHTML = warn +
		'<h4>level</h4>' +
		'<label>name<input id="p_name" value="' + esc(i.name) + '"></label>' +
		'<label>description<textarea id="p_desc">' + esc(i.description) + '</textarea></label>' +
		'<label>author<input id="p_auth" value="' + esc(i.author) + '"></label>' +
		'<h4>background</h4>' +
		'<select id="p_bg">' + BGS.map(b => '<option' +
			(l.backgrounds[0] === b.id ? ' selected' : '') + '>' +
			esc(b.id) + '</option>').join('') + '</select>' +
		'<h4>size</h4>' +
		'<div class="row">' +
			'<label>width<input value="' + W + '" disabled></label>' +
			'<label>rows<input id="p_rows" type="number" min="1" max="999" value="' + Grid.h + '"></label>' +
		'</div>' +
		'<button class="act" id="p_fit">fit view</button>';

	bind('p_name', v => { i.name = v; App.retitle(); });
	bind('p_desc', v => { i.description = v; });
	bind('p_auth', v => { i.author = v; });
	$('p_bg').onchange = e => Undo.act(() => {
		l.backgrounds = [e.target.value];
		App.touch();
		Grid.redraw();
	});
	$('p_rows').onchange = e => {
		Grid.setheight(+e.target.value);
		Panel.inspect();
	};
	$('p_fit').onclick = Grid.fit;
}

function entityview(p, e)
{
	const defs = App.doc.json.level.entity_definitions;
	const known = ENTS.concat(ITEMS).map(v => v.id)
		.concat(customdefs().map(d => d.id));

	if (!known.includes(e.def))		/* a def the catalog never knew */
		known.unshift(e.def);

	p.innerHTML =
		'<h4>entity</h4>' +
		'<label>definition<select id="p_def">' + known.map(id =>
			'<option' + (id === e.def ? ' selected' : '') + '>' + esc(id) +
			'</option>').join('') + '</select></label>' +
		'<div class="row">' +
			'<label>x<input id="p_x" type="number" step="' + B + '" value="' + e.pos[0] + '"></label>' +
			'<label>y<input id="p_y" type="number" step="' + B + '" value="' + e.pos[1] + '"></label>' +
		'</div>' +
		'<label>cell<input value="' + Math.floor(e.pos[0] / B) + ', ' +
			Math.floor(e.pos[1] / B) + '" disabled></label>' +
		'<h4>script</h4>' +
		'<select id="p_script">' + scripts(e.def).map(v =>
			'<option' + (v === script(e.def) ? ' selected' : '') + '>' + esc(v) +
			'</option>').join('') + '</select>' +
		'<div class="hint">' + shared(e.def) + '</div>' +
		'<button class="act" id="p_del">remove entity</button>';

	$('p_def').onchange = ev => Undo.act(() => {
		e.def = ev.target.value;
		App.usedef(e.def);
		App.touch();
		Grid.redraw();
		Panel.inspect();
	});
	for (const [id, n] of [['p_x', 0], ['p_y', 1]])
		$(id).onchange = ev => Undo.act(() => {
			e.pos[n] = Math.round(+ev.target.value / B) * B;
			App.touch();
			Grid.redraw();
			Panel.inspect();
		});
	$('p_script').onchange = ev => Panel.assign(e.def, ev.target.value);
	$('p_del').onclick = () => Undo.act(() => {
		App.doc.json.level.entities.splice(Grid.sel, 1);
		Grid.sel = -1;
		App.touch();
		Grid.redraw();
		Panel.inspect();
	});

	function script(id)
	{
		const d = defs.find(v => v.id === id);
		return d ? d.script : '(unassigned)';
	}

	/* Everything the definition could point at: the built-in behaviour it
	 * ships with, plus every Lua file in this level. */
	function scripts(id)
	{
		const c = entdefs.get(id);
		const out = c ? [c.script] : [];

		for (const p of Object.keys(App.doc.scripts).sort())
			if (!out.includes(p))
				out.push(p);
		if (!out.includes(script(id)))
			out.unshift(script(id));
		return out;
	}

	function shared(id)
	{
		const n = App.doc.json.level.entities.filter(v => v.def === id).length;
		return n > 1 ? 'shared by ' + n + ' entities of this kind' :
			'used by this entity only';
	}
}

/* The script belongs to the definition, so assigning one moves every entity
 * of that kind.  Callers show which. */
Panel.assign = function (def, path)
{
	Undo.act(() => {
		const d = App.doc.json.level.entity_definitions.find(v => v.id === def);
		if (!d)
			return;
		d.script = path;
		App.touch();
	});
	Panel.inspect();
	App.say(def + ' -> ' + path);
};

function defview(p, id)
{
	const defs = App.doc.json.level.entity_definitions;
	const d = defs.find(v => v.id === id);
	if (!d) {
		levelview(p);
		return;
	}
	const scripts = Object.keys(App.doc.scripts);

	p.innerHTML =
		'<h4>definition</h4>' +
		'<label>id<input id="p_id" value="' + esc(d.id) + '"></label>' +
		'<label>script<select id="p_script">' + scripts.map(s =>
			'<option' + (s === d.script ? ' selected' : '') + '>' + esc(s) +
			'</option>').join('') + '</select></label>' +
		'<button class="act" id="p_rm">remove definition</button>';

	$('p_id').onchange = ev => Undo.act(() => {
		const v = ev.target.value.trim();
		if (!v || defs.some(x => x !== d && x.id === v) || entdefs.has(v)) {
			App.say('id must be non-empty and unused', true);
			Panel.inspect();
			return;
		}
		for (const e of App.doc.json.level.entities)
			if (e.def === d.id)
				e.def = v;
		d.id = v;
		Grid.tool = {kind: 'entity', id: v};
		App.touch();
		Panel.palette();
		Panel.inspect();
	});
	$('p_script').onchange = ev => Panel.assign(d.id, ev.target.value);
	$('p_rm').onclick = () => Undo.act(() => {
		const es = App.doc.json.level.entities;
		for (let i = es.length - 1; i >= 0; i--)
			if (es[i].def === d.id)
				es.splice(i, 1);
		defs.splice(defs.indexOf(d), 1);
		Grid.tool = {kind: 'block', id: 2};
		Grid.sel = -1;
		App.touch();
		Panel.palette();
		Panel.inspect();
		Grid.redraw();
	});
}

/* Live-edit a text field without rebuilding the panel under the caret.  The
 * undo step spans the whole visit to the field, so typing a name undoes as a
 * name rather than as thirteen letters. */
function bind(id, set)
{
	const el = $(id);

	el.onfocus = Undo.begin;
	el.oninput = e => { set(e.target.value); App.touch(); };
	el.onblur = Undo.end;
}
