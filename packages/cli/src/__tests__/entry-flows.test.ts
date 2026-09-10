// @cpt-flow:cpt-frontx-flow-cli-scaffolding-seed-repository:p1
// @cpt-flow:cpt-frontx-flow-cli-scaffolding-add-template:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-boundary-declared-assembly:p1
// @cpt-dod:cpt-frontx-dod-cli-scaffolding-add-undeclared-content:p1
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';
import { createFsWriteFileFn } from '../adapters/fs-project-io';
import { createFsReadTargetPathStateFn } from '../adapters/fs-target-path';
import { seedRepository } from '../commands/seed-repository';
import { addTemplate } from '../commands/add-template';
import type { InventoryEntry } from '../inventory/types';
import { InventoryState } from '../inventory/types';
import type { TemplateManifest } from '../manifest/types';
import type { ContentItem, ReadContentItemsFn, ReadProjectFileFn, WriteFileFn } from '../scaffold/types';
import type { ProvenanceRecord, ProvenanceWriteFn } from '../provenance/types';
import type { ReadProvenanceRecordsFn } from '../scaffold/materialize';
import type { ReadTargetDirFn } from '../commands/seed-repository';
import type { ReadTargetPathStateFn, TargetPathState } from '../commands/add-template';

// The seed cases below aim at a notional '/target' that exists on no
// filesystem, so the probe reports it absent — the case materialization
// creates. The empty-target guard's own cases supply their own probe.
const targetAbsent: ReadTargetDirFn = async () => undefined;

// Same content-registry-keyed-by-name convention as assembler.test.ts — the
// manifest carries ONLY its declared categories; content items live separately
// and are read via the injected readContentFn seam, directly from the installed
// content path, never from the manifest.
function makeEntry(
  name: string,
  content: ContentItem[],
  manifestOverrides: Partial<TemplateManifest> = {},
): InventoryEntry {
  const manifest: TemplateManifest = {
    name,
    version: '1.0.0',
    ownershipBoundaries: { exclusiveSubtrees: [`${name}/`], sharedFiles: [] },
    ...manifestOverrides,
  };
  contentRegistry.set(name, content);
  return {
    name,
    source: `github:acme/${name}@v1.0.0`,
    ref: 'v1.0.0',
    status: InventoryState.INSTALLED,
    content: JSON.stringify(manifest),
  };
}

const contentRegistry = new Map<string, ContentItem[]>();
const readContentFn: ReadContentItemsFn = async (entry) => contentRegistry.get(entry.name) ?? [];

function makeFsFake() {
  const files = new Map<string, string>();
  const writeFileFn: WriteFileFn = async (path, content) => {
    files.set(path, content);
  };
  const provenanceWriteFn: ProvenanceWriteFn = async (path, content) => {
    files.set(path, content);
  };
  const readProvenanceFn: ReadProvenanceRecordsFn = async (targetDir) => {
    const raw = files.get(`${targetDir}/.frontx/provenance.json`);
    return raw ? (JSON.parse(raw) as ProvenanceRecord[]) : [];
  };
  // Backed by the SAME in-memory `files` map every other fake here writes
  // through, so a region-union path this fake fs already holds (from an
  // earlier seed/add in the same test) is visible to composeSharedFiles'
  // carry-forward check exactly as the real fs adapter would see it.
  const readProjectFileFn: ReadProjectFileFn = async (path) => files.get(path) ?? null;
  // The same map read as a directory tree: a key is a file, a prefix of a key is
  // the directory holding it. A fake that reported every path absent would let
  // the add flow's occupied-ground guard pass everything, so it is derived from
  // what the other fakes here have actually written rather than stubbed.
  const readTargetPathStateFn: ReadTargetPathStateFn = async (path) => {
    if (files.has(path)) return 'file';
    return [...files.keys()].some((key) => key.startsWith(`${path}/`)) ? 'directory' : 'absent';
  };
  return { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn };
}

