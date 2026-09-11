/**
 * How a repo-script finds this repo's templates.
 *
 * A template IS its manifest (ADR-0018): a directory counts as one by
 * carrying `frontx-template.json`, never by matching a `template-*` name
 * prefix. That distinction is load-bearing rather than stylistic - the #470
 * split renamed `template-standard/` to `template-shell/` and added
 * `template-mfe/`, and a name-prefix glob would have kept passing while
 * quietly covering nothing.
 *
 * Every CI guard that walks templates (`validate-templates.mjs`,
 * `template-pin-drift-check.mjs`, `version-bump-on-change-check.mjs`)
 * discovers them through this one function.
 * Two copies of the rule is how they would come to disagree about what a
 * template is - and a discovery rule that finds nothing reports as a pass in
 * every caller that forgets to check (CodeRabbit on #493, which found the
 * duplication).
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Mirrors `MANIFEST_FILENAME` (`packages/cli/src/manifest/types.ts`) - kept as
 * a local literal rather than an import so a repo-script keeps working
 * straight after `npm ci`, with no `build:packages:cli` prerequisite. Kept
 * honest by the sync-guard test in `template-pin-drift-check.test.mjs`, which
 * reads the canonical TypeScript declaration as text.
 */
export const MANIFEST_FILENAME = 'frontx-template.json';

/**
 * Every top-level directory at `rootDir` that carries `manifestFilename`,
 * sorted. `manifestFilename` is a parameter, not a hardcoded read of the
 * constant above, because `validate-templates.mjs` passes the value the built
 * CLI itself exports - so that guard checks the CLI's own idea of the filename
 * rather than a second copy of it.
 *
 * `node_modules` is the ONE exclusion (install-time output, never something
 * this repo's own tree defines). A dot-prefixed top-level directory (`.git`,
 * `.github`, `.cf-studio`, ...) is deliberately NOT excluded: filtering it out
 * would reintroduce exactly the naming assumption manifest-presence discovery
 * exists to drop, and the cost is one `existsSync` per top-level entry.
 *
 * @param {string} rootDir
 * @param {string} [manifestFilename]
 * @returns {string[]} absolute paths, sorted
 */
export function findTemplateDirs(rootDir, manifestFilename = MANIFEST_FILENAME) {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => path.join(rootDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, manifestFilename)))
    .sort();
}
