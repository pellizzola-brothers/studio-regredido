/* grid.js - the level canvas: rendering, panning and every edit gesture.
 *
 * block_data is a 540-wide array of rows of 3-digit strings, which is a poor
 * thing to paint into.  On load it is unpacked once into a flat Uint16Array
 * and packed back only when saving, so editing touches plain integers.
 *
 * Drawing walks just the visible window, so cost tracks the viewport rather
 * than the level: a 540 x 200 level costs the same as a 540 x 12 one. */
'use strict';

const Grid = {
	cv: null, g: null,
	a: null, h: 0,			/* tiles, W columns by h rows */
	cam: {x: 0, y: 0, z: 0.25},
	tool: {kind: 'block', id: 2},	/* what the palette has selected */
	sel: -1,			/* index into level.entities, or -1 */
	hov: {x: -1, y: -1},
	pan: null, paint: -1, last: null, moving: false,
	need: false, rsz: false, fitted: false, dpr: 1
};

/* Zoom bounds, shared by Grid.fit() and the wheel handler so the two can
 * never drift apart (NAT-11, GEO-11). */
const ZMIN = 0.03, ZMAX = 3;

/* GEO-11: the rest of this file's unnamed constants, named and explained once
 * rather than left as bare numbers at each site. */
const FITPAD = B;	/* Grid.fit(): one block of margin above and below the level */
const GRIDMIN = 10;	/* Grid.draw(): stop drawing grid lines once a tile is smaller
			   than this many device px - below it the lines outweigh
			   the content */
const SELW = 2;		/* Grid.draw(): the selection ring's stroke width; the inset
			   that keeps the stroke inside the tile is derived from it */
const BARSLOP = 1;	/* Grid.syncbar()/onbar(): the re-entrancy tolerance CLAUDE.md
			   documents - both sites must agree on the same value */

function elist() { return App.doc.json.level.entities; }

/* Which entity, if any, owns cell (cx, cy).  Levels hold tens of entities, so
 * a scan beats maintaining a second index that can fall out of sync. */
function entat(cx, cy)
{
	const es = elist();
	for (let i = es.length - 1; i >= 0; i--)
		if (Math.floor(es[i].pos[0] / B) === cx && Math.floor(es[i].pos[1] / B) === cy)
			return i;
	return -1;
}

/* An entity always wins the cell it stands on: painting under one leaves air.
 * The game applies the same rule when loading, so this only mirrors it. */
function setblock(cx, cy, id)
{
	if (cx < 0 || cy < 0 || cx >= W || cy >= Grid.h)
		return;
	if (id && entat(cx, cy) >= 0)
		id = 0;

	const n = cy * W + cx;
	if (Grid.a[n] === id)
		return;
	Undo.cell(n, Grid.a[n], id);
	Grid.a[n] = id;
	App.touch();
	Grid.redraw();
}

/* Paint every cell on the segment so a fast drag leaves no gaps. */
function stroke(x0, y0, x1, y1, id)
{
	const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
	let e = dx - dy;

	for (;;) {
		setblock(x0, y0, id);
		if (x0 === x1 && y0 === y1)
			return;
		const e2 = 2 * e;
		if (e2 > -dy) { e -= dy; x0 += sx; }
		if (e2 < dx)  { e += dx; y0 += sy; }
	}
}

Grid.init = function (cv)
{
	Grid.cv = cv;
	Grid.g = cv.getContext('2d', {alpha: false});

	new ResizeObserver(Grid.resize).observe(cv.parentElement);
	document.getElementById('hbar').addEventListener('scroll', onbar);
	cv.addEventListener('wheel', onwheel, {passive: false});
	cv.addEventListener('mousedown', ondown);
	cv.addEventListener('contextmenu', e => e.preventDefault());
	addEventListener('mousemove', onmove);
	addEventListener('mouseup', onup);
	watchdpr();
};

/* BUG-12: Grid.dpr is only re-read inside Grid.resize(), which only runs from
 * the ResizeObserver on #wrap - dragging the window to a different-DPI
 * display doesn't change #wrap's CSS size, so the observer never fires and
 * the backing store stays at the old resolution.  A media query is valid
 * only for the ratio it was created at, so each firing re-arms a fresh one
 * for whatever the ratio just became. */