// inst-seed-check-target-empty / inst-seed-if-target-not-directory /
// inst-seed-abort-target-not-directory / inst-seed-if-target-not-empty /
// inst-seed-abort-target-not-empty — cpt-frontx-dod-cli-scaffolding-seed-empty-target
describe('seedRepository empty-target guard — cpt-frontx-dod-cli-scaffolding-seed-empty-target', () => {
  const entry = makeEntry('template-a', [{ path: 'template-a/index.ts', content: 'export const a = true;' }]);

  it('refuses a target directory that already holds entries, writing no file and resolving no template', async () => {
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();
    const lookupFn = vi.fn(() => entry);

    const result = await seedRepository(
      'template-a',
      '/existing-repo',
      lookupFn,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => ['package.json', 'src', '.git'],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-not-empty');
    expect(files.size).toBe(0);
  });

  // .git is the load-bearing non-content entry: `git init` then `frontx seed` is
  // the ordinary way to start, so refusing a bare repository would refuse the
  // most common first step there is.
  it('seeds a directory holding only .git, so a freshly initialized repository is a supported start', async () => {
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository(
      'template-a',
      '/fresh-repo',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => ['.git'],
    );

    expect(result.ok).toBe(true);
    expect(files.get('/fresh-repo/template-a/index.ts')).toBe('export const a = true;');
  });

  it('seeds a directory holding only platform droppings such as .DS_Store', async () => {
    const { writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository(
      'template-a',
      '/dropping-only',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => ['.DS_Store', 'Thumbs.db'],
    );

    expect(result.ok).toBe(true);
  });

  it('still refuses a directory mixing non-content entries with real content', async () => {
    const { writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository(
      'template-a',
      '/mixed',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => ['.git', 'package.json'],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-not-empty');
  });

  // The non-content entries were not the reason, so quoting them would send the
  // developer looking for content that is not what blocked them.
  it('names only the content entries in the refusal, never the non-content ones', async () => {
    const { writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository(
      'template-a',
      '/mixed',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => ['.git', '.DS_Store', 'package.json'],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('package.json');
    expect(result.message).not.toContain('.git');
    expect(result.message).not.toContain('.DS_Store');
    expect(result.message).toContain('holds 1 entry');
  });

  // A path that exists as a file gets its own reason and NO add remedy: add
  // needs a directory too, so recommending it would be a second failure.
  it('refuses a target path that exists and is not a directory, offering no add remedy', async () => {
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository(
      'template-a',
      '/some-file.txt',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => 'not-a-directory',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-not-directory');
    expect(result.message).toContain('/some-file.txt');
    expect(result.message).not.toContain('frontx add');
    expect(files.size).toBe(0);
  });

  // The remedy has to say what add does with the content found here, and what
  // it says has to be what add does: since
  // cpt-frontx-dod-cli-scaffolding-add-undeclared-content, add refuses a path it
  // would write that this directory already holds, so a remedy still warning of
  // an overwrite would send the developer away from a working next step.
  it('qualifies the add remedy with what add leaves alone rather than with an overwrite it no longer performs', async () => {
    const { writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository(
      'template-a',
      '/existing-repo',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => ['package.json'],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('refuses instead of overwriting');
    expect(result.message).not.toContain('can still overwrite');
  });

  // Add refuses this same directory when what it holds stands on the template's
  // own ground, so a refusal naming only add can lead from one refusal to the
  // next. The fresh-directory exit is what keeps the message a way out.
  it('names seeding into a fresh directory alongside the add remedy, so the refusal leads somewhere either way', async () => {
    const { writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository(
      'template-a',
      '/existing-repo',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => ['package.json'],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('fresh directory');
  });

  it('names the refused directory and the add command as the remedy', async () => {
    const { writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository(
      'template-a',
      '/existing-repo',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => ['package.json'],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('/existing-repo');
    expect(result.message).toContain('frontx add template-a /existing-repo');
  });

  // A repository holding thousands of files must still produce a readable
  // refusal, so the message samples and counts rather than listing everything.
  it('summarizes the remainder rather than listing every entry of a large directory', async () => {
    const { writeFileFn, provenanceWriteFn } = makeFsFake();
    const many = Array.from({ length: 12 }, (_, i) => `file-${i}.ts`);

    const result = await seedRepository(
      'template-a',
      '/existing-repo',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => many,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The property: exactly REFUSAL_ENTRY_SAMPLE names quoted, the balance
    // counted. Asserting one absent filename would pass for the wrong reason if
    // the cap changed but the sample happened to exclude that name.
    const quoted = many.filter((name) => result.message.includes(name));
    expect(quoted).toHaveLength(5);
    expect(result.message).toContain(`and ${many.length - 5} more`);
  });

  it('seeds a target directory that exists and is empty, because an empty directory holds nothing to overwrite', async () => {
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository(
      'template-a',
      '/empty-dir',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => [],
    );

    expect(result.ok).toBe(true);
    expect(files.get('/empty-dir/template-a/index.ts')).toBe('export const a = true;');
  });

  it('seeds a target directory that does not exist, which materialization creates', async () => {
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();

    const result = await seedRepository(
      'template-a',
      '/not-yet',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => undefined,
    );

    expect(result.ok).toBe(true);
    expect(files.get('/not-yet/template-a/index.ts')).toBe('export const a = true;');
  });

  // inst-seed-recheck-target — resolution and the conflict check take time, so
  // the target is re-read immediately before the first write. A probe that
  // reports empty first and occupied second stands in for a directory that
  // gained content during that window.
  it('refuses on the last-moment re-read when the target became occupied after the pre-flight read', async () => {
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();
    const states: (string[] | undefined)[] = [[], ['package.json']];
    let call = 0;
    const flipping = async (): Promise<string[] | undefined> => states[call++] ?? ['package.json'];

    const result = await seedRepository(
      'template-a',
      '/races',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      flipping,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-not-empty');
    // The point of re-reading at all: nothing was written despite the pre-flight
    // read having cleared the target.
    expect(files.size).toBe(0);
    expect(call).toBe(2);
  });

  it('refuses on the re-read when the target became a file after the pre-flight read', async () => {
    const { files, writeFileFn, provenanceWriteFn } = makeFsFake();
    const states: (string[] | 'not-a-directory' | undefined)[] = [undefined, 'not-a-directory'];
    let call = 0;
    const flipping = async (): Promise<string[] | 'not-a-directory' | undefined> => states[call++] ?? 'not-a-directory';

    const result = await seedRepository(
      'template-a',
      '/races-file',
      () => entry,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      flipping,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-not-directory');
    expect(files.size).toBe(0);
  });

  // The guard runs before resolution, so a populated target is refused without
  // the flow ever consulting the inventory.
  it('refuses before resolving the template, so only the reference check consults the inventory', async () => {
    const { writeFileFn, provenanceWriteFn } = makeFsFake();
    const lookupFn = vi.fn((): InventoryEntry | undefined => entry);

    await seedRepository(
      'template-a',
      '/existing-repo',
      lookupFn,
      readContentFn,
      writeFileFn,
      provenanceWriteFn,
      async () => ['package.json'],
    );

    // One call only: the reference check at inst-seed-check-resolved. Resolution
    // (inst-seed-resolve-set) would drive further lookups.
    expect(lookupFn).toHaveBeenCalledTimes(1);
  });
});

describe('seedRepository — cpt-frontx-flow-cli-scaffolding-seed-repository', () => {
  it('seeds an empty target: resolves the referenced set incl. preset references, stages via P14, passes P29, materializes, writes one provenance record per applied template', async () => {
    const preset = makeEntry('preset-template', [{ path: 'preset-template/README.md', content: 'preset' }], {
      referencedTemplates: [{ ref: 'mfe-a' }],
    });
    const mfeA = makeEntry('mfe-a', [{ path: 'mfe-a/index.ts', content: 'export const mfeA = true;' }]);
    const entries: Record<string, InventoryEntry> = { 'preset-template': preset, 'mfe-a': mfeA };
    const lookupFn = (n: string) => entries[n];
    const { files, writeFileFn, provenanceWriteFn, readProjectFileFn } = makeFsFake();

    const result = await seedRepository('preset-template', '/target', lookupFn, readContentFn, writeFileFn, provenanceWriteFn, targetAbsent, readProjectFileFn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedTemplates.sort()).toEqual(['mfe-a', 'preset-template']);
    expect(files.get('/target/preset-template/README.md')).toBe('preset');
    expect(files.get('/target/mfe-a/index.ts')).toBe('export const mfeA = true;');
    const provenance = JSON.parse(files.get('/target/.frontx/provenance.json')!) as ProvenanceRecord[];
    expect(provenance).toHaveLength(2);
    expect(provenance.map((r) => r.templateIdentity).sort()).toEqual(['mfe-a', 'preset-template']);
  });

  it('aborts with no files written when the template reference cannot be resolved from the local inventory', async () => {
    const { files, writeFileFn, provenanceWriteFn, readProjectFileFn } = makeFsFake();

    const result = await seedRepository('missing', '/target', () => undefined, readContentFn, writeFileFn, provenanceWriteFn, targetAbsent, readProjectFileFn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unresolved');
    expect(files.size).toBe(0);
  });

  it('aborts BEFORE any file write when two templates in the staged assembly claim the same exclusive subtree', async () => {
    const templateA = makeEntry('template-a', [{ path: 'shared/a.ts', content: 'a' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['shared/'], sharedFiles: [] },
      referencedTemplates: [{ ref: 'template-b' }],
    });
    const templateB = makeEntry('template-b', [{ path: 'shared/b.ts', content: 'b' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['shared/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'template-a': templateA, 'template-b': templateB };
    const { files, writeFileFn, provenanceWriteFn, readProjectFileFn } = makeFsFake();

    const result = await seedRepository('template-a', '/target', (n) => entries[n], readContentFn, writeFileFn, provenanceWriteFn, targetAbsent, readProjectFileFn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    if (result.reason === 'conflict') {
      expect(result.conflicts).toEqual([{ ground: 'shared/', contestants: ['template-a', 'template-b'] }]);
    }
    expect(files.size).toBe(0);
  });
});

describe('addTemplate — cpt-frontx-flow-cli-scaffolding-add-template', () => {
  // inst-add-resolve-occupied
  it('resolves a provenance record written under the old identity scheme by its source address', async () => {
    // The repository remembers `legacy-repo-name`, the identity the resolver
    // derived from the repository segment before the manifest owned it. The
    // installed template now answers to its manifest name, and the two are
    // connected only by the source-spec the record carries.
    const applied = makeEntry('declared-identity', [{ path: 'applied/index.ts', content: 'applied' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['applied/'], sharedFiles: [] },
    });
    const legacyEntry: InventoryEntry = { ...applied, source: 'github:acme/legacy-repo-name@v1.0.0' };
    const newTemplate = makeEntry('new-template', [{ path: 'new/index.ts', content: 'new' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['new/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = {
      'declared-identity': legacyEntry,
      'new-template': newTemplate,
    };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'legacy-repo-name', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/legacy-repo-name@v2.0.0' },
      ]),
    );

    const result = await addTemplate(
      'new-template',
      '/target',
      (n: string) => entries[n],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    // The add proceeds: the legacy record's boundaries were established from
    // the address match, so nothing was skipped and nothing was locked out.
    expect(result.ok).toBe(true);
    expect(files.get('/target/new/index.ts')).toBe('new');
  });

  // inst-add-resolve-occupied
  it('submits one claim per installed template when two provenance records resolve to the same one', async () => {
    // A repository carrying both a record written under the old identity scheme
    // and one written under the new: the legacy record resolves by source
    // address, the current one by identity, and both land on `applied/`.
    const applied = makeEntry('declared-identity', [{ path: 'applied/index.ts', content: 'applied' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['applied/'], sharedFiles: [] },
    });
    const newTemplate = makeEntry('new-template', [{ path: 'new/index.ts', content: 'new' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['new/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = {
      'declared-identity': applied,
      'new-template': newTemplate,
    };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'legacy-repo-name', scaffoldedFromVersion: '1.0.0', sourceSpec: applied.source },
        { templateIdentity: 'declared-identity', scaffoldedFromVersion: '2.0.0', sourceSpec: applied.source },
      ]),
    );

    const result = await addTemplate(
      'new-template',
      '/target',
      (n: string) => entries[n],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    // One claim per occupant, and the disjoint `new/` claim passes. The pass
    // does not depend on the deduplication — pairs of occupied claims are not
    // judged at all — so what this pins is the claim count reaching the check;
    // the companion case below is where a duplicate would have been visible.
    expect(result.ok).toBe(true);
    expect(files.get('/target/new/index.ts')).toBe('new');
  });

  // inst-add-resolve-occupied
  it('keeps the surviving claim after deduplication, so the occupant still contests its own ground', async () => {
    // The companion to the case above: deduplicating to ZERO claims would also
    // let a disjoint add through, so the guard has to be shown from the other
    // side — a template claiming the occupied ground must still be refused.
    const applied = makeEntry('declared-identity', [{ path: 'applied/index.ts', content: 'applied' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['applied/'], sharedFiles: [] },
    });
    const intruder = makeEntry('intruder', [{ path: 'applied/other.ts', content: 'intruder' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['applied/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = {
      'declared-identity': applied,
      intruder,
    };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'legacy-repo-name', scaffoldedFromVersion: '1.0.0', sourceSpec: applied.source },
        { templateIdentity: 'declared-identity', scaffoldedFromVersion: '2.0.0', sourceSpec: applied.source },
      ]),
    );

    const result = await addTemplate(
      'intruder',
      '/target',
      (n: string) => entries[n],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    if (result.reason !== 'conflict') return;
    // Exactly one contest, and the occupant is named once — under the identity
    // of the first record that resolved, not under both.
    expect(result.conflicts).toEqual([{ ground: 'applied/', contestants: ['intruder', 'legacy-repo-name'] }]);
    expect(files.get('/target/applied/other.ts')).toBeUndefined();
  });

  // inst-cc-foreach-pair — arbitration is about the incoming assembly against
  // the existing state, so two records already on disk are never tried against
  // each other. A repository assembled before the boundary comparison became
  // segment-aware can hold a nested occupied pair: the equality check that
  // admitted the inner template is gone, but its provenance record is not, and
  // re-judging that pair would refuse every later add with a contest the
  // developer cannot resolve from either side.
  it('adds a disjoint template into a repository whose two already-applied templates hold nested boundaries', async () => {
    const outer = makeEntry('outer-applied', [{ path: 'src/index.ts', content: 'outer' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const inner = makeEntry('inner-applied', [{ path: 'src/config/app.ts', content: 'inner' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/config/'], sharedFiles: [] },
    });
    const incoming = makeEntry('incoming', [{ path: 'docs/readme.md', content: 'incoming' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['docs/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'outer-applied': outer, 'inner-applied': inner, incoming };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'outer-applied', scaffoldedFromVersion: '1.0.0', sourceSpec: outer.source },
        { templateIdentity: 'inner-applied', scaffoldedFromVersion: '1.0.0', sourceSpec: inner.source },
      ]),
    );

    const result = await addTemplate(
      'incoming',
      '/target',
      (n: string) => entries[n],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(true);
    expect(files.get('/target/docs/readme.md')).toBe('incoming');
  });

  // The companion bound: narrowing the pairs must not stop the incoming claim
  // from being tried against every occupant, including the inner one of a
  // nested pair, and the refusal names that occupant rather than the pair the
  // check no longer judges.
  it('still refuses an incoming claim that nests into one of two already-applied nested boundaries', async () => {
    const outer = makeEntry('outer-applied', [{ path: 'src/index.ts', content: 'outer' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const inner = makeEntry('inner-applied', [{ path: 'src/config/app.ts', content: 'inner' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/config/'], sharedFiles: [] },
    });
    const intruder = makeEntry('intruder', [{ path: 'src/config/deep/x.ts', content: 'intruder' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/config/deep/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'outer-applied': outer, 'inner-applied': inner, intruder };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'outer-applied', scaffoldedFromVersion: '1.0.0', sourceSpec: outer.source },
        { templateIdentity: 'inner-applied', scaffoldedFromVersion: '1.0.0', sourceSpec: inner.source },
      ]),
    );

    const result = await addTemplate(
      'intruder',
      '/target',
      (n: string) => entries[n],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    if (result.reason !== 'conflict') return;
    // Both occupants contain the intruder's claim, so both contests are real and
    // both are reported; the `src/` against `src/config/` pair between the two
    // occupants is absent.
    expect(result.conflicts).toEqual([
      { ground: 'src/config/deep/ overlaps src/', contestants: ['intruder', 'outer-applied'] },
      { ground: 'src/config/deep/ overlaps src/config/', contestants: ['intruder', 'inner-applied'] },
    ]);
    expect(files.get('/target/src/config/deep/x.ts')).toBeUndefined();
  });

  // inst-add-resolve-occupied
  it('ignores an identity hit whose installed source addresses a different template, and resolves by address instead', async () => {
    // An inventory written before the collision guard existed: the key
    // `shared-key` points at a template acquired from somewhere else entirely.
    const impostor: InventoryEntry = {
      ...makeEntry('shared-key', [{ path: 'impostor/index.ts', content: 'impostor' }], {
        ownershipBoundaries: { exclusiveSubtrees: ['new/'], sharedFiles: [] },
      }),
      source: 'github:contoso/unrelated@v1.0.0',
    };
    const realOwner: InventoryEntry = {
      ...makeEntry('real-owner', [{ path: 'owned/index.ts', content: 'owned' }], {
        ownershipBoundaries: { exclusiveSubtrees: ['owned/'], sharedFiles: [] },
      }),
      source: 'github:acme/shared-key@v1.0.0',
    };
    const newTemplate = makeEntry('new-template', [{ path: 'new/index.ts', content: 'new' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['new/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = {
      'shared-key': impostor,
      'real-owner': realOwner,
      'new-template': newTemplate,
    };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'shared-key', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/shared-key@v1.0.0' },
      ]),
    );

    const result = await addTemplate(
      'new-template',
      '/target',
      (n: string) => entries[n],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    // Trusting the identity hit would have checked the impostor's boundaries,
    // which do not include `owned/`, and the add would have proceeded over the
    // real owner's ground. Resolved by address, the real owner's `owned/` is
    // what the conflict check sees, and `new/` does not intersect it.
    expect(result.ok).toBe(true);
    expect(files.get('/target/new/index.ts')).toBe('new');
  });

  // inst-add-check-occupied, inst-add-abort-occupied-unknown
  it('aborts when an applied template recorded in provenance is not installed locally, naming the source-spec that would restore it', async () => {
    const newTemplate = makeEntry('new-template', [{ path: 'new/index.ts', content: 'new' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['new/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'new-template': newTemplate };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    // Neither the identity nor the address resolves: the template genuinely is
    // not installed, so `frontx install <sourceSpec>` is a recovery that works.
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'legacy-repo-name', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/legacy-repo-name@v1.0.0' },
      ]),
    );

    const result = await addTemplate(
      'new-template',
      '/target',
      (n: string) => entries[n],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('occupied-not-installed');
    expect(result.message).toContain('github:acme/legacy-repo-name@v1.0.0');
    // Skipping the unresolvable record instead of aborting would let the
    // conflict check pass a claim over ground the recorded template owns.
    expect(files.has('/target/new/index.ts')).toBe(false);
  });

  // inst-add-check-occupied, inst-add-abort-occupied-unknown
  it('aborts when an applied template is installed but its manifest cannot be read', async () => {
    const newTemplate = makeEntry('new-template', [{ path: 'new/index.ts', content: 'new' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['new/'], sharedFiles: [] },
    });
    const corrupted: InventoryEntry = { ...makeEntry('applied-template', []), content: 'not-a-manifest' };
    const entries: Record<string, InventoryEntry> = {
      'new-template': newTemplate,
      'applied-template': corrupted,
    };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    // The record's source-spec must address the same template as the installed
    // entry, or the identity hit is rejected and this exercises the
    // not-installed branch instead of the unreadable-manifest one.
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'applied-template', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/applied-template@v1.0.0' },
      ]),
    );

    const result = await addTemplate(
      'new-template',
      '/target',
      (n: string) => entries[n],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('occupied-manifest-unreadable');
    expect(files.has('/target/new/index.ts')).toBe(false);
  });

  it('adds into an existing repository: stages via the SAME P14 path, submits staged assembly + already-occupied boundaries to P29, materializes ONLY the new contribution, adds one provenance record per newly applied template', async () => {
    const existing = makeEntry('existing-template', [{ path: 'existing/index.ts', content: 'existing' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['existing/'], sharedFiles: [] },
    });
    const newTemplate = makeEntry('new-template', [{ path: 'new/index.ts', content: 'new' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['new/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'existing-template': existing, 'new-template': newTemplate };
    const lookupFn = (n: string) => entries[n];
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([{ templateIdentity: 'existing-template', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/existing-template@v1.0.0' }]),
    );

    const result = await addTemplate(
      'new-template',
      '/target',
      lookupFn,
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appliedTemplates).toEqual(['new-template']);
    // Only the new template's contribution is materialized — the existing
    // template's own file was never re-written by this operation.
    expect(files.get('/target/new/index.ts')).toBe('new');
    expect(files.has('/target/existing/index.ts')).toBe(false);
    const provenance = JSON.parse(files.get('/target/.frontx/provenance.json')!) as ProvenanceRecord[];
    expect(provenance).toHaveLength(2);
    expect(provenance.map((r) => r.templateIdentity)).toEqual(['existing-template', 'new-template']);
  });

  it('aborts with no files written when the template reference cannot be resolved from the local inventory', async () => {
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();

    const result = await addTemplate('missing', '/target', () => undefined, async () => [], readContentFn, writeFileFn, readProvenanceFn, provenanceWriteFn, readTargetPathStateFn, readProjectFileFn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unresolved');
    expect(files.size).toBe(0);
  });

  it('aborts BEFORE any file write when the new template intersects an already-applied boundary', async () => {
    const existing = makeEntry('existing-template', [{ path: 'clash/existing.ts', content: 'existing' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['clash/'], sharedFiles: [] },
    });
    const clashing = makeEntry('clashing-template', [{ path: 'clash/new.ts', content: 'new' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['clash/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'existing-template': existing, 'clashing-template': clashing };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([{ templateIdentity: 'existing-template', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/existing-template@v1.0.0' }]),
    );

    const result = await addTemplate(
      'clashing-template',
      '/target',
      (n) => entries[n],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    if (result.reason === 'conflict') {
      expect(result.conflicts).toEqual([{ ground: 'clash/', contestants: ['clashing-template', 'existing-template'] }]);
    }
    // Only the pre-existing provenance file is present; no new file was written.
    expect(files.size).toBe(1);
    expect(files.has('/target/.frontx/provenance.json')).toBe(true);
  });
});

// inst-add-check-ground-free / inst-add-if-target-not-directory /
// inst-add-abort-target-not-directory / inst-add-if-ground-occupied /
// inst-add-abort-ground-occupied / inst-add-recheck-ground —
// cpt-frontx-dod-cli-scaffolding-add-undeclared-content
describe('addTemplate occupied-ground guard — cpt-frontx-dod-cli-scaffolding-add-undeclared-content', () => {
  const guardedTemplate = makeEntry('guarded-template', [{ path: 'guarded/index.ts', content: 'from the template' }], {
    ownershipBoundaries: { exclusiveSubtrees: ['guarded/'], sharedFiles: [] },
  });
  const lookupFn = (name: string): InventoryEntry | undefined => (name === 'guarded-template' ? guardedTemplate : undefined);
  const listInstalledFn = async (): Promise<InventoryEntry[]> => [guardedTemplate];

  it('refuses a target holding content at a path the template owns that no provenance records, writing no file', async () => {
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    // The whole exposure: a populated directory with no provenance at all reads
    // as an empty occupied set, so the conflict check finds every claim free.
    files.set('/target/guarded/index.ts', 'work this repository already had');

    const result = await addTemplate(
      'guarded-template',
      '/target',
      lookupFn,
      listInstalledFn,
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-holds-undeclared-content');
    if (result.reason !== 'target-holds-undeclared-content') return;
    expect(result.paths).toEqual(['guarded/index.ts']);
    expect(files.get('/target/guarded/index.ts')).toBe('work this repository already had');
  });

  it('adds into a populated directory whose content the template does not claim, so an unprovenanced project stays a supported target', async () => {
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set('/target/README.md', 'someone else wrote this');
    files.set('/target/.git/HEAD', 'ref: refs/heads/main');

    const result = await addTemplate(
      'guarded-template',
      '/target',
      lookupFn,
      listInstalledFn,
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(true);
    expect(files.get('/target/guarded/index.ts')).toBe('from the template');
    expect(files.get('/target/README.md')).toBe('someone else wrote this');
  });

  it('adds over a shared file an applied template already wrote, because its recorded provenance accounts for that ground', async () => {
    // The one way an incoming path can legitimately stand on ground already
    // occupied: a region-union shared file whose earlier contributor is recorded
    // and whose block materialization carries forward. Refusing it would make
    // `add` into a repository this tool itself seeded impossible.
    const applied = makeEntry('applied-template', [], {
      ownershipBoundaries: {
        exclusiveSubtrees: [],
        sharedFiles: [{ path: 'shared.json', mergeStrategy: 'region-union', ownedRegions: ['applied'] }],
      },
    });
    const contributor = makeEntry(
      'contributing-template',
      [{ path: 'shared.json', content: 'frontx:region contributing-template:incoming\nincoming\nfrontx:endregion contributing-template:incoming' }],
      {
        ownershipBoundaries: {
          exclusiveSubtrees: [],
          sharedFiles: [{ path: 'shared.json', mergeStrategy: 'region-union', ownedRegions: ['incoming'] }],
        },
      },
    );
    const entries: Record<string, InventoryEntry> = { 'applied-template': applied, 'contributing-template': contributor };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'applied-template', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/applied-template@v1.0.0' },
      ]),
    );
    files.set(
      '/target/shared.json',
      'frontx:region applied-template:applied\nalready applied\nfrontx:endregion applied-template:applied',
    );

    const result = await addTemplate(
      'contributing-template',
      '/target',
      (name: string) => entries[name],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(true);
    expect(files.get('/target/shared.json')).toContain('already applied');
    expect(files.get('/target/shared.json')).toContain('incoming');
  });

  // A recorded subtree is a path prefix only at a separator boundary: "srcx.ts"
  // is a sibling of "src", not a file inside it. Comparing the two by bare
  // prefix would exempt every path whose name merely starts with a recorded
  // subtree's name, and the guard would wave through the write it exists to
  // refuse.
  it('refuses a path that only shares a prefix with a recorded subtree, since a sibling of it is not inside it', async () => {
    const applied = makeEntry('subtree-owner', [], {
      // Declared without a trailing separator, which the manifest contract
      // permits and real manifests use.
      ownershipBoundaries: { exclusiveSubtrees: ['src'], sharedFiles: [] },
    });
    const sibling = makeEntry('sibling-template', [{ path: 'srcx.ts', content: 'from the template' }], {
      ownershipBoundaries: {
        exclusiveSubtrees: [],
        sharedFiles: [{ path: 'srcx.ts', mergeStrategy: 'exclusive', ownedRegions: [] }],
      },
    });
    const entries: Record<string, InventoryEntry> = { 'subtree-owner': applied, 'sibling-template': sibling };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'subtree-owner', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/subtree-owner@v1.0.0' },
      ]),
    );
    files.set('/target/srcx.ts', 'work this repository already had');

    const result = await addTemplate(
      'sibling-template',
      '/target',
      (name: string) => entries[name],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-holds-undeclared-content');
    expect(files.get('/target/srcx.ts')).toBe('work this repository already had');
  });

  // The sibling case above never reaches the subtree comparison: its incoming
  // template declares no subtree, so `claimed.subtrees` is empty and the
  // separator plays no part. Here BOTH claims declare `src`, which is what makes
  // the trailing-separator normalization load-bearing — compared by bare prefix,
  // `srcx.ts` would read as ground inside `src` that both sides declare, be
  // exempted, and reach the conflict check, which reports the contested `src`
  // subtree and never mentions the content standing on `srcx.ts`.
  // The companion to the sibling case below: there the two claims are spelled
  // the same and the PATH is outside, here the path is inside and the two
  // claims spell one directory two ways. Matching the claims by raw string
  // would make this the guard's refusal — content no provenance accounts for,
  // remedied by moving files the occupant legitimately wrote — instead of the
  // conflict check's, which names both templates and both claims.
  it('leaves ground an occupied claim and an incoming claim spell differently to the conflict check', async () => {
    const applied = makeEntry('slash-owner', [{ path: 'src/main.ts', content: 'from the occupant' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const incoming = makeEntry('bare-claimer', [{ path: 'src/main.ts', content: 'from the incoming template' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['src'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'slash-owner': applied, 'bare-claimer': incoming };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'slash-owner', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/slash-owner@v1.0.0' },
      ]),
    );
    files.set('/target/src/main.ts', 'work the occupant wrote');

    const result = await addTemplate(
      'bare-claimer',
      '/target',
      (name: string) => entries[name],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    if (result.reason !== 'conflict') return;
    expect(result.conflicts).toEqual([{ ground: 'src overlaps src/', contestants: ['bare-claimer', 'slash-owner'] }]);
    expect(files.get('/target/src/main.ts')).toBe('work the occupant wrote');
  });

  it('refuses a sibling of a subtree both claims declare, since only the separator makes a path inside it', async () => {
    const applied = makeEntry('subtree-owner', [], {
      ownershipBoundaries: { exclusiveSubtrees: ['src'], sharedFiles: [] },
    });
    const sibling = makeEntry('sibling-sharer', [{ path: 'srcx.ts', content: 'from the template' }], {
      ownershipBoundaries: {
        exclusiveSubtrees: ['src'],
        sharedFiles: [{ path: 'srcx.ts', mergeStrategy: 'exclusive', ownedRegions: [] }],
      },
    });
    const entries: Record<string, InventoryEntry> = { 'subtree-owner': applied, 'sibling-sharer': sibling };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'subtree-owner', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/subtree-owner@v1.0.0' },
      ]),
    );
    files.set('/target/srcx.ts', 'work this repository already had');

    const result = await addTemplate(
      'sibling-sharer',
      '/target',
      (name: string) => entries[name],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-holds-undeclared-content');
    expect(files.get('/target/srcx.ts')).toBe('work this repository already had');
  });

  // The conflict check compares declared claims for equality, so a path strictly
  // inside ANOTHER template's recorded subtree passes it untouched. Exempting
  // such a path from the guard as well would leave nothing between the incoming
  // whole-file write and the content already there.
  it('refuses a path nested inside another template\'s recorded subtree, which no check arbitrates', async () => {
    const applied = makeEntry('subtree-owner', [], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const nested = makeEntry('nested-template', [{ path: 'src/config/app.json', content: 'from the template' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/config/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'subtree-owner': applied, 'nested-template': nested };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'subtree-owner', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/subtree-owner@v1.0.0' },
      ]),
    );
    files.set('/target/src/config/app.json', 'work this repository already had');

    const result = await addTemplate(
      'nested-template',
      '/target',
      (name: string) => entries[name],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-holds-undeclared-content');
    expect(files.get('/target/src/config/app.json')).toBe('work this repository already had');
  });

  // The same hole in its other shape: the conflict check never compares a
  // shared-file claim against a subtree claim at all, so a shared file declared
  // under someone else's recorded subtree reaches materialization unarbitrated.
  it('refuses a shared file declared under another template\'s recorded subtree', async () => {
    const applied = makeEntry('subtree-owner', [], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const sharing = makeEntry('sharing-template', [{ path: 'src/config.json', content: 'from the template' }], {
      ownershipBoundaries: {
        exclusiveSubtrees: [],
        sharedFiles: [{ path: 'src/config.json', mergeStrategy: 'exclusive', ownedRegions: [] }],
      },
    });
    const entries: Record<string, InventoryEntry> = { 'subtree-owner': applied, 'sharing-template': sharing };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'subtree-owner', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/subtree-owner@v1.0.0' },
      ]),
    );
    files.set('/target/src/config.json', 'work this repository already had');

    const result = await addTemplate(
      'sharing-template',
      '/target',
      (name: string) => entries[name],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-holds-undeclared-content');
    expect(files.get('/target/src/config.json')).toBe('work this repository already had');
  });

  // Ground both claims declare identically IS arbitrated, and the conflict check
  // is the authority that names the contestants. The guard stepping in first
  // would report contested ground as unaccounted-for content and hide which
  // template it contests with.
  it('leaves ground both claims declare identically to the conflict check, which names the contestants', async () => {
    const applied = makeEntry('subtree-owner', [], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const contender = makeEntry('contending-template', [{ path: 'src/index.ts', content: 'from the template' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const entries: Record<string, InventoryEntry> = { 'subtree-owner': applied, 'contending-template': contender };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'subtree-owner', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/subtree-owner@v1.0.0' },
      ]),
    );
    files.set('/target/src/index.ts', 'written by the recorded template');

    const result = await addTemplate(
      'contending-template',
      '/target',
      (name: string) => entries[name],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    expect(files.get('/target/src/index.ts')).toBe('written by the recorded template');
  });

  // A path can be contributed by several templates at once, and the ground they
  // declare is the union of their claims — the preset's root here declares only
  // the shared file, and only the template it references declares the `src/`
  // subtree the recorded claim also declares. Consulting the first contributor
  // alone would leave the path unarbitrated and refuse it as unaccounted
  // content, taking the contest away from the check that names the contestants.
  it('unions the claims of every template contributing a path, so ground only the referenced template declares is still arbitrated', async () => {
    const applied = makeEntry('subtree-owner', [], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const root = makeEntry(
      'union-root',
      [{ path: 'src/shared.json', content: 'frontx:region union-root:root\nroot\nfrontx:endregion union-root:root' }],
      {
        ownershipBoundaries: {
          exclusiveSubtrees: [],
          sharedFiles: [{ path: 'src/shared.json', mergeStrategy: 'region-union', ownedRegions: ['root'] }],
        },
        referencedTemplates: [{ ref: 'union-branch' }],
      },
    );
    const branch = makeEntry(
      'union-branch',
      [{ path: 'src/shared.json', content: 'frontx:region union-branch:branch\nbranch\nfrontx:endregion union-branch:branch' }],
      {
        ownershipBoundaries: {
          exclusiveSubtrees: ['src/'],
          sharedFiles: [{ path: 'src/shared.json', mergeStrategy: 'region-union', ownedRegions: ['branch'] }],
        },
      },
    );
    const entries: Record<string, InventoryEntry> = {
      'subtree-owner': applied,
      'union-root': root,
      'union-branch': branch,
    };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'subtree-owner', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/subtree-owner@v1.0.0' },
      ]),
    );
    files.set('/target/src/shared.json', 'written by the recorded template');

    const result = await addTemplate(
      'union-root',
      '/target',
      (name: string) => entries[name],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('conflict');
    expect(files.get('/target/src/shared.json')).toBe('written by the recorded template');
  });

  // The pre-flight probe deliberately runs ahead of the conflict check
  // (instruction 7 before instruction 10). A target that both holds unaccounted
  // content and contests a declared boundary is therefore refused for the
  // content: that refusal names a path the developer can move, delete or record,
  // while the conflict report would name templates and leave the content that is
  // actually at risk unmentioned.
  it('reports the unaccounted content rather than the boundary conflict when the target holds both', async () => {
    const applied = makeEntry('subtree-owner', [], {
      ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] },
    });
    const contender = makeEntry(
      'contending-template',
      [
        { path: 'src/index.ts', content: 'from the template' },
        { path: 'legacy.json', content: 'from the template' },
      ],
      {
        ownershipBoundaries: {
          exclusiveSubtrees: ['src/'],
          sharedFiles: [{ path: 'legacy.json', mergeStrategy: 'exclusive', ownedRegions: [] }],
        },
      },
    );
    const entries: Record<string, InventoryEntry> = { 'subtree-owner': applied, 'contending-template': contender };
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn, readTargetPathStateFn } = makeFsFake();
    files.set(
      '/target/.frontx/provenance.json',
      JSON.stringify([
        { templateIdentity: 'subtree-owner', scaffoldedFromVersion: '1.0.0', sourceSpec: 'github:acme/subtree-owner@v1.0.0' },
      ]),
    );
    // Unaccounted by any provenance record, and on ground no recorded claim
    // declares — so nothing arbitrates it and only the guard stands in the way.
    files.set('/target/legacy.json', 'work this repository already had');

    const result = await addTemplate(
      'contending-template',
      '/target',
      (name: string) => entries[name],
      async () => Object.values(entries),
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      readTargetPathStateFn,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-holds-undeclared-content');
    if (result.reason !== 'target-holds-undeclared-content') return;
    expect(result.paths).toEqual(['legacy.json']);
    expect(files.get('/target/legacy.json')).toBe('work this repository already had');
  });

  it('refuses a target path that exists and is not a directory, writing no file', async () => {
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn } = makeFsFake();

    const result = await addTemplate(
      'guarded-template',
      '/some-file.txt',
      lookupFn,
      listInstalledFn,
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      async () => 'file',
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-not-directory');
    expect(files.size).toBe(0);
  });

  // inst-add-recheck-ground — the conflict check takes time, so the ground is
  // re-probed immediately before the first write. A probe reporting the path
  // free first and occupied second stands in for a repository that gained
  // content during that window.
  it('refuses on the last-moment re-probe when the target gained content after the pre-flight probe', async () => {
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn } = makeFsFake();
    let probes = 0;
    const flipping = async (path: string): Promise<TargetPathState> => {
      if (path === '/races') return 'directory';
      probes += 1;
      return probes === 1 ? 'absent' : 'file';
    };

    const result = await addTemplate(
      'guarded-template',
      '/races',
      lookupFn,
      listInstalledFn,
      readContentFn,
      writeFileFn,
      readProvenanceFn,
      provenanceWriteFn,
      flipping,
      readProjectFileFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('target-holds-undeclared-content');
    // The point of re-probing at all: nothing was written despite the
    // pre-flight probe having cleared the ground.
    expect(files.size).toBe(0);
  });

  // The one case here that touches a real filesystem: a dangling symlink cannot
  // be represented by the in-memory fake at all, and what makes it dangerous is
  // precisely what the real `stat`/`writeFileSync` pair does with it — resolve
  // the link, find nothing, then create the file the link names, which for
  // `claimed.txt -> ../escaped.txt` lands outside the directory being guarded.
  it('refuses a claimed path held by a dangling symlink, so no write escapes the target directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-escape-'));
    const targetDir = joinWithinRoot(root, 'repo');
    fs.mkdirSync(targetDir);
    // The symlink target '../escaped.txt' is an intentionally escaping
    // relative string (the point of this test), not a path built from `root`
    // — left as a literal, not routed through `joinWithinRoot`.
    fs.symlinkSync('../escaped.txt', joinWithinRoot(targetDir, 'claimed.txt'));
    const escaping = makeEntry('escape-template', [{ path: 'claimed.txt', content: 'from the template' }], {
      ownershipBoundaries: { exclusiveSubtrees: ['claimed.txt'], sharedFiles: [] },
    });

    try {
      const result = await addTemplate(
        'escape-template',
        targetDir,
        () => escaping,
        async () => [escaping],
        readContentFn,
        createFsWriteFileFn(),
        async () => [],
        async () => undefined,
        createFsReadTargetPathStateFn(),
        async () => null,
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('target-holds-undeclared-content');
      // The escape itself: the write would have created this file one level
      // above the directory the developer named.
      expect(fs.existsSync(joinWithinRoot(root, 'escaped.txt'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // A probe that cannot answer must not be read as free ground: a guard that
  // passes because it could not look is the hole it exists to close.
  it('fails closed and writes nothing when the probe cannot read the target', async () => {
    const { files, writeFileFn, provenanceWriteFn, readProvenanceFn, readProjectFileFn } = makeFsFake();
    const refusing = async (): Promise<TargetPathState> => {
      throw new Error('EACCES: permission denied');
    };

    await expect(
      addTemplate(
        'guarded-template',
        '/unreadable',
        lookupFn,
        listInstalledFn,
        readContentFn,
        writeFileFn,
        readProvenanceFn,
        provenanceWriteFn,
        refusing,
        readProjectFileFn,
      ),
    ).rejects.toThrow('EACCES');

    expect(files.size).toBe(0);
  });
});

describe('boundary-declared-assembly DoD — cpt-frontx-dod-cli-scaffolding-boundary-declared-assembly', () => {
  it('reads declared ownership boundaries from the manifest and content from the installed content path scoped to those boundaries, never from the manifest', async () => {
    const entry = makeEntry('template-a', [
      { path: 'template-a/index.ts', content: 'in-bounds' },
      { path: 'unrelated/outside.ts', content: 'out-of-bounds' },
    ]);
    const { files, writeFileFn, provenanceWriteFn, readProjectFileFn } = makeFsFake();

    const result = await seedRepository('template-a', '/target', () => entry, readContentFn, writeFileFn, provenanceWriteFn, targetAbsent, readProjectFileFn);

    expect(result.ok).toBe(true);
    expect(files.get('/target/template-a/index.ts')).toBe('in-bounds');
    expect(files.has('/target/unrelated/outside.ts')).toBe(false);
  });
});
