/* code.js - the Monaco text editor for the level's Lua scripts.
 *
 * One model per script keeps undo history and the caret alive across tab
 * switches.  Every keystroke writes straight back into App.doc.scripts, so
 * saving the level needs no separate flush. */
'use strict';

const Code = {ed: null, models: new Map(), path: null, ready: false, quiet: false};

const THEME = {
	base: 'vs-dark',
	inherit: true,
	rules: [{token: '', foreground: 'b9a6d6', background: '150f24'}],
	colors: {
		'editor.background': '#150f24',
		'editor.foreground': '#b9a6d6',
		'editor.lineHighlightBackground': '#1a122c',
		'editor.selectionBackground': '#2e2049',
		'editorCursor.foreground': '#7b56ba',
		'editorLineNumber.foreground': '#3b285b',
		'editorLineNumber.activeForeground': '#7b56ba',
		'editorGutter.background': '#150f24',
		'editorWidget.background': '#1a122c',
		'editorIndentGuide.background1': '#1e1633'
	}
};

Code.init = function (done)
{
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
		Code.ed = monaco.editor.create($('code'), {
			theme: 'pb',
			automaticLayout: true,
			fontFamily: "'JetBrains Mono','DejaVu Sans Mono',monospace",
			fontSize: 12,
			minimap: {enabled: false},
			scrollBeyondLastLine: false,
			renderWhitespace: 'selection',
			tabSize: 4
		});
		Code.ready = true;
		done();
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
