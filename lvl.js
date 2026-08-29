/* lvl.js - reading, writing and validating .lvl archives.
 *
 * A .lvl is a ZIP holding:
 *	level.json	the level itself (schema below)
 *	scripts/*.lua	user-written Lua
 *	midi/*.mid	music
 */
'use strict';

const fs = require('fs');
const {zip, unzipSync, strToU8, strFromU8} = require('fflate');
const cat = require('./catalog');

/* W, H and B are catalog.js's alone (ARCH-02) - this file used to redefine
 * W itself, which meant the cross-repo row-width contract CLAUDE.md documents
 * lived in two places, one of which required('./catalog') and ignored it. */
const BG = ['foo', 'bar', 'baz'];	/* the only accepted background presets */
const MAXERR = 12;			/* errors reported before we stop counting */

function isstr(v) { return typeof v === 'string'; }
function isnum(v) { return typeof v === 'number' && isFinite(v); }

/* Collect every problem with `j` as a human-readable line.  Empty means valid.
 * Bails out at MAXERR so a single mangled file cannot spam megabytes. */
function validate(j)
{
	const e = [];
	const l = j && j.level;

	if (!l || typeof l !== 'object')
		return ['missing "level" object'];

	const i = l.information;
	if (!i || typeof i !== 'object')
		e.push('missing level.information');
	else for (const k of ['name', 'description', 'author'])
		if (!isstr(i[k]))
			e.push('information.' + k + ' must be a string');

	if (!Array.isArray(l.block_data) || !l.block_data.length)
		e.push('block_data must be a non-empty array of rows');
	else for (let y = 0; y < l.block_data.length && e.length < MAXERR; y++) {
		const row = l.block_data[y];
		if (!Array.isArray(row) || row.length !== cat.W) {
			e.push('block_data row ' + y + ' must hold exactly ' + cat.W + ' entries');
			continue;
		}
		for (let x = 0; x < cat.W; x++)
			if (!isstr(row[x]) || !/^\d{3}$/.test(row[x])) {
				e.push('block_data[' + y + '][' + x + '] must be a 3-digit id string');
				break;
			}
	}

	const defs = new Set();
	if (!Array.isArray(l.entity_definitions))
		e.push('entity_definitions must be an array');
	else l.entity_definitions.forEach((d, n) => {
		if (!d || !isstr(d.id) || !isstr(d.script)) {
			e.push('entity_definitions[' + n + '] needs a string id and script');
			return;
		}
		if (defs.has(d.id))
			e.push('duplicate entity definition "' + d.id + '"');
		defs.add(d.id);
	});

	if (!Array.isArray(l.entities))
		e.push('entities must be an array');
	else l.entities.forEach((s, n) => {
		if (!s || !isstr(s.def)) {
			e.push('entities[' + n + '].def must be a string');
			return;
		}
		if (!defs.has(s.def))
			e.push('entities[' + n + '] references unknown definition "' + s.def + '"');
		if (!Array.isArray(s.pos) || s.pos.length !== 2 || !s.pos.every(isnum))
			e.push('entities[' + n + '].pos must be [x, y]');
	});

	if (!Array.isArray(l.backgrounds))
		e.push('backgrounds must be an array');
	else l.backgrounds.forEach((b, n) => {
		if (!BG.includes(b))
			e.push('backgrounds[' + n + '] "' + b + '" is not a preset (' + BG.join(', ') + ')');
	});

	return e.slice(0, MAXERR);
}

/* Semantic checks beyond validate(): things textures/README.md's contract
 * requires for the *game* to run the level, but that are not malformed data,
 * so a level failing them must still be allowed to save - an author mid-build
 * legitimately has no end block yet.  Returns warning strings; empty means
 * clean.  Takes the whole document, not just json, because "a definition's
 * script is missing" and "a script is unused" both need doc.scripts. */
