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

/* UX-09: shown once, on a genuinely first run (boot(), below) - a fresh
 * blank level with no prior session to restore. */
const HINT = 'click to place · right-drag to erase · alt-drag to pan';

/* A11Y-06: style.css's own --font-size/--font-size-sm/--line-box (12px/11px/
 * 18px) are what every type size and, through the --row-* bands that are
 * calc()s off --line-box, every row height in the chrome ultimately comes
 * from - scaling those three together, in place, grows the rows built to
 * hold a line of text along with the text itself, instead of clipping it.
 * --space-* (gaps and padding) is deliberately left alone: a dense tool UI's
 * controls would lose their own grid if those grew with text too.
 *
 * POLISH.md's own suggestion was to express --font-size/--font-size-sm in
 * rem and let a root font-size change do the rest - not done that way here,
 * because tokens.js reads both with getComputedStyle(...).getPropertyValue(),
 * which returns a custom property's *specified* value verbatim ("0.75rem"),
 * never resolved to pixels the way an ordinary property is once applied -
 * code.js's own Monaco font size would have silently become 0.75 instead of
 * 12. Overriding the three tokens directly sidesteps that without touching
 * what tokens.js or code.js read. uibase is captured once, from the
 * un-scaled tokens still in style.css's own :root, so repeated in/out/reset
 * commands always compute from the same base rather than compounding a
 * stale one. */
let uibase = null;

function uiscalebase()
{
	if (!uibase) {
		const cs = getComputedStyle(document.documentElement);
		uibase = {
			size: parseFloat(cs.getPropertyValue('--font-size')),
			sizeSm: parseFloat(cs.getPropertyValue('--font-size-sm')),
			line: parseFloat(cs.getPropertyValue('--line-box'))
		};
	}
	return uibase;
}

const UISCALE_KEY = 'pb-uiscale', UISCALE_STEP = 1.1, UISCALE_MIN = 0.75, UISCALE_MAX = 2;

function applyuiscale(v)
{
	v = Math.min(UISCALE_MAX, Math.max(UISCALE_MIN, v));
	const b = uiscalebase();
	const root = document.documentElement.style;

	root.setProperty('--font-size', (b.size * v) + 'px');
	root.setProperty('--font-size-sm', (b.sizeSm * v) + 'px');
	root.setProperty('--line-box', (b.line * v) + 'px');
	localStorage.setItem(UISCALE_KEY, v);
	/* Grid.cv does not exist yet the first time this runs, before Grid.init()
	 * (index.html loads grid.js ahead of app.js, so Grid itself already does) -
	 * harmless, since Grid.init() reads the already-scaled CSS on its own
	 * first layout pass, so nothing is missed. */
	if (Grid.cv)
		Grid.resize();
}

applyuiscale(+localStorage.getItem(UISCALE_KEY) || 1);

/* UX-09: the first-run hint (boot(), below) is sticky - it says so itself,
 * comparing #msg's own text rather than a separate flag, so it only ever
 * clears itself and never a different, more recent message that happened to
 * still be showing when the first edit landed. */
App.touch = function ()
{
	if ($('msg').textContent === HINT)
		App.say('');
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
	/* UX-03: the step at the top of each stack is the one Undo/Redo would
	 * act on next - its label is what lets the menu read "Undo Paint"
	 * instead of a generic "Undo" no matter what the last edit was. */
	api.menustate({
		tab: App.tab,
		canUndo: Undo.past.length > 0,
		canRedo: Undo.future.length > 0,
		undoLabel: Undo.past.length ? Undo.past[Undo.past.length - 1].label : null,
		redoLabel: Undo.future.length ? Undo.future[Undo.future.length - 1].label : null
	});
};

