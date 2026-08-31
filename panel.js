/* panel.js - the palette (top right) and the property inspector (bottom right).
 *
 * The inspector shows exactly one thing, chosen by what is selected: an entity
 * on the canvas, a custom definition in the palette, or the level itself. */
'use strict';

/* UX-11: showsettings is view state for #props, not canvas selection state -
 * it has to survive a click on the canvas underneath it (the user is still
 * looking at Settings until they say otherwise), which is exactly why it is
 * checked first in Panel.inspect(), below, ahead of Grid.sel/Grid.tool. */
const Panel = {showsettings: false};

/* VIS-11: the two icons a dynamically-built element still needs (the palette's
 * add-definition "+" and a tab's own close "x" - everything else the icon set
 * covers is static markup in index.html). `d` is one or more SVG path data
 * strings; the shared .icon/.icon.fill classes (style.css) own colour and
 * size, so nothing here is a presentation attribute. */
function svgicon(fill, d)
{
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('class', fill ? 'icon fill' : 'icon');
	svg.setAttribute('aria-hidden', 'true');
	const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	p.setAttribute('d', d);
	svg.appendChild(p);
	return svg;
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

/* The roving-tabindex helper needs the palette's row length to move focus
 * up/down a grid that CSS alone lays out. GEO-07 made the column count
 * itself a function of the panel's width (repeat(auto-fill, var(--cell))),
 * so a fixed PALCOLS constant would go stale the moment the panel resized -
 * read it back from the grid's own resolved column list instead, which is
 * exactly as many columns as are actually on screen. */
function palcols(el)
{
	return getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
}

/* UX-07: matched case-insensitively against each cell's own display name -
 * the same string its title/aria-label already show - not the raw catalog
 * id, so "brick" finds the brick block the same way its own tooltip names
 * it. An empty query matches everything, so the unfiltered palette is just
 * this same code path with `q` empty rather than a separate one. */
function palettematch(name)
{
	const q = $('palette-filter').value.trim().toLowerCase();
	return !q || name.toLowerCase().includes(q);
}

Panel.palette = function ()
{
	const el = $('palette');
	el.innerHTML = '';
	el.setAttribute('role', 'group');
	/* A11Y-02: the "items" <h2> (index.html) is the visible label; pointing
	 * at it beats a second string ("palette") nobody sees. */
	el.setAttribute('aria-labelledby', 'hdr-items');
	const items = [];

	group(el, items, 'blocks', [
		['block', 0, 'air (eraser)', null],
		...BLOCKS.map(t => ['block', t.id, t.name, t.file])
	]);
	group(el, items, 'items', ITEMS.map(t => ['entity', t.id, t.id, t.file]));
	group(el, items, 'entities', [
		...ENTS.map(e => ['entity', e.id, e.id, e.file]),
		...customdefs().map(d => ['entity', d.id, d.id + ' (custom)', PLACEHOLDER])
	]);

	const add = document.createElement('button');
	add.type = 'button';
	add.className = 'cell add';
	add.appendChild(svgicon(false, 'M8 3v10M3 8h10'));
	add.title = 'new custom entity definition';
	add.setAttribute('aria-label', 'new custom entity definition');
	add.onclick = newdef;
	el.appendChild(add);
	items.push(add);

	roving(el, items, palcols(el));
	App.tool(toolname());
};

/* UX-06: the same display name each palette cell already uses for its own
 * title/aria-label - block 0 is "air (eraser)", a plain block is its own
 * catalog name, and an entity or item is its own id, "(custom)" appended
 * for a definition the catalog does not know about (customdefs(), above). */
function toolname()
{
	const t = Grid.tool;

	if (t.kind === 'block')
		return t.id === 0 ? 'air (eraser)' : ((tiles.get(t.id) || {}).name || 'unknown');
	return entdefs.has(t.id) ? t.id : t.id + ' (custom)';
}

/* UX-07: `entries` is [kind, id, name, file] per cell; the whole group -
 * heading included - disappears rather than showing an empty label when a
 * filter leaves nothing in it, so a query narrows the palette instead of
 * just greying parts of it out. */
function group(parent, items, name, entries)
{
	const matching = entries.filter(e => palettematch(e[2]));
	if (!matching.length)
		return;

	const g = document.createElement('div');
	g.className = 'grp';
	g.textContent = name;
	parent.appendChild(g);
	for (const [kind, id, cellname, file] of matching)
		items.push(cell(parent, kind, id, cellname, file));
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

/* A custom definition needs a script to point at - an empty one fails
 * validation on the game's side (lvl.js requires a non-empty string), so
 * "leave it unassigned" is not a state the schema can represent.
 *
 * UX-14: always its own fresh script now, rather than whichever existing one
 * happened to come first out of Object.keys(App.doc.scripts) - silently
 * binding a brand new entity kind to an unrelated script it did not choose
 * was the actual complaint, not the fact that *some* script gets created.
 * App.newscript() call is outside the Undo.act() below rather than nested in
 * it: Undo.begin()/end() are not reentrant (a nested begin() joins the open
 * step, but the inner call's own end() would still close it early), so this
 * lands as two undo steps - the same pattern the previous, sometimes-taken
 * "create a script" branch already used. */
function newdef()
{
	const defs = App.doc.json.level.entity_definitions;
	let n = 1;
	while (defs.some(d => d.id === 'custom_' + n))
		n++;

	const id = 'custom_' + n;
	const script = App.newscript(id + '.lua');

	Undo.act(() => {
		defs.push({id: id, script: script});
		/* Whatever was selected on the canvas before is not what "+" was
		 * about - without this, Panel.inspect() below would keep showing
		 * that entity instead of the definition just created. */
		Grid.sel = -1;
		Grid.tool = {kind: 'entity', id: id};
		App.touch();
	}, 'new definition');
	Panel.palette();
	Panel.inspect();
	App.say('created ' + id + ' with ' + script);
}

/* PERF-01: onmove()'s entity-drag branch used to call the full Panel.inspect()
 * on every cell the entity crossed - a fresh ~1KB innerHTML string, plus two
 * rebuilt <select> elements, several dozen times a second.  While the shape
 * of the entity view is unchanged (still the same entity, still selected),
 * only its position fields actually move, so a drag can write straight into
 * the three fields that hold it instead.  Returns false, doing nothing, if
 * the inspector is not currently showing an entityview() for this drag - the
 * caller falls back to a full Panel.inspect() in that case (ARCH-04). */
Panel.update = function (e)
{
	const x = $('p_x'), y = $('p_y'), cell = $('p_cell');
	if (!x || !y || !cell)
		return false;
	x.value = e.pos[0];
	y.value = e.pos[1];
	cell.value = Math.floor(e.pos[0] / B) + ', ' + Math.floor(e.pos[1] / B);
	return true;
};

/* ARCH-04: every rebuild below replaces #props's own subtree wholesale, so a
 * field the user is mid-edit in (p_def, p_id, the p_script/p_bg selects) is
 * destroyed and a new, unfocused element takes its place - Tab or
 * a screen reader loses its position entirely, not just the caret.  Saving
 * which field (by id) held focus before the rebuild and restoring it after
 * fixes every onchange call site at once, rather than patching each by hand;
 * a text field's own selection range is restored too, so it is only the
 * caret's *position*, not the caret itself, that a rebuild can still move. */
function savefocus(p)
{
	const el = document.activeElement;
	if (!el || !p.contains(el) || !el.id)
		return null;
	const r = {id: el.id};
	if (typeof el.selectionStart === 'number') {
		r.start = el.selectionStart;
		r.end = el.selectionEnd;
	}
	return r;
}

function restorefocus(p, r)
{
	if (!r)
		return;
	const el = $(r.id);
	if (!el)
		return;
	el.focus();
	if (r.start != null && typeof el.setSelectionRange === 'function')
		el.setSelectionRange(r.start, r.end);
}

Panel.inspect = function ()
{
	const p = $('props');
	const es = App.doc.json.level.entities;
	const focus = savefocus(p);

	if (Panel.showsettings)
		settingsview(p);
	else if (Grid.sel >= 0 && es[Grid.sel])
		entityview(p, es[Grid.sel]);
	else if (Grid.tool.kind === 'entity' && !entdefs.has(Grid.tool.id))
		defview(p, Grid.tool.id);
	else
		levelview(p);
	restorefocus(p, focus);
};

/* UX-11: the fourth #props view - not chosen by canvas selection like the
 * other three, but by the Settings command (ACTS.settings, app.js) until
 * "done" clears Panel.showsettings again. setsetting() applies each
 * control's own live effect immediately (applysettings(), app.js) and
 * persists the whole object in one round trip, rather than one channel per
 * field - four settings do not need four channels. */
function setsetting(key, value)
{
	Settings[key] = value;
	applysettings();
	call(api.setsettings(Settings));	/* ARCH-06: fire-and-forget through the one envelope every invoke() answers */
}

function settingsview(p)
{
	p.innerHTML =
		'<h4>settings</h4>' +
		'<label><input id="p_grid" type="checkbox"' + (Settings.grid ? ' checked' : '') +
			'> grid overlay</label>' +
		'<label>palette cell size<select id="p_cellsize">' +
			'<option value="1"' + (Settings.cellsize === 1 ? ' selected' : '') + '>1x</option>' +
			'<option value="2"' + (Settings.cellsize === 2 ? ' selected' : '') + '>2x</option>' +
		'</select></label>' +
		'<label>editor font size<input id="p_editorfontsize" type="number" min="8" max="32" value="' +
			Settings.editorfontsize + '"></label>' +
		'<label>recovery snapshot interval (seconds)<input id="p_snapshotinterval" type="number" min="5" max="600" value="' +
			Settings.snapshotinterval + '"></label>' +
		'<button class="act" id="p_settings_done">done</button>';

	$('p_grid').onchange = e => setsetting('grid', e.target.checked);
	$('p_cellsize').onchange = e => setsetting('cellsize', +e.target.value);
	$('p_editorfontsize').onchange = e => setsetting('editorfontsize',
		Math.min(32, Math.max(8, +e.target.value)));
	$('p_snapshotinterval').onchange = e => setsetting('snapshotinterval',
		Math.min(600, Math.max(5, +e.target.value)));
	$('p_settings_done').onclick = () => {
		Panel.showsettings = false;
		Panel.inspect();
	};
}

function levelview(p)
{
	const l = App.doc.json.level;
	const i = l.information;

	p.innerHTML =
		'<h4>level</h4>' +
		'<label>name<input id="p_name" value="' + esc(i.name) + '"></label>' +
		'<label>description<textarea id="p_desc">' + esc(i.description) + '</textarea></label>' +
		'<label>author<input id="p_auth" value="' + esc(i.author) + '"></label>' +
		'<h4>background</h4>' +
		'<select id="p_bg">' + BGS.map(b => '<option' +
			(l.backgrounds[0] === b.id ? ' selected' : '') + '>' +
			esc(b.id) + '</option>').join('') + '</select>' +
		/* Both dimensions are fixed - B/W/H (catalog.js) are a cross-repo
		 * contract with the game (CLAUDE.md), not a per-level choice, so
		 * rows reads the same way width already did rather than offering an
		 * edit the game could never honour. */
		'<h4>size</h4>' +
		'<div class="row">' +
			'<label>width<input value="' + W + '" disabled aria-disabled="true"></label>' +
			'<label>rows<input value="' + Grid.h + '" disabled aria-disabled="true"></label>' +
		'</div>' +
		'<button class="act" id="p_fit">fit view</button>';

	bind('p_name', v => { i.name = v; App.retitle(); }, 'rename level');
	bind('p_desc', v => { i.description = v; }, 'edit description');
	bind('p_auth', v => { i.author = v; }, 'edit author');
	$('p_bg').onchange = e => Undo.act(() => {
		l.backgrounds = [e.target.value];
		App.touch();
		Grid.redraw();
	}, 'change background');
	$('p_fit').onclick = Grid.fit;
}

function entityview(p, e)
{
	const defs = App.doc.json.level.entity_definitions;
	const known = ENTS.concat(ITEMS).map(v => v.id)
		.concat(customdefs().map(d => d.id));

	if (!known.includes(e.def))		/* a def the catalog never knew */
		known.unshift(e.def);

	/* Items and entities are the same thing on disk and in every code path
	 * here (CLAUDE.md: "Interactives are entities, not tiles") - this is the
	 * one place that visually tells them apart, since the palette already
	 * keeps them in separate groups (ITEMS vs ENTS, palette() above) and a
	 * user who dragged a coin in from the "items" group should not read
	 * "entity" back at them. A custom definition (never in ITEMS) still
	 * reads "entity", unchanged. */
	const title = ITEMS.some(v => v.id === e.def) ? 'item' : 'entity';

	p.innerHTML =
		'<h4>' + title + '</h4>' +
		'<label>definition<select id="p_def">' + known.map(id =>
			'<option' + (id === e.def ? ' selected' : '') + '>' + esc(id) +
			'</option>').join('') + '</select></label>' +
		/* UX-17: x/y round silently to the nearest B on commit (the onchange
		 * handlers below) since entities snap to the grid (CLAUDE.md) - the
		 * label says so now, rather than a typed 137 turning into 100 with
		 * no explanation anywhere on screen. */
		'<div class="row">' +
			'<label>x (snaps to ' + B + ')<input id="p_x" type="number" step="' + B + '" value="' + e.pos[0] + '"></label>' +
			'<label>y (snaps to ' + B + ')<input id="p_y" type="number" step="' + B + '" value="' + e.pos[1] + '"></label>' +
		'</div>' +
		'<label>cell<input id="p_cell" value="' + Math.floor(e.pos[0] / B) + ', ' +
			Math.floor(e.pos[1] / B) + '" disabled aria-disabled="true"></label>' +
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
	}, 'change entity definition');
	/* ARCH-04/PERF-01: Panel.update() over the full Panel.inspect() this used
	 * to call - the same field this handler's own onchange just fired from
	 * is exactly what a rebuild here would destroy mid-interaction (e.g.
	 * Tab from p_x straight into p_y), and PERF-01 already gave this drag
	 * hot path a helper that writes x/y/cell in place for precisely this. */
	for (const [id, n] of [['p_x', 0], ['p_y', 1]])
		$(id).onchange = ev => Undo.act(() => {
			e.pos[n] = Math.round(+ev.target.value / B) * B;
			App.touch();
			Grid.redraw();
			Panel.update(e);
		}, 'move entity');
	$('p_script').onchange = ev => Panel.assign(e.def, ev.target.value);
	$('p_del').onclick = () => Undo.act(() => {
		App.doc.json.level.entities.splice(Grid.sel, 1);
		Grid.sel = -1;
		App.touch();
		Grid.redraw();
		Panel.inspect();
	}, 'remove entity');

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
	}, 'assign script');
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
	}, 'rename definition');
	$('p_script').onchange = ev => Panel.assign(d.id, ev.target.value);
	$('p_rm').onclick = () => {
		const es = App.doc.json.level.entities;
		let removed = 0;
		Undo.act(() => {
			for (let i = es.length - 1; i >= 0; i--)
				if (es[i].def === d.id) {
					es.splice(i, 1);
					removed++;
				}
			defs.splice(defs.indexOf(d), 1);
			Grid.tool = {kind: 'block', id: 2};
			Grid.sel = -1;
			App.touch();
		}, 'remove definition');
		Panel.palette();
		Panel.inspect();
		Grid.redraw();
		/* UX-08: undoable (Undo.act, above), but otherwise silent - clicking
		 * this was one click for what can be dozens of placed entities. */
		App.say('removed \'' + d.id + '\'' + (removed ?
			' and ' + removed + ' ' + (removed === 1 ? 'entity' : 'entities') +
				' · ' + (api.platform === 'darwin' ? '⌘Z' : 'Ctrl+Z') + ' to undo' :
			''));
	};
}

/* Live-edit a text field without rebuilding the panel under the caret.  The
 * undo step spans the whole visit to the field, so typing a name undoes as a
 * name rather than as thirteen letters. */
function bind(id, set, label)
{
	const el = $(id);

	/* UX-03: wrapped rather than `el.onfocus = Undo.begin` directly - a DOM
	 * event handler is called with the Event as its first argument, which
	 * would otherwise become the step's label. */
	el.onfocus = () => Undo.begin(label);
	el.oninput = e => { set(e.target.value); App.touch(); };
	el.onblur = Undo.end;
}
