// Static half of the accessibility gate: eslint-plugin-jsx-a11y's recommended
// rules over every TSX file. The shell's eslint.config.js spreads this
// fragment in when the design-guardrails template (and with it this package)
// is installed; without it the shell lints without the a11y rules rather than
// failing to resolve a plugin it does not carry. The runtime half — axe over
// the composed DOM — lives in __tests__/a11y.test.tsx and src/designDefects.ts.
import jsxA11y from 'eslint-plugin-jsx-a11y';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ['**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: { ...jsxA11y.flatConfigs.recommended.rules },
  },
];