function review(doc)
{
	const l = doc.json.level;
	const w = [];
	let starts = 0, ends = 0;

	/* VIS-17: a 3-digit id validate() already accepts as *shape*-valid can
	 * still name no block this build's catalog.js knows about (a level
	 * authored against a newer catalog, or a hand-edited/corrupted one) -
	 * grid.js renders that cell as a hatch rather than a texture, and this
	 * is the warning that says why, the first time each unknown id turns up. */
	const knownblocks = new Set(cat.BLOCKS.map(b => String(b.id).padStart(3, '0')));
	const unknownblocks = new Set();
	for (const row of l.block_data)
		for (const id of row) {
			if (id === '001') starts++;
			else if (id === '004') ends++;
			if (id !== '000' && !knownblocks.has(id))
				unknownblocks.add(id);
		}
	for (const id of unknownblocks)
		w.push('block id ' + id + ' is not in this build\'s catalog');
	if (starts === 0)
		w.push('no start block placed (tile 1 is required)');
	else if (starts > 1)
		w.push(starts + ' start blocks placed; tile 1 must be unique');
	if (ends === 0)
		w.push('no end block placed (tile 4 is required)');
	else if (ends > 1)
		w.push(ends + ' end blocks placed; tile 4 must be unique');

	for (const d of l.entity_definitions)
		if (d.script.startsWith('scripts/') && doc.scripts[d.script] === undefined)
			w.push('definition "' + d.id + '" points at missing script ' + d.script);

	const h = l.block_data.length;
	const used = new Set();
	l.entities.forEach((s, n) => {
		used.add(s.def);
		if (!Array.isArray(s.pos) || s.pos.length !== 2)
			return;			/* validate() already reports this shape error */
		const [x, y] = s.pos;
		if (x < 0 || y < 0 || x >= cat.W * cat.B || y >= h * cat.B)
			w.push('entities[' + n + '] ("' + s.def + '") is outside the level bounds');
	});
	for (const d of l.entity_definitions)
		if (!used.has(d.id))
			w.push('definition "' + d.id + '" is not used by any entity');

	const usedscripts = new Set(l.entity_definitions.map(d => d.script));
	for (const p of Object.keys(doc.scripts))
		if (!usedscripts.has(p))
			w.push('script ' + p + ' is not referenced by any definition');

	return w;
}

/* Old levels stored one flat "data" array instead of rows, and predate the
 * entity and background fields.  Reshape in place so they still open. */
function migrate(j)
{
	const l = j && j.level;
	if (!l)
		return j;

	if (!Array.isArray(l.block_data) && Array.isArray(l.data)) {
		const rows = [];
		for (let n = 0; n < l.data.length; n += cat.W) {
			const r = l.data.slice(n, n + cat.W);
			while (r.length < cat.W)
				r.push('000');
			rows.push(r);
		}
		l.block_data = rows;
		delete l.data;
	}
	if (!Array.isArray(l.block_data) || !l.block_data.length)
		l.block_data = blockrows(cat.H);
	if (!l.information)
		l.information = {name: '', description: '', author: ''};
	if (!Array.isArray(l.entity_definitions))
		l.entity_definitions = [];
	if (!Array.isArray(l.entities))
		l.entities = [];
	if (!Array.isArray(l.backgrounds))
		l.backgrounds = [BG[0]];

	items(l);
	return j;
}

/* Lift any leftover interactive tiles out of block_data and into entities. */
function items(l)
{
	const have = new Set(l.entity_definitions.map(d => d.id));

	for (let y = 0; y < l.block_data.length; y++) {
		const row = l.block_data[y];
		for (let x = 0; x < cat.W; x++) {
			const id = cat.ITEMTILE[+row[x]];
			if (!id)
				continue;
			row[x] = '000';
			if (!have.has(id)) {
				l.entity_definitions.push({
					id: id,
					script: cat.ITEMS.find(i => i.id === id).script
				});
				have.add(id);
			}
			l.entities.push({def: id, pos: [x * cat.B, y * cat.B]});
		}
	}
}

function blockrows(h)
{
	const rows = [];
	for (let y = 0; y < h; y++)
		rows.push(new Array(cat.W).fill('000'));
	return rows;
}

/* A document is what the renderer works on:
 *	json	 parsed level.json
 *	scripts	 {"scripts/foo.lua": "<text>"}
 *	midi	 {"midi/foo.mid": Uint8Array} */
