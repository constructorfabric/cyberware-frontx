// @cpt-algo:cpt-frontx-algo-composed-provenance-project-state-io:p1
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mutateProjectState, projectStatePath, readProjectState } from '../io';
import type { ProjectStateDocument, ReadProjectStateFn, WriteProjectStateFn } from '../types';

// Path-keyed, unlike `fakeStore` below: ADR-0019's legacy-provenance
// refusal is a function of TWO distinct paths (`.frontx/project.json` and
// the legacy `.frontx/provenance.json`) existing or not independently of
// each other — a single-value fake cannot model that.
function pathKeyedStore(entries: Record<string, string>): ReadProjectStateFn {
  return async (absolutePath) => entries[absolutePath] ?? null;
}

// Pure-logic coverage against fakes, proving the algorithm's own steps
// (locate / absent-default / malformed refusal / read / mutate) without
// touching a real filesystem — real-fs coverage of the atomic write itself
// lives in `adapters/__tests__/fs-project-io.test.ts`, per this codebase's
// convention of proving the real adapter separately from the pure logic
// (see that file's own `createFsListPayloadFilesFn` precedent).

function fakeStore(initial: string | null = null): {
  read: ReadProjectStateFn;
  write: WriteProjectStateFn;
  written: () => string | null;
} {
  let stored = initial;
  return {
    read: async () => stored,
    write: async (_absolutePath, content) => {
      stored = content;
    },
    written: () => stored,
  };
}

describe('readProjectState', () => {
  it('returns the initial empty shape when no document exists, writing nothing', async () => {
    const { read, written } = fakeStore(null);

    const result = await readProjectState('/repo', read);

    expect(result).toEqual({
      ok: true,
      document: { formatVersion: 1, templates: {}, projectOwnedRoots: [] },
    });
    expect(written()).toBeNull();
  });

  // ADR-0019 "More Information" / Confirmation's fifth test: a repository
  // carrying a legacy `.frontx/provenance.json` and no `.frontx/project.json`
  // is NOT migrated automatically — it is refused with an actionable message
  // naming the legacy file, never silently treated as an ordinary empty
  // project.
  it('refuses PROJECT_INVALID naming the legacy provenance.json when project.json is absent but it exists', async () => {
    const legacyPath = path.join('/repo', '.frontx', 'provenance.json');
    const read = pathKeyedStore({ [legacyPath]: JSON.stringify([{ name: 'auth', version: '1.0.0' }]) });

    const result = await readProjectState('/repo', read);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('PROJECT_INVALID');
      expect(result.message).toContain(legacyPath);
    }
  });

  // The ordinary path this fix must not break: neither file present is
  // still a plain empty project, not a refusal.
  it('still returns the initial empty shape when neither project.json nor a legacy provenance.json exists', async () => {
    const read = pathKeyedStore({});

    const result = await readProjectState('/repo', read);

    expect(result).toEqual({
      ok: true,
      document: { formatVersion: 1, templates: {}, projectOwnedRoots: [] },
    });
  });

  it('returns PROJECT_INVALID naming the document when it cannot be parsed', async () => {
    const { read } = fakeStore('{ not valid json');

    const result = await readProjectState('/repo', read);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('PROJECT_INVALID');
      // Project-relative, the one way every refusal in this package spells
      // a path inside the project.
      expect(result.message).toContain('".frontx/project.json"');
      expect(result.message).not.toContain(projectStatePath('/repo'));
    }
  });

  it('returns PROJECT_INVALID when the document is well-formed JSON but not the expected shape', async () => {
    const { read } = fakeStore(JSON.stringify({ formatVersion: 1, templates: 'nope', projectOwnedRoots: [] }));

    const result = await readProjectState('/repo', read);

    expect(result).toMatchObject({ ok: false, error: 'PROJECT_INVALID' });
  });

  // Regression: a bare `typeof formatVersion === 'number'` check accepted
  // ANY number — a document stamped `formatVersion: 2` by a future schema
  // generation this build does not understand would have been read (and,
  // on the next mutation, silently rewritten) as if it were the current
  // shape, rather than refused.
  it('returns PROJECT_INVALID for a well-formed document stamped with a formatVersion other than 1', async () => {
    const { read } = fakeStore(JSON.stringify({ formatVersion: 2, templates: {}, projectOwnedRoots: [] }));

    const result = await readProjectState('/repo', read);

    expect(result).toMatchObject({ ok: false, error: 'PROJECT_INVALID' });
  });
});