/* VIS-14: a transient confirmation used to sit there for the rest of the
 * session, indistinguishable in permanence from an actual error. A success
 * auto-clears after ~4s, with the colour transition #msg already has
 * (VIS-08); an error persists until the next action, per the finding's own
 * text, and never relies on colour alone - a small aria-hidden glyph (the
 * message text itself, which role="status" already announces, carries the
 * meaning for a screen reader) plus the existing --danger colour. */
let saytimer = null;
/* UX-09: `sticky` skips the auto-clear timer, for the first-run hint below -
 * it needs to survive until the user's first edit dismisses it explicitly,
 * not four seconds, which is barely enough time to read it once. */
App.say = function (m, bad, sticky)
{
	const el = $('msg');

	clearTimeout(saytimer);
	el.textContent = '';
	el.classList.toggle('bad', !!bad);
	if (bad && m) {
		const icon = document.createElement('span');
		icon.textContent = '⚠';
		icon.setAttribute('aria-hidden', 'true');
		el.append(icon, ' ' + m);
	} else {
		el.textContent = m || '';
		if (m && !sticky)
			saytimer = setTimeout(() => { el.textContent = ''; }, 4000);
	}
};

App.status = function (cx, cy)
{
	$('cursor').textContent = cx >= 0 && cx < W && cy >= 0 && cy < Grid.h
		? cx + ', ' + cy : '';
};

/* VIS-14: level dimensions and entity count had nowhere to live either.
 * Grid.draw() calls this once per frame, the same place App.zoom() already
 * gets its own readout from - cheap (two textContent writes) and correct
 * without hunting down every one of the several places that add or remove
 * an entity. */
App.stats = function (dims, n)
{
	$('dims').textContent = dims;
	$('entcount').textContent = n + (n === 1 ? ' entity' : ' entities');
};

/* UX-04: the only zoom feedback used to be none at all - wheel-only, with no
 * numeric readout and no command beyond it.  Grid.draw() reports the current
 * percentage on every frame; clicking it pops the same native quick-menu
 * (main.js's 'menu:zoom' handler, NAT-05's pattern) the View menu's Zoom
 * commands also dispatch through. */
App.zoom = function (pct) { $('zoom').textContent = pct + '%'; };

/* UX-06: the only feedback for which tool is about to paint was a 1px border
 * on one of 30-odd similar palette cells - easy to miss, and no feedback at
 * all for a keyboard user who has tabbed past the palette. Panel.palette()
 * calls this with the newly-selected tool's own display name on every
 * change, the same name the palette cell itself already shows as a tooltip. */
App.tool = function (name) { $('tool').textContent = 'tool: ' + name; };

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
	/* A11Y-05: role="alert" carries its own implicit assertive live region
	 * and - unlike a plain aria-live attribute - is defined to announce even
	 * though this element is created and inserted after the fact rather than
	 * sitting empty in the DOM from load, which is what makes it the right
	 * choice for a block that Panel.inspect() (just above) tears down and
	 * this function recreates on every failure. */
	d.setAttribute('role', 'alert');
	d.setAttribute('aria-atomic', 'true');
	/* A11Y-08: the same non-colour cue #msg's own error state carries - a
	 * screen reader already gets role="alert" above; this is for a sighted
	 * user who cannot rely on --danger alone. */
	const icon = document.createElement('span');
	icon.textContent = '⚠';
	icon.setAttribute('aria-hidden', 'true');
	d.append(icon, ' ' + err);
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
	el.setAttribute('role', 'tablist');
	el.setAttribute('aria-label', 'open tabs');
	const items = [tab('level', 'Level Editor', false)];
	for (const p of App.open)
		items.push(tab(p, p, true));
	roving(el, items, 1);
	document.body.classList.toggle('text', App.tab !== 'level');
	/* UX-16: switching to a tab scrolled out of the strip's own width used
	 * to leave it still out of sight - nothing scrolled it into view, and
	 * nothing else does either. 'nearest' does not disturb tabs already
	 * visible, matching how a browser's own tab strip behaves. */
	const on = items.find(t => t.classList.contains('on'));
	if (on)
		on.scrollIntoView({block: 'nearest', inline: 'nearest'});
}

