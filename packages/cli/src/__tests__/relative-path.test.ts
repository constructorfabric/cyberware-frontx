// The semantics of the path-shape predicates in `paths/relative-path.ts`, stated
// directly rather than through the assembler, the conflict check and the
// manifest validator that call them. Those three cover the predicates on the
// inputs they happen to pass; this file fixes the rule itself, including the
// normalizations it deliberately does NOT perform — a caller reading only the
// consumers cannot tell an unhandled spelling from a handled one.
import { describe, it, expect } from 'vitest';
import { pathWithinSubtree, pathsNest, pathWithinTarget, targetsNest } from '../paths/relative-path';

describe('pathWithinSubtree — containment by whole path segments', () => {
  it.each([
    // A subtree contains itself, under either spelling of the declaration.
    { path: 'src', subtree: 'src', within: true },
    { path: 'src/', subtree: 'src', within: true },
    { path: 'src', subtree: 'src/', within: true },
    { path: 'src/', subtree: 'src/', within: true },
    // Descendants, at one level and deeper.
    { path: 'src/main.ts', subtree: 'src', within: true },
    { path: 'src/main.ts', subtree: 'src/', within: true },
    { path: 'src/config/deep/app.ts', subtree: 'src', within: true },
    // A single declared file behaves as its own ground.
    { path: 'package.json', subtree: 'package.json', within: true },
    // Siblings whose names merely extend the declaration: the whole point of the
    // segment rule, and what a bare string prefix gets wrong.
    { path: 'src-app/main.ts', subtree: 'src', within: false },
    { path: 'srcx.ts', subtree: 'src', within: false },
    { path: 'package-lock.json', subtree: 'package.json', within: false },
    { path: 'README.md.bak', subtree: 'README.md', within: false },
    // Ancestors are not inside their descendants — containment is one-way.
    { path: 'src', subtree: 'src/config', within: false },
    // Unrelated paths.
    { path: 'docs/index.md', subtree: 'src', within: false },
    // An empty declaration captures no real content path — not even the
    // repository root. A bare prefix test would have it capture everything.
    { path: 'src/main.ts', subtree: '', within: false },
    // Reflexivity on two raw equal strings, and nothing more: this predicate is
    // a containment primitive and does not judge whether its arguments are
    // well-formed declarations. It is also unreachable — the manifest contract
    // rejects an empty declaration, and no content item has an empty path — and
    // the caller for which an empty value IS a declaration (`pathsNest`) settles
    // this pair on its own equality test without ever reaching here.
    { path: '', subtree: '', within: true },
    // A doubled separator is not collapsed, and the two sides of the comparison
    // are affected differently. On the PATH side leniency is harmless and
    // arguably right — `src//main.ts` names the same file as `src/main.ts`, which
    // is inside `src`. On the SUBTREE side only one trailing slash is stripped,
    // so a declaration written `src//` captures nothing at all, including the
    // directory it was meant to name. Neither is repaired here: this predicate
    // would then be a second authority on what a declared path means, after the
    // manifest contract that admitted the spelling (degenerate declarations are
    // issue #546's ground). `pathsNest` is where that shape stops producing a
    // verdict against a DISTINCT claim, because there both sides are
    // declarations.
    { path: 'src//main.ts', subtree: 'src', within: true },
    { path: 'src/main.ts', subtree: 'src//', within: false },
    { path: 'src/', subtree: 'src//', within: false },
    // Deliberately NOT normalized: a backslash is a literal character in a
    // repository-relative path here, never a separator.
    { path: 'src\\main.ts', subtree: 'src', within: false },
  ])('places "$path" within "$subtree": $within', ({ path, subtree, within }) => {
    expect(pathWithinSubtree(path, subtree)).toBe(within);
  });
});

