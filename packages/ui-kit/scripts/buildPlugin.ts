import fs from 'node:fs';
import path from 'node:path';
import MagicString from 'magic-string';
import nodeExternals from 'rollup-plugin-node-externals';
import type { Plugin, PluginOption, UserConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { libInjectCss } from 'vite-plugin-lib-inject-css';

/**
 * Vite library-mode build: one entry per component (globbed from
 * src/components/*'/public.ts) plus the src/index.ts barrel, each emitting
 * its own JS chunk and — via libInjectCss — its own CSS. This is what lets a
 * consumer's bundler drop both the JS and the CSS of any component it never
 * imports, including through the barrel (see src/index.ts's comment). Modeled
 * on Constructor's internal react-kit (scripts/buildPlugin.ts there); see
 * design-notes.md's Architecture section for what carries over and what
 * doesn't.
 */
export function buildPlugin(): PluginOption[] {
  return [
    // Externalizes `dependencies`/`peerDependencies` (@base-ui/react, CVA,
    // react, react-dom, and subpaths like react/jsx-runtime) instead of
    // tsup's hand-maintained `external` array — anything not declared as a
    // dependency gets inlined, anything declared stays an import statement.
    nodeExternals(),
    // Vite's lib mode emits each entry's CSS as a plain asset but does not
    // wire it back into that entry's JS — there's no HTML entry to do it via
    // <link>, unlike a normal app build. This plugin rewrites each chunk to
    // `import './chunk.css'` when Vite extracted CSS from that chunk's
    // module graph, which is what makes per-entry (not per-package) CSS
    // possible at all.
    libInjectCss(),
    buildEntries(),
    preserveUseClientPlugin(),
    dts({
      outDir: 'dist',
      entryRoot: 'src',
      // tsconfig.src.json already excludes *.test.ts(x)/*.spec.ts(x) and sets
      // rootDir/outDir/declaration for this package (see tsconfig.src.json),
      // so it doubles as the build project - no separate tsconfig.build.json
      // like react-kit's, because nothing else (dev server, Storybook) shares
      // it with incompatible settings. The root tsconfig.json is a
      // references-only solution file that carries none of these options.
      tsconfigPath: 'tsconfig.src.json',
      // *.test.*/*.spec.* keep test files themselves out of dist/; separately,
      // __test-utils__ (vitest setup, not a build entry, not test-file-named)
      // isn't caught by that pattern and shipped in the tarball until this was
      // added — glob it out explicitly rather than letting the exclude list's
      // apparent coverage stay incomplete.
      exclude: ['src/**/*.test.*', 'src/**/*.spec.*', 'src/__test-utils__/**'],
      afterBuild,
    }),
  ];

  /**
   * vite-plugin-dts mirrors source layout under dist/ (a component's types
   * land at dist/components/<name>/public.d.ts, next to where its .tsx
   * source lived). The `./*` wildcard export needs a flat dist/<name>.d.ts
   * per component, matching the flat dist/<name>.js chunk emitted for that
   * same entry — write that one-line re-export shim here, the same trick
   * react-kit's buildPlugin.ts uses for its own (deeper) entries/ layout.
   */
  function afterBuild(emittedFiles: Map<string, string>) {
    const distDir = path.resolve('dist');

    for (const filename of Array.from(emittedFiles.keys())) {
      if (!filename.endsWith('/public.d.ts')) {
        continue;
      }

      const entryPath = path.relative(distDir, filename);
      // Explicit .js extension: this specifier lands verbatim in a shipped
      // .d.ts, and moduleResolution: "nodenext" (unlike our own "bundler")
      // rejects an extensionless relative specifier in ESM declarations —
      // every symbol goes invisible under nodenext without it. See the same
      // note on src/index.ts, which needed the identical fix.
      const content = `export * from './${entryPath.replace(/\.d\.ts$/, '.js')}'`;
      const entryName = entryPath.replace(/^components\//, '').replace(/\/public\.d\.ts$/, '');

      fs.writeFileSync(path.resolve(distDir, `${entryName}.d.ts`), content, 'utf-8');
    }
  }

  function buildEntries(): Plugin {
    return {
      name: 'ui-kit-build-entries',
      apply: 'build',
      config() {
        return getBuildConfig();
      },
      closeBundle(error) {
        if (error) {
          return;
        }

        // Design tokens are plain CSS (not a module) and must ship as a
        // separate, consumer-importable file — Vite's lib build only emits
        // CSS that JS actually imports, and theme.css is deliberately never
        // imported by JS (see design-notes.md's Architecture section).
        // utilities.css (scroll-fade/shimmer/no-scrollbar) and typeset.css
        // (the prose stylesheet) are the same kind of file — global CSS no
        // component ever `import`s from JS — so they ship the same way,
        // alongside theme.css rather than folded into it: a consumer who
        // only wants tokens (or only wants the utilities, or only Typeset)
        // can import just that file instead of paying for all three. The
        // per-component usage docs ship under dist/docs/ so agents can read
        // them from node_modules via llms.txt.
        fs.copyFileSync('src/styles/theme.css', 'dist/theme.css');
        fs.copyFileSync('src/styles/utilities.css', 'dist/utilities.css');
        fs.copyFileSync('src/styles/typeset.css', 'dist/typeset.css');
        fs.mkdirSync('dist/docs', { recursive: true });
        // src/styles/*.md alongside the per-component ones: typeset.md
        // documents a shipped stylesheet the same way a component doc
        // documents a component, and llms.txt links it from the same
        // dist/docs/ path.
        for (const file of [
          ...fs.globSync('src/components/*/*.md'),
          ...fs.globSync('src/styles/*.md'),
        ]) {
          fs.copyFileSync(file, path.join('dist/docs', path.basename(file)));
        }
      },
    };
  }

  /**
   * Rollup strips a source module's `'use client'` directive prologue when it
   * renders that module's code into a bundled chunk. Vite transpiles each
   * TS/TSX module through esbuild individually (strip types, downlevel syntax)
   * before Rollup ever bundles them, and esbuild's per-file transpile preserves
   * a directive prologue verbatim — so the directive survives that step but not
   * Rollup's own bundling step, which strips it when inlining the module's code
   * into a shared chunk, so it never reaches dist/ without this plugin.
   * `rollup-plugin-preserve-directives` (the community-standard fix) only
   * re-adds directives under `output.preserveModules: true`, which emits one
   * file per source module and would break the one-chunk-per-component shape
   * this build already has (getBuildConfig's `lib.entry` + `treeshake`
   * combination — see that comment) — so this does the same job at this build's
   * actual chunk granularity: remember which source module declared the
   * directive, then re-add it to whichever chunk that module's code lands in.
   *
   * A chunk earns the banner if ANY of its modules declared it — the
   * source directive is the only input, so this plugin never needs a list
   * of component names to keep current (src/client-boundaries.test.ts is
   * what keeps the lists that DO exist, in verify-consumer.sh and the
   * docs, honest against those same directives). A component that merely
   * renders a Base UI primitive as JSX (Button, Dialog, Select, …) does not
   * need the directive on its own chunk: Base UI's own dist already
   * carries 'use client' on the modules that call hooks, so composing them
   * is safe as a Server Component and stays server-renderable — marking it
   * here anyway would take that away for no reason.
   */
  function preserveUseClientPlugin(): Plugin {
    const USE_CLIENT = "'use client';";
    // Matches the directive once the leading whitespace/comment run has
    // already been stripped by `hasLeadingUseClientDirective` below — this
    // regex itself is deliberately trivial (no repetition, no ambiguity).
    const directiveRe = /^['"]use client['"];?/;
    const clientModuleIds = new Set<string>();

    /**
     * Do NOT collapse this loop back into a single regex. The obvious form —
     * `/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"];?/` — is a
     * textbook catastrophic-backtracking (ReDoS) shape: a `*`-repeated
     * alternation where one branch (`\/\*[\s\S]*?\*\/`) itself contains an
     * unbounded lazy quantifier. On input with FEW leading comment blocks
     * (most component .tsx files: one header comment, then code) the engine
     * fails fast. On input with MANY of them — this kit's own CSS Modules
     * files, commented block-by-block throughout; sidebar.module.css alone
     * carries 59 separate block comments and hangs a single `.test()` call
     * past 5 seconds — the number of ways to partition that leading run
     * before concluding "no directive here" grows combinatorially with the
     * comment-block count. `transform` runs this check on every one of the
     * package's ~65 components' CSS modules, which is enough to turn
     * `vite build` from roughly a minute into effectively unbounded.
     *
     * This is instead the fast path bash's own `verify-consumer.sh` already
     * uses for the same "what is the file's first real statement" question
     * (`has_client_directive`'s awk skip-loop), generalized here to also
     * skip a genuine MULTI-line block comment (bash's version only skips a
     * comment that opens and closes on one line): strip one leading
     * whitespace run, `//` line comment, or `/* ... *\/` block comment at a
     * time, left to right, until none of the three match at the current
     * position — each step consumes a strictly non-empty prefix (so this
     * always terminates in at most `code.length` steps) and each step's own
     * regex has no repeated/ambiguous quantifier to backtrack through, so
     * total cost is linear in the comment/whitespace run's length, not
     * combinatorial in how many comment blocks it contains.
     */
    function hasLeadingUseClientDirective(code: string): boolean {
      let rest = code;
      for (;;) {
        const whitespace = /^\s+/.exec(rest);
        if (whitespace) {
          rest = rest.slice(whitespace[0].length);
          continue;
        }
        const lineComment = /^\/\/[^\n]*/.exec(rest);
        if (lineComment) {
          rest = rest.slice(lineComment[0].length);
          continue;
        }
        const blockComment = /^\/\*[\s\S]*?\*\//.exec(rest);
        if (blockComment) {
          rest = rest.slice(blockComment[0].length);
          continue;
        }
        break;
      }
      return directiveRe.test(rest);
    }

    return {
      name: 'ui-kit-preserve-use-client',
      apply: 'build',
      transform(code, id) {
        if (hasLeadingUseClientDirective(code)) {
          clientModuleIds.add(id);
        }
        return null;
      },
      renderChunk(code, chunk) {
        // Rollup has always already stripped the source directive by this
        // point (that's the whole problem this plugin exists to fix) — the
        // `directiveRe` check is a no-op today, kept only as a cheap guard
        // against double-prepending if a future Rollup/Vite version stops
        // stripping it. Reuses `directiveRe` (rather than a plain
        // `startsWith(USE_CLIENT)`) so this guard tolerates the same quote
        // styles the detection above does.
        if (directiveRe.test(code) || !chunk.moduleIds.some((id) => clientModuleIds.has(id))) {
          return null;
        }

        const magicString = new MagicString(code);
        magicString.prepend(`${USE_CLIENT}\n`);
        return { code: magicString.toString(), map: magicString.generateMap({ hires: true }) };
      },
    };
  }

  function getBuildConfig(): UserConfig {
    const entries = fs
      .globSync('src/components/*/public.ts')
      .map((file) => [path.basename(path.dirname(file)), file]);

    return {
      build: {
        sourcemap: true,
        lib: {
          entry: {
            index: 'src/index.ts',
            ...Object.fromEntries(entries),
          },
          formats: ['es'],
        },
        rollupOptions: {
          // Only CSS is presumed to have side effects. This is NOT what
          // splits components into their own chunks — that comes from
          // having one lib.entry per component regardless of this option;
          // measured directly (build with this option removed): Rollup
          // still emits one physical chunk per component, just behind an
          // extra 2-line re-export shim (dist/button.js becomes
          // `export { B as Button } from "./chunks/button.js"` instead of
          // containing Button's code itself), and the consumer-facing
          // bundle is unchanged. What this option actually buys: it
          // flattens that indirection away, so a component's code lands
          // directly in dist/<name>.js — which is what the `./*` export and
          // verify-consumer.sh's hashed-class probes (which grep
          // dist/<name>.js directly, not a chunks/ subpath) depend on. See
          // package.json's `sideEffects` for the shipped-side counterpart of
          // the same CSS-only-side-effects policy.
          treeshake: {
            moduleSideEffects: (id) => id.endsWith('.css'),
          },
          output: {
            chunkFileNames: 'chunks/[name].js',
            assetFileNames: 'chunks/[name].[hash][extname]',
          },
        },
      },
    };
  }
}
