/* catalog.js - what the palette can paint and place.
 *
 * Block ids follow the contract documented in textures/README.md; the game
 * reads the same table, so an id may never be reused or renumbered here alone.
 *
 * Deliberately absent: blocks/lucky_block.png and the six interactives/*_flag
 * sprites.  They ship in the texture library but textures/README.md assigns
 * them no id, and inventing one here would silently disagree with the game.
 * Give them ids in all three repos at once, then add them below. */
'use strict';

/* PLACEHOLDER, tex and ready are consumed by grid.js and panel.js in the
 * renderer's shared global scope (CLAUDE.md), not by this file itself. */
/* exported PLACEHOLDER, tex, ready */

const B = 100;		/* world pixels per block; game/src/main.c draws 100x100 */
const W = 540;		/* entries per block_data row */
const H = 12;		/* rows in a fresh level - a product decision, not a format one */

const BLOCKS = [
	{id:  1, name: 'start',        file: 'blocks/start_level.png'},
	{id:  2, name: 'brick',        file: 'blocks/bricks.png'},
	{id:  3, name: 'excla',        file: 'blocks/normal_excla_block1.png'},
	{id:  4, name: 'end',          file: 'blocks/end_level.png'},
	{id:  5, name: 'arrow sign',   file: 'blocks/arrow_sign.png'},
	{id:  6, name: 'bronze',       file: 'blocks/bronze_block.png'},
	{id:  7, name: 'cement',       file: 'blocks/cement.png'},
	{id:  8, name: 'diamond',      file: 'blocks/diamond_block.png'},
	{id:  9, name: 'esponja',      file: 'blocks/esponja.png'},
	{id: 10, name: 'floor',        file: 'blocks/floor_block.png'},
	{id: 11, name: 'frozen excla', file: 'blocks/frozen_excla_block1.png'},
	{id: 12, name: 'frozen floor', file: 'blocks/frozen_floor_block.png'},
	{id: 13, name: 'gold',         file: 'blocks/gold_block.png'},
	{id: 14, name: 'ice excla',    file: 'blocks/ice_excla_block1.png'},
	{id: 15, name: 'ice floor',    file: 'blocks/ice_floor_block.png'},
	{id: 16, name: 'note',         file: 'blocks/note_block.png'},
	{id: 17, name: 'sand',         file: 'blocks/sand.png'},
	{id: 18, name: 'silver',       file: 'blocks/silver_block.png'},
	{id: 19, name: 'cloud',        file: 'blocks/strange_cloud1.png'}
];

/* Interactives are entities, not tiles: they are dragged into place and carry a
 * script like any other entity.  The palette keeps them in their own group. */
const ITEMS = [
	{id: 'pizza', script: 'pizza_item', file: 'interactives/pizza.png'},
	{id: 'coin',  script: 'coin_item',  file: 'interactives/PELLIZZOLA-COIN!!!!!.png'},
	{id: 'soda',  script: 'soda_item',  file: 'interactives/energéticoBrothers(estrela).png'},
	{id: 'star',  script: 'star_item',  file: 'interactives/star.png'}
];

/* They were tile ids 43-46 once.  Levels written back then are converted on
 * load, so the ids stay reserved and must not be handed to a block. */
const ITEMTILE = {43: 'pizza', 44: 'coin', 45: 'soda', 46: 'star'};

/* Built-in entity definitions.  `script` is a bare name: the game resolves it
 * against its own script table.  Custom definitions instead carry a path into
 * the level's own scripts/ directory. */
const ENTS = [
	{id: 'chapeleira', script: 'chapeleira_ai', file: 'enemies/chapeleira.png'},
	{id: 'abu',        script: 'abu_ai',        file: 'enemies/abú.png'},
	{id: 'gombacrack', script: 'gombacrack_ai', file: 'enemies/gombacrack.png'},
	{id: 'pranta',     script: 'pranta_ai',     file: 'enemies/pranta.png'},
	{id: 'pinguim',    script: 'pinguim_ai',    file: 'enemies/pinguim.png'},
	{id: 'bullet',     script: 'bullet_ai',     file: 'enemies/bullet.png'}
];

/* The three presets the schema allows, mapped onto real backdrop art. */
const BGS = [
	{id: 'foo', file: 'backdrops/background.png'},
	{id: 'bar', file: 'backdrops/Mountains-V1.png'},
	{id: 'baz', file: 'backdrops/scen(beta).png'}
];

const PLACEHOLDER = 'icons/placeholder.png';

const tiles = new Map();	/* block id -> catalog entry */
for (const t of BLOCKS)
	tiles.set(t.id, t);

const entdefs = new Map();	/* definition id -> catalog entry */
for (const e of ENTS.concat(ITEMS))
	entdefs.set(e.id, e);

/* Texture names carry accents, spaces and '!'; encode each segment. */
function texurl(file)
{
	return 'textures/' + file.split('/').map(encodeURIComponent).join('/');
}

const cache = new Map();

/* Images decode asynchronously; `redraw` fires once each one lands. */
function tex(file, redraw)
{
	let im = cache.get(file);
	if (im)
		return im;
	im = new Image();
	im.onload = im.onerror = redraw;
	im.src = texurl(file);
	cache.set(file, im);
	return im;
}

function ready(im) { return im && im.complete && im.naturalWidth > 0; }

/* lvl.js pulls the tables in from the main process; the renderer loads this as
 * a plain script and picks the same names up as globals. */
if (typeof module !== 'undefined' && module.exports)
	module.exports = {B, W, H, BLOCKS, ITEMS, ENTS, BGS, ITEMTILE};
