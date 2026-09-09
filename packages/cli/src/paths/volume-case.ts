// @cpt-constraint:cpt-frontx-constraint-cli-platform-path-identity:p1
//
// Whether the volume backing a path folds case for identity purposes: on
// macOS (APFS) and Windows (NTFS), the platforms this package supports
// besides Linux, `docs` and `Docs` name the SAME on-disk entry; on Linux
// (ext4) they name two independent ones. `paths/relative-path.ts`'s
// containment predicates (`pathWithinSubtree`, `pathsNest`) and
// `adapters/fs-project-io.ts`'s `isInside` all decide "is this the same
// ground, or does one contain the other" against a project-relative path a
// developer or a template author spelled, sometimes for ground that does
// not exist on disk yet (a batch's own not-yet-created targets) — nothing
// `fs.realpathSync`/`fs.realpathSync.native` can canonicalize into one
// spelling, since there is no on-disk entry yet to canonicalize AGAINST.
// This module is the one place that decides the fact those predicates fold
// on: never guessed from `process.platform` (a case-sensitive volume can be
// mounted on any OS, and vice versa), decided instead by a real, cheap
// filesystem probe.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Decided once per process and never re-probed: every path comparison this
// package makes within one invocation must agree on the same answer, and a
// CLI invocation is short-lived enough that the volume cannot change under
// it. `undefined` means "not yet probed" - distinct from a cached `false`.
let cachedCaseInsensitive: boolean | undefined;

/**
 * Whether the volume holding `probeDir` folds case for path identity. The
 * default is the working directory, never the OS temp directory: the CLI
 * always operates on the project the developer is standing in, and a repo
 * on a case-sensitive volume mounted under a case-insensitive `/tmp` (or
 * the reverse) would otherwise settle this process on the answer for a
 * volume none of its paths live on. Callers holding the resolved project
 * root pass it explicitly, which is strictly better still. Memoized process-wide on first call - a
 * later call with a different `probeDir` still returns the FIRST answer,
 * per this module's own header comment on why one process settles on one
 * answer. Creates and removes one uniquely-named marker file inside
 * `probeDir`, comparing the marker's lower- and upper-case spellings by
 * device and inode rather than by a second `existsSync` (which would prove
 * only that SOME entry answers to that name, not that it is the SAME
 * entry the marker created - two colliding names on a case-SENSITIVE
 * volume would otherwise read as one).
 *
 * Falls back to the CONSERVATIVE answer (case-insensitive) when the probe
 * itself cannot run at all — a read-only `probeDir`, most commonly — so an
 * undetectable volume is treated as one where two spellings collide and are
 * refused, never as one where they are silently accepted as independent.
 */
export function isVolumeCaseInsensitive(probeDir: string = process.cwd()): boolean {
  if (cachedCaseInsensitive !== undefined) return cachedCaseInsensitive;
  cachedCaseInsensitive = probeVolumeCaseInsensitive(probeDir);
  return cachedCaseInsensitive;
}

function probeVolumeCaseInsensitive(probeDir: string): boolean {
  const marker = `frontx-case-probe-${process.pid}-${crypto.randomUUID().replace(/-/g, '')}`;
  const lowerPath = path.join(probeDir, marker.toLowerCase());
  const upperPath = path.join(probeDir, marker.toUpperCase());
  try {
    fs.writeFileSync(lowerPath, '');
    try {
      const lowerStat = fs.statSync(lowerPath);
      const upperStat = fs.statSync(upperPath);
      return lowerStat.dev === upperStat.dev && lowerStat.ino === upperStat.ino;
    } catch {
      return false; // the flipped spelling names no entry at all: a case-sensitive volume
    } finally {
      fs.rmSync(lowerPath, { force: true });
    }
  } catch {
    return true; // the probe itself could not run: the conservative answer, see this function's own doc comment
  }
}

/**
 * The one ground-identity fold every path comparison in this package runs
 * both sides through before comparing: unchanged on a case-sensitive
 * volume, lower-cased on a case-insensitive one. Never call `.toLowerCase()`
 * directly on a path being compared for identity - that is the ONE
 * formulation this module exists to keep from drifting into two.
 */
export function foldForIdentity(value: string): string {
  return isVolumeCaseInsensitive() ? value.toLowerCase() : value;
}