function watchdpr()
{
	matchMedia('(resolution: ' + devicePixelRatio + 'dppx)')
		.addEventListener('change', () => { Grid.resize(); watchdpr(); }, {once: true});
}

/* NAT-13: the only feedback channel for which tool is active, whether the
 * pointer is over an entity it could grab, or whether a gesture is already
 * under way.  Takes the cell explicitly rather than reading Grid.hov, so
 * ondown() can update it immediately on press instead of waiting for the
 * next mousemove. */
Grid.cursor = function (c)
{
	let cur;

	if (Grid.pan || Grid.moving)
		cur = 'grabbing';
	else if (c.x < 0 || c.y < 0 || c.x >= W || c.y >= Grid.h)
		cur = 'not-allowed';
	else if (entat(c.x, c.y) >= 0)
		cur = 'grab';
	else
		cur = Grid.tool.kind === 'entity' ? 'copy' : 'crosshair';
	Grid.cv.style.cursor = cur;
};

/* PERF-04: the ResizeObserver callback used to reallocate the canvas backing
 * store - a real cost, not just a style write - unconditionally, on every
 * observed frame; a window drag fires it dozens of times a second.  Coalesced
 * through requestAnimationFrame like Grid.redraw() already does, and the
 * reallocation itself is skipped when the target device-pixel dimensions
 * have not changed (a devicePixelRatio-only change, e.g. BUG-12's
 * cross-monitor case, still needs it, since it changes the target size at
 * the same CSS size). */
Grid.resize = function ()
{
	if (Grid.rsz)
		return;
	Grid.rsz = true;
	requestAnimationFrame(() => { Grid.rsz = false; doresize(); });
};

function doresize()
{
	const cv = Grid.cv, r = cv.parentElement.getBoundingClientRect();
	const dpr = devicePixelRatio || 1;
	const w = Math.max(1, Math.round(r.width * dpr));
	const h = Math.max(1, Math.round(r.height * dpr));

	Grid.dpr = dpr;
	cv.style.width = r.width + 'px';
	cv.style.height = r.height + 'px';
	if (cv.width !== w || cv.height !== h) {
		cv.width = w;
		cv.height = h;
	}
	if (!Grid.fitted && Grid.a) {
		Grid.fitted = true;
		Grid.fit();
	}
	Grid.draw();
}

/* Unpack block_data into the working array. */
Grid.load = function ()
{
	const rows = App.doc.json.level.block_data;

	Grid.h = rows.length;
	Grid.a = new Uint16Array(W * Grid.h);
	for (let y = 0; y < Grid.h; y++) {
		const row = rows[y], o = y * W;
		for (let x = 0; x < W; x++)
			Grid.a[o + x] = +row[x];
	}
	Grid.sel = -1;
};

/* Pack the working array back into block_data.  Called before every save. */
Grid.commit = function ()
{
	const rows = new Array(Grid.h);

	for (let y = 0; y < Grid.h; y++) {
		const row = new Array(W), o = y * W;
		for (let x = 0; x < W; x++) {
			const id = Grid.a[o + x];
			row[x] = id < 10 ? '00' + id : id < 100 ? '0' + id : '' + id;
		}
		rows[y] = row;
	}
	App.doc.json.level.block_data = rows;
};

/* Grow or shrink the level, keeping the rows that survive. */
Grid.setheight = function (h)
{
	h = Math.max(1, Math.min(999, h | 0));
	if (h === Grid.h)
		return;

	Undo.act(() => {
		const old = Grid.a;
		const a = new Uint16Array(W * h);

		a.set(old.subarray(0, W * Math.min(h, Grid.h)));
		Grid.a = a;
		Grid.h = h;

		const es = elist();
		for (let i = es.length - 1; i >= 0; i--)
			if (es[i].pos[1] >= h * B)
				es.splice(i, 1);
		Undo.grid(old.slice(), a.slice());
		Grid.sel = -1;
		App.touch();
	});
	Grid.redraw();
};

/* Never fit *above* 100% - a small level should not be blown up past its
 * native pixel size just because the window is large. */
function fitset(z, x)
{
	Grid.cam.z = Math.max(ZMIN, Math.min(1, z));
	Grid.cam.x = x;
	Grid.cam.y = -B / 2;
	Grid.redraw();
}

