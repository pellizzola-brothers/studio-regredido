/* lvl.js - reading, writing and validating .lvl archives.
 *
 * A .lvl is a ZIP holding:
 *	level.json	the level itself (schema below)
 *	scripts/*.lua	user-written Lua
 *	midi/*.mid	music
 */
'use strict';

const fs = require('fs');
const {zipSync, unzipSync, strToU8, strFromU8} = require('fflate');
const cat = require('./catalog');

const W = 540;				/* every block_data row is exactly this wide */
const H = 12;				/* rows in a fresh level */
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
		if (!Array.isArray(row) || row.length !== W) {
			e.push('block_data row ' + y + ' must hold exactly ' + W + ' entries');
			continue;
		}
		for (let x = 0; x < W; x++)
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

/* Old levels stored one flat "data" array instead of rows, and predate the
 * entity and background fields.  Reshape in place so they still open. */
function migrate(j)
{
	const l = j && j.level;
	if (!l)
		return j;

	if (!Array.isArray(l.block_data) && Array.isArray(l.data)) {
		const rows = [];
		for (let n = 0; n < l.data.length; n += W) {
			const r = l.data.slice(n, n + W);
			while (r.length < W)
				r.push('000');
			rows.push(r);
		}
		l.block_data = rows;
		delete l.data;
	}
	if (!Array.isArray(l.block_data) || !l.block_data.length)
		l.block_data = blockrows(H);
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
		for (let x = 0; x < W; x++) {
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
		rows.push(new Array(W).fill('000'));
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
				block_data: blockrows(H),
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
		const zip = unzipSync(buf);
		if (!zip['level.json'])
			throw new Error(p + ' contains no level.json');
		doc = {json: JSON.parse(strFromU8(zip['level.json'])), scripts: {}, midi: {}};
		for (const k in zip) {
			if (k.endsWith('/'))
				continue;
			if (k.startsWith('scripts/'))
				doc.scripts[k] = strFromU8(zip[k]);
			else if (k.startsWith('midi/'))
				doc.midi[k] = zip[k];
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
	try {
		fs.writeFileSync(tmp, zipSync(files, {level: 6}));
		fs.renameSync(tmp, p);
	} catch (e) {
		try { fs.unlinkSync(tmp); } catch (_) { /* nothing to clean up */ }
		throw e;
	}
}

module.exports = {W, H, BG, blank, read, write, validate, migrate};