/* A11Y-01: role="tab" rather than a real <button>, because the closable ones
 * nest a real <button> for the close glyph - button-in-button is invalid
 * HTML and Chromium hoists the inner one out, breaking the layout. Enter and
 * Space are therefore wired by hand; roving() (panel.js) still gives the
 * strip one Tab stop and handles the arrow keys. */
function tab(id, label, closable)
{
	const t = document.createElement('div');

	/* UX-16: the one non-closable tab is pinned outside the scrolling region
	 * (style.css's .tab.pin) rather than just looking identical to every
	 * closable one next to it. */
	t.className = 'tab' + (App.tab === id ? ' on' : '') + (closable ? '' : ' pin');
	t.setAttribute('role', 'tab');
	t.setAttribute('aria-selected', App.tab === id ? 'true' : 'false');
	t.innerHTML = '<span></span>';
	t.firstChild.textContent = label;
	t.onclick = () => App.select(id);
	t.onkeydown = e => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			App.select(id);
		}
	};
	if (closable) {
		const x = document.createElement('button');
		x.type = 'button';
		x.className = 'tabclose';
		x.tabIndex = -1;			/* reachable by mouse; Ctrl+W covers keyboard */
		x.appendChild(svgicon(false, 'M4.5 4.5l7 7M11.5 4.5l-7 7'));	/* VIS-11 */
		x.setAttribute('aria-label', 'Close ' + label);
		x.onclick = e => { e.stopPropagation(); App.closetab(id); };
		/* UX-16: middle-click-to-close, which every tabbed editor supports. */
		t.onauxclick = e => { if (e.button === 1) App.closetab(id); };
		t.appendChild(x);
	}
	$('tablist').appendChild(t);
	return t;
}

