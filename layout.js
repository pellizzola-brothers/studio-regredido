/* layout.js - draggable, keyboard-operable splitters between the panels
 * (GEO-04).
 *
 * Builds directly on GEO-03's proportional, clamped --side/--right tokens: a
 * drag simply overwrites the custom property within its own --*-min/--*-max
 * bounds (read live, since those are ch-/percentage-derived rather than
 * constants this file could duplicate), and double-click or Enter removes
 * the override entirely so the panel goes back to tracking the window
 * through the stylesheet's own clamp() instead of re-deriving the same
 * number by hand. The two in-panel splits (#scripts | #midis, #palette |
 * #props) have no such tokens of their own, so they drag a plain percentage
 * within a fixed floor/ceiling instead.
 *
 * This is view state, not document state (CLAUDE.md): persisted to
 * localStorage, never anywhere near the .lvl. */
'use strict';

const Layout = {};

const LSKEY = 'pb-layout';
const root = document.documentElement;

/* Coarse-but-usable keyboard steps; not derived from anything, since neither
 * unit has a natural "one step" the way e.g. a row height does. */
const STEP_PX = 16;
const STEP_PCT = 2;

function loadstate()
{
	try { return JSON.parse(localStorage.getItem(LSKEY)) || {}; }
	catch (e) { return {}; }
}

function savestate(s)
{
	try { localStorage.setItem(LSKEY, JSON.stringify(s)); }
	catch (e) { /* private browsing, or a full quota - view state, fine to drop */ }
}

/* Pointer-drag plumbing shared by all four splitters: capture on press, call
 * onmove(ev) for each move, release on release. Each splitter's own setup()
 * below wires keyboard and double-click itself, since what they reset to
 * differs per splitter.  Locks the cursor to the whole document while
 * dragging - pointer capture keeps events routed to the splitter, but not
 * the OS cursor glyph, which would otherwise flicker to whatever is under
 * the pointer during a fast drag. */
function drag(el, cursor, onmove)
{
	el.addEventListener('pointerdown', ev => {
		if (ev.button !== 0)
			return;
		ev.preventDefault();
		/* A real pointerdown always has an active pointer to capture; this can
		 * only fail for a pointer id nothing actually put down (a synthetic
		 * event with a stale or fabricated id) - harmless to keep going
		 * without capture rather than let the whole gesture silently drop. */
		try { el.setPointerCapture(ev.pointerId); } catch (e) { /* see above */ }
		document.body.style.cursor = cursor;
		const move = mv => onmove(mv);
		const up = () => {
			try { el.releasePointerCapture(ev.pointerId); } catch (e) { /* never captured, nothing to release */ }
			document.body.style.cursor = '';
			removeEventListener('pointermove', move);
			removeEventListener('pointerup', up);
		};
		addEventListener('pointermove', move);
		addEventListener('pointerup', up);
	});
}

/* A custom property's own computed value is only resolved as far as var()
 * substitution - a calc()/clamp() expression inside it (as --side-min's ch-
 * and-token arithmetic is) comes back as that literal, unevaluated string,
 * not a px number, unless something actually lays an element out with it.
 * --side-max, a plain "320px" literal, would parseFloat() fine either way;
 * --side-min would not, so both go through this one honest measurement. */
function pxof(varname)
{
	const probe = document.createElement('div');
	probe.style.cssText = 'position:absolute;visibility:hidden;width:var(' + varname + ')';
	document.body.appendChild(probe);
	const px = parseFloat(getComputedStyle(probe).width);
	probe.remove();
	return px;
}

/* --side / --right: an absolute length, the mental model "I dragged it to
 * here" every other resizable panel uses, clamped to the token pair GEO-03
 * already defines for exactly this purpose. */