/* UX-04: fit-height alone showed a 12-row level's full height but, on a 540
 * column level, only ~4% of its width - there was no view that ever showed
 * the whole thing.  Kept as an explicit command (it is the useful one while
 * editing a tall level), alongside its width counterpart and Grid.fit()
 * itself. Height isn't divided into scenes (below), so this one still fits
 * the level's actual full height and resets x to the level's own start. */
Grid.fitH = function ()
{
	const r = Grid.cv.getBoundingClientRect();
	if (!r.height)			/* not laid out yet; the resize does it */
		return;
	fitset(r.height / (Grid.h * B + 2 * FITPAD), 0);
};

/* A level divides into a fixed 9 scenes (textures/README.md: "9 scenes in a
 * level", each with its own backdrop) - 540 / 9 = 60 columns per scene, an
 * exact division rather than a guessed one. Fitting the level's *actual*
 * full width is never a useful "fit": a level is 54 000 world px wide, and
 * even ZMIN's floor only shows a fraction of that, so "fit width" and
 * "fit view" both target one scene - the one the camera is already over -
 * instead of the whole level. */
const SCENES = 9;
const SCENECOLS = W / SCENES;

/* The scene under the centre of the current view - "closest" to what the
 * user is actually looking at, not to column 0. */
function curscene()
{
	const r = Grid.cv.getBoundingClientRect();
	const cx = Grid.cam.x + r.width / Grid.cam.z / 2;
	return Math.max(0, Math.min(SCENES - 1, Math.floor(cx / (SCENECOLS * B))));
}

/* Fits z, then centres the closest scene horizontally in the resulting
 * viewport - the natural anchor for a fit with no pointer of its own to
 * anchor to, and what keeps a height-constrained fit from flushing the
 * scene against the left edge instead of showing it in the middle of the
 * frame. */
function fitscene(z)
{
	const r = Grid.cv.getBoundingClientRect();
	const cz = Math.max(ZMIN, Math.min(1, z));
	const left = curscene() * SCENECOLS * B;

	fitset(z, left - (r.width / cz - SCENECOLS * B) / 2);
}

Grid.fitW = function ()
{
	const r = Grid.cv.getBoundingClientRect();
	if (!r.height)
		return;
	fitscene(r.width / (SCENECOLS * B + 2 * FITPAD));
};

Grid.fit = function ()		/* fit the closest scene, not the whole level */
{
	const r = Grid.cv.getBoundingClientRect();
	if (!r.height)
		return;
	fitscene(Math.min(r.height / (Grid.h * B + 2 * FITPAD), r.width / (SCENECOLS * B + 2 * FITPAD)));
};

/* UX-04: c.z *= 2 every two presses - the same "zoom doubles per N units of
 * input" statement ZOOM_PX_PER_DOUBLING makes for the wheel, applied to a
 * single keypress instead of a pixel of travel.  Consumed by app.js's ACTS
 * table, not by this file. */
/* exported ZOOM_STEP */
const ZOOM_STEP = Math.SQRT2;

/* Re-centres on the canvas's own midpoint, the natural anchor for a command
 * with no pointer position to anchor to (onwheel()'s Ctrl+wheel zoom anchors
 * on the pointer instead, since it has one). */
Grid.zoomto = function (z)
{
	const r = Grid.cv.getBoundingClientRect();
	const mx = r.width / 2, my = r.height / 2;
	const wx = Grid.cam.x + mx / Grid.cam.z, wy = Grid.cam.y + my / Grid.cam.z;

	Grid.cam.z = Math.max(ZMIN, Math.min(ZMAX, z));
	Grid.cam.x = wx - mx / Grid.cam.z;
	Grid.cam.y = wy - my / Grid.cam.z;
	Grid.redraw();
};

Grid.zoomby = function (factor) { Grid.zoomto(Grid.cam.z * factor); };

/* Keep the camera over the level so the scrollbar below the canvas can stand
 * for the whole range of x. */
Grid.clamp = function ()
{
	const r = Grid.cv.getBoundingClientRect();
	const c = Grid.cam;

	c.x = Math.max(0, Math.min(Math.max(0, W * B - r.width / c.z), c.x));
	c.y = Math.max(-B, Math.min(Grid.h * B + B - r.height / c.z, c.y));
	if (Grid.h * B < r.height / c.z)
		c.y = -B;
};