App.select = function (id)
{
	App.tab = id;
	tabs();
	if (id === 'level')
		Grid.resize();
	else if (Code.ready)
		Code.show(id);
	else
		/* ARCH-08: the first script tab a session opens is what triggers
		 * Monaco's lazy load; `done` reads App.tab rather than closing over
		 * `id`, since the user is free to switch tabs again before a slow
		 * load finishes. */
		Code.init(() => { if (App.tab !== 'level') Code.show(App.tab); });
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

/* VIS-12: a fresh document - the state App.setdoc() always starts in - left
 * both lists blank voids with no indication that anything could go there or
 * how (GEO-05's content-driven default is what keeps that void from also
 * being a disproportionate 60/40 empty region). Not a role="option" row -
 * there is nothing here to select - just static text plus the one action
 * that would fill it, the section's own create command so there is exactly
 * one way to do it, not two. */
function empty(ul, isscript)
{
	const li = document.createElement('li');
	const b = document.createElement('button');

	li.className = 'empty';
	li.setAttribute('role', 'presentation');
	li.append(isscript ? 'no scripts yet · ' : 'no midi files · ');
	b.type = 'button';
	b.textContent = isscript ? 'new script' : 'import…';
	b.onclick = isscript ? addscript : addmidi;
	li.appendChild(b);
	ul.appendChild(li);
}

function list(ul, keys, isscript)
{
	ul.innerHTML = '';
	ul.setAttribute('role', 'listbox');
	/* A11Y-02: the section's own <h2> (index.html) is the list's real label
	 * now, not a second, parallel string naming the same thing. */
	ul.setAttribute('aria-labelledby', isscript ? 'hdr-scripts' : 'hdr-midi');
	if (!keys.length) {
		empty(ul, isscript);
		return;
	}
	const items = [];
	for (const k of keys) {
		const li = document.createElement('li');
		const b = document.createElement('span');

		b.textContent = k.replace(/^[^/]+\//, '');
		li.className = App.tab === k ? 'on' : '';
		li.title = k;
		li.setAttribute('role', 'option');
		li.setAttribute('aria-selected', App.tab === k ? 'true' : 'false');
		li.appendChild(b);
		li.onclick = ev => rowmenu(ev, k, isscript);
		li.oncontextmenu = ev => rowmenu(ev, k, isscript);
		/* UX-01: left-click opening the menu instead of the row was a
		 * documented, deliberate choice (CLAUDE.md), but it costs the file
		 * manager's most frequent action - opening a script - two clicks and
		 * a pointer traverse.  Double-click is the same gesture every other
		 * file manager on every platform uses for "open", and it does not
		 * cost the menu anything: dblclick fires after the second click's own
		 * click/rowmenu() has already opened and dismissed it. */
		if (isscript)
			li.ondblclick = () => App.opentab(k);
		li.onkeydown = ev => rowkeys(ev, li, k, isscript);
		ul.appendChild(li);
		items.push(li);
	}
	roving(ul, items, 1);
}

/* A11Y-01: the keyboard equivalents a mouse gets for free from left-click
 * (which opens the row's menu, CLAUDE.md) - a script's most common action,
 * "open", gets its own key rather than forcing every keyboard user through
 * the menu; rename and delete are the menu's other two mutating entries. */
function rowkeys(ev, li, k, isscript)
{
	if (ev.key === 'Enter' && isscript) {
		ev.preventDefault();
		App.opentab(k);
	} else if (ev.key === 'F2') {
		ev.preventDefault();
		edit(li, li.querySelector('span'), k, isscript);
	} else if (ev.key === 'Delete' || ev.key === 'Backspace') {
		ev.preventDefault();
		(isscript ? delscript : delmidi)(k);
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

/* UX-15: what the typed name would become and, if it cannot commit, why - the
 * same duplicate/empty checks renscript()/renmidi() make after the fact,
 * moved earlier so edit() can show the problem while the user is still typing
 * instead of after the field is already gone. `key === old` (renaming to the
 * name it already has) is deliberately not an error - it is a no-op commit,
 * not a collision with itself. */
function badname(raw, old, isscript)
{
	const clean = isscript ? cleanscript(raw) : cleanmidi(raw, old);
	if (!clean)
		return 'name cannot be empty';
	const key = (isscript ? 'scripts/' : 'midi/') + clean;
	if (key === old)
		return '';
	const table = isscript ? App.doc.scripts : App.doc.midi;
	return table[key] !== undefined ?
		(isscript ? 'a script' : 'a MIDI file') + ' named ' + clean + ' already exists' : '';
}

/* Electron has no window.prompt, so names are typed in place.  `isscript` is
 * the row's own kind, forwarded by the caller rather than re-derived from
 * `old`'s prefix - `old === null` (a brand new row) is only ever a script,
 * since MIDI is always added by import, never by inline entry.
 *
 * UX-15: validated as the user types (badname(), above) rather than only
 * after commit, so a duplicate or empty name is visible - a --danger border
 * plus a one-line message under the field - before Enter or blur is even
 * tried.  A failed commit leaves the field open with the typed text intact
 * instead of discarding it into sidebar()'s rebuild, which is what used to
 * make a rejected rename indistinguishable from a silently ignored one. */
function edit(li, b, old, isscript)
{
	const inp = document.createElement('input');
	const err = document.createElement('div');

	inp.value = b.textContent;
	/* VIS-08: a bare fade-in marks the moment this field replaces the row's
	 * static label, rather than the label just vanishing and this appearing.
	 * VIS-15: .field is the same shared text-input component #props uses,
	 * so this is no longer a second, visually distinct input built by hand. */
	inp.className = 'field rename';
	err.className = 'rename-err';
	err.setAttribute('role', 'alert');
	li.classList.add('editing');
	li.replaceChild(inp, b);
	li.appendChild(err);
	inp.focus();
	inp.select();

	function check()
	{
		const msg = badname(inp.value, old, isscript);
		inp.classList.toggle('invalid', !!msg);
		err.textContent = msg;
		return !msg;
	}
	check();

	function commit()
	{
		if (!check()) {
			inp.focus();
			return;
		}
		if (old === null)
			App.newscript(cleanscript(inp.value), true);
		else if (isscript) {
			const v = cleanscript(inp.value);
			if ('scripts/' + v !== old)
				renscript(old, 'scripts/' + v);
		} else {
			const v = cleanmidi(inp.value, old);
			if ('midi/' + v !== old)
				renmidi(old, 'midi/' + v);
		}
		sidebar();
	}

	inp.oninput = check;
	inp.onkeydown = e => {
		if (e.key === 'Enter') {
			e.preventDefault();
			commit();
		} else if (e.key === 'Escape') { inp.onblur = null; sidebar(); }
		e.stopPropagation();
	};
	inp.onmousedown = e => e.stopPropagation();
	inp.onclick = e => e.stopPropagation();
	inp.onblur = commit;
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
	/* VIS-12: an empty list's placeholder row is the thing that just got
	 * clicked (it is the only route into this function while the list is
	 * empty) - drop it now rather than leaving "no scripts yet" hanging
	 * above the new inline field until the rename commits and sidebar()
	 * rebuilds. */
	const ph = ul.querySelector('li.empty');
	if (ph)
		ph.remove();
	const li = document.createElement('li');
	const b = document.createElement('span');

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
	}, 'new script');
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
	}, 'rename script');
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
	}, 'rename midi');
}

