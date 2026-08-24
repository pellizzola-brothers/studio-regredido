/* eslint.config.js - checks the house style CLAUDE.md and the suckless guide
 * ask for: tabs, a 'use strict' pragma, and no dead variables.
 *
 * Deliberately no no-undef: the renderer scripts share one global scope on
 * purpose (CLAUDE.md, "The renderer scripts share one global scope"), so a
 * name defined in grid.js and used in app.js is correct, not an error.
 * tools/check.js's collision grep is the check for that scope instead. */
'use strict';

module.exports = [
	{
		files: ['**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'script'
		},
		rules: {
			indent: ['error', 'tab', {SwitchCase: 1}],
			strict: ['error', 'global'],
			'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none'}]
		}
	}
];