/* The bar is a real overflow container: the browser draws and drives it, and
 * a spacer as wide as the level at the current zoom sets its range. */
Grid.syncbar = function ()
{
	const bar = document.getElementById('hbar');
	const want = Math.round(Grid.cam.x * Grid.cam.z);

	document.getElementById('hspace').style.width =
		Math.round(W * B * Grid.cam.z) + 'px';
	if (Math.abs(bar.scrollLeft - want) >= BARSLOP)
		bar.scrollLeft = want;
};

function onbar()
{
	const bar = document.getElementById('hbar');

	if (Math.abs(bar.scrollLeft - Grid.cam.x * Grid.cam.z) < BARSLOP)
		return;				/* our own write coming back */
	Grid.cam.x = bar.scrollLeft / Grid.cam.z;
	Grid.redraw();
}

Grid.redraw = function ()
{
	if (Grid.need)
		return;
	Grid.need = true;
	requestAnimationFrame(() => { Grid.need = false; Grid.draw(); });
};

Grid.draw = function ()
{
	const g = Grid.g;
	if (!g || !Grid.a)
		return;

	Grid.clamp();
	Grid.syncbar();
	App.zoom(Math.round(Grid.cam.z * 100));

	const cw = Grid.cv.width, ch = Grid.cv.height;
	const z = Grid.cam.z * Grid.dpr;
	const ox = Grid.cam.x * z, oy = Grid.cam.y * z;

	g.setTransform(1, 0, 0, 1, 0, 0);
	g.imageSmoothingEnabled = false;
	g.fillStyle = Tokens.canvasBg;
	g.fillRect(0, 0, cw, ch);

	drawbg(g, cw);

	const c0 = Math.max(0, Math.floor(ox / (B * z)));
	const c1 = Math.min(W, Math.ceil((ox + cw) / (B * z)));
	const r0 = Math.max(0, Math.floor(oy / (B * z)));
	const r1 = Math.min(Grid.h, Math.ceil((oy + ch) / (B * z)));

	/* Snap tile edges to whole device pixels: shared edges then line up
	 * exactly and pixel art shows no seams at any zoom. */
	const ex = [], ey = [];
	for (let x = c0; x <= c1; x++)
		ex.push(Math.round(x * B * z - ox));
	for (let y = r0; y <= r1; y++)
		ey.push(Math.round(y * B * z - oy));

	for (let y = r0; y < r1; y++) {
		const o = y * W, sy = ey[y - r0], sh = ey[y - r0 + 1] - sy;
		for (let x = c0; x < c1; x++) {
			const id = Grid.a[o + x];
			if (!id)
				continue;
			const sx = ex[x - c0], sw = ex[x - c0 + 1] - sx;
			blit(g, tiles.get(id), sx, sy, sw, sh);
		}
	}

	if (B * z >= GRIDMIN) {
		g.strokeStyle = Tokens.gridLine;
		g.lineWidth = 1;
		g.beginPath();
		/* GEO-11: + .5 centres a 1px canvas stroke on a whole device pixel
		 * rather than straddling two - the one magic number in this file
		 * that is correct as a bare literal and should stay one. */
		for (const x of ex) { g.moveTo(x + .5, ey[0]); g.lineTo(x + .5, ey[ey.length - 1]); }
		for (const y of ey) { g.moveTo(ex[0], y + .5); g.lineTo(ex[ex.length - 1], y + .5); }
		g.stroke();
	}

	const es = elist();
	for (let i = 0; i < es.length; i++) {
		const e = es[i];
		const sx = Math.round(e.pos[0] * z - ox), sy = Math.round(e.pos[1] * z - oy);
		const s = Math.round(B * z);
		if (sx > cw || sy > ch || sx + s < 0 || sy + s < 0)
			continue;
		blit(g, entdefs.get(e.def) || {file: PLACEHOLDER}, sx, sy, s, s);
		if (i === Grid.sel) {
			g.strokeStyle = Tokens.acc;
			g.lineWidth = SELW;
			/* Half the stroke width insets the rect so the stroke itself
			 * lands inside the tile rather than straddling its edge. */
			g.strokeRect(sx + SELW / 2, sy + SELW / 2, s - SELW, s - SELW);
		}
	}

	if (Grid.hov.x >= 0 && !Grid.pan) {
		const sx = Math.round(Grid.hov.x * B * z - ox);
		const sy = Math.round(Grid.hov.y * B * z - oy);
		const s = Math.round(B * z);
		g.strokeStyle = Tokens.hoverCell;
		g.lineWidth = 1;
		g.strokeRect(sx + .5, sy + .5, s - 1, s - 1);
	}

	g.strokeStyle = Tokens.bounds;
	g.lineWidth = 1;
	g.strokeRect(Math.round(-ox) + .5, Math.round(-oy) + .5,
		Math.round(W * B * z), Math.round(Grid.h * B * z));
};