/* UX-13: used to just refuse, in the status bar, leaving the user to find and
 * reassign every definition by hand through the inspector. A native
 * confirmation at least turns that dead end into a choice: deleting anyway
 * leaves those definitions pointing at a script that no longer exists, which
 * lvl.js's review() already surfaces as a warning (BUG-11) exactly like any
 * other dangling reference - nothing new has to detect it. "Reassign to…"
 * a specific target was left out: the inspector's own script dropdown per
 * definition already does targeted reassignment once BUG-11's warning has
 * pointed the user at which ones need it. */
async function delscript(p)
{
	const used = App.doc.json.level.entity_definitions.filter(d => d.script === p);
	if (used.length && !await call(api.confirmdeletescript(p, used.map(d => d.id))))
		return;
	Undo.act(() => {
		delete App.doc.scripts[p];
		App.touch();
	}, 'delete script');
	Code.drop(p);
	App.closetab(p);
	sidebar();
}

function delmidi(p)
{
	Undo.act(() => {
		delete App.doc.midi[p];
		App.touch();
	}, 'delete midi');
	sidebar();
}

/* Shared by the Import MIDI dialog (addmidi(), below) and a drop onto #midis
 * (dropmidi(), NAT-09) - both end up with the same {name, data} file list,
 * one from a system dialog and the other from paths resolved in the
 * preload. */
function importmidifiles(files)
{
	Undo.act(() => {
		for (const f of files)
			App.doc.midi[f.name] = f.data;
		App.touch();
	}, 'import midi');
	sidebar();
	App.say('imported ' + files.length + ' file(s)');
}

async function addmidi()
{
	const r = await call(api.midi());
	if (!r)
		return;
	importmidifiles(r.files);
}

/* NAT-09: a .mid/.midi file dropped onto #midis. */
async function dropmidi(paths)
{
	const r = await call(api.importmidipaths(paths));
	if (r)
		importmidifiles(r.files);
}

/* NAT-09: a .lua file dropped onto #scripts - collision-avoided the same way
 * App.newscript() already avoids one, since a dropped file's own name is not
 * guaranteed unique in the archive. */
async function dropscripts(paths)
{
	const r = await call(api.importscriptpaths(paths));
	if (!r)
		return;
	Undo.act(() => {
		for (const f of r.files) {
			const base = f.name.replace(/\.lua$/i, '');
			let p = f.name, n = 2;
			while (App.doc.scripts[p] !== undefined)
				p = base + '_' + n++ + '.lua';
			App.doc.scripts[p] = f.data;
		}
		App.touch();
	}, 'import script');
	sidebar();
	App.say('imported ' + r.files.length + ' file(s)');
}

