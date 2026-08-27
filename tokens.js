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
 * top-level code runs.
 *
 * VIS-18: code.js's own font size and line height are read the same way, for
 * the same reason - Monaco's editor.create() options want plain numbers, not
 * a live var(--font-size). */
'use strict';

/* exported Tokens */
const Tokens = (() => {
	const cs = getComputedStyle(document.documentElement);
	const v = name => cs.getPropertyValue(name).trim();

	return {
		fg: v('--fg'),
		acc: v('--acc'),
		accRgb: v('--acc-rgb'),		/* VIS-18: the raw triple, for code.js's
						   own accent-tinted overlays - the same
						   composition gridLine already does below,
						   just with alphas only Monaco's theme needs */
		tab: v('--tab'),
		line: v('--line'),			/* VIS-18: code.js's indent guide */
		danger: v('--danger'),			/* VIS-18: code.js's error/warning squiggles */
		surfaceHover: v('--surface-hover'),	/* VIS-18: code.js's list hover */
		surfaceSelected: v('--surface-selected'), /* VIS-18: code.js's list/suggest selection */
		scrollThumb: v('--scroll-thumb'),
		canvasBg: v('--canvas-bg'),
		missingTex: v('--missing-tex'),
		missingDef: v('--missing-def'),
		gridLine: 'rgba(' + v('--acc-rgb') + ', .14)',
		/* VIS-18: code.js's own editor options - it cannot resolve a CSS
		 * var() any more than it can resolve one for a colour, so the type
		 * scale needs the same numeric read-out. */
		fontSize: parseFloat(v('--font-size')),
		lineHeight: parseFloat(v('--line-box'))
	};
})();