function pxsplitter(el, prop, panel, key, measure)
{
	function current() { return panel.getBoundingClientRect().width; }

	function apply(px, persist)
	{
		const min = pxof(prop + '-min'), max = pxof(prop + '-max');
		px = Math.max(min, Math.min(max, px));
		root.style.setProperty(prop, px + 'px');
		el.setAttribute('aria-valuenow', Math.round(px));
		el.setAttribute('aria-valuemin', Math.round(min));
		el.setAttribute('aria-valuemax', Math.round(max));
		if (persist) {
			const s = loadstate();
			s[key] = px;
			savestate(s);
		}
	}

	function reset()
	{
		root.style.removeProperty(prop);
		el.removeAttribute('aria-valuenow');
		const s = loadstate();
		delete s[key];
		savestate(s);
	}

	const stored = loadstate()[key];
	if (typeof stored === 'number')
		apply(stored, false);
	else {
		el.setAttribute('aria-valuemin', Math.round(pxof(prop + '-min')));
		el.setAttribute('aria-valuemax', Math.round(pxof(prop + '-max')));
		el.setAttribute('aria-valuenow', Math.round(current()));
	}

	drag(el, 'col-resize', ev => apply(measure(ev), true));
	el.addEventListener('dblclick', reset);
	el.addEventListener('keydown', ev => {
		if (ev.key === 'ArrowLeft') apply(current() - STEP_PX, true);
		else if (ev.key === 'ArrowRight') apply(current() + STEP_PX, true);
		else if (ev.key === 'Enter') reset();
		else return;
		ev.preventDefault();
	});
}

/* #scripts | #midis and #palette | #props: a plain percentage of the
 * container's own height - neither split has a content-driven min/max token
 * the way the side panels do, so a floor and ceiling stand in instead, so
 * neither side can be dragged to nothing. GEO-05/GEO-06 (both done, see
 * "Already completed") gave #scripts and #props their own content-driven
 * *default*, below, without needing to touch this percentage mechanism -
 * it is what a user's own drag still overrides either default with.
 *
 * `cls`/`target`, when given, is a class this toggles on `target` for exactly
 * as long as `prop` is actually overridden (dragged, stepped, or restored
 * from a previous session) - GEO-05's content-driven default for #scripts
 * only applies in that class's absence, so switching to and from it here is
 * what lets one CSS custom property continue meaning "the user's own size"
 * rather than "the size", now that the two can differ. */
function pctsplitter(el, prop, key, def, measure, cls, target)
{
	const FLOOR = 15, CEIL = 85;

	function apply(pct, persist)
	{
		pct = Math.max(FLOOR, Math.min(CEIL, pct));
		root.style.setProperty(prop, pct + '%');
		el.setAttribute('aria-valuenow', Math.round(pct));
		if (cls)
			target.classList.add(cls);
		if (persist) {
			const s = loadstate();
			s[key] = pct;
			savestate(s);
		}
	}

	function reset()
	{
		root.style.removeProperty(prop);
		el.removeAttribute('aria-valuenow');
		if (cls)
			target.classList.remove(cls);
		const s = loadstate();
		delete s[key];
		savestate(s);
	}

	el.setAttribute('aria-valuemin', FLOOR);
	el.setAttribute('aria-valuemax', CEIL);
	const stored = loadstate()[key];
	if (typeof stored === 'number')
		apply(stored, false);
	else
		el.setAttribute('aria-valuenow', Math.round(parseFloat(def)));

	drag(el, 'row-resize', ev => apply(measure(ev), true));
	el.addEventListener('dblclick', reset);
	el.addEventListener('keydown', ev => {
		const now = parseFloat(getComputedStyle(root).getPropertyValue(prop)) || parseFloat(def);
		if (ev.key === 'ArrowUp') apply(now - STEP_PCT, true);
		else if (ev.key === 'ArrowDown') apply(now + STEP_PCT, true);
		else if (ev.key === 'Enter') reset();
		else return;
		ev.preventDefault();
	});
}

Layout.init = function ()
{
	const side = $('side'), right = $('right');
	const body = () => $('body').getBoundingClientRect();

	pxsplitter($('splitter-side'), '--side', side, 'side',
		ev => ev.clientX - body().left);
	pxsplitter($('splitter-right'), '--right', right, 'right',
		ev => body().right - ev.clientX);
	pctsplitter($('splitter-scripts'), '--scripts-h', 'scripts', '60%',
		ev => (ev.clientY - side.getBoundingClientRect().top) / side.getBoundingClientRect().height * 100,
		'split-scripts', side);
	pctsplitter($('splitter-props'), '--props-h', 'props', '46%',
		ev => (right.getBoundingClientRect().bottom - ev.clientY) / right.getBoundingClientRect().height * 100,
		'split-props', right);
};