describe('mutateProjectState', () => {
  it('round-trips a set-template mutation: written document is read back unchanged', async () => {
    const { read, write } = fakeStore(null);

    const written = await mutateProjectState(
      '/repo',
      { kind: 'set-template', name: 'auth', entry: { origin: 'github:acme/auth@abc123', version: '1.0.0', targets: [] } },
      read,
      write,
    );
    expect(written).toEqual({
      ok: true,
      document: {
        formatVersion: 1,
        templates: { auth: { origin: 'github:acme/auth@abc123', version: '1.0.0', targets: [] } },
        projectOwnedRoots: [],
      },
    });

    const readBack = await readProjectState('/repo', read);
    expect(readBack).toEqual(written);
  });

  it('applies exactly the described change and nothing else, preserving unrelated entries', async () => {
    const existing: ProjectStateDocument = {
      formatVersion: 1,
      templates: { auth: { origin: 'github:acme/auth@abc123', version: '1.0.0', targets: ['apps/web'] } },
      projectOwnedRoots: ['docs'],
    };
    const { read, write } = fakeStore(JSON.stringify(existing));

    const result = await mutateProjectState('/repo', { kind: 'add-owned-root', path: 'scripts' }, read, write);

    expect(result).toEqual({
      ok: true,
      document: { ...existing, projectOwnedRoots: ['docs', 'scripts'] },
    });
  });

  it('removing a template entry drops exactly that name', async () => {
    const existing: ProjectStateDocument = {
      formatVersion: 1,
      templates: {
        auth: { origin: 'github:acme/auth@abc123', version: '1.0.0', targets: [] },
        billing: { origin: 'path:../billing', version: '2.0.0', targets: [] },
      },
      projectOwnedRoots: [],
    };
    const { read, write } = fakeStore(JSON.stringify(existing));

    const result = await mutateProjectState('/repo', { kind: 'remove-template', name: 'auth' }, read, write);

    expect(result).toEqual({
      ok: true,
      document: { ...existing, templates: { billing: existing.templates.billing } },
    });
  });

  it('a malformed existing document refuses the mutation with PROJECT_INVALID, never guessing a partial shape', async () => {
    const { read, write, written } = fakeStore('not json at all');

    const result = await mutateProjectState('/repo', { kind: 'add-owned-root', path: 'scripts' }, read, write);

    expect(result).toMatchObject({ ok: false, error: 'PROJECT_INVALID' });
    // The refusal must happen before any write is attempted.
    expect(written()).toBe('not json at all');
  });

  // The AC this simulates: "A simulated interrupted write ... leaves the
  // repository holding the prior valid document, never a partially-written
  // or partially-merged one." At the pure-logic level, that guarantee comes
  // entirely from trusting `writeProjectStateFn`'s own atomicity contract —
  // this fake models an interruption occurring inside that call (after the
  // real adapter would have constructed its temp path, before its rename)
  // by throwing without ever mutating `stored`, so the caller's own prior
  // document is provably untouched on the failure path.
  it('an interrupted write leaves the prior document untouched when writeProjectStateFn throws', async () => {
    const priorDocument: ProjectStateDocument = {
      formatVersion: 1,
      templates: { auth: { origin: 'github:acme/auth@abc123', version: '1.0.0', targets: [] } },
      projectOwnedRoots: [],
    };
    const stored: string | null = JSON.stringify(priorDocument);
    const read: ReadProjectStateFn = async () => stored;
    const write: WriteProjectStateFn = async () => {
      // Models the real adapter's write reaching the point of having
      // constructed its temporary file's path but failing before the
      // rename that would publish it — `stored` (standing in for the real
      // `.frontx/project.json`) is never assigned.
      throw new Error('simulated interruption before rename');
    };

    await expect(
      mutateProjectState('/repo', { kind: 'add-owned-root', path: 'scripts' }, read, write),
    ).rejects.toThrow('simulated interruption before rename');

    const readBack = await readProjectState('/repo', read);
    expect(readBack).toEqual({ ok: true, document: priorDocument });
    expect(stored).toBe(JSON.stringify(priorDocument));
  });
});
