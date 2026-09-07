// @cpt-algo:cpt-frontx-algo-upgrade-changeset-validate:p1
//
// In-memory-harness suite for `validateUpgrade` (`../upgrade/validate.ts`),
// modeled on `upgrade-classify.test.ts`'s fixture style and
// `entry-flows.test.ts`'s `makeHarness()` shape — no real filesystem or
// network access anywhere in this suite. `classifyTarget` itself is
// exercised exhaustively by `upgrade-classify.test.ts`; these tests cover
// only what `validateUpgrade` adds on top of it: the ordering of its own
// refusals, the no-op short-circuit, and accumulating classification across
// every target before either conflict check runs.
import { describe, expect, it } from 'vitest';
import { validateUpgrade } from '../upgrade/validate';
import type { ValidateInput } from '../upgrade/validate';
import type { DiskEntry, ReadDiskEntryFn, ResolvedPayload, ResolvePayloadResult } from '../upgrade/types';
import type { ProjectStateDocument, TemplateEntry } from '../project-state/types';

const REPO_ROOT = '/repo';

function payload(overrides: Partial<ResolvedPayload> = {}): ResolvedPayload {
  return {
    name: 'my-template',
    version: '1.0.0',
    origin: 'origin-a',
    files: new Map(),
    excludedSubtrees: [],
    ...overrides,
  };
}

// A fixture-backed `ResolvePayloadFn`, keyed by origin string, with a call
// log so a test can assert a given origin was — or, crucially, was NOT —
// ever resolved (`inst-val-if-baseline-drift`'s own requirement: "no
// candidate resolution ... is ever attempted" once the baseline is found
// dishonest).
function makeResolvePayload(fixtures: Record<string, ResolvedPayload | { code: 'ORIGIN_UNAVAILABLE' | 'INVALID_MANIFEST'; message: string }>) {
  const calls: string[] = [];
  const resolvePayload = async (origin: string): Promise<ResolvePayloadResult> => {
    calls.push(origin);
    const fixture = fixtures[origin];
    if (fixture === undefined) {
      return { ok: false, code: 'ORIGIN_UNAVAILABLE', message: `no fixture registered for origin "${origin}"` };
    }
    if ('code' in fixture) {
      return { ok: false, code: fixture.code, message: fixture.message };
    }
    return { ok: true, payload: fixture };
  };
  return { resolvePayload, calls };
}

const fileEntry = (content: string): DiskEntry => ({ kind: 'file', content });
const absentEntry: DiskEntry = { kind: 'absent' };
const directoryEntry: DiskEntry = { kind: 'directory' };
const symlinkEntry: DiskEntry = { kind: 'symlink' };

function fakeReadDiskEntry(entries: Record<string, DiskEntry> = {}): ReadDiskEntryFn {
  const calls: string[] = [];
  const fn: ReadDiskEntryFn = async (absolutePath) => {
    calls.push(absolutePath);
    return entries[absolutePath] ?? absentEntry;
  };
  return Object.assign(fn, { calls }) as ReadDiskEntryFn & { calls: string[] };
}

const identityCanonicalize = (raw: string): string | null => raw;

function makeDocument(name: string, entry: TemplateEntry, others: Record<string, TemplateEntry> = {}): ProjectStateDocument {
  return {
    formatVersion: 1,
    templates: { [name]: entry, ...others },
    projectOwnedRoots: [],
  };
}

function baseEntry(overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  return { origin: 'origin-a', version: '1.0.0', targets: ['app'], ...overrides };
}

function baseInput(overrides: Partial<ValidateInput> = {}): ValidateInput {
  const entry = overrides.entry ?? baseEntry();
  return {
    name: 'my-template',
    entry,
    candidateOrigin: 'origin-b',
    document: overrides.document ?? makeDocument('my-template', entry),
    repoRoot: REPO_ROOT,
    resolvePayload: makeResolvePayload({ 'origin-a': payload({ origin: 'origin-a' }) }).resolvePayload,
    // Manifest-only exclusions for OTHER registered templates. Defaults to
    // "declares none", which is the fail-closed direction for the nesting
    // check: it can only ADMIT more conflicts, never silently permit one.
    resolveRegisteredExclusions: async () => [],
    readDiskEntry: fakeReadDiskEntry({}),
    canonicalizeFn: identityCanonicalize,
    ...overrides,
  };
}