describe('pathsNest — containment asked in both directions', () => {
  it.each([
    { a: 'src', b: 'src', nest: true },
    { a: 'src', b: 'src/', nest: true },
    { a: 'src/', b: 'src', nest: true },
    { a: 'src', b: 'src/config', nest: true },
    { a: 'src/config', b: 'src', nest: true },
    { a: 'src/', b: 'src/config/deep/', nest: true },
    { a: 'src', b: 'src-app', nest: false },
    { a: 'src/', b: 'src-app/', nest: false },
    { a: 'src', b: 'srcx.ts', nest: false },
    { a: 'docs/', b: 'src/', nest: false },
    // A declaration addressing no location nests with no DISTINCT claim, in
    // either position. `src//` is the case that matters: it reads as a near-miss
    // for `src`, and treating it as one would refuse an assembly over a claim the
    // assembler hands no file for — a refusal with no ground under it. Empty and
    // slash-only values answer the same way for the same reason.
    { a: 'src//', b: 'src', nest: false },
    { a: 'src', b: 'src//', nest: false },
    { a: 'src//', b: 'src/', nest: false },
    { a: '', b: 'src', nest: false },
    // Two identical claims are one declaration written by two templates, which
    // is a contest whatever it addresses. Answering false here would admit an
    // assembly that then contributes no file for either template while recording
    // ownership for both.
    { a: 'src//', b: 'src//', nest: true },
    { a: '', b: '', nest: true },
    { a: '/', b: 'src', nest: false },
    { a: '//', b: 'src', nest: false },
    // Template identities, the other caller: a scoped identity and one nested
    // under it occupy nested directories in the inventory root.
    { a: '@acme/tools', b: '@acme/tools/extra', nest: true },
    { a: '@acme/tools', b: '@acme/toolsx', nest: false },
  ])('reports "$a" and "$b" as nesting: $nest', ({ a, b, nest }) => {
    expect(pathsNest(a, b)).toBe(nest);
  });

  it('is symmetric for every pair the consumers can hand it', () => {
    const paths = ['src', 'src/', 'src//', 'src/config', 'src-app/', 'srcx.ts', '', '/', 'package.json', '@acme/tools'];

    const asymmetric = paths.flatMap((a) =>
      paths.filter((b) => pathsNest(a, b) !== pathsNest(b, a)).map((b) => `${a} vs ${b}`),
    );

    expect(asymmetric).toEqual([]);
  });
});

describe('pathWithinTarget / targetsNest — the root-aware counterparts for concrete TARGETS', () => {
  // A concrete applied target, unlike a declaration such as `excludedSubtrees`
  // or `projectOwnedRoots`, can legitimately be `.`, the project root — and a
  // project root contains every other well-formed relative path
  // unconditionally. `pathWithinSubtree`/`pathsNest` correctly do NOT grant
  // `.` this meaning (an empty or otherwise degenerate DECLARATION addresses
  // no location at all, which is the right behavior for a declaration); these
  // two are the one place that adds the target-specific exception.

  it('treats "." as containing every other path, unlike pathWithinSubtree', () => {
    expect(pathWithinTarget('src/index.ts', '.')).toBe(true);
    expect(pathWithinSubtree('src/index.ts', '.')).toBe(false);
  });

  it('still defers to pathWithinSubtree for a non-root target', () => {
    expect(pathWithinTarget('packages/app/src', 'packages/app')).toBe(true);
    expect(pathWithinTarget('packages/other', 'packages/app')).toBe(false);
  });

  it('"." nests with every other target, unlike pathsNest', () => {
    expect(targetsNest('.', 'packages/app')).toBe(true);
    expect(targetsNest('packages/app', '.')).toBe(true);
    expect(pathsNest('.', 'packages/app')).toBe(false);
  });

  it('two non-root targets still defer to pathsNest for coincidence/nesting', () => {
    expect(targetsNest('packages/app', 'packages/app/src')).toBe(true);
    expect(targetsNest('packages/app', 'packages/app-shell')).toBe(false);
  });

  it('"." nests with itself', () => {
    expect(targetsNest('.', '.')).toBe(true);
  });
});
