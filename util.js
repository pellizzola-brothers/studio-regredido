/* util.js - the two helpers every other renderer script leans on: $() (app.js,
 * code.js, layout.js, panel.js) and esc() (panel.js). Loaded first (index.html)
 * precisely so that dependency is explicit rather than implicit in load order,
 * per ARCH-05 (POLISH.md): the renderer scripts share one global scope on
 * purpose (CLAUDE.md), and a name this widely used deserves one visible home
 * rather than living wherever it was first needed. */
'use strict';

/* exported $, esc */
function $(id) { return document.getElementById(id); }

function esc(s)
{
	return String(s).replace(/[&<>"]/g, c =>
		({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
}
