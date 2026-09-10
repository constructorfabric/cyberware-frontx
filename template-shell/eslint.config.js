/**
 * FrontX Template ESLint Configuration (template-shell/, self-contained)
 *
 * Covers the template-side packages (state, i18n, framework, react, auth,
 * studio) and the host app (src-app/), relocated here from the ecosystem
 * monorepo by Phase 11 template-move. See the ecosystem root's
 * `eslint.config.js` for the rules that still apply to `mfes`, `gts-plugin`,
 * `api`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Lint fragments contributed by installed verify packages
// (src-app/verify_packages/*/eslint.config.mjs). The shell defines only the
// convention — it names no template and no package; which rules arrive, if
// any, is the installing template's business. A shell with no verify
// packages lints without them instead of failing to resolve plugins it does
// not carry. A fragment that IS present but fails to import fails the lint
// run loudly — an installed-but-broken package is an error, not an absence.
const verifyPackagesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'src-app',
  'verify_packages'
);
const verifyLintConfigs = [];
const verifyPackageEntries = fs.existsSync(verifyPackagesDir)
  ? fs.readdirSync(verifyPackagesDir)
  : [];
for (const entry of verifyPackageEntries) {
  const fragmentPath = path.join(verifyPackagesDir, entry, 'eslint.config.mjs');
  if (!fs.existsSync(fragmentPath)) continue;
  const fragment = await import(pathToFileURL(fragmentPath).href);
  verifyLintConfigs.push(...fragment.default);
}

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Global ignores
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'dist-lib/**', // tsup output of the template's own library build
      '**/.__mf__temp/**',
      '**/coverage/**',
      'node_modules/**',
      '*.config.*',
      '**/*.config.*',
      '**/*.cjs',
    ],
  },

  // Base JS + TypeScript
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Plain .mjs files are Node-land tooling (build scripts, verify-package
  // runners delivered by overlays). js.configs.recommended enables no-undef
  // for them, and unlike TS files they get no globals from typescript-eslint,
  // so without this block `console`/`process`/`fetch` all report as undefined.
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
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

  // React hooks
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, 'react-hooks/exhaustive-deps': 'error' },
  },

  // Rules delivered by verify packages (see the discovery loop above). The
  // Studio panel's drag handle is a reasoned exception to jsx-a11y when a
  // verify package supplies that plugin: onMouseDown starts a pointer-only
  // panel drag, and the header's real controls (collapse button) are native
  // and keyboard-reachable. It lives here rather than as an inline directive
  // because the plugin is optional — a named directive errors when the rule
  // is undefined, an unnamed one is an unused directive when it never fires.
  ...verifyLintConfigs,
  ...(verifyLintConfigs.some((c) => c.plugins?.['jsx-a11y'])
    ? [
        {
          files: ['packages/studio/src/StudioPanel.tsx'],
          rules: { 'jsx-a11y/no-static-element-interactions': 'off' },
        },
      ]
    : []),

  // Additional ignores
  {
    ignores: [
      'packages/**/dist/**',
      '**/dist/**', // All dist directories are build artifacts
      '**/*.__mf__temp/**', // Module Federation generated temp files
      '**/.__mf__temp/**', // Module Federation generated temp files (dot-prefixed)
      'packages/**/templates/**',
      '**/.vitepress/**',
      '.dependency-cruiser.cjs',
    ],
  },

  // Package internals and @/ aliases (catch-all for packages without layer-specific rules)
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
                'PACKAGE VIOLATION: Use relative imports within packages. @/ aliases are only for app code (src-app/).',
            },
          ],
        },
      ],
    },
  },

  // SDK packages (template-owned half): state, i18n. Allow unknown/object types
  // (required for generic event bus, store, etc.). Layer enforcement: SDK
  // packages cannot import other @gears-frontx packages or React, except
  // @gears-frontx/mfes (the ecosystem-side extracted port-contract foundation).
  {
    files: [
      'packages/state/**/*.ts',
      'packages/i18n/**/*.ts',
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

  // Framework package: Allow unknown/object types (wraps SDK with plugin architecture)
  // Layer enforcement: Framework cannot import @gears-frontx/react or React
  // BUT keep Flux rules for effects files
  {
    files: ['packages/framework/**/*.ts'],
    ignores: ['**/effects.ts', '**/*Effects.ts', '**/effects/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/react', '@gears-frontx/react/*'],
              message:
                'FRAMEWORK VIOLATION: Framework cannot import @gears-frontx/react (circular dependency).',
            },
            {
              group: ['react', 'react-dom', 'react/*'],
              message:
                'FRAMEWORK VIOLATION: Framework cannot import React.',
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

  // Framework effects: Keep Flux rules with layer enforcement
  {
    files: ['packages/framework/**/effects.ts', 'packages/framework/**/*Effects.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/react', '@gears-frontx/react/*'],
              message:
                'FRAMEWORK VIOLATION: Framework cannot import @gears-frontx/react (circular dependency).',
            },
            {
              group: ['react', 'react-dom', 'react/*'],
              message:
                'FRAMEWORK VIOLATION: Framework cannot import React.',
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
      // Keep no-restricted-syntax (enforced by frameworkConfig Flux rules)
    },
  },

  // Framework action files in effects directory: Allow event emission with layer enforcement
  {
    files: [
      'packages/framework/**/effects/**/*Actions.ts',
      'packages/framework/**/effects/*Actions.ts',
      'packages/framework/**/effects/**/actions.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off', // Actions emit events as their primary purpose
      'no-restricted-imports': 'off', // Action files may import from slices for direct coordination
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/react', '@gears-frontx/react/*'],
              message:
                'FRAMEWORK VIOLATION: Framework cannot import @gears-frontx/react (circular dependency).',
            },
            {
              group: ['react', 'react-dom', 'react/*'],
              message:
                'FRAMEWORK VIOLATION: Framework cannot import React.',
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

  // React package: Allow unknown types for hook generics
  // Layer enforcement: React must import from @gears-frontx/framework, not SDK packages directly
  {
    files: ['packages/react/**/*.ts', 'packages/react/**/*.tsx'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-empty-object-type': 'off', // Allow empty EventPayloadMap for module augmentation
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/state', '@gears-frontx/state/*'],
              message:
                'REACT VIOLATION: Import from @gears-frontx/framework instead.',
            },
            {
              group: ['@gears-frontx/mfes', '@gears-frontx/mfes/*', '@gears-frontx/gts-plugin', '@gears-frontx/gts-plugin/*'],
              message:
                'REACT VIOLATION: Import from @gears-frontx/framework instead.',
            },
            {
              group: ['@gears-frontx/api', '@gears-frontx/api/*'],
              message:
                'REACT VIOLATION: Import from @gears-frontx/framework instead.',
            },
            {
              group: ['@gears-frontx/i18n', '@gears-frontx/i18n/*'],
              message:
                'REACT VIOLATION: Import from @gears-frontx/framework instead.',
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

  // ============ @gears-frontx/frontx-template-shell (package root, src/) ============
  // Allow unknown/object types: build utilities (mf-gts.ts AST transforms, lazy-import-transform)
  // use unknown for dynamic module shapes and generic AST node types — architecturally required.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // Layout components: Allow unknown types for API registry type assertions
  {
    files: ['src-app/layout/**/*.tsx', 'src-app/layout/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        // Keep flux/lodash rules but remove TSUnknownKeyword restriction
        {
          selector: "CallExpression[callee.name='dispatch'] > MemberExpression[object.name='store']",
          message: 'FLUX VIOLATION: Components must not call store.dispatch directly. Use actions instead.',
        },
      ],
    },
  },

  // MFE packages: Each MFE is fully self-contained — no imports from host or other MFEs
  {
    files: ['src-app/mfe_packages/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../app/*', '../../app/**'],
              message:
                'MFE VIOLATION: MFE packages cannot import from the host app. MFEs must be self-contained.',
            },
            {
              group: ['../*-mfe/*', '../*-mfe/**', '../_*/*', '../_*/**'],
              message:
                'MFE VIOLATION: MFE packages cannot import from other MFE packages. Each MFE must be self-contained.',
            },
          ],
        },
      ],
    },
  },

  // App: Layer enforcement for src-app/app/** (must use @gears-frontx/react, not L1/L2 packages)
  {
    files: ['src-app/app/**/*.{ts,tsx}'],
    rules: {
      // Use @typescript-eslint rule to catch TypeScript-specific imports (import type, side-effect imports)
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/framework', '@gears-frontx/framework/*'],
              message:
                'LAYER VIOLATION: App-layer code must import from @gears-frontx/react, not directly from @gears-frontx/framework (Layer 2).',
            },
            {
              group: ['@gears-frontx/state', '@gears-frontx/state/*'],
              message:
                'LAYER VIOLATION: App-layer code must import from @gears-frontx/react, not directly from @gears-frontx/state (Layer 1).',
            },
            {
              group: ['@gears-frontx/api', '@gears-frontx/api/*'],
              message:
                'LAYER VIOLATION: App-layer code must import from @gears-frontx/react, not directly from @gears-frontx/api (Layer 1).',
            },
            {
              group: ['@gears-frontx/i18n', '@gears-frontx/i18n/*'],
              message:
                'LAYER VIOLATION: App-layer code must import from @gears-frontx/react, not directly from @gears-frontx/i18n (Layer 1).',
            },
            {
              group: ['@gears-frontx/mfes', '@gears-frontx/mfes/*', '@gears-frontx/gts-plugin', '@gears-frontx/gts-plugin/*'],
              message:
                'LAYER VIOLATION: App-layer code must import from @gears-frontx/react, not directly from @gears-frontx/mfes (Layer 1).',
            },
            // Redux term bans - use FrontX state terms instead
            {
              group: ['react-redux'],
              importNames: ['useDispatch'],
              message:
                'REDUX VIOLATION: Do not use useDispatch from react-redux. Use useAppDispatch from @gears-frontx/react instead.',
            },
            {
              group: ['react-redux'],
              importNames: ['useSelector'],
              message:
                'REDUX VIOLATION: Do not use useSelector from react-redux. Use useAppSelector from @gears-frontx/react instead.',
            },
          ],
        },
      ],
    },
  },

  // App: Studio should only be imported via FrontXProvider (auto-detection)
  // Only App.tsx variants are allowed to import StudioOverlay directly
  {
    files: ['src-app/**/*'],
    ignores: [
      'src-app/app/App.tsx', // Monorepo demo app - renders StudioOverlay
      'src-app/app/App.no-uikit.tsx', // --uikit none variant - renders StudioOverlay
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gears-frontx/studio', '@gears-frontx/studio/**'],
              message:
                'STUDIO VIOLATION: Studio should not be imported directly in app code. FrontXProvider auto-detects and loads Studio in development mode.',
            },
          ],
        },
      ],
    },
  },
];