function blank()
{
	return {
		json: {
			level: {
				information: {name: 'untitled', description: '', author: ''},
				block_data: blockrows(cat.H),
				entity_definitions: [],
				entities: [],
				backgrounds: [BG[0]]
			}
		},
		scripts: {},
		midi: {}
	};
}

function fail(what, errs)
{
	throw new Error(what + '\n\n' + errs.join('\n'));
}

function read(p)
{
	const buf = fs.readFileSync(p);
	let doc;

	if (buf[0] === 0x50 && buf[1] === 0x4b) {		/* "PK": a real archive */
		/* Named unzipped rather than zip - write() (below) imports fflate's
		 * own async zip() at module scope, and this would otherwise shadow
		 * it within this function only, which is exactly the kind of
		 * same-name-different-thing confusion worth avoiding even where it
		 * is not currently a bug. */
		const unzipped = unzipSync(buf);
		if (!unzipped['level.json'])
			throw new Error(p + ' contains no level.json');
		doc = {json: JSON.parse(strFromU8(unzipped['level.json'])), scripts: {}, midi: {}};
		for (const k in unzipped) {
			if (k.endsWith('/'))
				continue;
			if (k.startsWith('scripts/'))
				doc.scripts[k] = strFromU8(unzipped[k]);
			else if (k.startsWith('midi/'))
				doc.midi[k] = unzipped[k];
		}
	} else {						/* a bare level.json */
		doc = {json: JSON.parse(strFromU8(buf)), scripts: {}, midi: {}};
	}

	migrate(doc.json);
	const errs = validate(doc.json);
	if (errs.length)
		fail('invalid level.json in ' + p + ':', errs);
	return doc;
}

/* NAT-19/ARCH-09/PERF-06: measured before touching, per this file's own
 * "the synchronous code is simpler... measure, then convert if the
 * measurement justifies it" rule (POLISH.md). A 999-row save, isolated from
 * IPC and Grid.commit(), broke down as: JSON.stringify 11ms, zipSync 82ms,
 * writeFileSync under 2ms, validate() 6ms - ~104ms total, crossing the
 * ~100ms budget on this machine, and disk I/O was never the reason: it cost
 * under 2% of the total. zipSync's own compression is what blocks the main
 * process - confirmed by timing a 5ms setInterval against fflate's async
 * zip() over the same payload: the timer kept firing throughout (proof the
 * main thread stayed free), where it could not have during zipSync's own
 * synchronous call. So only the compression step moves - fs.writeFileSync/
 * renameSync stay exactly as they were, since fs.promises would not have
 * addressed the measured bottleneck at all. (A 999-row *read* measured 70ms
 * total, under the same threshold, so unzipSync is unconverted.) write()
 * now returns a Promise; every caller (main.js) already awaits it inside an
 * async handler. */
function write(p, doc)
{
	const errs = validate(doc.json);
	if (errs.length)
		fail('refusing to save an invalid level:', errs);

	const files = {'level.json': strToU8(JSON.stringify(doc.json, null, 4))};
	for (const k in doc.scripts)
		files[k] = strToU8(doc.scripts[k]);
	for (const k in doc.midi)
		files[k] = new Uint8Array(doc.midi[k]);

	/* Write to a temp file in the same directory, then rename over the
	 * target: rename(2) is atomic within one filesystem, so a crash or a
	 * full disk mid-write leaves the previous good file in place instead of
	 * a truncated one. */
	const tmp = p + '.tmp-' + process.pid;
	return new Promise((resolve, reject) => {
		zip(files, {level: 6}, (err, data) => {
			if (err) {
				reject(err);
				return;
			}
			try {
				fs.writeFileSync(tmp, data);
				fs.renameSync(tmp, p);
				resolve();
			} catch (e) {
				try { fs.unlinkSync(tmp); } catch (_) { /* nothing to clean up */ }
				reject(e);
			}
		});
	});
}

module.exports = {W: cat.W, H: cat.H, BG, blank, read, write, validate, migrate, review};
