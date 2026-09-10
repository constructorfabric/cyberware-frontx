// @cpt-algo:cpt-frontx-algo-composed-provenance-unregister:p1
import { describe, expect, it, vi } from 'vitest';
import { unregisterTemplate } from '../commands/unregister';
import type { ProjectStateDocument, ReadProjectStateFn, WriteProjectStateFn } from '../project-state/types';

function fakeProjectState(initial: ProjectStateDocument | null = null): {
  read: ReadProjectStateFn;
  write: WriteProjectStateFn;
  written: () => ProjectStateDocument | null;
} {
  let stored = initial ? JSON.stringify(initial) : null;
  const write: WriteProjectStateFn = vi.fn(async (_absolutePath, content) => {
    stored = content;
  });
  return {
    read: async () => stored,
    write,
    written: () => (stored ? (JSON.parse(stored) as ProjectStateDocument) : null),
  };
}

describe('unregisterTemplate (cpt-frontx-algo-composed-provenance-unregister)', () => {
  it('removes the entry when targets is empty', async () => {
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: [] } },
      projectOwnedRoots: [],
    });

    const result = await unregisterTemplate('foo', '/repo', read, write);

    expect(result).toEqual({ ok: true, name: 'foo' });
    expect(written()?.templates.foo).toBeUndefined();
  });

  it('removes any "previous" entry along with the rest of the entry', async () => {
    const { read, write, written } = fakeProjectState({
      formatVersion: 1,
      templates: {
        foo: {
          origin: 'github:acme/foo@v1.0.0',
          version: '1.0.0',
          targets: [],
          previous: { origin: 'github:acme/foo@v0.9.0', version: '0.9.0' },
        },
      },
      projectOwnedRoots: [],
    });

    await unregisterTemplate('foo', '/repo', read, write);

    expect(written()?.templates.foo).toBeUndefined();
  });

  it('refuses with TEMPLATE_NOT_REGISTERED when the name has no entry', async () => {
    const { read, write } = fakeProjectState({ formatVersion: 1, templates: {}, projectOwnedRoots: [] });

    const result = await unregisterTemplate('foo', '/repo', read, write);

    expect(result).toEqual({ ok: false, code: 'TEMPLATE_NOT_REGISTERED', message: 'Template "foo" is not registered.' });
  });

  it('refuses with TARGETS_EXIST and lists every dependent target, preserving the entry', async () => {
    const existingEntry = { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/foo', 'apps/foo'] };
    const { read, write } = fakeProjectState({
      formatVersion: 1,
      templates: { foo: existingEntry },
      projectOwnedRoots: [],
    });

    const result = await unregisterTemplate('foo', '/repo', read, write);

    expect(result).toMatchObject({
      ok: false,
      code: 'TARGETS_EXIST',
      details: { name: 'foo', targets: ['packages/foo', 'apps/foo'] },
    });
    expect(write).not.toHaveBeenCalled();
    const reread = await read('/repo/.frontx/project.json');
    expect(reread && JSON.parse(reread).templates.foo).toEqual(existingEntry);
  });

  it('surfaces PROJECT_INVALID when the document cannot be parsed', async () => {
    const read: ReadProjectStateFn = async () => '{ not valid json';
    const write: WriteProjectStateFn = async () => undefined;

    const result = await unregisterTemplate('foo', '/repo', read, write);

    expect(result).toMatchObject({ ok: false, code: 'PROJECT_INVALID' });
  });
});