/* NAT-09: dropping a .lvl/.json anywhere else opens it, through the same
 * unsaved-changes guard any other open crosses (App.openrecent() already
 * does exactly this for a path the menu, rather than a drop, supplied). */
function dropzone() { return $('dropzone'); }

/* preventDefault() here, unconditionally, is the actual backstop - without
 * it on dragover specifically, the browser never fires drop at all and falls
 * through to its own default, navigating the window to the file (the
 * NAT-18/BUG-01 class of data loss this finding is partly about closing). */
function showdropzone(ev)
{
	ev.preventDefault();
	if (ev.dataTransfer.types.includes('Files'))
		dropzone().hidden = false;
}

function hidedropzone() { dropzone().hidden = true; }

async function drop(ev)
{
	ev.preventDefault();
	hidedropzone();
	const files = [...ev.dataTransfer.files].map(f => ({name: f.name, path: api.droppath(f)}));
	if (!files.length)
		return;

	const onmidi = ev.target.closest && ev.target.closest('#midis');
	const onscript = ev.target.closest && ev.target.closest('#scripts');

	if (onmidi) {
		const midis = files.filter(f => /\.midi?$/i.test(f.name)).map(f => f.path);
		if (midis.length)
			return dropmidi(midis);
	}
	if (onscript) {
		const luas = files.filter(f => /\.lua$/i.test(f.name)).map(f => f.path);
		if (luas.length)
			return dropscripts(luas);
	}
	const level = files.find(f => /\.(lvl|json)$/i.test(f.name));
	if (level)
		return App.openrecent(level.path);
	App.say('unsupported file type', true);
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

/* ARCH-06: every api.*() invoke call used to come back as one of two shapes -
 * {ok:true, ...} or {ok:false, err}, plus a bare {cancel:true} spread into
 * the success shape by whichever handlers wrap a dialog - so a call site had
 * to remember two separate checks, and a missed cancel check would read a
 * dismissed dialog as a successful, empty result.  main.js now answers one
 * shape, {status:'ok'|'cancel'|'error', data, message}; this is the one place
 * that unwraps it.  A cancel and an error both resolve to undefined here - an
 * error is already reported (App.fail()) before returning, and a cancel is a
 * silent no-op every caller already treated as such - so every call site below
 * collapses to a single `if (!r) return;`, which cannot forget the other one. */
async function call(promise)
{
	const r = await promise;
	if (r.status === 'error') {
		App.fail(r.message);
		return undefined;
	}
	if (r.status === 'cancel')
		return undefined;
	return r.data;
}

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
	const r = await call(api.blank());
	if (!r)
		return;
	App.setdoc(r.doc, null);
	App.setwarnings(r.warnings);
	App.say('new level');
};

/* Named openlevel rather than open_ (ARCH-06) - the trailing underscore only
 * ever existed to dodge the `open` keyword, and said nothing about what the
 * function does. */
App.openlevel = async function ()
{
	if (!await guard())
		return;
	const r = await call(api.open());
	if (!r)
		return;
	App.setdoc(r.doc, r.path);
	App.setwarnings(r.warnings);
	App.say('opened ' + r.path);
};

/* NAT-06: File -> Open Recent (menu.js) already knows the path - still has to
 * cross the same unsaved-changes guard as any other open before replacing the
 * document. */
App.openrecent = async function (p)
{
	if (!await guard())
		return;
	const r = await call(api.openpath(p));
	if (!r)
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

	const r = await call(api.save(App.doc));
	if (!r)
		return;
	saved(r.path, r.warnings);
};