/* Fall back to a flat swatch until (or unless) the sprite decodes. */
function blit(g, t, x, y, w, h)
{
	const im = t ? tex(t.file, Grid.redraw) : null;

	if (ready(im))
		g.drawImage(im, x, y, w, h);
	else {
		g.fillStyle = t ? Tokens.missingTex : Tokens.missingDef;
		g.fillRect(x, y, w, h);
	}
}

/* Scaled to the level's height and repeated along it, so the backdrop marks
 * exactly how far the level runs instead of smearing over the whole viewport. */
function drawbg(g, cw)
{
	const id = App.doc.json.level.backgrounds[0];
	const b = BGS.find(v => v.id === id);
	if (!b)
		return;

	const im = tex(b.file, Grid.redraw);
	if (!ready(im))
		return;

	const z = Grid.cam.z * Grid.dpr;
	const ox = Grid.cam.x * z, oy = Grid.cam.y * z;
	const lh = Grid.h * B * z;
	const tw = im.naturalWidth * lh / im.naturalHeight;
	const end = Math.min(cw, W * B * z - ox);

	if (tw < 1)
		return;

	g.save();
	g.beginPath();
	g.rect(-ox, -oy, W * B * z, lh);
	g.clip();
	for (let x = Math.floor(ox / tw) * tw - ox; x < end; x += tw)
		g.drawImage(im, x, -oy, tw, lh);
	g.restore();
}

/* Which cell, and which world point, the pointer is over. */
function at(ev)
{
	const r = Grid.cv.getBoundingClientRect();
	const z = Grid.cam.z;

	const wx = (ev.clientX - r.left) / z + Grid.cam.x;
	const wy = (ev.clientY - r.top) / z + Grid.cam.y;

	return {x: Math.floor(wx / B), y: Math.floor(wy / B), wx: wx, wy: wy};
}

/* c.z *= 2 every this many px of wheel travel - Math.LN2 / 462 reproduces
 * the feel of the original, unexplained 0.0015 factor exactly, but as a
 * statement ("zoom doubles per N pixels") a reader can actually check. */
const ZOOM_PX_PER_DOUBLING = 462;

/* macOS - and Windows/Linux precision touchpads - report a two-finger swipe
 * as a wheel event and synthesise a pinch as a wheel event with ctrlKey
 * true.  Treating every wheel event as zoom (the old behaviour) has this
 * exactly backwards: scrolling zoomed, with inertia, and pinch was
 * indistinguishable from it.  ctrlKey is what tells the two apart, and it
 * also keeps the conventional Ctrl+wheel zoom for anyone on a plain mouse. */
function onwheel(ev)
{
	ev.preventDefault();

	const r = Grid.cv.getBoundingClientRect();
	const c = Grid.cam;

	/* Some Windows/Linux mice report whole lines or pages instead of pixels;
	 * normalise so the same physical notch feels the same on every device.
	 * 18 is --line in style.css - a line is the natural "one notch" unit for
	 * a text-driven UI; a page is the viewport itself. */
	const scale = ev.deltaMode === 1 ? 18 : ev.deltaMode === 2 ? r.height : 1;
	const dx = ev.deltaX * scale, dy = ev.deltaY * scale;

	if (ev.ctrlKey) {
		const mx = ev.clientX - r.left, my = ev.clientY - r.top;
		const wx = c.x + mx / c.z, wy = c.y + my / c.z;

		c.z = Math.max(ZMIN, Math.min(ZMAX,
			c.z * Math.exp(-dy * Math.LN2 / ZOOM_PX_PER_DOUBLING)));
		c.x = wx - mx / c.z;
		c.y = wy - my / c.z;
	} else {
		/* Shift+wheel is the classic convention for turning a vertical-only
		 * wheel into horizontal motion; a trackpad already reports its own
		 * deltaX, so this only fires when there is none to lose. */
		const hx = ev.shiftKey && !dx ? dy : dx, hy = ev.shiftKey && !dx ? 0 : dy;
		c.x += hx / c.z;
		c.y += hy / c.z;
	}
	Grid.redraw();
}

