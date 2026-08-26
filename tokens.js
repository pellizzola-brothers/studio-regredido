/* tokens.js - style.css's :root custom properties, read once into a plain
 * object (VIS-04).
 *
 * Colour used to exist in four independent copies: style.css's :root, a
 * scatter of literals in grid.js, code.js's hand-transcribed Monaco THEME,
 * and main.js's backgroundColor (a fifth, but a legitimate one - see the
 * comment at its one use site).  style.css :root is now the single
 * definition; grid.js's canvas 2D context and code.js's THEME both read it
 * from here instead of restating it, because neither can resolve a CSS
 * var(...) reference itself: Canvas2D's fillStyle/strokeStyle wants a plain
 * colour string, and Monaco's defineTheme() wants a plain object literal, not
 * a live stylesheet reference.
 *
 * A <link rel=stylesheet> blocks every <script> that follows it in the
 * document until the sheet has loaded, and index.html's <link> is first, so
 * the custom properties below are already resolvable by the time this file's
 * top-level code runs. */
'use strict';

/* exported Tokens */
const Tokens = (() => {
	const cs = getComputedStyle(document.documentElement);
	const v = name => cs.getPropertyValue(name).trim();

	return {
		fg: v('--fg'),
		acc: v('--acc'),
		tab: v('--tab'),
		scrollThumb: v('--scroll-thumb'),
		canvasBg: v('--canvas-bg'),
		missingTex: v('--missing-tex'),
		missingDef: v('--missing-def'),
		gridLine: 'rgba(' + v('--acc-rgb') + ', .14)',
		bounds: 'rgba(' + v('--acc-rgb') + ', .5)',
		/* A lighter tint than --acc, for the hover cell's outline; distinct
		 * enough from the selection ring that the two are not confused, and
		 * has no CSS consumer of its own to read a token from yet. */
		hoverCell: 'rgba(200, 170, 255, .75)'
	};
})();