App.saveas = async function ()
{
	Grid.commit();
	const r = await call(api.saveas(App.doc, App.doc.json.level.information.name));
	if (!r)
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

/* NAT-14: cycles through the Level Editor plus every open script tab, in tab
 * strip order - the level is always first and always present, so it anchors
 * the wrap-around at both ends. */
function switchtab(dir)
{
	const order = ['level', ...App.open];
	const i = (order.indexOf(App.tab) + dir + order.length) % order.length;
	App.select(order[i]);
}

const ACTS = {
	'new':		() => App.new(),
	open:		() => App.openlevel(),
	save:		() => App.save(),
	saveas:		() => App.saveas(),
	undo:		() => Undo.undo(),
	redo:		() => Undo.redo(),
	/* UX-05: the Edit menu's own duplicate command - ⌘D, offset by one cell. */
	duplicate:	() => { if (App.tab === 'level') Grid.duplicate(); },
	closetab:	() => { if (App.tab !== 'level') App.closetab(App.tab); },
	/* Reload must cross the same unsaved-changes guard as closing the window
	 * (BUG-01) - a bare location.reload() would silently discard the level
	 * exactly like the default menu's Reload item used to. */
	reload:		async () => { if (await guard()) location.reload(); },
	/* UX-04: the View menu's zoom commands and the status bar's zoom quick-menu
	 * both dispatch through this same table, alongside every other command. */
	zoomin:		() => Grid.zoomby(ZOOM_STEP),
	zoomout:	() => Grid.zoomby(1 / ZOOM_STEP),
	zoom25:		() => Grid.zoomto(0.25),
	zoom50:		() => Grid.zoomto(0.5),
	zoom100:	() => Grid.zoomto(1),
	zoom200:	() => Grid.zoomto(2),
	fitheight:	() => Grid.fitH(),
	fitwidth:	() => Grid.fitW(),
	fitall:		() => Grid.fit(),
	/* NAT-14: View -> Next/Previous Tab, Control+Tab/Control+Shift+Tab. */
	nexttab:	() => switchtab(1),
	prevtab:	() => switchtab(-1),
	/* A11Y-06: View -> Increase/Decrease/Reset Text Size. */
	uitextinc:	() => applyuiscale((+localStorage.getItem(UISCALE_KEY) || 1) * UISCALE_STEP),
	uitextdec:	() => applyuiscale((+localStorage.getItem(UISCALE_KEY) || 1) / UISCALE_STEP),
	uitextreset:	() => applyuiscale(1)
};

/* Canvas-local keys only: Escape, Delete, and now the A11Y-03 keyboard-editing
 * set, not any command the menu already owns.  Gated on the canvas itself
 * holding focus (Grid.cv.focus() in ondown()), not on excluding text-input
 * tag names - A11Y-01 made the palette, file rows and tabs focusable too, and
 * without this a Delete pressed while renaming a script would also delete
 * whatever Grid.sel happened to be selected on the canvas underneath. */
function keys(e)
{
	if (App.tab !== 'level' || e.target !== Grid.cv)
		return;
	if (e.key === 'Escape') {
		/* UX-12: a gesture in progress is cancelled and reverted; only with
		 * nothing open does Escape fall back to a plain deselect. */
		if (!Grid.cancel()) {
			Grid.sel = -1;
			Panel.inspect();
			Grid.redraw();
		}
	} else if (e.key === 'Delete' || e.key === 'Backspace') {
		if (Grid.sel >= 0) {
			Undo.act(() => {
				App.doc.json.level.entities.splice(Grid.sel, 1);
				Grid.sel = -1;
				App.touch();
			}, 'delete entity');
			Panel.inspect();
			Grid.redraw();
		} else
			/* A11Y-03: no mouse-selected entity - erase under the keyboard
			 * cursor instead, the keyboard equivalent of a right-click. */
			Grid.kerase();
	} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
			e.key === 'ArrowUp' || e.key === 'ArrowDown') {
		e.preventDefault();
		const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
		const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
		/* UX-05: a selected entity takes the arrow keys - nudging it - over
		 * moving the keyboard cursor, mirroring ondown()'s own precedence
		 * (an existing selection always wins). */
		if (Grid.sel >= 0)
			Grid.nudge(dx, dy, e.shiftKey);
		else
			Grid.kmove(dx, dy);
	} else if (e.key === 'Enter' || e.key === ' ') {
		e.preventDefault();
		Grid.kpaint();
	}
}

