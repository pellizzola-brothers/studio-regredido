/* undo.js - one flat history for the level document.
 *
 * A step stores the small parts of the document verbatim (information,
 * definitions, entities, backgrounds, the script and MIDI tables) and the
 * block grid as a list of changed cells.  Painting a stroke therefore costs a
 * few bytes per cell touched rather than a copy of the whole grid, which is
 * what makes an unbounded history affordable.
 *
 * Script and MIDI tables are copied shallowly: the values are immutable
 * strings and byte arrays, so the copy is a handful of pointers. */
'use strict';

/* `clean` is the depth at which the document last matched disk, so dirty is
 * `depth() !== clean` instead of "anything happened since open", which is
 * what let undoing every edit back to the opened state still read as dirty. */
const Undo = {past: [], future: [], step: null, quiet: false, clean: 0};

function shot()
{
	const l = App.doc.json.level;

	return {
		info: JSON.stringify(l.information),
		defs: JSON.stringify(l.entity_definitions),
		ents: JSON.stringify(l.entities),
		bgs: JSON.stringify(l.backgrounds),
		scripts: Object.assign({}, App.doc.scripts),
		midi: Object.assign({}, App.doc.midi),
		h: Grid.h
	};
}

function tablesame(a, b)
{
	const ka = Object.keys(a);

	if (ka.length !== Object.keys(b).length)
		return false;
	for (const k of ka)
		if (a[k] !== b[k])
			return false;
	return true;
}

/* PERF-05: which of a step's own parts actually differ between its two
 * shots - shared by same() (below, "did anything change at all") and
 * apply() (below, "which views does undoing/redoing this step actually
 * need to rebuild"), so the two can never quietly disagree about what a
 * change to one field means. */
function diffparts(a, b)
{
	return {
		info: a.info !== b.info,
		defs: a.defs !== b.defs,
		ents: a.ents !== b.ents,
		bgs: a.bgs !== b.bgs,
		scripts: !tablesame(a.scripts, b.scripts),
		midi: !tablesame(a.midi, b.midi)
	};
}

function same(a, b)
{
	const d = diffparts(a, b);
	return !d.info && !d.defs && !d.ents && !d.bgs && a.h === b.h &&
		!d.scripts && !d.midi;
}

/* Open a step.  Nested calls join the step already running, so a drag that
 * paints eighty cells still undoes in one go.
 *
 * UX-03: `label` names the step for the Edit menu ("Undo Paint") and the
 * status bar ("undid paint") - the caller who knows what gesture this is
 * supplies it; a step nobody named falls back to the generic 'edit' rather
 * than leaving the label undefined. */
Undo.begin = function (label)
{
	if (Undo.step || Undo.quiet)
		return;
	Undo.step = {before: shot(), cells: [], grid: null, label: label || 'edit'};
};

/* setblock() reports each cell it changes: index, what was there, what is. */
Undo.cell = function (n, was, now)
{
	if (Undo.step)
		Undo.step.cells.push(n, was, now);
};

/* Resizing reallocates the grid, so that one keeps whole copies. */
Undo.grid = function (before, after)
{
	if (Undo.step)
		Undo.step.grid = {before: before, after: after};
};

Undo.end = function ()
{
	const s = Undo.step;

	if (!s)
		return;
	Undo.step = null;
	s.after = shot();
	if (!s.cells.length && !s.grid && same(s.before, s.after))
		return;				/* the gesture changed nothing */
	/* The clean marker may be sitting in the redo path this edit is about to
	 * discard.  Once that path is gone the saved state can never be reached
	 * again, so pin the marker somewhere depth() can never land, or a later
	 * coincidence of depth would read as clean when it is not. */
	if (Undo.future.length && Undo.clean > Undo.past.length)
		Undo.clean = -1;
	Undo.past.push(s);
	Undo.future.length = 0;
	if (App.syncmenu)
		App.syncmenu();
};

/* UX-12: abort the step currently open, reverting whatever it had already
 * applied, without ever recording it in history - used when a gesture is
 * cancelled mid-flight rather than completed at mouseup. Reuses apply()
 * against the step's own 'before' shot, exactly like undoing it would, since
 * an aborted step and an undone one restore the document the same way. */
Undo.cancel = function ()
{
	const s = Undo.step;

	if (!s)
		return;
	Undo.step = null;
	apply(s, 'before');
};

/* Run fn as a single undoable step. */
Undo.act = function (fn, label)
{
	Undo.begin(label);
	try {
		fn();
	} finally {
		Undo.end();
	}
};

Undo.undo = function () { shift(Undo.past, Undo.future, 'before', 'undo'); };
Undo.redo = function () { shift(Undo.future, Undo.past, 'after', 'redo'); };

Undo.clear = function ()
{
	Undo.past.length = 0;
	Undo.future.length = 0;
	Undo.step = null;
	Undo.clean = 0;
	if (App.syncmenu)
		App.syncmenu();
};

Undo.depth = function () { return Undo.past.length; };

function shift(from, to, side, what)
{
	const s = from.pop();

	if (!s) {
		App.say('nothing to ' + what);
		return;
	}
	to.push(s);
	apply(s, side);
	if (App.syncmenu)
		App.syncmenu();
	/* UX-03: "3 left" is a count no other application reports and most users
	 * read backwards ("3 things were undone") - naming the step itself is
	 * both more useful and reads the way Undo/Redo menu items already do
	 * ("Undo Paint"). */
	App.say((what === 'undo' ? 'undid ' : 'redid ') + s.label);
}

function apply(s, side)
{
	const w = s[side];
	const l = App.doc.json.level;

	Undo.quiet = true;
	l.information = JSON.parse(w.info);
	l.entity_definitions = JSON.parse(w.defs);
	l.entities = JSON.parse(w.ents);
	l.backgrounds = JSON.parse(w.bgs);
	App.doc.scripts = Object.assign({}, w.scripts);
	App.doc.midi = Object.assign({}, w.midi);

	if (s.grid) {
		Grid.h = w.h;
		Grid.a = s.grid[side].slice();
	} else {
		const c = s.cells, n = side === 'before' ? 1 : 2;
		for (let i = 0; i < c.length; i += 3)
			Grid.a[c[i]] = c[i + n];
	}

	Grid.sel = -1;
	Undo.quiet = false;
	/* PERF-05: a plain cell-diff step (the common case - painting) touches
	 * none of info/defs/ents/bgs/scripts/midi at all, so diffparts() reports
	 * every one of them false and App.refresh() rebuilds only the canvas -
	 * previously it rebuilt the tab strip, both file lists, the whole
	 * palette and the inspector, and re-synced every Monaco model, for
	 * every single step walked back through, whether or not any of them
	 * had anything to do with that step. cells is true whenever the grid
	 * itself changed - either a resize (s.grid) or an actual cell diff
	 * (s.cells.length) - so a step that touched neither still skips the
	 * redraw too. */
	App.refresh({
		cells: !!(s.grid || s.cells.length),
		...diffparts(s.before, s.after)
	});
}