function ondown(ev)
{
	const c = at(ev);

	Grid.cv.focus();
	if (ev.button === 1 || ev.altKey) {
		Grid.pan = {x: ev.clientX, y: ev.clientY, cx: Grid.cam.x, cy: Grid.cam.y};
		Grid.cursor(c);
		ev.preventDefault();
		return;
	}

	const hit = entat(c.x, c.y);

	if (ev.button === 2) {				/* right: remove */
		Undo.begin();
		if (hit >= 0) {
			elist().splice(hit, 1);
			Grid.sel = -1;
			App.touch();
			App.inspect();
		} else {
			Grid.paint = 0;
			Grid.last = c;
			setblock(c.x, c.y, 0);
		}
		Grid.redraw();
		return;
	}
	if (ev.button !== 0)
		return;

	if (hit >= 0) {					/* grab an existing entity */
		Undo.begin();
		Grid.sel = hit;
		Grid.moving = true;
		Grid.cursor(c);
		App.inspect();
		Grid.redraw();
		return;
	}
	if (Grid.tool.kind === 'entity') {
		/* Entities are dragged into place, never painted: the press
		 * creates one and the same gesture carries it to its cell. */
		if (c.x < 0 || c.y < 0 || c.x >= W || c.y >= Grid.h)
			return;
		Undo.begin();
		App.usedef(Grid.tool.id);
		elist().push({def: Grid.tool.id, pos: [c.x * B, c.y * B]});
		Grid.sel = elist().length - 1;
		Grid.moving = true;
		Grid.cursor(c);
		setblock(c.x, c.y, 0);
		App.touch();
		App.inspect();
		Grid.redraw();
		return;
	}

	Undo.begin();
	Grid.sel = -1;
	Grid.paint = Grid.tool.id;
	Grid.last = c;
	setblock(c.x, c.y, Grid.paint);
	App.inspect();
}

function onmove(ev)
{
	const c = at(ev);

	Grid.cursor(c);
	if (Grid.pan) {
		Grid.cam.x = Grid.pan.cx - (ev.clientX - Grid.pan.x) / Grid.cam.z;
		Grid.cam.y = Grid.pan.cy - (ev.clientY - Grid.pan.y) / Grid.cam.z;
		Grid.redraw();
		return;
	}

	if (c.x !== Grid.hov.x || c.y !== Grid.hov.y) {
		Grid.hov = {x: c.x, y: c.y};
		App.status(c.x, c.y);
		Grid.redraw();
	}

	if (Grid.moving && Grid.sel >= 0) {
		if (c.x < 0 || c.y < 0 || c.x >= W || c.y >= Grid.h)
			return;
		const e = elist()[Grid.sel];
		if (e.pos[0] === c.x * B && e.pos[1] === c.y * B)
			return;
		e.pos[0] = c.x * B;
		e.pos[1] = c.y * B;
		setblock(c.x, c.y, 0);		/* the block under it gives way */
		App.touch();
		/* PERF-01: write the moved fields in place rather than rebuilding the
		 * whole inspector on every cell crossed; Panel.update() falls back to
		 * false if the inspector isn't already showing this entity, which
		 * ondown() guarantees it is the moment a drag can begin. */
		if (!Panel.update(e))
			App.inspect();
		Grid.redraw();
		return;
	}

	if (Grid.paint >= 0 && Grid.last) {
		stroke(Grid.last.x, Grid.last.y, c.x, c.y, Grid.paint);
		Grid.last = c;
	}
}

function onup()
{
	const moved = Grid.moving;

	Grid.pan = null;
	Grid.paint = -1;
	Grid.last = null;
	Grid.moving = false;
	Grid.cursor(Grid.hov);
	Undo.end();
	/* PERF-01: the drag itself only kept Panel.update()'s three fields in
	 * step; run the real Panel.inspect() once now that the gesture is done,
	 * as the finding asks, rather than on every cell crossed. */
	if (moved)
		App.inspect();
}