async function tryclose()
{
	if (await guard())
		api.forceclose();
}

addEventListener('DOMContentLoaded', () => {
	Grid.init($('cv'));
	Layout.init();

	/* NAT-04: on Windows/Linux the hotbar is the only visible command surface
	 * (style.css hides it on macOS, where the menu bar already carries File
	 * regardless of window framing), so it gets the same tooltip-with-
	 * accelerator and one-Tab-stop-plus-arrow-keys treatment as any other
	 * toolbar - the roving() helper A11Y-01 already gave the palette, file
	 * lists and tab strip, reused rather than reinvented. */
	const ACCEL = api.platform === 'darwin' ?
		{'new': '⌘N', open: '⌘O', save: '⌘S', saveas: '⌘⇧S'} :
		{'new': 'Ctrl+N', open: 'Ctrl+O', save: 'Ctrl+S', saveas: 'Ctrl+Shift+S'};
	const acts = [...document.querySelectorAll('.acts button')];
	for (const b of acts) {
		b.onclick = () => ACTS[b.dataset.act]();
		b.title = b.textContent + ' (' + ACCEL[b.dataset.act] + ')';
	}
	roving(document.querySelector('.acts'), acts, 1);
	$('add').onclick = addscript;
	$('addmidi').onclick = ev => { ev.stopPropagation(); addmidi(); };
	$('side').onclick = panelmenu;
	$('side').oncontextmenu = panelmenu;
	$('zoom').onclick = () => api.zoommenu();
	addEventListener('keydown', keys, true);
	/* NAT-09: a global backstop first - main.js's own will-navigate guard
	 * (NAT-18) already stops a stray drop from replacing the app with a view
	 * of the file, but only after Chromium has already decided to navigate;
	 * preventDefault() here is what stops that decision from being made in
	 * the first place, on every element, not only the ones with their own
	 * handling below. */
	addEventListener('dragover', showdropzone);
	addEventListener('dragleave', ev => { if (!ev.relatedTarget) hidedropzone(); });
	addEventListener('drop', drop);
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
				edit(li, li.querySelector('span'), a.key, a.kind === 'script');
		} else if (a.action === 'delete')
			(a.kind === 'script' ? delscript : delmidi)(a.key);
		else if (a.action === 'newscript')
			addscript();
		else if (a.action === 'importmidi')
			addmidi();
		/* NAT-12: the canvas menu's own remaining action - deleting under a
		 * right click is now direct (grid.js's onup()), so the menu itself
		 * only ever offers this one. */
		else if (a.action === 'fitview')
			Grid.fit();
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
	/* A recovered document (UX-10) replaces whatever boot() loaded below,
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
	api.onopenrecent(p => App.openrecent(p));

	/* UX-09: restores the last session's document instead of always landing
	 * on an untitled blank one - lvl:init (main.js) falls back to the same
	 * blank lvl:new would have produced when there is nothing to restore, so
	 * a total failure of that channel still leaves something to load here.
	 * PERF-07: main holds win.show() until 'ui:ready' arrives (or a 2s
	 * fallback fires), so this is also what decides when the window's first
	 * visible frame shows a real document instead of an empty chrome. */
	(async function boot()
	{
		let r = await call(api.init());
		if (!r)
			r = await call(api.blank());
		App.setdoc(r.doc, r.path || null);
		App.setwarnings(r.warnings);
		App.say(r.restored ? 'restored last session' : HINT, false, !r.restored);
		api.uiready();
	})();

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
