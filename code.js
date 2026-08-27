/* code.js - the Monaco text editor for the level's Lua scripts.
 *
 * One model per script keeps undo history and the caret alive across tab
 * switches.  Every keystroke writes straight back into App.doc.scripts, so
 * saving the level needs no separate flush. */
'use strict';

const Code = {ed: null, models: new Map(), path: null, ready: false, quiet: false,
	loading: false, pending: []};

/* VIS-04/VIS-18: every one of these now reads Tokens (tokens.js) instead of
 * a hand-transcribed hex literal - the three that VIS-04 left alone
 * (150f24/2e2049/1e1633, none of them a duplicate of anything else in the
 * app, so nothing for them to drift out of sync with) now have a considered
 * relationship to the surrounding chrome instead: the editor replaces the
 * canvas on screen (#code sits where #wrap does, `body.text` toggles which
 * one shows), so its own background is the canvas's, not one of the side
 * panels'; the selection/bracket/occurrence highlights are accent-tinted
 * overlays built from the same --acc-rgb triple grid.js's own selection
 * ring and level-bounds outline already are, rather than a fourth
 * unrelated violet; the indent guide reuses --line, the decorative-only
 * separator token already scoped for exactly this weight of mark. Unset
 * keys previously fell through to vs-dark's own blue - a colour with
 * nothing to do with this app - for the scrollbar, the find/suggest
 * widgets, the list states inside them, bracket matching, and error/warning
 * squiggles; all of them are named below now. */
const THEME = {
	base: 'vs-dark',
	inherit: true,
	rules: [{token: '', foreground: Tokens.fg.replace('#', ''), background: Tokens.canvasBg.replace('#', '')}],
	colors: {
		'editor.background': Tokens.canvasBg,
		'editor.foreground': Tokens.fg,
		'editor.lineHighlightBackground': Tokens.tab,
		'editor.selectionBackground': 'rgba(' + Tokens.accRgb + ', .3)',
		'editor.selectionHighlightBackground': 'rgba(' + Tokens.accRgb + ', .15)',
		'editorCursor.foreground': Tokens.acc,
		'editorLineNumber.foreground': Tokens.scrollThumb,
		'editorLineNumber.activeForeground': Tokens.acc,
		'editorGutter.background': Tokens.canvasBg,
		'editorWidget.background': Tokens.tab,
		'editorWidget.border': Tokens.acc,
		'editorIndentGuide.background1': Tokens.line,
		'focusBorder': Tokens.acc,
		'scrollbarSlider.background': 'rgba(' + Tokens.accRgb + ', .2)',
		'scrollbarSlider.hoverBackground': 'rgba(' + Tokens.accRgb + ', .35)',
		'scrollbarSlider.activeBackground': 'rgba(' + Tokens.accRgb + ', .5)',
		'editorSuggestWidget.background': Tokens.tab,
		'editorSuggestWidget.border': Tokens.acc,
		'editorSuggestWidget.selectedBackground': Tokens.surfaceSelected,
		'editorSuggestWidget.highlightForeground': Tokens.acc,
		'list.hoverBackground': Tokens.surfaceHover,
		'list.activeSelectionBackground': Tokens.surfaceSelected,
		'editorBracketMatch.background': 'rgba(' + Tokens.accRgb + ', .25)',
		'editorBracketMatch.border': Tokens.acc,
		'editorError.foreground': Tokens.danger,
		'editorWarning.foreground': Tokens.danger
	}
};

/* ARCH-08: Monaco is several megabytes of JavaScript that the Level Editor -
 * the tab every session opens first, and the only one most sessions ever use
 * - never touches.  Code.init() is idempotent: the first call actually loads
 * it; calls while that load is in flight queue their `done` behind it instead
 * of starting a second `require(['vs/editor/editor.main'], ...)`; a call once
 * loaded just runs `done` straight away. App.select() is what makes each of
 * those three cases happen, calling this on the first script-tab activation
 * instead of unconditionally at boot. */
Code.init = function (done)
{
	if (Code.ready) {
		done();
		return;
	}
	if (Code.loading) {
		Code.pending.push(done);
		return;
	}
	Code.loading = true;
	Code.pending.push(done);

	const el = $('code');
	el.textContent = 'loading editor…';
	el.style.cssText = 'padding: 12px; color: var(--dim)';

	const dir = 'node_modules/monaco-editor/min/vs';
	const base = new URL(dir + '/', location.href).href;

	/* The workers are loaded through a shim blob so they inherit the page's
	 * app:// origin and can importScripts the real worker next to it. */
	self.MonacoEnvironment = {
		getWorkerUrl: () => URL.createObjectURL(new Blob([
			'self.MonacoEnvironment={baseUrl:"' + base + '"};' +
			'importScripts("' + base + 'base/worker/workerMain.js");'
		], {type: 'text/javascript'}))
	};

	require.config({paths: {vs: dir}});
	require(['vs/editor/editor.main'], () => {
		monaco.editor.defineTheme('pb', THEME);
		el.textContent = '';
		el.style.cssText = '';
		Code.ed = monaco.editor.create(el, {
			theme: 'pb',
			automaticLayout: true,
			fontFamily: "'JetBrains Mono','DejaVu Sans Mono',monospace",
			fontSize: Tokens.fontSize,
			lineHeight: Tokens.lineHeight,		/* VIS-18 */
			/* VIS-18: 'line' is Monaco's own default, made explicit so it
			 * reads as a decision - it fills the current line with
			 * editor.lineHighlightBackground (Tokens.tab, above), the same
			 * "this row" fill treatment li.on/.tab.on already give a
			 * selected row elsewhere in the app (VIS-07). */
			renderLineHighlight: 'line',
			minimap: {enabled: false},
			scrollBeyondLastLine: false,
			renderWhitespace: 'selection',
			tabSize: 4
		});
		Code.ready = true;
		Code.loading = false;
		const fns = Code.pending;
		Code.pending = [];
		for (const fn of fns)
			fn();
	});
};

Code.model = function (path)
{
	let m = Code.models.get(path);
	if (m)
		return m;

	m = monaco.editor.createModel(App.doc.scripts[path] || '', 'lua');
	m.onDidChangeContent(() => {
		if (Code.quiet)
			return;			/* our own write, from an undo */
		App.doc.scripts[path] = m.getValue();
		App.textdirty = true;		/* Monaco keeps its own history, so
						 * Undo.depth() knows nothing of this */
		App.touch();
	});
	Code.models.set(path, m);
	return m;
};

Code.show = function (path)
{
	if (!Code.ready)
		return;
	Code.path = path;
	Code.ed.setModel(Code.model(path));
	Code.ed.focus();
};

Code.drop = function (path)
{
	const m = Code.models.get(path);
	if (!m)
		return;
	Code.models.delete(path);
	m.dispose();
	if (Code.path === path)
		Code.path = null;
};

/* Pull the models back in line with the document after an undo replaced it. */
Code.sync = function ()
{
	for (const [p, m] of Code.models) {
		const text = App.doc.scripts[p];

		if (text === undefined) {
			Code.models.delete(p);
			m.dispose();
		} else if (m.getValue() !== text) {
			Code.quiet = true;
			m.setValue(text);
			Code.quiet = false;
		}
	}
};

/* Reload every model from the document, e.g. after opening another level. */
Code.reset = function ()
{
	for (const m of Code.models.values())
		m.dispose();
	Code.models.clear();
	Code.path = null;
	if (Code.ready)
		Code.ed.setModel(null);
};
