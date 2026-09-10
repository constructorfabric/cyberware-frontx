// Fixture coverage for the nesting-aware pre-flight conflict check
// (`cpt-frontx-algo-cli-scaffolding-conflict-check`) against a FAKE
// `CanonicalizeTargetFn` seam — every branch of the pure geometry, decoupled
// from any real filesystem. The real `CanonicalizeTargetFn` adapter
// (`createFsCanonicalizeTargetFn`) has its own real-fs suite, including the
// symlink-escape case a fake seam cannot honestly exercise
// (`../adapters/__tests__/fs-canonicalize-target.test.ts`).
import { describe, it, expect } from 'vitest';
import { checkTargetConflicts } from '../scaffold/conflict-check';
import type { CanonicalizeTargetFn, TargetClaim } from '../scaffold/conflict-check';

// The fake seam every test below uses unless it exercises `INVALID_PATH`
// itself: every fixture in this suite is already a well-formed
// project-relative POSIX path, so canonicalization is the identity.
const identityCanonicalize: CanonicalizeTargetFn = (rawTarget) => rawTarget;

function claim(target: string, templateName: string | null, excludedSubtrees: string[] = []): TargetClaim {
  return { target, templateName, excludedSubtrees };
}

describe('checkTargetConflicts', () => {
  it('passes on an empty batch against an empty project', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [],
      recordedTargets: [],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({ ok: true });
  });

  it('treats an identical target re-staged by the SAME template as an idempotent no-op', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/auth', 'auth-template')],
      recordedTargets: [claim('packages/auth', 'auth-template')],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({ ok: true });
  });

  it('reports a conflict when an identical target is claimed by two DIFFERENT templates', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/auth', 'auth-template')],
      recordedTargets: [claim('packages/auth', 'other-template')],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'TARGET_CONFLICT',
      conflicts: [
        {
          ground: 'packages/auth',
          contestants: [
            { target: 'packages/auth', templateName: 'auth-template' },
            { target: 'packages/auth', templateName: 'other-template' },
          ],
        },
      ],
    });
  });

  // The whole reason `pathsNest`/`pathWithinSubtree` compare whole path
  // segments rather than a bare string prefix: these two share a string
  // prefix but no path segment, and are siblings, not ancestor/descendant.
  it('does NOT conflict on string-prefix-but-not-segment siblings (packages/app vs packages/app-shell)', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/app-shell', 'shell-template')],
      recordedTargets: [claim('packages/app', 'app-template')],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({ ok: true });
  });

  it('reports a conflict on an undeclared ancestor/descendant relationship between two templates', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/app/admin', 'admin-template')],
      recordedTargets: [claim('packages/app', 'app-template')],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'TARGET_CONFLICT',
      conflicts: [
        {
          ground: 'packages/app contains packages/app/admin',
          contestants: [
            { target: 'packages/app', templateName: 'app-template' },
            { target: 'packages/app/admin', templateName: 'admin-template' },
          ],
        },
      ],
    });
  });

  // The reverse of the previous test: here the STAGED template is the
  // ANCESTOR and the already-RECORDED template is the descendant. The
  // underlying geometry (`targetsNest`/`pathWithinTarget`) decides the
  // ancestor/descendant role from the target strings alone, never from which
  // side is staged, so this must refuse exactly as the other direction does
  // — proving `checkTargetConflicts` (still shared, unmodified, by
  // `ownership add`) stays both-directions-aware for assemble/apply, which
  // is load-bearing there (a staged batch must never be admitted merely
  // because IT happens to be the ancestor of ground already applied).
  it('reports a conflict when the STAGED target is the ANCESTOR of an already-recorded descendant target', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/app', 'app-template')],
      recordedTargets: [claim('packages/app/admin', 'admin-template')],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'TARGET_CONFLICT',
      conflicts: [
        {
          ground: 'packages/app contains packages/app/admin',
          contestants: [
            { target: 'packages/app', templateName: 'app-template' },
            { target: 'packages/app/admin', templateName: 'admin-template' },
          ],
        },
      ],
    });
  });

  it('permits the same ancestor/descendant nesting when the descendant lies inside the ancestor template\'s declared excludedSubtrees', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/app/admin', 'admin-template')],
      recordedTargets: [claim('packages/app', 'app-template', ['packages/app/admin/'])],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({ ok: true });
  });

  // The prior test's descendant IS the declared excludedSubtrees entry
  // itself; this one is a descendant strictly FURTHER inside it — both are
  // "at or inside" per `pathWithinSubtree`, not only the exact-match case.
  it('permits nesting when the descendant is further inside the declared excludedSubtrees entry, not just equal to it', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/app/admin/deep', 'admin-template')],
      recordedTargets: [claim('packages/app', 'app-template', ['packages/app/admin/'])],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({ ok: true });
  });

  it('reports a conflict when the target under check lands inside a projectOwnedRoots entry', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('docs/internal', 'docs-template')],
      recordedTargets: [],
      projectOwnedRoots: ['docs'],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'TARGET_CONFLICT',
      conflicts: [
        {
          ground: 'projectOwnedRoots: docs',
          contestants: [{ target: 'docs/internal', templateName: 'docs-template' }],
        },
      ],
    });
  });

  // Regression: this reserved-ground check used to test containment with the
  // bare `pathWithinSubtree`, while `scaffold/effective-ownership.ts`
  // subtracts the SAME list with `pathWithinTarget`. The two disagree on
  // exactly one reachable input — a reserved path spelled `.` — and
  // `projectOwnedRoots` genuinely can hold `.` (`ownership add .` is
  // legitimate on a project with no applied target yet). With the old
  // predicate this check passed, and effective ownership then subtracted the
  // whole project: `apply` reported success, wrote zero files, and recorded
  // the target anyway. One predicate for one list is what makes the check
  // and the subtraction agree by construction.
  it('reports a conflict when projectOwnedRoots holds the project root itself, for a target anywhere beneath it', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/app', 'app-template')],
      recordedTargets: [],
      projectOwnedRoots: ['.'],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'TARGET_CONFLICT',
      conflicts: [
        {
          ground: 'projectOwnedRoots: .',
          contestants: [{ target: 'packages/app', templateName: 'app-template' }],
        },
      ],
    });
  });

  it('reports a conflict when the target under check lands inside .frontx', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('.frontx/ai/rogue', 'rogue-template')],
      recordedTargets: [],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'TARGET_CONFLICT',
      conflicts: [
        {
          ground: '.frontx',
          contestants: [{ target: '.frontx/ai/rogue', templateName: 'rogue-template' }],
        },
      ],
    });
  });

  it('reports a conflict when the target under check lands inside a caller-supplied local origin folder', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('vendor/my-template-source/extra', 'consumer-template')],
      recordedTargets: [],
      projectOwnedRoots: [],
      localOriginFolders: ['vendor/my-template-source'],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'TARGET_CONFLICT',
      conflicts: [
        {
          ground: 'local origin folder: vendor/my-template-source',
          contestants: [{ target: 'vendor/my-template-source/extra', templateName: 'consumer-template' }],
        },
      ],
    });
  });

  it('reports a conflict when the target under check coincides with a reserved environment entry', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('.git', 'rogue-template')],
      recordedTargets: [],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'TARGET_CONFLICT',
      conflicts: [
        {
          ground: '.git',
          contestants: [{ target: '.git', templateName: 'rogue-template' }],
        },
      ],
    });
  });

  it('reports a conflict when the target under check lands INSIDE a reserved environment entry', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('.git/hooks', 'rogue-template')],
      recordedTargets: [],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result.ok).toBe(false);
  });

  // The REVERSE direction — a projectOwnedRoots entry or a local origin
  // folder landing inside the target under check — is a permitted
  // subtraction, never a conflict, in contrast to every case above.
  it('does NOT conflict when a projectOwnedRoots entry lands INSIDE the target under check (reverse containment)', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('.', 'root-template')],
      recordedTargets: [],
      projectOwnedRoots: ['docs'],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({ ok: true });
  });

  it('does NOT conflict when a local origin folder lands INSIDE the target under check (reverse containment)', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('.', 'root-template')],
      recordedTargets: [],
      projectOwnedRoots: [],
      localOriginFolders: ['vendor/my-template-source'],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({ ok: true });
  });

  // `.frontx` and the reserved environment entries sitting INSIDE a target
  // under check are likewise no conflict — an ordinary root-level target
  // contains both, and whole-target ownership subtracts them unconditionally
  // regardless of what this checker does.
  it('does NOT conflict when a root-level target under check contains .frontx and .git', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('.', 'root-template')],
      recordedTargets: [],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result).toEqual({ ok: true });
  });

  it('returns INVALID_PATH, naming the unresolvable path, when the canonicalize seam cannot prove containment', () => {
    const rejectEscape: CanonicalizeTargetFn = (rawTarget) => (rawTarget.startsWith('../') ? null : rawTarget);

    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('../escape', 'rogue-template')],
      recordedTargets: [],
      projectOwnedRoots: [],
      canonicalizeFn: rejectEscape,
    });

    expect(result).toEqual({ ok: false, kind: 'INVALID_PATH', path: '../escape' });
  });

  // `.` (the project root) is a legitimate target — `apply`/`seed` may
  // apply a template AT the project root, and `delete-plan`'s own spec text
  // uses exactly this example. It is spelled `.` by the real canonicalize
  // adapter, never `""` (`""` is reserved for what every containment
  // predicate this algorithm calls already treats as a DECLARATION
  // addressing no location at all — a target claim must never share that
  // spelling, confirmed live: an unadorned `.` used to sail through the OLD
  // `""`-spelled representation as if it contested nothing, then land in
  // `projectOwnedRoots` unremovable). Root correctly conflicts with
  // anything already applied, because it is an ancestor of everything.
  it('treats the project root as an ancestor of every applied target, not an invalid or inert claim', () => {
    const identity: CanonicalizeTargetFn = (rawTarget) => rawTarget;

    const result = checkTargetConflicts({
      targetsUnderCheck: [{ target: '.', templateName: null, excludedSubtrees: [] }],
      recordedTargets: [claim('packages/app', 'app-template')],
      projectOwnedRoots: [],
      canonicalizeFn: identity,
    });

    expect(result).toMatchObject({ ok: false, kind: 'TARGET_CONFLICT' });
  });

  it('the project root succeeds as a target when nothing is applied yet', () => {
    const identity: CanonicalizeTargetFn = (rawTarget) => rawTarget;

    const result = checkTargetConflicts({
      targetsUnderCheck: [{ target: '.', templateName: null, excludedSubtrees: [] }],
      recordedTargets: [],
      projectOwnedRoots: [],
      canonicalizeFn: identity,
    });

    expect(result).toEqual({ ok: true });
  });

  it('a sibling of the project root string-prefix-wise ("..") is never confused for it', () => {
    const identity: CanonicalizeTargetFn = (rawTarget) => rawTarget;

    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/app', 'new-template')],
      recordedTargets: [{ target: '.', templateName: 'shell-template', excludedSubtrees: ['packages/'] }],
      projectOwnedRoots: [],
      canonicalizeFn: identity,
    });

    // Permitted: the root's own template declared `packages/` excluded,
    // carving out exactly this nested ground for another template.
    expect(result).toEqual({ ok: true });
  });

  // `ownership add`'s candidate carries no template name at all — a bare
  // `projectOwnedRoots` addition, not a template claim. It still runs
  // through the identical geometry: refused when it coincides with or
  // contains an applied target (DESIGN §3.2's "refused when that path
  // coincides with or is an ancestor of any applied target").
  it('refuses an ownership-add candidate (no template name) that is an ANCESTOR of an applied target', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages', null)],
      recordedTargets: [claim('packages/app', 'app-template')],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'TARGET_CONFLICT') {
      expect(result.conflicts).toEqual([
        {
          ground: 'packages contains packages/app',
          contestants: [
            { target: 'packages', templateName: null },
            { target: 'packages/app', templateName: 'app-template' },
          ],
        },
      ]);
    }
  });

  it('refuses an ownership-add candidate (no template name) that coincides with an applied target', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/app', null)],
      recordedTargets: [claim('packages/app', 'app-template')],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result.ok).toBe(false);
  });

  it('collects every conflict in one refusal report rather than short-circuiting on the first', () => {
    const result = checkTargetConflicts({
      targetsUnderCheck: [claim('packages/app', 'app-template'), claim('.git', 'app-template')],
      recordedTargets: [claim('packages/app', 'other-template')],
      projectOwnedRoots: [],
      canonicalizeFn: identityCanonicalize,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'TARGET_CONFLICT') {
      expect(result.conflicts).toHaveLength(2);
    }
  });
});
