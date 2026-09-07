/**
 * FrontX ESLint Configuration (Ecosystem Root)
 *
 * Covers ONLY the ecosystem packages (mfes, gts-plugin, api, cli,
 * cyber-pilot-kit-frontx).
 * The template-side packages (state, i18n, framework, react, auth, studio) and
 * the host app now live in the self-contained top-level `template-shell/`
 * (see Phase 11 template-move; split from its MFE content into the sibling
 * `template-mfe/` in issue #470); it ships its own `eslint.config.js`. Both
 * `template-shell/` and `template-mfe/` are excluded from this config's
 * scope below.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Global ignores
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      '**/.__mf__temp/**',
      '**/coverage/**',
      'node_modules/**',
      '*.config.*',
      '**/*.config.*',
      '**/*.cjs',
      // Not lintable yet, and deliberately still ignored. Lifting this needs a
      // config block giving `scripts/**` the Node globals it runs against —
      // without one, 69 of the 73 errors are `no-undef` on `console`, `Buffer`,
      // `setTimeout` and `queueMicrotask`. The remaining 4 are real and
      // pre-existing (`no-useless-assignment`, `preserve-caught-error`, an
      // unused import), so lifting the ignore turns `npm run lint` red on code
      // this branch does not touch. Tracked with the rest of the scripts/
      // enforcement gap on #483.
      'scripts/**',
      // Disposable Claude Code agent worktrees — full repo checkouts that
      // should never be linted as part of this repo's own source tree.
      '.claude/**',
      // Local OMX agent runtime — session/task state, logs, and an embedded
      // scratch subproject (code-memory-pilot) with its own package.json and
      // .mjs sources; none of it is this repo's source.
      '.omx/**',
      // Constructor Studio vendored/generated runtime — kit-managed tool
      // internals (e.g. bundled browser-side assets), not this repo's own
      // source. Regenerated via `cfs update`/`cfs generate-agents`.
      '.cf-studio/.core/**',
      '.cf-studio/.gen/**',
      // Disposable seed-test scratch — generated template output produced by
      // the offline-seed e2e procedure; not this repo's own source.
      'seeded-test/**',
      '.seed-test-inventory/**',
    ],
  },

  // Base JS + TypeScript
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Package-local build scripts (e.g. packages/mfes/scripts/) run under Node,
  // unlike the root scripts/** which is still ignored pending #483.
  {
    files: ['packages/*/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // L0 BASE: Universal rules for all TS/TSX files
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
      },
    },
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': false },
      ],
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/no-wrapper-object-types': 'error',
      'prefer-const': 'error',
      'no-console': 'off',
      'no-var': 'error',
      'no-empty-pattern': 'error',
    },
  },

  // Kit-shipped scripts: node programs installed as kit resources rather than
  // compiled from this repo's TypeScript. The L0 block above is scoped to
  // .ts/.tsx, so without this block every `fetch`, `process` and `console` in
  // them is a `no-undef` error against globals node actually provides.
  {
    files: ['packages/**/skills/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // React hooks
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, 'react-hooks/exhaustive-deps': 'error' },
  },

  // Additional monorepo ignores
  {
    ignores: [
      'packages/**/dist/**',
      '**/dist/**', // All dist directories are build artifacts
      '**/*.__mf__temp/**', // Module Federation generated temp files
      '**/.__mf__temp/**', // Module Federation generated temp files (dot-prefixed)
      'packages/**/templates/**',
      'scripts/**', // Monorepo scripts — see the reasoning on the global ignore above
      '**/.vitepress/**',
      // Legacy config files (still used by dependency-cruiser)
      '.dependency-cruiser.cjs',
      '.husky/**',
      '.artifacts/**', // Sandbox artifacts (gitignored)
      '.agents/**', // Agent infrastructure (gitignored)
      'template-shell/**', // Self-contained template; ships its own eslint.config.js
      'template-mfe/**', // MFE content extracted from template-shell (issue #470); linted as part of the assembled shell+mfe tree, not from this ecosystem root
      'template-design-guardrails/**', // Manifest-only template; its verify package ships a lint fragment the shell consumes, linted as part of the assembled shell+overlay tree, not from this ecosystem root
    ],
  },

  // Monorepo-specific: Package internals and @/ aliases (catch-all for packages without layer-specific rules)
  // This block must appear BEFORE layer-specific blocks so they can override it
  {
    files: ['packages/**/*'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/*/src/**'],
              message:
                'MONOREPO VIOLATION: Import from package root, not internal paths.',
            },
            {
              group: ['@/*'],
              message:
                'PACKAGE VIOLATION: Use relative imports within packages. @/ aliases are only for app code (src/).',
            },
          ],
        },
      ],
    },
  },

  // SDK foundation: @gears-frontx/mfes — the port-contract package.
  // Allow unknown/object types (TypeSystemPlugin uses TSchema=unknown and entity:unknown).
  // mfes is the lowest-level SDK package; it cannot import any other @gears-frontx package.
  {
    files: ['packages/mfes/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/*'],
              message:
                'SDK VIOLATION: @gears-frontx/mfes is the SDK foundation and cannot import other @gears-frontx packages.',
            },
            {
              group: ['react', 'react-dom', 'react/*'],
              message:
                'SDK VIOLATION: SDK packages cannot import React.',
            },
            {
              group: ['@gears-frontx/*/src/**'],
              message:
                'MONOREPO VIOLATION: Import from package root, not internal paths.',
            },
            {
              group: ['@/*'],
              message:
                'PACKAGE VIOLATION: Use relative imports within packages.',
            },
          ],
        },
      ],
    },
  },

  // SDK packages: Allow unknown/object types (required for generic event bus, store, etc.)
  // These packages use generics and need flexible typing for consumer code to augment
  // Layer enforcement: SDK packages cannot import other @gears-frontx packages or React,
  //   EXCEPT @gears-frontx/mfes which is the extracted port-contract foundation.
  {
    files: [
      'packages/api/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/!(mfes)', '@gears-frontx/!(mfes)/*'],
              message:
                'SDK VIOLATION: SDK packages cannot import other @gears-frontx packages (except @gears-frontx/mfes).',
            },
            {
              group: ['react', 'react-dom', 'react/*'],
              message:
                'SDK VIOLATION: SDK packages cannot import React.',
            },
            {
              group: ['@gears-frontx/*/src/**'],
              message:
                'MONOREPO VIOLATION: Import from package root, not internal paths.',
            },
            {
              group: ['@/*'],
              message:
                'PACKAGE VIOLATION: Use relative imports within packages.',
            },
          ],
        },
      ],
    },
  },

  // @gears-frontx/telemetry: standalone browser SDK — no intra-ecosystem edge, no React.
  // dep-cruiser cannot see this edge: options.exclude.path drops packages/*/dist and every
  // workspace import resolves there, so this block is the gate that catches it.
  // Scoped to src/ to match the two dep-cruiser rules; demo/ consumes the package by name.
  {
    files: ['packages/telemetry/src/**/*.ts', 'packages/telemetry/src/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/*', '@gears-frontx/*/*'],
              message:
                'SDK VIOLATION: @gears-frontx/telemetry holds no intra-ecosystem package dependency.',
            },
            {
              group: ['react', 'react-dom', 'react-dom/*', 'react/*'],
              message:
                'SDK VIOLATION: SDK packages cannot import React.',
            },
            {
              group: ['@gears-frontx/*/src/**'],
              message:
                'MONOREPO VIOLATION: Import from package root, not internal paths.',
            },
            {
              group: ['@/*'],
              message:
                'PACKAGE VIOLATION: Use relative imports within packages.',
            },
          ],
        },
      ],
    },
  },

  // @gears-frontx/ui-kit: a React component library — React is its raison d'etre, so the
  // SDK no-React rule does not apply. Boundary: no intra-ecosystem edge, no reach into
  // template territory, package-root imports only.
  {
    files: ['packages/ui-kit/**/*.ts', 'packages/ui-kit/**/*.tsx'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/*', '@gears-frontx/*/*'],
              message:
                'ECOSYSTEM VIOLATION: @gears-frontx/ui-kit holds no intra-ecosystem package dependency.',
            },
            {
              group: ['@gears-frontx/*/src/**'],
              message:
                'MONOREPO VIOLATION: Import from package root, not internal paths.',
            },
            {
              group: ['@/*'],
              message:
                'PACKAGE VIOLATION: Use relative imports within packages.',
            },
          ],
        },
      ],
    },
  },

  // ui-kit's demo consumes the package by name (the workspace-linked dist), same as the
  // telemetry demo — that one is exempt because the telemetry block is scoped to src/;
  // ui-kit's block above spans the whole package, so the demo needs its own override.
  // Only the intra-ecosystem ban is lifted (importing @gears-frontx/ui-kit IS the demo's
  // job); the src-internals and alias bans stay, so the demo keeps validating the public
  // surface instead of quietly reaching into src/.
  {
    files: ['packages/ui-kit/demo/**/*.ts', 'packages/ui-kit/demo/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/*/src/**'],
              message:
                'MONOREPO VIOLATION: Import from package root, not internal paths.',
            },
            {
              group: ['@/*'],
              message:
                'PACKAGE VIOLATION: Use relative imports within packages.',
            },
          ],
        },
      ],
    },
  },

  // The hook signature is variadic so a handler of any shape stays assignable, and the record
  // carries consumer-supplied user data.
  // TODO: type both against a generic payload and drop this block; follow-up PR.
  {
    files: [
      'packages/telemetry/src/utils/hooks.ts',
      'packages/telemetry/src/utils/eventTypes.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // The envelope builders rewrite each record field in place to match the collector's wire format,
  // and the hooks manager dispatches a variadic tuple through a key-indexed handler map.
  // TODO: build the envelope into a fresh typed object and drop this block; follow-up PR.
  {
    files: [
      'packages/telemetry/src/managers/events.ts',
      'packages/telemetry/src/utils/hooks.ts',
    ],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },

  // ============ @gears-frontx/mfes BOUNDARY ENFORCEMENT (Phase 10) ============
  // MFES-1/2/3 enforced here via no-restricted-syntax denylist.
  // MFES-4 enforced via dep-cruiser rule frontx-mfes-4-type-format-dep (.dependency-cruiser.cjs).
  // MFES-5 enforced via scripts/test-architecture.ts (opaque schema surface grep check).
  {
    files: ['packages/mfes/**/*.ts', 'packages/mfes/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        // Each selector below is a list covering both spellings of a string constant: a
        // quoted one is a `Literal`, a backtick one is a `TemplateElement`, so matching
        // `Literal` alone lets `` `gts.frontx…` `` through the denylist untouched. Both
        // `value.raw` and `value.cooked` are checked so an escape sequence
        // (`gts.frontx…`) cannot spell the forbidden text either. A node matching
        // several branches of one list still reports once. Comments and JSDoc carry no
        // matching node at all, so naming these ids in prose stays legal.
        // @cpt-begin:cpt-frontx-constraint-mfes-no-type-format-literals:p10:inst-eslint-rule
        {
          selector: [
            "Literal[value=/gts\\.(frontx\\.(screensets|framework|state|i18n|react|mfes)|[a-z]+\\.(screensets|framework|state|i18n))/]",
            "TemplateElement[value.raw=/gts\\.(frontx\\.(screensets|framework|state|i18n|react|mfes)|[a-z]+\\.(screensets|framework|state|i18n))/]",
            "TemplateElement[value.cooked=/gts\\.(frontx\\.(screensets|framework|state|i18n|react|mfes)|[a-z]+\\.(screensets|framework|state|i18n))/]",
          ].join(', '),
          message:
            'MFES-1 VIOLATION (cpt-frontx-constraint-mfes-no-type-format-literals): @gears-frontx/mfes must not contain type-system-format string literals from solution namespaces or the mfes namespace (gts.frontx.mfes.*). These belong in the type-system plugin or consumer packages.',
        },
        // @cpt-end:cpt-frontx-constraint-mfes-no-type-format-literals:p10:inst-eslint-rule
        // @cpt-begin:cpt-frontx-constraint-mfes-no-solution-shared-properties:p10:inst-eslint-rule
        {
          selector: [
            "Literal[value=/^(theme|language)$/]",
            "TemplateElement[value.raw=/^(theme|language)$/]",
            "TemplateElement[value.cooked=/^(theme|language)$/]",
          ].join(', '),
          message:
            'MFES-2 VIOLATION (cpt-frontx-constraint-mfes-no-solution-shared-properties): @gears-frontx/mfes must not define solution-specific shared-property identifiers (e.g. theme, language). Supply these via the application layer or templates.',
        },
        // @cpt-end:cpt-frontx-constraint-mfes-no-solution-shared-properties:p10:inst-eslint-rule
        // @cpt-begin:cpt-frontx-constraint-mfes-no-layout-domain-values:p10:inst-eslint-rule
        {
          selector: [
            "Literal[value=/^(header|footer|menu|sidebar|popup|overlay|screen)$/]",
            "TemplateElement[value.raw=/^(header|footer|menu|sidebar|popup|overlay|screen)$/]",
            "TemplateElement[value.cooked=/^(header|footer|menu|sidebar|popup|overlay|screen)$/]",
          ].join(', '),
          message:
            'MFES-3 VIOLATION (cpt-frontx-constraint-mfes-no-layout-domain-values): @gears-frontx/mfes must not define specific extension-domain (layout-domain) values. These are solution vocabulary owned by frontx-template-shell (LayoutDomain enum).',
        },
        // @cpt-end:cpt-frontx-constraint-mfes-no-layout-domain-values:p10:inst-eslint-rule
      ],
    },
  },

  // ============ @gears-frontx/gts-plugin ============
  // GTS-PLUGIN-1/2 are enforced via dep-cruiser rules frontx-gts-plugin-1/2 (.dependency-cruiser.cjs).
  // Allow unknown/object types: gts-plugin owns JSONSchema (requires [key: string]: unknown)
  // and implements TypeSystemPlugin.register(entity: unknown) — all architecturally required.
  {
    files: ['packages/gts-plugin/**/*.ts', 'packages/gts-plugin/**/*.tsx'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // ============ @gears-frontx/api BOUNDARY ============
  // API-1 enforced via dep-cruiser rule frontx-api-1-no-solution-content (.dependency-cruiser.cjs).
  // (no ESLint-level changes needed for api boundary enforcement)

  // CLI package: Allow unknown types for dynamic command handling
  // Inherits monorepo boundary enforcement from catch-all block
  {
    files: ['packages/cli/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // Monorepo: uicore components must also follow flux rules (no direct slice dispatch)
  {
    files: [
      'packages/uicore/src/components/**/*.tsx',
      'packages/uicore/src/layout/domains/**/*.tsx',
    ],
    ignores: ['**/*.test.*', '**/*.spec.*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='dispatch'] CallExpression[callee.name=/^set[A-Z]/]",
          message:
            'FLUX VIOLATION: Components cannot call slice reducers (setXxx functions). Use actions from /actions/ instead.',
        },
        {
          selector:
            "CallExpression[callee.name='dispatch'] CallExpression[callee.object.name][callee.property.name]",
          message:
            'FLUX VIOLATION: Do not dispatch slice actions directly. Use event-emitting actions instead.',
        },
        {
          selector:
            "CallExpression[callee.object.name=/Store$/][callee.property.name!='getState']",
          message:
            'FLUX VIOLATION: Components cannot call custom store methods directly. Use Redux actions and useSelector.',
        },
      ],
    },
  },

];