describe('validateUpgrade (cpt-frontx-algo-upgrade-changeset-validate)', () => {
  it('refuses VERSION_MISMATCH for baseline drift before the candidate is ever resolved', async () => {
    const { resolvePayload, calls } = makeResolvePayload({
      // Baseline reports a DIFFERENT version than the recorded one.
      'origin-a': payload({ origin: 'origin-a', version: '2.0.0' }),
      'origin-b': payload({ origin: 'origin-b', version: '1.0.0' }),
    });

    const result = await validateUpgrade(
      baseInput({
        entry: baseEntry({ origin: 'origin-a', version: '1.0.0' }),
        candidateOrigin: 'origin-b',
        resolvePayload,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VERSION_MISMATCH');
    expect(result.details).toMatchObject({ recordedVersion: '1.0.0', reportedVersion: '2.0.0' });
    // The candidate is NEVER resolved once the baseline is found dishonest.
    expect(calls).toEqual(['origin-a']);
  });

  it('refuses ORIGIN_UNAVAILABLE when the candidate cannot be resolved', async () => {
    const { resolvePayload } = makeResolvePayload({
      'origin-a': payload({ origin: 'origin-a', version: '1.0.0' }),
      // 'origin-b' deliberately absent from the fixture map.
    });

    const result = await validateUpgrade(baseInput({ candidateOrigin: 'origin-b', resolvePayload }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ORIGIN_UNAVAILABLE');
  });

  it('refuses VERSION_MISMATCH for a restore-style candidate whose recorded expected version no longer matches what it resolves to', async () => {
    const { resolvePayload } = makeResolvePayload({
      'origin-a': payload({ origin: 'origin-a', version: '2.0.0' }),
      // The preceding origin now reports a DIFFERENT version than what was
      // recorded beside it at the time of the upgrade that produced it.
      'origin-preceding': payload({ origin: 'origin-preceding', version: '0.5.0' }),
    });

    const result = await validateUpgrade(
      baseInput({
        entry: baseEntry({ origin: 'origin-a', version: '2.0.0' }),
        candidateOrigin: 'origin-preceding',
        candidateExpectedVersion: '0.1.0',
        resolvePayload,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VERSION_MISMATCH');
    expect(result.details).toMatchObject({ recordedVersion: '0.1.0', reportedVersion: '0.5.0' });
  });

  it('refuses REGISTRATION_CONFLICT naming both identities when the candidate declares a different name', async () => {
    const { resolvePayload } = makeResolvePayload({
      'origin-a': payload({ origin: 'origin-a', version: '1.0.0', name: 'my-template' }),
      'origin-b': payload({ origin: 'origin-b', version: '2.0.0', name: 'someone-elses-template' }),
    });

    const result = await validateUpgrade(baseInput({ resolvePayload }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('REGISTRATION_CONFLICT');
    expect(result.details).toMatchObject({ registeredName: 'my-template', declaredName: 'someone-elses-template' });
  });

  it('reports the noop variant, leaving the preceding pair untouched, when the candidate resolves to the baseline itself', async () => {
    const entry = baseEntry({ origin: 'origin-a', version: '1.0.0', previous: { origin: 'origin-zero', version: '0.0.1' } });
    const { resolvePayload, calls } = makeResolvePayload({
      'origin-a': payload({ origin: 'origin-a', version: '1.0.0' }),
    });

    const result = await validateUpgrade(baseInput({ entry, candidateOrigin: 'origin-a', resolvePayload }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('noop');
    if (result.kind !== 'noop') return;
    expect(result.at).toEqual({ origin: 'origin-a', version: '1.0.0' });
    // `entry.previous` was never read or mutated by this call.
    expect(entry.previous).toEqual({ origin: 'origin-zero', version: '0.0.1' });
    // The baseline is resolved once for the honesty check and once more as
    // the "candidate" (same origin) — no target is ever inspected either way.
    expect(calls).toEqual(['origin-a', 'origin-a']);
  });

  it('refuses CONTENT_CONFLICT for a doubly-changed file in the SECOND of two targets, having classified both (no early return)', async () => {
    const entry = baseEntry({ targets: ['app1', 'app2'] });
    const { resolvePayload } = makeResolvePayload({
      'origin-a': payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['clean.ts', 'v1'], ['conflict.ts', 'base']]) }),
      'origin-b': payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['clean.ts', 'v2'], ['conflict.ts', 'candidate']]) }),
    });
    const readDiskEntry = fakeReadDiskEntry({
      // app1's files are clean: 'clean.ts' already at the candidate content
      // (UNCHANGED), 'conflict.ts' still at the baseline (REPLACE).
      '/repo/app1/clean.ts': fileEntry('v2'),
      '/repo/app1/conflict.ts': fileEntry('base'),
      // app2's 'conflict.ts' is the doubly-changed one — both baseline and
      // disk have moved away from each other and from the candidate.
      '/repo/app2/conflict.ts': fileEntry('local-edit'),
      '/repo/app2/clean.ts': fileEntry('v2'),
    });

    const result = await validateUpgrade(
      baseInput({ entry, document: makeDocument('my-template', entry), resolvePayload, readDiskEntry }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTENT_CONFLICT');
    expect(result.details).toMatchObject({ conflicts: [{ target: 'app2', path: 'app2/conflict.ts' }] });
    // Proof app1 WAS classified too, not skipped by an early return: its
    // file was actually queried on disk.
    const calls = (readDiskEntry as ReadDiskEntryFn & { calls: string[] }).calls;
    expect(calls).toContain('/repo/app1/clean.ts');
    expect(calls).toContain('/repo/app1/conflict.ts');
  });

  it('refuses CONTENT_CONFLICT naming which paths are uncomparable (an unreadable disk shape) apart from which genuinely drifted', async () => {
    const entry = baseEntry({ targets: ['app1', 'app2'] });
    const { resolvePayload } = makeResolvePayload({
      'origin-a': payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['drift.ts', 'base'], ['blocked.ts', 'content']]) }),
      'origin-b': payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['drift.ts', 'candidate'], ['blocked.ts', 'content']]) }),
    });
    const readDiskEntry = fakeReadDiskEntry({
      // app1: a genuine content drift on 'drift.ts'; 'blocked.ts' already
      // matches, so it classifies UNCHANGED and never reaches this report.
      '/repo/app1/drift.ts': fileEntry('local-edit'),
      '/repo/app1/blocked.ts': fileEntry('content'),
      // app2: the mirror — 'drift.ts' already matches the candidate
      // (UNCHANGED), 'blocked.ts' is a directory on disk, uncomparable.
      '/repo/app2/drift.ts': fileEntry('candidate'),
      '/repo/app2/blocked.ts': directoryEntry,
    });

    const result = await validateUpgrade(
      baseInput({ entry, document: makeDocument('my-template', entry), resolvePayload, readDiskEntry }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTENT_CONFLICT');
    expect(result.details).toMatchObject({
      conflicts: expect.arrayContaining([
        { target: 'app1', path: 'app1/drift.ts' },
        { target: 'app2', path: 'app2/blocked.ts' },
      ]),
      uncomparableConflicts: [{ target: 'app2', path: 'app2/blocked.ts' }],
    });
    // Each cause is named with its own remedy, in one sentence per cause —
    // never collapsed into a single disjunction a reader has to guess from.
    expect(result.message).toContain('moved away from the baseline without already matching the candidate');
    expect(result.message).toContain('cannot be compared against the payload at all');
    expect(result.message).toContain('app1/drift.ts');
    expect(result.message).toContain('app2/blocked.ts');
  });

  it('refuses INVALID_PATH, ahead of CONTENT_CONFLICT, when an ancestor symlink resolves outside the project root', async () => {
    const entry = baseEntry({ targets: ['app1', 'app2'] });
    const { resolvePayload } = makeResolvePayload({
      'origin-a': payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['vendor/lib.ts', 'old'], ['drift.ts', 'base']]) }),
      'origin-b': payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['vendor/lib.ts', 'new'], ['drift.ts', 'candidate']]) }),
    });
    const readDiskEntry = fakeReadDiskEntry({
      // app1's 'vendor' ancestor is a symlink that (per the fake
      // `canonicalizeFn` below) resolves OUTSIDE the project root.
      '/repo/app1/vendor': symlinkEntry,
      '/repo/app1/vendor/lib.ts': fileEntry('old'),
      // app1's 'drift.ts' matches the candidate already — isolates this
      // test to the escaping ancestor alone on app1.
      '/repo/app1/drift.ts': fileEntry('candidate'),
      // app2 carries an ORDINARY genuine content conflict, unrelated to any
      // symlink — present to prove the escaping-ancestor refusal preempts
      // the content-conflict report entirely, rather than merging with it.
      '/repo/app2/drift.ts': fileEntry('local-edit'),
      '/repo/app2/vendor': directoryEntry,
      '/repo/app2/vendor/lib.ts': fileEntry('old'),
    });
    // Every ancestor resolves to itself (stays inside the project) EXCEPT
    // 'app1/vendor', which reports an escape — the one fact this module has
    // no way to derive from `DiskEntry` alone.
    const canonicalizeFn = (raw: string): string | null => (raw === 'app1/vendor' ? null : raw);

    const result = await validateUpgrade(
      baseInput({ entry, document: makeDocument('my-template', entry), resolvePayload, readDiskEntry, canonicalizeFn }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_PATH');
    expect(result.details).toEqual({ paths: [{ target: 'app1', path: 'app1/vendor/lib.ts' }] });
    expect(result.message).toContain('could not be proven to stay inside the project root');
    expect(result.message).toContain('app1/vendor/lib.ts');
    // The unrelated CONTENT_CONFLICT on app2 is never reported: containment
    // is checked, and refused, before content.
    expect(result.message).not.toContain('app2/drift.ts');
  });

  it('refuses TARGET_CONFLICT when newly-claimed ground nests another registered template\'s target', async () => {
    const entry = baseEntry({ targets: ['app'], previous: undefined });
    // Baseline excluded 'vendor/lib'; the candidate drops that exclusion,
    // newly claiming ground 'other-template' already occupies.
    const { resolvePayload } = makeResolvePayload({
      'origin-a': payload({ origin: 'origin-a', version: '1.0.0', excludedSubtrees: ['vendor/lib'] }),
      'origin-b': payload({ origin: 'origin-b', version: '2.0.0', excludedSubtrees: [] }),
      'origin-other': payload({ origin: 'origin-other', version: '1.0.0', name: 'other-template', excludedSubtrees: [] }),
    });
    const document = makeDocument('my-template', entry, {
      'other-template': { origin: 'origin-other', version: '1.0.0', targets: ['app/vendor/lib'] },
    });

    const result = await validateUpgrade(baseInput({ entry, document, resolvePayload }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TARGET_CONFLICT');
    expect(result.details).toMatchObject({
      conflicts: [{ target: 'app', contestingTarget: 'app/vendor/lib', contestingTemplateName: 'other-template' }],
    });
  });

  it('returns a plan accumulating operations and skipped paths across every target, with correct from/to', async () => {
    const entry = baseEntry({ targets: ['app1', 'app2'] });
    const { resolvePayload } = makeResolvePayload({
      'origin-a': payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }),
      'origin-b': payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new'], ['added.ts', 'fresh']]) }),
    });
    const readDiskEntry = fakeReadDiskEntry({
      '/repo/app1/index.ts': fileEntry('old'),
      '/repo/app2/index.ts': fileEntry('old'),
    });

    const result = await validateUpgrade(
      baseInput({ entry, document: makeDocument('my-template', entry), resolvePayload, readDiskEntry }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') return;
    expect(result.plan.from).toEqual({ origin: 'origin-a', version: '1.0.0' });
    expect(result.plan.to).toEqual({ origin: 'origin-b', version: '2.0.0' });
    expect(result.plan.targets).toEqual(['app1', 'app2']);
    const byPath = new Map(result.plan.operations.map((operation) => [operation.path, operation.op]));
    expect(byPath.get('app1/index.ts')).toBe('REPLACE');
    expect(byPath.get('app1/added.ts')).toBe('ADD');
    expect(byPath.get('app2/index.ts')).toBe('REPLACE');
    expect(byPath.get('app2/added.ts')).toBe('ADD');
    expect(result.plan.operations).toHaveLength(4);
  });
  // The `cpt-frontx-cli-nfr-template-scale` independence property, pinned as a
  // CALL-COUNT assertion because that is the only way it can be observed:
  // preparing ONE name's upgrade must resolve exactly two PAYLOADS — the
  // baseline's and the candidate's — no matter how many other templates the
  // project has registered.
  //
  // The nesting check does need every other registered template's declared
  // `excludedSubtrees`, but that is a MANIFEST read, and it goes through the
  // separate `resolveRegisteredExclusions` seam. Routing it through
  // `resolvePayload` instead (which reads every file, and fetches over the
  // network for a remote origin) made this cost scale with the number of
  // registered templates — nineteen extra full resolutions in the
  // twenty-template project that NFR names as its own threshold.
  it('resolves exactly two payloads regardless of how many other templates are registered', async () => {
    const entry = baseEntry({ targets: ['app'] });
    const others: Record<string, TemplateEntry> = {};
    for (let index = 0; index < 19; index += 1) {
      others[`other-${index}`] = { origin: `origin-other-${index}`, version: '1.0.0', targets: [`vendor/other-${index}`] };
    }
    const { resolvePayload, calls } = makeResolvePayload({
      'origin-a': payload({ origin: 'origin-a', version: '1.0.0', files: new Map([['index.ts', 'old']]) }),
      'origin-b': payload({ origin: 'origin-b', version: '2.0.0', files: new Map([['index.ts', 'new']]) }),
    });
    const exclusionCalls: string[] = [];
    const readDiskEntry = fakeReadDiskEntry({ '/repo/app/index.ts': fileEntry('old') });

    const result = await validateUpgrade(
      baseInput({
        entry,
        document: makeDocument('my-template', entry, others),
        resolvePayload,
        resolveRegisteredExclusions: async (otherName: string) => {
          exclusionCalls.push(otherName);
          return [];
        },
        readDiskEntry,
      }),
    );

    expect(result.ok).toBe(true);
    // Exactly the baseline and the candidate — never another template's payload.
    expect(calls).toEqual(['origin-a', 'origin-b']);
    // The other nineteen are reached through the manifest-only seam instead.
    expect(exclusionCalls).toHaveLength(19);
  });
});
