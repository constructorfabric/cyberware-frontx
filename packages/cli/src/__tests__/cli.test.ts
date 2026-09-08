import { describe, it, expect, vi } from 'vitest';
import { Writable } from 'node:stream';
import {
  parseInvocation,
  helpOutcome,
  usageText,
  run,
  writeToStream,
  writeInteractiveLineOrEscalate,
  EXIT_SUCCESS,
  EXIT_USER_ERROR,
  EXIT_INTERNAL_ERROR,
} from '../cli';
import {
  PathContainmentError,
  NotRegularFileError,
  UnreachablePathError,
  PathUnreadableError,
  ProjectStateUnreadableError,
} from '../adapters/fs-project-io';
import type { CliDeps } from '../cli';
import { TemplateInventory } from '../inventory/TemplateInventory';
import { BUNDLE_MARKER } from '../bundle/envelope';
import { MANIFEST_FILENAME } from '../manifest/types';
import type { FetchFn } from '../resolver/types';
import type { AssertPathWithinRootFn, ContentItem, ReadContentItemsFn, WriteFileFn } from '../scaffold/types';
import type { TargetPathState } from '../commands/add-template';
import type { ListPayloadFilesFn, ResolveDeclaredExclusionFn, ReadFileFn, TemplateManifest } from '../manifest/types';
import type { OwnershipBoundary, ReferencedTemplate } from '../manifest/legacy-ownership';
import type { ProjectStateDocument, ReadProjectStateFn, WriteProjectStateFn } from '../project-state/types';
import type { CanonicalizeTargetFn } from '../scaffold/conflict-check';
import type { ReadExistingContentFn, ReadInstalledContentFn } from '../scaffold/existing-content';

// F18: cpt-frontx-flow-cli-invocation-run-command,
// cpt-frontx-flow-cli-invocation-help,
// cpt-frontx-algo-cli-invocation-parse-dispatch,
// cpt-frontx-state-cli-invocation-run

// Builds the TRANSITIONAL DUAL SHAPE these fixtures need: the current
// four-field contract's own required fields (`readManifestFromContent`, the
// path every dispatched command reads through, rejects anything less), PLUS
// the legacy `ownershipBoundaries` category the retiring
// scaffold/composition/upgrade mechanics these dispatch tests still exercise
// still read straight off raw content (`cpt-frontx-adr-template-manifest-
// contract`). Returned as a plain object rather than `TemplateManifest`,
// since that type no longer declares the legacy field.
// Plain four-field manifest by default — `readManifestFromContent` now wires
// `refuseLegacyManifest` (checkpoint 3+4), so a manifest carrying
// `ownershipBoundaries`/`referencedTemplates` unconditionally, as this
// helper used to build by default, is refused with `INVALID_MANIFEST`
// before any of these dispatch tests reach the behavior they actually mean
// to exercise. Neither legacy field is ever read by any of the current
// (`install`/`list`/`register`/`unregister`/`update-local`/`upgrade`)
// dispatch paths this file tests — only the OLD, now-deleted `add`/`seed`
// path and `upgrade/compute.ts`'s own legacy bridge ever did, and no caller
// here passed either override explicitly. A test that genuinely needs a
// legacy-shaped manifest (to prove a refusal, say) can still pass one via
// `overrides`, exactly as any other field is overridden.
function makeManifest(
  name: string,
  version: string,
  overrides: Partial<TemplateManifest> & {
    ownershipBoundaries?: OwnershipBoundary;
    referencedTemplates?: ReferencedTemplate[];
  } = {},
): Record<string, unknown> {
  const { ownershipBoundaries, referencedTemplates, ...contractOverrides } = overrides;
  return {
    name,
    version,
    excludedSubtrees: [],
    description: 'Establishes the project shell and contributes the build toolchain.',
    ...contractOverrides,
    ...(ownershipBoundaries !== undefined ? { ownershipBoundaries } : {}),
    ...(referencedTemplates !== undefined ? { referencedTemplates } : {}),
  };
}

// A clean four-field manifest — deliberately NOT `makeManifest()` above,
// whose own doc comment explains why it unconditionally adds the legacy
// `ownershipBoundaries` category the OLDER seed/add dispatch tests used to
// exercise: `refuseLegacyManifest` (wired into `readManifestFromContent`
// this checkpoint) now refuses any manifest carrying it outright, which
// would make `register` fail before any of THIS suite's own assemble/
// apply/seed dispatch assertions ever run. Used only by those three new
// describe blocks below.
function cleanManifest(name: string, version = '1.0.0'): Record<string, unknown> {
  return {
    name,
    version,
    excludedSubtrees: [],
    description: `Fixture template "${name}" for the uniform-batch dispatch tests.`,
  };
}

export interface DepsFixture {
  deps: CliDeps;
  registerManifest: (spec: string, manifest: Record<string, unknown>) => void;
  registerContent: (name: string, items: ContentItem[]) => void;
  // Reads back whatever `.frontx/project.json` currently holds in this
  // fixture's in-memory fake store — register/unregister/ownership dispatch
  // tests use this instead of touching a real filesystem.
  readProjectStateDocument: () => ProjectStateDocument | null;
}

// Builds an isolated set of fakes for one test — no real fs/network, per
// this package's dependency-injection test convention.
function makeDeps(overrides: Partial<CliDeps> = {}): DepsFixture {
  const manifestsByRef = new Map<string, string>();
  const contentByName = new Map<string, ContentItem[]>();

  // The resolver builds a GitHub tarball URL from the parsed source-spec
  // (`resolver/resolve.ts` buildFetchUrl): "https://api.github.com/repos/
  // <owner>/<repo>/tarball/<ref>". Reconstruct the "host:owner/repo@ref"
  // spec key from that URL so tests can register fixtures by spec string.
  const fetchFn: FetchFn = vi.fn(async (url: string) => {
    const match = /\/repos\/([^/]+)\/([^/]+)\/tarball\/(.+)$/.exec(url);
    const key = match ? `github:${match[1]}/${match[2]}@${match[3]}` : url;
    const manifest = manifestsByRef.get(key);
    if (!manifest) throw new Error(`no manifest registered for fetch url "${url}"`);
    return manifest;
  });

  const readContentFn: ReadContentItemsFn = vi.fn(async (entry) => contentByName.get(entry.name) ?? []);
  const writeFileFn: WriteFileFn = vi.fn(async () => undefined);
  const readFileFn: ReadFileFn = vi.fn(async () => {
    throw new Error('manifest not found');
  });
  // Default fixture finds no payload files and no on-disk declared exclusion,
  // so `validate` dispatch tests that don't care about content
  // self-containment exercise only the manifest-contract path (matching this
  // file's existing coverage before #493).
  const listPayloadFilesFn: ListPayloadFilesFn = vi.fn(async () => []);
  const resolveDeclaredExclusionFn: ResolveDeclaredExclusionFn = vi.fn(async (): Promise<'ABSENT' | 'RESOLVED'> => 'ABSENT');

  // In-memory fake for `.frontx/project.json`, isolated per fixture — the
  // register/unregister/ownership dispatch tests below read and write
  // through this instead of any real filesystem, per this suite's own
  // no-real-fs-or-network convention.
  let projectStateContent: string | null = null;
  const readProjectStateFn: ReadProjectStateFn = vi.fn(async () => projectStateContent);
  const writeProjectStateFn: WriteProjectStateFn = vi.fn(async (_absolutePath, content) => {
    projectStateContent = content;
  });
  // Identity by default — every dispatch fixture's paths are already
  // well-formed project-relative strings, so real symlink/`..`-escape
  // resolution is not this suite's concern (that seam has its own real-fs
  // coverage in `adapters/__tests__/fs-canonicalize-target.test.ts`).
  const createCanonicalizeTargetFn = vi.fn((): CanonicalizeTargetFn => (rawTarget: string) => rawTarget);
  // No-op for the identical reason `createCanonicalizeTargetFn` above is an
  // identity: this suite's own dispatch fixtures use notional roots
  // (`/tmp/fresh-repo`, and this file's own real `process.cwd()` for
  // `apply`/`delete`) with no real escaping-symlink scenario to prove —
  // that seam's own real-fs coverage lives in `__tests__/fs-
  // containment.test.ts`.
  const createAssertPathWithinRootFn = vi.fn((): AssertPathWithinRootFn => () => undefined);

  const deps: CliDeps = {
    inventory: new TemplateInventory(),
    fetchFn,
    readContentFn,
    writeFileFn,
    readFileFn,
    listPayloadFilesFn,
    resolveDeclaredExclusionFn,
    // Same notional paths seen from the old add flow's probe: nothing stands
    // at them, so its occupied-ground guard clears (`ownership add` dispatch
    // still uses this seam; the refusal cases override it).
    readTargetPathStateFn: vi.fn(async (): Promise<TargetPathState> => 'absent'),
    // `seed`'s own `<dir>` pre-flight — every dispatch fixture's notional
    // `/tmp/...-repo` argument is meant to be usable, so this defaults to
    // "directory" (never the `readTargetPathStateFn` default above, which
    // is chosen for a DIFFERENT command's occupied-ground probe). The
    // dedicated invalid-path tests override this to `'absent'`/`'file'`.
    readSeedDirStateFn: vi.fn(async (): Promise<TargetPathState> => 'directory'),
    // A local `path:` origin's folder is presumed to exist and to hold no
    // files beyond the manifest `readFileFn` above already fixtures by
    // path — dispatch fixtures in this suite are not exercising the
    // resolver's own folder-enumeration branch, only that a local origin
    // resolves at all.
    existsFn: vi.fn(async () => true),
    listFolderFilesFn: vi.fn(async () => []),
    // `assemble`/`apply`/`seed` — the installed-content-path resolver is the
    // identity function here: content is registered (and read back) keyed by
    // the template's own NAME, exactly as `readContentFn`/`registerContent`
    // above already key it, so `resolveInstalledContentPathFn(name)` handing
    // back `name` itself lets `createReadInstalledContentFn` below read from
    // the SAME `contentByName` map without a second content registry.
    resolveInstalledContentPathFn: vi.fn((name: string) => name),
    createReadInstalledContentFn: vi.fn(
      (): ReadInstalledContentFn =>
        async (installedContentPath) => contentByName.get(installedContentPath) ?? [],
    ),
    // Dispatch fixtures aim at a target with nothing already on disk by
    // default — the ordinary case for a fresh apply/seed target; a test
    // exercising existing-content reconciliation overrides this.
    createReadExistingContentFn: vi.fn((): ReadExistingContentFn => async () => []),
    // Wired to the SAME in-memory `.frontx/project.json` fake `readProjectStateFn`/
    // `writeProjectStateFn` below read and write — this fixture keeps exactly
    // one flat document, so an unconditional clear is faithful to what the
    // real adapter does to the ONE file it is ever asked to remove here
    // (`seed`'s own rollback). Delete/upgrade dispatch tests that exercise
    // `removeProjectFile` always override `readProjectStateFn`/
    // `writeProjectStateFn` with their own `seededProjectState` closure, so
    // this default never reaches (and can never corrupt) their state.
    removeProjectFile: vi.fn(async () => {
      projectStateContent = null;
    }),
    // `seed`'s own rollback — no dispatch fixture models a real `.frontx`
    // directory, so this is a harmless no-op by default; the rollback test
    // overrides it to assert it was called.
    removeEmptyDirFn: vi.fn(async () => undefined),
    readProjectStateFn,
    writeProjectStateFn,
    createCanonicalizeTargetFn,
    createAssertPathWithinRootFn,
    // `delete` dispatch fixtures aim at notional paths with nothing on disk,
    // so the default enumeration is empty; interactive confirmation
    // defaults to "declined". The `delete`-specific dispatch tests override
    // these.
    listTargetFilesFn: vi.fn(async () => []),
    listUnenumerableTargetEntriesFn: vi.fn(async () => []),
    confirmDeletion: vi.fn(async (): Promise<'confirmed' | 'declined'> => 'declined'),
    // `upgrade`'s own interactive plan-approval prompt — same "declined by
    // default" discipline as `confirmDeletion` above; the upgrade dispatch
    // tests exercise `--json` mode instead of overriding this.
    presentUpgradePlan: vi.fn(async (): Promise<'approved' | 'declined'> => 'declined'),
    ...overrides,
  };

  return {
    deps,
    registerManifest: (spec, manifest) => manifestsByRef.set(spec, JSON.stringify(manifest)),
    registerContent: (name, items) => contentByName.set(name, items),
    readProjectStateDocument: () => (projectStateContent ? (JSON.parse(projectStateContent) as ProjectStateDocument) : null),
  };
}

describe('parseInvocation (cpt-frontx-algo-cli-invocation-parse-dispatch)', () => {
  it('treats no argv as a help request', () => {
    const parsed = parseInvocation([]);
    expect(parsed.command).toBeUndefined();
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.unrecognized).toBe(false);
  });

  it('treats "help", "-h" and "--help" as a help request', () => {
    for (const token of ['help', '-h', '--help']) {
      const parsed = parseInvocation([token]);
      expect(parsed.helpRequested).toBe(true);
      expect(parsed.unrecognized).toBe(false);
    }
  });

  it('parses a leading command token and its remaining arguments', () => {
    const parsed = parseInvocation(['install', 'github:acme/foo@v1.0.0', '--extra']);
    expect(parsed.command).toBe('install');
    expect(parsed.args).toEqual(['github:acme/foo@v1.0.0', '--extra']);
    expect(parsed.helpRequested).toBe(false);
    expect(parsed.unrecognized).toBe(false);
  });

  it('flags an unrecognized command token', () => {
    const parsed = parseInvocation(['bogus-command']);
    expect(parsed.unrecognized).toBe(true);
    expect(parsed.helpRequested).toBe(false);
  });
});

describe('usage/help (cpt-frontx-flow-cli-invocation-help)', () => {
  it('lists every dispatchable command', () => {
    const text = usageText();
    for (const cmd of ['install', 'list', 'update-local', 'validate', 'seed', 'add', 'upgrade']) {
      expect(text).toContain(cmd);
    }
  });

  it('emits usage and exits success for a help request', () => {
    const outcome = helpOutcome(parseInvocation(['help']));
    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('Usage: frontx');
  });

  it('emits usage and exits user-error for an unrecognized command', () => {
    const outcome = helpOutcome(parseInvocation(['bogus-command']));
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toContain('Unrecognized command');
    expect(outcome.stderr).toContain('Usage: frontx');
  });

  // `frontx nosuchcommand --json` must not write usage text to stderr and
  // NOTHING to stdout: an unrecognized command never reaches a dispatch
  // case that could parse `--json` out of its own args, so every known
  // command's own envelope handling would otherwise leave this one path
  // behind. `--json` mode gets exactly one JSON value on stdout, per
  // ADR-0042, and nothing on stderr.
  it('emits the shared err envelope on stdout, and nothing on stderr, for an unrecognized command under --json', () => {
    const outcome = helpOutcome(parseInvocation(['nosuchcommand', '--json']));
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('nosuchcommand');
  });

  // `help` was the one dispatchable request that still tolerated trailing
  // garbage after every OTHER command gained strict extra-argument rejection
  // (`rejectUnrecognizedArgs`) in an earlier round: `frontx help extra --json`
  // used to exit 0 and print usage with `extra` never even inspected.
  it('rejects an unrecognized extra argument to an explicit help request instead of silently ignoring it', () => {
    const outcome = helpOutcome(parseInvocation(['help', 'extra']));
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toContain('Unrecognized argument(s) for help: extra');
  });

  it('rejects an unrecognized extra argument to an explicit help request under --json, on stdout as the shared envelope', () => {
    const outcome = helpOutcome(parseInvocation(['help', 'extra', '--json']));
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('extra');
  });

  // `--json` is refused for `help` rather than tolerated and ignored: `help`
  // has no result to render, so it advertises no `--json` of its own in
  // `usageText()`, and answering the flag with plain usage prose would leave
  // the one invocation on this surface that responds to `--json` with
  // something no parser can read. The refusal itself IS an envelope, so an
  // agent that appends `--json` to every invocation still gets a parseable —
  // and truthful — answer. See `helpOutcome`'s own comment for the full
  // reasoning behind choosing this over adding a JSON mode to `help`.
  it('refuses --json for help itself, answering in the envelope rather than printing prose no parser can read', () => {
    const outcome = helpOutcome(parseInvocation(['help', '--json']));
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('--json');
  });

  // The no-command and token-form help requests keep working untouched: they
  // carry no arguments of their own for the new strictness to inspect.
  it.each([[[]], [['help']], [['--help']], [['-h']]])(
    'still prints usage and exits 0 for %j',
    (argv: string[]) => {
      const outcome = helpOutcome(parseInvocation(argv));
      expect(outcome.exitCode).toBe(EXIT_SUCCESS);
      expect(outcome.stdout).toContain('Usage: frontx <command> [args]');
    },
  );

  it('run() propagates the same --json envelope for an unrecognized command end-to-end', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['nosuchcommand', '--json'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toBeUndefined();
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('run() defers to help for no command, dispatching nothing', async () => {
    const { deps } = makeDeps();
    const outcome = await run([], deps);
    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it('run() defers to help for an unrecognized command with user-error exit', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['bogus-command'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });
});

describe('dispatch: install (cpt-frontx-flow-template-resolution-install)', () => {
  it('dispatches to the install behavior exactly once and exits success', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));

    const outcome = await run(['install', 'github:acme/foo@v1.0.0'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('Installed foo');
    expect(deps.fetchFn).toHaveBeenCalledTimes(1);
  });

  // inst-run-render-output / cpt-frontx-adr-uniform-cli-json-envelope —
  // `install` ignored `--json` outright: it wrote a human sentence to stderr
  // and NOTHING to stdout, so a caller asking for the machine-readable form
  // saw an empty stream it could not parse and a refusal it could not read.
  it('renders the envelope on stdout under --json, with nothing on stderr', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));

    const outcome = await run(['install', 'github:acme/foo@v1.0.0', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stderr).toBeUndefined();
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: true });
  });

  // The code has to survive resolver -> inventory -> install command ->
  // dispatcher. It was dropped at all three of the last links, so a refused
  // manifest arrived as no code at all here.
  it('reports INVALID_MANIFEST in the envelope when the resolved manifest is refused', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest(
      'github:acme/legacy@v1.0.0',
      makeManifest('legacy', '1.0.0', { ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] } }),
    );

    const outcome = await run(['install', 'github:acme/legacy@v1.0.0', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('INVALID_MANIFEST');
  });

  // Acceptance criterion (FEATURE.md:409): a source-spec naming a subtree
  // that holds no content at the referenced version fails with
  // `ORIGIN_UNAVAILABLE` identifying the subtree, and nothing reaches the
  // local inventory. The fetch fixture is registered at the REPOSITORY
  // address (no subtree) because `resolver/resolve.ts`'s own `buildFetchUrl`
  // deliberately excludes the subtree from the fetch URL — acquisition stays
  // whole-repository and the subtree is a filter applied afterward.
  it('reports ORIGIN_UNAVAILABLE naming the subtree, and installs nothing, when the addressed subtree holds no content', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/templates@v1.0.0', {
      [BUNDLE_MARKER]: {
        [`shell/${MANIFEST_FILENAME}`]: JSON.stringify(makeManifest('acme-shell', '1.0.0')),
        'shell/src/index.ts': 'shell-source',
      },
    });

    const outcome = await run(['install', 'github:acme/templates//absent@v1.0.0', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('ORIGIN_UNAVAILABLE');
    expect(envelope.error.message).toContain('absent');
    // Nothing was written to the local inventory: the subtree never resolved
    // to a manifest identity, so there is nothing installed under any name.
    expect(await deps.inventory.list()).toEqual([]);
  });

  it('refuses an unrecognized argument rather than silently ignoring it', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['install', 'github:acme/foo@v1.0.0', '--jsonl'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toContain('Unrecognized argument(s) for install');
  });

  it('exits user-error when the <spec> argument is missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['install'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it('exits user-error when the source-spec fails to resolve', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['install', 'not-a-valid-spec'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('exits internal-error when the dispatched behavior fails unexpectedly', async () => {
    // The shared resolver already turns a fetch failure into an ok:false
    // USER-facing result (resolver/resolve.ts inst-resolve-fetch-fail) — so
    // an unexpected THROW from the dispatched behavior itself (not a
    // reported user/input failure) is what must map to internal-error here.
    const brokenInventory = {
      install: vi.fn(async () => {
        throw new Error('inventory store exploded');
      }),
    } as unknown as TemplateInventory;
    const { deps } = makeDeps({ inventory: brokenInventory });
    const outcome = await run(['install', 'github:acme/foo@v1.0.0'], deps);
    expect(outcome.exitCode).toBe(EXIT_INTERNAL_ERROR);
    expect(outcome.stderr).toContain('inventory store exploded');
  });
});

describe('dispatch: list (cpt-frontx-flow-template-resolution-list)', () => {
  it('exits success with an empty-inventory message when nothing is installed', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['list'], deps);
    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toBe('No templates installed.');
  });

  // inst-list-project-invalid-check / inst-list-project-invalid-return — a
  // PRESENT-but-unreadable project state document refuses the listing. Before
  // this, `list` never read the document at all and answered `ok: true` with a
  // full listing over state it could not parse.
  it('refuses with PROJECT_INVALID under --json when a present project state document does not satisfy the contract', async () => {
    const { deps, registerManifest } = makeDeps({ readProjectStateFn: vi.fn(async () => '{ not valid json') });
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));

    const outcome = await run(['list', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('PROJECT_INVALID');
    // The refusal replaces the listing outright rather than riding alongside
    // it — the envelope carries no `templates` collection at all. Asserted on
    // the parsed shape, not the raw text: the contract-violation message
    // itself names the document's expected fields, `templates` among them.
    expect(envelope).not.toHaveProperty('templates');
    expect(envelope).not.toHaveProperty('data.templates');
  });

  it('reports the same failure as text in the human-readable form', async () => {
    const { deps } = makeDeps({ readProjectStateFn: vi.fn(async () => '{ not valid json') });

    const outcome = await run(['list'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toContain('could not be parsed');
    expect(outcome.stdout).toBeUndefined();
  });

  // The real `createFsReadProjectStateFn` (`../adapters/fs-project-io.ts`)
  // wraps every one of its own three read-side refusals (a FIFO/socket/
  // device/directory/dangling symlink at the document path; an ancestor that
  // is not a directory; a permission refusal) into ONE `ProjectStateUnreadableError`
  // specifically so this document's own unreadability always reports
  // `PROJECT_INVALID` — the same code the malformed-JSON case above already
  // gets — rather than the `CONTENT_CONFLICT` a bare `NotRegularFileError`
  // would collapse into at this same dispatcher catch (below).
  it('refuses with PROJECT_INVALID, not CONTENT_CONFLICT, when the project state document itself is unreadable', async () => {
    const { deps } = makeDeps({
      readProjectStateFn: vi.fn(async () => {
        throw new ProjectStateUnreadableError(
          '/repo/.frontx/project.json',
          new NotRegularFileError('/repo/.frontx/project.json', 'fifo'),
        );
      }),
    });

    const outcome = await run(['list', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('PROJECT_INVALID');
    // Carries the UNDERLYING reason, not just a generic "unreadable" label —
    // a caller told this document is a FIFO knows to remove it, not to
    // re-run the same command hoping for a different answer.
    expect(envelope.error.message).toContain('FIFO');
  });

  // A path read some OTHER content had to inspect (never the project state
  // document, which is refused above with its own code) reached this exact
  // shape of refusal too, before `resolvePathKind` distinguished a wrong-
  // shape leaf (`NotRegularFileError`) from an ancestor that is not a
  // directory (`UnreachablePathError`) from a permission refusal
  // (`PathUnreadableError`). All three report `CONTENT_CONFLICT` — the same
  // code every OTHER "the disk holds something this operation cannot work
  // with" refusal in this package already uses — rather than an internal
  // failure with no envelope under `--json`.
  it.each([
    ['NotRegularFileError', new NotRegularFileError('/repo/some/manifest.json', 'socket')],
    ['UnreachablePathError', new UnreachablePathError('/repo/some/manifest.json', '/repo/some')],
    ['PathUnreadableError', new PathUnreadableError('/repo/some/manifest.json', 'EACCES')],
  ])('maps %s to CONTENT_CONFLICT with the user-error exit code, never an internal failure', async (_name, typedError) => {
    const { deps } = makeDeps({
      readProjectStateFn: vi.fn(async () => {
        throw typedError;
      }),
    });

    const outcome = await run(['list', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('CONTENT_CONFLICT');
  });

  // Absence is not invalidity: `readProjectState` answers a missing document
  // with the initial empty shape, so `list` outside any project still
  // enumerates the inventory.
  it('still lists when no project state document is present at all', async () => {
    const { deps, registerManifest } = makeDeps({ readProjectStateFn: vi.fn(async () => null) });
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));
    await run(['install', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['list'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('foo@1.0.0');
  });

  it('lists a previously installed template', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));
    await run(['install', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['list'], deps);
    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('foo@1.0.0');
  });

  // inst-list-format-machine — the surface a calling program obtains the
  // selectable set over, instead of reading this CLI's inventory storage. An
  // `install`ed (never registered) template lands in `data.installed`; the
  // other two sets are empty since nothing was registered and none of the
  // two real official defaults resolve against this fixture's fake `readFileFn`.
  it('emits one structured record per entry carrying identity, resolved version, origin and declared description under --json', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest(
      'github:acme/foo@v1.0.0',
      makeManifest('foo', '1.0.0', { description: 'Establishes the thing and contributes the other thing.' }),
    );
    await run(['install', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['list', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '')).toEqual({
      ok: true,
      data: {
        defaults: [],
        registered: [],
        installed: [
          {
            name: 'foo',
            version: '1.0.0',
            origin: 'github:acme/foo@v1.0.0',
            description: 'Establishes the thing and contributes the other thing.',
          },
        ],
      },
    });
  });

  // Regression guard for the defect §1.5 now names explicitly: `version` must
  // report the entry's OWN MANIFEST version in every set, never the ref an
  // origin was resolved through. The two fixtures below deliberately pick a
  // manifest version ('2.3.1') and a ref ('v9.9.9') that share no characters,
  // so a listing that leaked the ref through by mistake could not pass by
  // coincidence the way the adjacent fixtures' 'v1.0.0' vs '1.0.0' could.
  // Covers both the `installed` position (an entry only `install`ed) and the
  // `registered` position (a separate entry `register`ed, which installs it
  // too) in one test, since the two sets are disjoint by name and a single
  // entry can never occupy both at once.
  it('reports the manifest-declared version, never the resolved ref, in both the registered and the installed position', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest(
      'github:acme/foo@v9.9.9',
      makeManifest('foo', '2.3.1', { description: 'Installed-only fixture for the version-vs-ref regression guard.' }),
    );
    await run(['install', 'github:acme/foo@v9.9.9'], deps);
    registerManifest(
      'github:acme/bar@v9.9.9',
      makeManifest('bar', '2.3.1', { description: 'Registered fixture for the version-vs-ref regression guard.' }),
    );
    await run(['register', 'github:acme/bar@v9.9.9'], deps);

    const outcome = await run(['list', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    const parsed = JSON.parse(outcome.stdout ?? '') as {
      data: { registered: Array<{ name: string; version: string }>; installed: Array<{ name: string; version: string }> };
    };
    expect(parsed.data.installed).toEqual([
      {
        name: 'foo',
        version: '2.3.1',
        origin: 'github:acme/foo@v9.9.9',
        description: 'Installed-only fixture for the version-vs-ref regression guard.',
      },
    ]);
    expect(parsed.data.registered).toEqual([
      {
        name: 'bar',
        origin: 'github:acme/bar@v9.9.9',
        version: '2.3.1',
        targets: [],
        description: 'Registered fixture for the version-vs-ref regression guard.',
      },
    ]);
  });

  // Under the OLD contract (five categories), `description` was optional and
  // a "conforming manifest that simply declares none" was a real, reachable
  // state — this case used to omit the key entirely rather than reporting it
  // as unreadable. The four-field contract (`cpt-frontx-contract-template-
  // manifest`) removed that state outright: `description` is now required
  // and non-empty, and `readManifestFromContent` enforces the WHOLE contract
  // at install time too, so a manifest omitting it is refused before it ever
  // reaches the inventory — there is no successor "conforming, but no
  // description" scenario left to test. Adapted to verify the new true
  // behavior instead of the old one: the entry has to be installed valid and
  // then drift out of contract afterward (same technique the adjacent "flags
  // an entry whose stored manifest no longer satisfies the contract" case
  // uses), since install itself would otherwise refuse the manifest outright.
  it('flags an entry whose manifest omits the now-required description as manifestUnreadable, rather than reporting it as declaring none', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0', { description: 'Establishes a thing.' }));
    await run(['install', 'github:acme/foo@v1.0.0'], deps);
    const stored = deps.inventory.lookup('foo');
    if (!stored) throw new Error('fixture: expected "foo" to be installed');
    const drifted = JSON.parse(stored.content) as Record<string, unknown>;
    delete drifted.description;
    stored.content = JSON.stringify(drifted);

    const outcome = await run(['list', '--json'], deps);

    const parsed: unknown = JSON.parse(outcome.stdout ?? '');
    expect(parsed).toEqual({
      ok: true,
      data: {
        defaults: [],
        registered: [],
        installed: [{ name: 'foo', origin: 'github:acme/foo@v1.0.0', manifestUnreadable: true }],
      },
    });
  });

  it('emits three empty collections rather than the empty-inventory message under --json', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['list', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '')).toEqual({
      ok: true,
      data: { defaults: [], registered: [], installed: [] },
    });
  });

  // The envelope's KEY NAMES are the contract (F10 §1.5): the AI Tooling
  // Framework reads this over a process boundary and cannot see these types, so
  // renaming `data`/`installed` (or a field within one of its entries) breaks
  // it with no compile-time edge to report it. Asserting the keys is what
  // makes that rename fail here instead of in the kit — the value-shape
  // assertions above all survive it.
  it('names the envelope keys the machine-readable contract fixes, so a rename fails here', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0', { description: 'Establishes a thing.' }));
    await run(['install', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['list', '--json'], deps);

    // Narrowed rather than cast: a cast would assert the very shape this case
    // exists to verify, so a rename would satisfy the compiler and the
    // assertion alike.
    const parsed: unknown = JSON.parse(outcome.stdout ?? '');
    if (typeof parsed !== 'object' || parsed === null) throw new Error('expected a JSON object envelope');
    expect(Object.keys(parsed).sort()).toEqual(['data', 'ok']);
    expect(Reflect.get(parsed, 'ok')).toBe(true);

    const data: unknown = Reflect.get(parsed, 'data');
    if (typeof data !== 'object' || data === null) throw new Error('expected a "data" object');
    expect(Object.keys(data).sort()).toEqual(['defaults', 'installed', 'registered']);

    const installed: unknown = Reflect.get(data, 'installed');
    if (!Array.isArray(installed)) throw new Error('expected "installed" to be an array');

    const record: unknown = installed[0];
    if (typeof record !== 'object' || record === null) throw new Error('expected a record object');
    expect(Object.keys(record).sort()).toEqual(['description', 'name', 'origin', 'version']);
  });

  // inst-list-format-machine — `readManifestFromContent` rejects on ANY contract
  // violation, so a manifest that drifted out of contract in a way unrelated to
  // the description still yields no description. It is reported as its own cause
  // rather than as "declares none": a caller told a template describes nothing
  // goes looking for a better-described template, where one told the manifest is
  // unreadable knows to reinstall this one.
  it('flags an entry whose stored manifest no longer satisfies the contract, rather than reporting it as declaring none', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0', { description: 'Establishes a thing.' }));
    await run(['install', 'github:acme/foo@v1.0.0'], deps);
    // Drift the STORED manifest out of contract after install, on a category
    // unrelated to the description: version is required and must be non-empty.
    const stored = deps.inventory.lookup('foo');
    if (!stored) throw new Error('fixture: expected "foo" to be installed');
    stored.content = JSON.stringify({ ...JSON.parse(stored.content), version: '' });

    const outcome = await run(['list', '--json'], deps);

    expect(JSON.parse(outcome.stdout ?? '')).toEqual({
      ok: true,
      data: {
        defaults: [],
        registered: [],
        installed: [{ name: 'foo', origin: 'github:acme/foo@v1.0.0', manifestUnreadable: true }],
      },
    });
  });

  // Distinct from the previous case (description key absent entirely): the
  // four-field contract rejects a description that is present but only
  // whitespace just as firmly (`description.trim() === ''`) — also flagged
  // manifestUnreadable, never reported as "declares none". Installed valid
  // and drifted afterward for the same reason as the previous case: install
  // itself enforces the whole contract and would otherwise refuse it outright.
  it('also flags a manifest whose description is present but only whitespace as manifestUnreadable', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0', { description: 'Establishes a thing.' }));
    await run(['install', 'github:acme/foo@v1.0.0'], deps);
    const stored = deps.inventory.lookup('foo');
    if (!stored) throw new Error('fixture: expected "foo" to be installed');
    stored.content = JSON.stringify({ ...JSON.parse(stored.content), description: '   ' });

    const outcome = await run(['list', '--json'], deps);

    expect(JSON.parse(outcome.stdout ?? '')).toEqual({
      ok: true,
      data: {
        defaults: [],
        registered: [],
        installed: [{ name: 'foo', origin: 'github:acme/foo@v1.0.0', manifestUnreadable: true }],
      },
    });
  });

  // A near-miss flag used to fall through to the HUMAN output at exit 0, so a
  // calling program saw success and unparseable text.
  it('refuses an unrecognized flag rather than silently emitting the human listing', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['list', '--jsonl'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stdout).toBeUndefined();
    expect(outcome.stderr).toContain('--jsonl');
    expect(outcome.stderr).toContain('frontx list [--json]');
  });

  // `frontx list --json --jsonl` must not report the refusal on stderr with
  // NOTHING on stdout when `--json` is right there in argv: the near-miss
  // check must not run before `jsonMode` is computed. Reading `jsonMode`
  // first makes the refusal itself render through the same envelope every
  // other `--json` failure does.
  it('refuses an unrecognized flag through the shared envelope when --json is also present', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['list', '--json', '--jsonl'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('--jsonl');
  });

  // A repeated recognized flag names the same form unambiguously, so it is
  // accepted rather than refused as a duplicate.
  it('accepts a repeated --json flag rather than refusing it as a duplicate', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['list', '--json', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '')).toEqual({
      ok: true,
      data: { defaults: [], registered: [], installed: [] },
    });
  });

  // inst-list-format — a description never appears in the human form (that is
  // the machine form's own extra work, `inst-list-format-machine`); the human
  // form reports each set's entries as name and version only, one section per
  // set, all three sections always present.
  it('lists an installed-but-unregistered template under "Installed:" as name and version, without its description', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0', { description: 'Establishes a thing.' }));
    await run(['install', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['list'], deps);

    expect(outcome.stdout).toBe('Defaults:\n  (none)\n\nRegistered:\n  (none)\n\nInstalled:\n  foo@1.0.0');
  });

  // A registered template's content was materialized into the local
  // inventory by `register`'s own remote-origin install (same as `install`
  // itself), so its description is read back from there rather than
  // re-fetched — `list` never touches the network. `registered` and
  // `installed` are disjoint by name: a registered identity is reported once,
  // under `registered`, never doubled into `installed` too.
  it('reports a registered template under data.registered — never doubled into data.installed — with its description read back from the local inventory', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0', { description: 'Establishes a thing.' }));
    await run(['register', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['list', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '')).toEqual({
      ok: true,
      data: {
        defaults: [],
        registered: [
          {
            name: 'foo',
            origin: 'github:acme/foo@v1.0.0',
            version: '1.0.0',
            targets: [],
            description: 'Establishes a thing.',
          },
        ],
        installed: [],
      },
    });
  });

  // `defaults` is the ONE set §1.5 requires to be independent of the current
  // project's `.frontx/project.json`: sourced from the CLI's own built-in
  // list (`OFFICIAL_DEFAULT_TEMPLATES`), resolved through the same local
  // `path:` resolution `register` already uses for a local origin — never
  // through the project's own `templates` map, which here names an entirely
  // unrelated template ("foo") and is asserted alongside `defaults` to prove
  // the two do not influence each other.
  it("reports the platform's default templates from its own built-in list, independent of the current project's registered templates", async () => {
    const { deps, registerManifest } = makeDeps({
      readFileFn: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('template-mfe/frontx-template.json')) {
          return JSON.stringify(cleanManifest('@gears-frontx/frontx-template-mfe', '0.1.0-alpha.0'));
        }
        if (filePath.endsWith('template-shell/frontx-template.json')) {
          return JSON.stringify(cleanManifest('@gears-frontx/frontx-template-shell', '0.1.0-alpha.2'));
        }
        throw new Error(`unexpected readFileFn path: ${filePath}`);
      }),
    });
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));
    await run(['register', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['list', '--json'], deps);

    const parsed = JSON.parse(outcome.stdout ?? '') as { data: { defaults: unknown; registered: unknown[] } };
    // The project's OWN registered template ("foo") is visible under
    // `registered` (asserted so this is a meaningful independence check, not
    // a vacuous one against an unregistered project).
    expect(parsed.data.registered).toHaveLength(1);
    // `defaults` names only the CLI's own built-in identities — "foo" is not
    // one of them, and is not among the ones returned here.
    expect(parsed.data.defaults).toEqual([
      {
        name: '@gears-frontx/frontx-template-mfe',
        version: '0.1.0-alpha.0',
        description: `Fixture template "@gears-frontx/frontx-template-mfe" for the uniform-batch dispatch tests.`,
      },
      {
        name: '@gears-frontx/frontx-template-shell',
        version: '0.1.0-alpha.2',
        description: `Fixture template "@gears-frontx/frontx-template-shell" for the uniform-batch dispatch tests.`,
      },
    ]);
  });
});

describe('dispatch: update-local (cpt-frontx-flow-template-resolution-update-local)', () => {
  it('exits user-error when the template is not yet installed', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['update-local', 'foo', 'github:acme/foo@v2.0.0'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('dispatches once and exits success for an already-installed template', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));
    registerManifest('github:acme/foo@v2.0.0', makeManifest('foo', '2.0.0'));
    await run(['install', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['update-local', 'foo', 'github:acme/foo@v2.0.0'], deps);
    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('Updated foo');
    expect(deps.fetchFn).toHaveBeenCalledTimes(2);
  });

  it('exits user-error when required arguments are missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['update-local', 'foo'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });
});

describe('dispatch: validate (cpt-frontx-flow-template-manifest-validate-for-publication)', () => {
  it('exits success when the manifest passes validation', async () => {
    const manifest = makeManifest('foo', '1.0.0');
    const readFileFn: ReadFileFn = vi.fn(async () => JSON.stringify(manifest));
    const { deps } = makeDeps({ readFileFn });

    const outcome = await run(['validate', '/tmp/some-template'], deps);
    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('PASS');
    expect(readFileFn).toHaveBeenCalledTimes(1);
  });

  it('exits user-error when the manifest is missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['validate', '/tmp/absent-template'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toContain('manifest not found');
  });

  it('exits user-error when the <templateDir> argument is missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['validate'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  // `frontx validate tpl --json` must not print the human "PASS: ..."
  // sentence to stdout with no envelope: the pre-publish path must look at
  // `--json` and route through the same shared envelope every other
  // command's `--json` mode uses (ADR-0042).
  it('emits the shared ok envelope under --json when the manifest passes validation', async () => {
    const manifest = makeManifest('foo', '1.0.0');
    const readFileFn: ReadFileFn = vi.fn(async () => JSON.stringify(manifest));
    const { deps } = makeDeps({ readFileFn });

    const outcome = await run(['validate', '/tmp/some-template', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stderr).toBeUndefined();
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: true, data: { status: 'PASS' } });
  });

  it('emits the shared err envelope under --json when the manifest fails validation', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['validate', '/tmp/absent-template', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('INVALID_MANIFEST');
    expect(envelope.error.message).toContain('manifest not found');
  });

  // Extra-argument strictness (defect #1) is shared across commands through
  // one `rejectUnrecognizedArgs` helper — `validate <templateDir>` is one of
  // the commands proving that, alongside `validate --project` and
  // `register`/`unregister` below.
  it('refuses an unrecognized argument rather than silently ignoring it', async () => {
    const manifest = makeManifest('foo', '1.0.0');
    const readFileFn: ReadFileFn = vi.fn(async () => JSON.stringify(manifest));
    const { deps } = makeDeps({ readFileFn });

    const outcome = await run(['validate', '/tmp/some-template', 'unexpected'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toContain('Unrecognized argument(s) for validate');
    expect(outcome.stderr).toContain('unexpected');
  });
});

describe('dispatch: validate --project (cpt-frontx-flow-composed-provenance-validate-project)', () => {
  it('exits success (PASS) when no project state document exists yet', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['validate', '--project'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('PASS');
  });

  it('exits user-error and emits the shared err envelope under --json for a refusal', async () => {
    const { deps } = makeDeps({ readProjectStateFn: vi.fn(async () => '{ not valid json') });

    const outcome = await run(['validate', '--project', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'PROJECT_INVALID' } });
  });

  it('plain "validate <templateDir>" without --project still reaches the pre-publish path, unchanged', async () => {
    const manifest = makeManifest('foo', '1.0.0');
    const readFileFn: ReadFileFn = vi.fn(async () => JSON.stringify(manifest));
    const { deps } = makeDeps({ readFileFn });

    const outcome = await run(['validate', '/tmp/some-template'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('PASS');
    expect(readFileFn).toHaveBeenCalledTimes(1);
  });

  // `frontx validate --project unexpected --json` must not return
  // `{"ok":true,"data":{"status":"PASS"}}` at exit 0 while leaving the
  // extra positional uninspected. `validate --project` refuses an
  // unrecognized argument exactly as every other command refuses one it
  // does not recognize.
  it('refuses an unrecognized extra argument rather than silently ignoring it', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['validate', '--project', 'unexpected', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('unexpected');
  });

  it('refuses the same unrecognized extra argument outside --json, on stderr', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['validate', '--project', 'unexpected'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toContain('unexpected');
  });
});

describe('dispatch: assemble (cpt-frontx-flow-cli-scaffolding-assemble-preview)', () => {
  it('exits user-error when --input is missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['assemble'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('exits user-error when --input is not valid JSON', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['assemble', '--input', 'not-json'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('exits user-error naming TEMPLATE_NOT_REGISTERED for a batch entry with no project-state entry', async () => {
    const { deps } = makeDeps();
    const outcome = await run(
      ['assemble', '--input', JSON.stringify({ templates: { foo: ['apps/foo'] } }), '--json'],
      deps,
    );
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const parsed = JSON.parse(outcome.stdout!) as { ok: false; error: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('TEMPLATE_NOT_REGISTERED');
  });

  it('previews a registered template\'s batch and writes no file or project-state entry', async () => {
    const { deps, registerManifest, registerContent, readProjectStateDocument } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', cleanManifest('foo'));
    registerContent('foo', [{ path: 'src/App.tsx', content: 'hello' }]);
    await run(['register', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(
      ['assemble', '--input', JSON.stringify({ templates: { foo: ['apps/foo'] } }), '--json'],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(deps.writeFileFn).not.toHaveBeenCalled();
    const parsed = JSON.parse(outcome.stdout!) as { ok: true; data: { entries: Array<{ templateName: string; target: string }> } };
    expect(parsed.data.entries).toEqual([expect.objectContaining({ templateName: 'foo', target: 'apps/foo' })]);
    // The registered entry's own `targets[]` stays empty — a preview never
    // records anything into the project state document.
    expect(readProjectStateDocument()?.templates.foo.targets).toEqual([]);
  });

  it('exits user-error naming TARGET_CONFLICT when two batch entries claim the same target', async () => {
    const { deps, registerManifest, registerContent } = makeDeps();
    registerManifest('github:acme/clash-a@v1.0.0', cleanManifest('clash-a'));
    registerManifest('github:acme/clash-b@v1.0.0', cleanManifest('clash-b'));
    registerContent('clash-a', [{ path: 'index.ts', content: 'a' }]);
    registerContent('clash-b', [{ path: 'index.ts', content: 'b' }]);
    await run(['register', 'github:acme/clash-a@v1.0.0'], deps);
    await run(['register', 'github:acme/clash-b@v1.0.0'], deps);

    const outcome = await run(
      [
        'assemble',
        '--input',
        JSON.stringify({ templates: { 'clash-a': ['shared'], 'clash-b': ['shared'] } }),
        '--json',
      ],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const parsed = JSON.parse(outcome.stdout!) as { ok: false; error: { code: string } };
    expect(parsed.error.code).toBe('TARGET_CONFLICT');
  });
});

describe('dispatch: apply (cpt-frontx-flow-cli-scaffolding-add-template)', () => {
  it('exits user-error when --input is missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['apply'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  // `apply` must not parse `--input`/`--adopt-existing`/`--json` and
  // silently DROP anything else: a caller's typo or stray positional would
  // otherwise run straight through at exit 0. Proves `apply` shares the
  // same `rejectUnrecognizedArgs` check that `install`/`list`/`update-local`
  // already have.
  it('refuses an unrecognized extra argument rather than silently ignoring it', async () => {
    const { deps } = makeDeps();

    const outcome = await run(
      ['apply', '--input', JSON.stringify({ templates: {} }), 'unexpected', '--json'],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('unexpected');
  });

  it('dispatches once and exits success, materializing a fresh target and recording it', async () => {
    const { deps, registerManifest, registerContent, readProjectStateDocument } = makeDeps();
    registerManifest('github:acme/bar@v1.0.0', cleanManifest('bar'));
    registerContent('bar', [{ path: 'src/Bar.tsx', content: 'hello bar' }]);
    await run(['register', 'github:acme/bar@v1.0.0'], deps);

    const outcome = await run(
      ['apply', '--input', JSON.stringify({ templates: { bar: ['apps/bar'] } }), '--json'],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(deps.writeFileFn).toHaveBeenCalledTimes(1);
    expect(readProjectStateDocument()?.templates.bar.targets).toEqual(['apps/bar']);
  });

  it('exits user-error naming TEMPLATE_NOT_REGISTERED when the template has no project-state entry', async () => {
    const { deps } = makeDeps();
    const outcome = await run(
      ['apply', '--input', JSON.stringify({ templates: { bar: ['apps/bar'] } }), '--json'],
      deps,
    );
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const parsed = JSON.parse(outcome.stdout!) as { ok: false; error: { code: string } };
    expect(parsed.error.code).toBe('TEMPLATE_NOT_REGISTERED');
  });

  it('is an idempotent no-op-by-record for a target already recorded under its template, writing no file', async () => {
    const { deps, registerManifest, registerContent } = makeDeps();
    registerManifest('github:acme/bar@v1.0.0', cleanManifest('bar'));
    registerContent('bar', [{ path: 'src/Bar.tsx', content: 'hello bar' }]);
    await run(['register', 'github:acme/bar@v1.0.0'], deps);
    await run(['apply', '--input', JSON.stringify({ templates: { bar: ['apps/bar'] } })], deps);
    (deps.writeFileFn as ReturnType<typeof vi.fn>).mockClear();

    const outcome = await run(
      ['apply', '--input', JSON.stringify({ templates: { bar: ['apps/bar'] } }), '--json'],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(deps.writeFileFn).not.toHaveBeenCalled();
    const parsed = JSON.parse(outcome.stdout!) as {
      ok: true;
      data: { applied: unknown[]; noop: Array<{ templateName: string; target: string }> };
    };
    expect(parsed.data.applied).toEqual([]);
    expect(parsed.data.noop).toEqual([{ templateName: 'bar', target: 'apps/bar' }]);
  });

  it('exits user-error naming TARGET_CONFLICT when a batch entry lands on an already-applied target', async () => {
    const { deps, registerManifest, registerContent } = makeDeps();
    registerManifest('github:acme/bar@v1.0.0', cleanManifest('bar'));
    registerManifest('github:acme/baz@v1.0.0', cleanManifest('baz'));
    registerContent('bar', [{ path: 'src/Bar.tsx', content: 'hello bar' }]);
    registerContent('baz', [{ path: 'src/Baz.tsx', content: 'hello baz' }]);
    await run(['register', 'github:acme/bar@v1.0.0'], deps);
    await run(['register', 'github:acme/baz@v1.0.0'], deps);
    await run(['apply', '--input', JSON.stringify({ templates: { bar: ['apps/shared'] } })], deps);

    const outcome = await run(
      ['apply', '--input', JSON.stringify({ templates: { baz: ['apps/shared'] } }), '--json'],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const parsed = JSON.parse(outcome.stdout!) as { ok: false; error: { code: string } };
    expect(parsed.error.code).toBe('TARGET_CONFLICT');
  });
});

describe('dispatch: seed (cpt-frontx-flow-cli-scaffolding-seed-repository)', () => {
  it('exits user-error when the <dir> argument is missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['seed', '--input', JSON.stringify({ templates: {} })], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('exits user-error when --input is missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['seed', '/tmp/fresh-repo'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('exits user-error naming TEMPLATE_NOT_REGISTERED when a batch entry is not an official default', async () => {
    const { deps } = makeDeps();
    const outcome = await run(
      ['seed', '/tmp/fresh-repo', '--input', JSON.stringify({ templates: { 'not-a-default': ['.'] } }), '--json'],
      deps,
    );
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const parsed = JSON.parse(outcome.stdout!) as { ok: false; error: { code: string } };
    expect(parsed.error.code).toBe('TEMPLATE_NOT_REGISTERED');
  });

  it('exits user-error naming INVALID_INPUT when the directory already carries a project state document', async () => {
    const { deps } = makeDeps();
    // Seeding a directory once, then again, refuses the second call.
    await run(
      ['seed', '/tmp/twice-repo', '--input', JSON.stringify({ templates: {} }), '--json'],
      deps,
    );

    const outcome = await run(
      ['seed', '/tmp/twice-repo', '--input', JSON.stringify({ templates: {} }), '--json'],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const parsed = JSON.parse(outcome.stdout!) as { ok: false; error: { code: string } };
    expect(parsed.error.code).toBe('INVALID_INPUT');
  });

  it('seeds an empty batch: creates the project state document and registers/applies nothing', async () => {
    const { deps, readProjectStateDocument } = makeDeps();

    const outcome = await run(
      ['seed', '/tmp/empty-batch-repo', '--input', JSON.stringify({ templates: {} }), '--json'],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(readProjectStateDocument()).toEqual({ formatVersion: 1, templates: {}, projectOwnedRoots: [] });
  });

  // cpt-frontx-algo-composed-provenance-register — `seed` resolves the
  // built-in default's `path:` origin, pins it, and writes `templates[name]`
  // exactly as a direct `register` call would, THEN applies the batch
  // through the identical mechanism `apply` uses — in one call.
  it('auto-registers and applies a fresh official default template in one call', async () => {
    const { deps, registerContent, readProjectStateDocument } = makeDeps({
      readFileFn: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('template-shell/frontx-template.json')) {
          return JSON.stringify({
            name: '@gears-frontx/frontx-template-shell',
            version: '1.0.0',
            excludedSubtrees: [],
            description: 'The official shell template fixture.',
          });
        }
        throw new Error(`unexpected readFileFn path: ${filePath}`);
      }),
    });
    // A local `path:` origin's `installedContentPath` is the canonical
    // folder joined against the seed target's own repo root, never the bare
    // canonical folder alone (`scaffold/assembler.ts`'s `resolveRegisteredTemplate`
    // — the fix `scaffold/types.ts`'s `ContributionEntry.installedContentPath`
    // doc comment states as the one rule) — so this suite's fake content
    // registry is keyed the identical way the real pipeline reads it.
    registerContent('/tmp/official-repo/template-shell', [{ path: 'package.json', content: '{}' }]);

    const outcome = await run(
      [
        'seed',
        '/tmp/official-repo',
        '--input',
        JSON.stringify({ templates: { '@gears-frontx/frontx-template-shell': ['.'] } }),
        '--json',
      ],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    const document = readProjectStateDocument();
    expect(document?.templates['@gears-frontx/frontx-template-shell']).toMatchObject({
      origin: 'path:template-shell',
      targets: ['.'],
    });
    expect(deps.writeFileFn).toHaveBeenCalledWith(expect.stringContaining('package.json'), '{}');
  });

  // `seed` must not write `.frontx/project.json` and register every
  // default BEFORE the apply phase can still refuse. CONTENT_CONFLICT is
  // the case exercised here: if the refusal is reported correctly but the
  // state document survives it, the directory would read as permanently
  // "already seeded" from then on. Rollback removes that state document
  // (and any `.frontx` directory `seed` itself created) so a refused
  // `seed` leaves the directory exactly as it found it.
  it('rolls back its own state-document write when the apply phase refuses with CONTENT_CONFLICT, leaving the directory seedable again', async () => {
    const { deps, registerContent, readProjectStateDocument } = makeDeps({
      readFileFn: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('template-shell/frontx-template.json')) {
          return JSON.stringify({
            name: '@gears-frontx/frontx-template-shell',
            version: '1.0.0',
            excludedSubtrees: [],
            description: 'The official shell template fixture.',
          });
        }
        throw new Error(`unexpected readFileFn path: ${filePath}`);
      }),
      // Existing on-disk content at the target differs from what the
      // template's own payload would write there — existing-content
      // reconciliation (run by `runApplyPipeline` AFTER seed's own
      // state-document write and registration) refuses with
      // CONTENT_CONFLICT before writing any payload file.
      createReadExistingContentFn: vi.fn(
        (): ReadExistingContentFn => async () => [{ path: 'package.json', content: 'NOT THE TEMPLATE PAYLOAD' }],
      ),
    });
    // Keyed by the absolute `installedContentPath` a local `path:` origin now
    // always carries (see the sibling test above for the full reasoning).
    registerContent('/tmp/conflict-repo/template-shell', [{ path: 'package.json', content: '{}' }]);

    const batchInput = JSON.stringify({ templates: { '@gears-frontx/frontx-template-shell': ['.'] } });

    const first = await run(['seed', '/tmp/conflict-repo', '--input', batchInput, '--json'], deps);

    expect(first.exitCode).toBe(EXIT_USER_ERROR);
    const parsedFirst = JSON.parse(first.stdout!) as { ok: false; error: { code: string } };
    expect(parsedFirst.error.code).toBe('CONTENT_CONFLICT');
    // The refused seed leaves no project state document behind...
    expect(deps.removeProjectFile).toHaveBeenCalled();
    expect(readProjectStateDocument()).toBeNull();

    // ...so a second seed against the identical directory is accepted
    // rather than refused as already-seeded (INVALID_INPUT) — proving the
    // first call's own state write did not survive its own refusal.
    const second = await run(['seed', '/tmp/conflict-repo', '--input', batchInput, '--json'], deps);
    expect(second.exitCode).toBe(EXIT_USER_ERROR);
    const parsedSecond = JSON.parse(second.stdout!) as { ok: false; error: { code: string } };
    expect(parsedSecond.error.code).toBe('CONTENT_CONFLICT');
  });

  // `seed` against a nonexistent directory must not reach a raw, uncaught
  // `fs` throw several seams deep, surfacing as exit 2 (the internal-error
  // class) with an EMPTY stdout under `--json` — `--json` mode owes every
  // caller the single envelope for an ordinary, caller-supplied bad path.
  it('exits user-error with INVALID_PATH, emitting one --json envelope on stdout, when <dir> does not exist', async () => {
    const { deps } = makeDeps({
      readSeedDirStateFn: vi.fn(async (): Promise<TargetPathState> => 'absent'),
    });

    const outcome = await run(
      ['seed', '/tmp/does-not-exist-repo', '--input', JSON.stringify({ templates: {} }), '--json'],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stdout).toBeTruthy();
    const parsed = JSON.parse(outcome.stdout!) as { ok: false; error: { code: string } };
    expect(parsed.error.code).toBe('INVALID_PATH');
  });

  // Same defect, the other reproduced shape: `<dir>` names an existing FILE
  // rather than a directory.
  it('exits user-error with INVALID_PATH, emitting one --json envelope on stdout, when <dir> names an existing file', async () => {
    const { deps } = makeDeps({
      readSeedDirStateFn: vi.fn(async (): Promise<TargetPathState> => 'file'),
    });

    const outcome = await run(
      ['seed', '/tmp/a-file-not-a-dir', '--input', JSON.stringify({ templates: {} }), '--json'],
      deps,
    );

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stdout).toBeTruthy();
    const parsed = JSON.parse(outcome.stdout!) as { ok: false; error: { code: string } };
    expect(parsed.error.code).toBe('INVALID_PATH');
  });
});

// Rewritten this checkpoint onto the whole-file, name-atomic engine
// (`cpt-frontx-adr-project-upgrade-mechanism`), replacing the retired
// region-union engine's own dispatch tests wholesale — the argument shape
// itself changed (`<templateName> <new-origin>` / `<templateName>
// --restore`, never the old `<projectRoot> <targetVersion>`), so none of
// the old fixtures could be adapted rather than replaced.
describe('dispatch: upgrade (cpt-frontx-flow-upgrade-changeset-review-approval, cpt-frontx-flow-upgrade-changeset-restore)', () => {
  // A raw, directly-seeded project state document — mirrors `dispatch:
  // delete`'s own `seededProjectState` fixture exactly, for the identical
  // reason: `upgrade` needs an ALREADY-REGISTERED name with at least one
  // applied target to operate on.
  function seededProjectState(document: ProjectStateDocument): {
    readProjectStateFn: ReadProjectStateFn;
    writeProjectStateFn: WriteProjectStateFn;
    written: () => ProjectStateDocument;
  } {
    let stored = JSON.stringify(document);
    const readProjectStateFn: ReadProjectStateFn = vi.fn(async () => stored);
    const writeProjectStateFn: WriteProjectStateFn = vi.fn(async (_absolutePath, content) => {
      stored = content;
    });
    return { readProjectStateFn, writeProjectStateFn, written: () => JSON.parse(stored) as ProjectStateDocument };
  }

  it('requires a <templateName> argument', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['upgrade'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('requires either a <new-origin> argument or --restore', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['upgrade', 'foo'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('--restore takes no <new-origin> argument', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['upgrade', 'foo', 'github:acme/foo@v2.0.0', '--restore'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('refuses TEMPLATE_NOT_REGISTERED under --json for a name with no project-state entry', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['upgrade', 'foo', 'github:acme/foo@v2.0.0', '--json'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'TEMPLATE_NOT_REGISTERED' } });
  });

  it('--restore refuses NOTHING_TO_RESTORE for a name with no recorded preceding origin', async () => {
    const { readProjectStateFn, writeProjectStateFn } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const { deps } = makeDeps({ readProjectStateFn, writeProjectStateFn });

    const outcome = await run(['upgrade', 'foo', '--restore', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_RESTORE' } });
  });

  // Both the baseline (v1.0.0) and the candidate (v2.0.0) resolve to a bare
  // four-field manifest with no bundle envelope — `upgrade/payload.ts`'s own
  // documented fallback for that case is an EMPTY payload, so classification
  // enumerates zero paths and the resulting plan carries zero operations.
  // That is deliberate here: it lets these two tests exercise the real
  // engine — real validation, a real computed plan, a real commit — without
  // ever writing a byte to disk, so nothing here depends on `process.cwd()`
  // (where these tests actually run) being anything other than the real
  // repository checkout.
  function registerTwoVersions(registerManifest: DepsFixture['registerManifest']): void {
    registerManifest('github:acme/foo@v1.0.0', cleanManifest('foo', '1.0.0'));
    registerManifest('github:acme/foo@v2.0.0', cleanManifest('foo', '2.0.0'));
  }

  it('--json without --yes returns CONFIRMATION_REQUIRED carrying the computed plan, writing nothing', async () => {
    const { readProjectStateFn, writeProjectStateFn, written } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const { deps, registerManifest } = makeDeps({ readProjectStateFn, writeProjectStateFn });
    registerTwoVersions(registerManifest);

    const outcome = await run(['upgrade', 'foo', 'github:acme/foo@v2.0.0', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const parsed = JSON.parse(outcome.stdout ?? '');
    expect(parsed).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
    expect(parsed.error.details.plan).toMatchObject({ name: 'foo', operations: [] });
    expect(written().templates.foo).toMatchObject({ origin: 'github:acme/foo@v1.0.0', version: '1.0.0' });
  });

  it('--json --yes commits the upgrade, recording the new origin and the preceding one', async () => {
    const { readProjectStateFn, writeProjectStateFn, written } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const { deps, registerManifest } = makeDeps({ readProjectStateFn, writeProjectStateFn });
    registerTwoVersions(registerManifest);

    const outcome = await run(['upgrade', 'foo', 'github:acme/foo@v2.0.0', '--json', '--yes'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    const parsed = JSON.parse(outcome.stdout ?? '');
    expect(parsed).toMatchObject({ ok: true, data: { outcome: 'success' } });
    expect(written().templates.foo).toMatchObject({
      origin: 'github:acme/foo@v2.0.0',
      version: '2.0.0',
      previous: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0' },
    });
  });

  it('a candidate resolving to the already-recorded {origin, version} is an idempotent no-op', async () => {
    const { readProjectStateFn, writeProjectStateFn, written } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const { deps, registerManifest } = makeDeps({ readProjectStateFn, writeProjectStateFn });
    registerManifest('github:acme/foo@v1.0.0', cleanManifest('foo', '1.0.0'));

    const outcome = await run(['upgrade', 'foo', 'github:acme/foo@v1.0.0', '--json', '--yes'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: true, data: { outcome: 'noop' } });
    expect(writeProjectStateFn).not.toHaveBeenCalled();
    expect(written().templates.foo).toMatchObject({ origin: 'github:acme/foo@v1.0.0', version: '1.0.0' });
  });

  it('interactive mode declines by default, writing nothing', async () => {
    const { readProjectStateFn, writeProjectStateFn, written } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const { deps, registerManifest } = makeDeps({ readProjectStateFn, writeProjectStateFn });
    registerTwoVersions(registerManifest);

    const outcome = await run(['upgrade', 'foo', 'github:acme/foo@v2.0.0'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(deps.presentUpgradePlan).toHaveBeenCalled();
    expect(written().templates.foo).toMatchObject({ origin: 'github:acme/foo@v1.0.0', version: '1.0.0' });
  });

  // `EXIT_INTERNAL_ERROR` (2) must be reachable through the envelope path:
  // every render*Outcome failure branch must not hardcode `EXIT_USER_ERROR`
  // (1) regardless of `result.code`, or an `INTERNAL`-coded outcome (as
  // opposed to a thrown exception, already covered by `install`'s own
  // "exits internal-error when the dispatched behavior fails unexpectedly"
  // test) would report itself indistinguishably from an ordinary refusal.
  // Drives `upgrade`'s own post-commit inventory-promotion failure: the
  // state-write transition lands, but the SEPARATE write to the local
  // inventory (`promoteInventory`'s own `updateLocal` call) fails, which
  // `upgrade/commit.ts` reports as `INTERNAL` precisely because the
  // transition stands committed while the promotion did not.
  it('exits with the distinct internal-error code (2) when the outcome carries INTERNAL, not the user-error code (1)', async () => {
    const { readProjectStateFn, writeProjectStateFn, written } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    // `foo` is already present in the local inventory (as a real `install`
    // would leave it), so `upgrade`'s post-commit `promoteInventory` step
    // attempts to replace that slot — and its `updateLocal` call is stubbed
    // to fail, forcing exactly the "transition committed, promotion did not"
    // branch `upgrade/commit.ts` reports as INTERNAL.
    const brokenInventory = {
      lookup: vi.fn(() => ({
        name: 'foo',
        source: 'github:acme/foo@v1.0.0',
        ref: 'v1.0.0',
        status: 'INSTALLED',
        content: '',
      })),
      updateLocal: vi.fn(async () => ({ ok: false, error: { message: 'inventory store exploded' } })),
    } as unknown as TemplateInventory;
    const { deps, registerManifest } = makeDeps({ readProjectStateFn, writeProjectStateFn, inventory: brokenInventory });
    registerTwoVersions(registerManifest);

    const outcome = await run(['upgrade', 'foo', 'github:acme/foo@v2.0.0', '--json', '--yes'], deps);

    expect(outcome.exitCode).toBe(EXIT_INTERNAL_ERROR);
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string; message: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('INTERNAL');
    // The transition itself still landed — only the SEPARATE inventory
    // promotion failed — exactly the invariant `upgrade/commit.ts`'s own
    // "transition itself STANDS committed" comment documents.
    expect(written().templates.foo).toMatchObject({ origin: 'github:acme/foo@v2.0.0', version: '2.0.0' });
  });

  // Contrast: an ordinary user-error outcome (no INTERNAL code) still exits
  // 1, proving the mapping is genuinely three-way rather than every failure
  // now collapsing onto exit 2.
  it('an ordinary user-error outcome still exits with the user-error code (1), not internal-error', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['upgrade', 'foo', 'github:acme/foo@v2.0.0', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.exitCode).not.toBe(EXIT_INTERNAL_ERROR);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'TEMPLATE_NOT_REGISTERED' } });
  });
});

// F19 cpt-frontx-flow-composed-provenance-register-template — the FIRST
// dispatch cases in this file that route their outcome through the shared
// `envelope.ts` shape under `--json` (cpt-frontx-dod-cli-invocation-json-
// envelope-dispatch), rather than a bespoke shape of their own.
describe('dispatch: register (cpt-frontx-flow-composed-provenance-register-template)', () => {
  // `register` must not take its first non-flag token as `<origin>` and
  // silently drop any further positional — proves `register` shares the
  // same `rejectUnrecognizedArgs` check as `apply`, `validate`, and
  // `validate --project` above.
  it('refuses an unrecognized extra argument rather than silently ignoring it', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['register', 'github:acme/foo@v1.0.0', 'unexpected'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toContain('Unrecognized argument(s) for register');
    expect(outcome.stderr).toContain('unexpected');
  });

  // The local `path:` branch propagated the resolver's code all along while
  // the remote branch dropped it, so one command answered the SAME failure two
  // ways: a refused manifest came back as `INVALID_MANIFEST` from a local
  // origin and as `ORIGIN_UNAVAILABLE` from a remote one — telling the caller
  // the origin was unreachable when it had been reached and read.
  it('reports INVALID_MANIFEST, not ORIGIN_UNAVAILABLE, when a REMOTE origin resolves to a refused manifest', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest(
      'github:acme/legacy@v1.0.0',
      makeManifest('legacy', '1.0.0', { ownershipBoundaries: { exclusiveSubtrees: ['src/'], sharedFiles: [] } }),
    );

    const outcome = await run(['register', 'github:acme/legacy@v1.0.0', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error: { code: string } };
    expect(envelope.error.code).toBe('INVALID_MANIFEST');
  });

  it('creates a new entry and exits success (human-readable)', async () => {
    const { deps, registerManifest, readProjectStateDocument } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));

    const outcome = await run(['register', 'github:acme/foo@v1.0.0'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('Registered template "foo"');
    expect(readProjectStateDocument()?.templates.foo).toEqual({
      origin: 'github:acme/foo@v1.0.0',
      version: '1.0.0',
      targets: [],
    });
  });

  it('emits the shared ok envelope under --json', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));

    const outcome = await run(['register', 'github:acme/foo@v1.0.0', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '')).toEqual({
      ok: true,
      data: { outcome: 'created', name: 'foo', entry: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: [] } },
    });
  });

  it('exits user-error when the <origin> argument is missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['register'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('emits INVALID_INPUT under --json when the <origin> argument is missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['register', '--json'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('reports REGISTRATION_CONFLICT through the shared error envelope under --json', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));
    registerManifest('github:acme/foo@v2.0.0', makeManifest('foo', '2.0.0'));
    await run(['register', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['register', 'github:acme/foo@v2.0.0', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'REGISTRATION_CONFLICT' } });
  });
});

describe('dispatch: unregister (cpt-frontx-flow-composed-provenance-unregister-template)', () => {
  it('removes a registered entry and exits success (human-readable)', async () => {
    const { deps, registerManifest, readProjectStateDocument } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));
    await run(['register', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['unregister', 'foo'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('Unregistered template "foo"');
    expect(readProjectStateDocument()?.templates.foo).toBeUndefined();
  });

  it('emits the shared ok envelope under --json', async () => {
    const { deps, registerManifest } = makeDeps();
    registerManifest('github:acme/foo@v1.0.0', makeManifest('foo', '1.0.0'));
    await run(['register', 'github:acme/foo@v1.0.0'], deps);

    const outcome = await run(['unregister', 'foo', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '')).toEqual({ ok: true, data: { name: 'foo' } });
  });

  it('exits user-error with TEMPLATE_NOT_REGISTERED under --json for an unknown name', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['unregister', 'nope', '--json'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'TEMPLATE_NOT_REGISTERED' } });
  });

  it('exits user-error when the <name> argument is missing', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['unregister'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });
});

describe('dispatch: ownership add|remove|list (cpt-frontx-feature-composed-provenance)', () => {
  it('add: marks an existing path as project-owned and exits success (human-readable)', async () => {
    const { deps, readProjectStateDocument } = makeDeps({ readTargetPathStateFn: vi.fn(async (): Promise<TargetPathState> => 'directory') });

    const outcome = await run(['ownership', 'add', 'docs'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('Marked "docs"');
    expect(readProjectStateDocument()?.projectOwnedRoots).toEqual(['docs']);
  });

  it('add: emits the shared ok envelope under --json', async () => {
    const { deps } = makeDeps({ readTargetPathStateFn: vi.fn(async (): Promise<TargetPathState> => 'directory') });

    const outcome = await run(['ownership', 'add', 'docs', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '')).toEqual({
      ok: true,
      data: { outcome: 'added', path: 'docs', projectOwnedRoots: ['docs'] },
    });
  });

  it('add: refuses with INVALID_PATH under --json when the path does not exist', async () => {
    const { deps } = makeDeps({ readTargetPathStateFn: vi.fn(async (): Promise<TargetPathState> => 'absent') });

    const outcome = await run(['ownership', 'add', 'missing', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'INVALID_PATH' } });
  });

  // Regression: `--json` used to be recognized only among the tokens AFTER
  // the sub-command (`rest`), so `--json` typed BEFORE the sub-command got
  // destructured into `sub` itself, never matched `add`/`remove`/`list`,
  // and the command fell through to the human-readable "unrecognized
  // sub-command" branch even though the caller asked for the machine
  // envelope — confirmed live before this fix, violating the ADR's "exactly
  // one JSON value on stdout" guarantee for that spelling.
  it('add: recognizes --json wherever it falls in argv, including before the sub-command', async () => {
    const { deps } = makeDeps({ readTargetPathStateFn: vi.fn(async (): Promise<TargetPathState> => 'directory') });

    const outcome = await run(['ownership', '--json', 'add', 'docs'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '')).toEqual({
      ok: true,
      data: { outcome: 'added', path: 'docs', projectOwnedRoots: ['docs'] },
    });
  });

  it('remove: un-marks a path and exits success, touching no file', async () => {
    const { deps, readProjectStateDocument } = makeDeps({ readTargetPathStateFn: vi.fn(async (): Promise<TargetPathState> => 'directory') });
    await run(['ownership', 'add', 'docs'], deps);

    const outcome = await run(['ownership', 'remove', 'docs'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(readProjectStateDocument()?.projectOwnedRoots).toEqual([]);
    expect(deps.writeFileFn).not.toHaveBeenCalled();
  });

  it('list: reports the current projectOwnedRoots under --json', async () => {
    const { deps } = makeDeps({ readTargetPathStateFn: vi.fn(async (): Promise<TargetPathState> => 'directory') });
    await run(['ownership', 'add', 'docs'], deps);

    const outcome = await run(['ownership', 'list', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(JSON.parse(outcome.stdout ?? '')).toEqual({ ok: true, data: { projectOwnedRoots: ['docs'] } });
  });

  it('list: reports an empty-state message in human-readable mode when nothing is recorded', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['ownership', 'list'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toBe('No project-owned roots recorded.');
  });

  it('exits user-error for an unrecognized ownership subcommand', async () => {
    const { deps } = makeDeps();
    const outcome = await run(['ownership', 'bogus'], deps);
    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });
});

describe('dispatch: delete (cpt-frontx-flow-cli-scaffolding-delete-target)', () => {
  // A raw, directly-seeded project state document, distinct from
  // `makeDeps`'s own in-memory store (which only ever gets a `targets[]`
  // entry through a real `register` dispatch, never `seed`/`add` at this
  // checkpoint) — `delete` needs an ALREADY-APPLIED target to operate on,
  // so this fixture seeds `targets[]` directly.
  function seededProjectState(document: ProjectStateDocument): {
    readProjectStateFn: ReadProjectStateFn;
    writeProjectStateFn: WriteProjectStateFn;
    written: () => ProjectStateDocument;
  } {
    let stored = JSON.stringify(document);
    const readProjectStateFn: ReadProjectStateFn = vi.fn(async () => stored);
    const writeProjectStateFn: WriteProjectStateFn = vi.fn(async (_absolutePath, content) => {
      stored = content;
    });
    return { readProjectStateFn, writeProjectStateFn, written: () => JSON.parse(stored) as ProjectStateDocument };
  }

  it('--json --yes deletes an applied target\'s ground and removes it from targets[]', async () => {
    const { readProjectStateFn, writeProjectStateFn, written } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const { deps } = makeDeps({
      readProjectStateFn,
      writeProjectStateFn,
      listTargetFilesFn: vi.fn(async () => ['src/index.ts']),
    });

    const outcome = await run(['delete', 'packages/app', '--json', '--yes'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    const parsed = JSON.parse(outcome.stdout ?? '');
    expect(parsed).toMatchObject({ ok: true, data: { toDelete: ['packages/app/src/index.ts'] } });
    expect(written().templates.foo.targets).toEqual([]);
    expect(deps.removeProjectFile).toHaveBeenCalled();
  });

  // A containment violation reaches `run()` as a throw from the adapter layer,
  // where every thrown error used to collapse into the internal-error exit with
  // a bare stderr line and, under `--json`, no envelope at all. The project-state
  // writer's own refusal reached callers exactly that way: containment was
  // enforced, and the report about it was wrong twice over — wrong outcome class
  // for a problem in the caller's own tree, and no parseable answer for a machine
  // caller. The real-filesystem coverage of the check itself lives in
  // `fs-containment.test.ts`; this pins how its refusal is REPORTED.
  it('reports a containment violation as an INVALID_PATH envelope with the user-error exit, not an internal error', async () => {
    const { readProjectStateFn } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    // The writer is where containment is enforced for project state, so this is
    // the seam that throws in the real adapter; a command that actually reaches
    // it is what proves the report, not the check.
    const writeProjectStateFn = vi.fn(() => {
      throw new PathContainmentError('/outside/state/project.json', '/repo');
    });
    const { deps } = makeDeps({
      readProjectStateFn,
      writeProjectStateFn,
      listTargetFilesFn: vi.fn(async () => ['src/index.ts']),
    });

    const outcome = await run(['delete', 'packages/app', '--json', '--yes'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(outcome.stderr).toBeUndefined();
    const parsed: unknown = JSON.parse(outcome.stdout ?? '');
    expect(parsed).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PATH', details: { path: '/outside/state/project.json' } },
    });
  });

  it('--json without --yes returns CONFIRMATION_REQUIRED and deletes nothing', async () => {
    const { readProjectStateFn, writeProjectStateFn, written } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const { deps } = makeDeps({ readProjectStateFn, writeProjectStateFn, listTargetFilesFn: vi.fn(async () => ['src/index.ts']) });

    const outcome = await run(['delete', 'packages/app', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
    expect(written().templates.foo.targets).toEqual(['packages/app']);
    expect(deps.removeProjectFile).not.toHaveBeenCalled();
  });

  it('--dry-run reports the plan without deleting or requiring confirmation', async () => {
    const { readProjectStateFn, writeProjectStateFn } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const { deps } = makeDeps({ readProjectStateFn, writeProjectStateFn, listTargetFilesFn: vi.fn(async () => ['src/index.ts']) });

    const outcome = await run(['delete', 'packages/app', '--dry-run'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.stdout).toContain('packages/app/src/index.ts');
    expect(deps.removeProjectFile).not.toHaveBeenCalled();
  });

  it('refuses TARGET_NOT_APPLIED under --json for a target matching no registered template', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['delete', 'packages/app', '--json'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
    expect(JSON.parse(outcome.stdout ?? '')).toMatchObject({ ok: false, error: { code: 'TARGET_NOT_APPLIED' } });
  });

  it('requires a <target> argument', async () => {
    const { deps } = makeDeps();

    const outcome = await run(['delete'], deps);

    expect(outcome.exitCode).toBe(EXIT_USER_ERROR);
  });

  it('interactive mode deletes on confirmation, defaulting the fixture\'s own confirm to declined otherwise', async () => {
    const { readProjectStateFn, writeProjectStateFn, written } = seededProjectState({
      formatVersion: 1,
      templates: { foo: { origin: 'github:acme/foo@v1.0.0', version: '1.0.0', targets: ['packages/app'] } },
      projectOwnedRoots: [],
    });
    const { deps } = makeDeps({
      readProjectStateFn,
      writeProjectStateFn,
      listTargetFilesFn: vi.fn(async () => ['src/index.ts']),
      confirmDeletion: vi.fn(async (): Promise<'confirmed' | 'declined'> => 'confirmed'),
    });

    const outcome = await run(['delete', 'packages/app'], deps);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(written().templates.foo.targets).toEqual([]);
  });
});

// A real `Writable` whose `_write` fails with a caller-supplied error. Going
// through the base class's actual internals (rather than stubbing `.write`
// or `.emit` directly) means the SAME two-notification hazard `writeToStream`
// exists to survive is the one exercised here: Node's own `onwriteError`
// path both invokes this write's callback with the error AND independently
// schedules a real `'error'` event for it — there is nothing fake about
// either notification, only about which destination is failing.
class FailingWritable extends Writable {
  constructor(private readonly failure: NodeJS.ErrnoException) {
    super();
  }
  override _write(_chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback(this.failure);
  }
}

function makeErrnoException(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`simulated ${code}`), { code });
}

// process.stdout/stderr crashing on an unhandled 'error' event is a real,
// built-in EventEmitter behavior (`cpt-frontx-flow-cli-invocation-run-
// command`, step 8.1/8.2) — this listens for it directly rather than trusting
// that a promise settling means nothing else could still bring the process
// down, since that gap is exactly what the previous fix missed.
async function runWithUncaughtExceptionCapture<T>(work: () => Promise<T>): Promise<{ result: T; uncaught: unknown[] }> {
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => uncaught.push(error);
  process.on('uncaughtException', onUncaught);
  try {
    const result = await work();
    // An 'error' event Node schedules via `process.nextTick` for the SAME
    // write failure lands after this function's own callback-driven promise
    // already resolved; yielding once more gives it a chance to surface
    // before this assertion is made.
    await new Promise((resolve) => setImmediate(resolve));
    return { result, uncaught };
  } finally {
    process.off('uncaughtException', onUncaught);
  }
}

describe('writeToStream (cpt-frontx-flow-cli-invocation-run-command, step 8)', () => {
  it('delivers a normal write and resolves "ok"', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });

    const result = await writeToStream(stream, 'payload');

    expect(result).toBe('ok');
    expect(chunks).toEqual(['payload']);
  });

  it('treats a broken pipe (EPIPE) as harmless and does not crash the process', async () => {
    const stream = new FailingWritable(makeErrnoException('EPIPE'));

    const { result, uncaught } = await runWithUncaughtExceptionCapture(() => writeToStream(stream, 'payload'));

    expect(result).toBe('ok');
    expect(uncaught).toEqual([]);
  });

  it('reports a non-EPIPE write failure as failed, without crashing the process either', async () => {
    const stream = new FailingWritable(makeErrnoException('ENOSPC'));

    const { result, uncaught } = await runWithUncaughtExceptionCapture(() => writeToStream(stream, 'payload'));

    expect(result).toBe('failed');
    expect(uncaught).toEqual([]);
  });

  // `createInteractiveDeletionConfirm` and `createInteractiveUpgradeApproval`
  // route their own plan/listing writes through `writeToStream` and then
  // hand the SAME stream to `readline.createInterface({ output: ... })`,
  // whose internal prompt-writing (`[_writeToOutput]`) never goes through
  // `writeToStream` at all. This only stays crash-safe if the permanent
  // 'error' listener `writeToStream` attaches is keyed by stream identity —
  // covering every later write on that stream, not just the call that
  // attached it. A stub `Writable` here stands in for `readline`'s own write
  // exactly the way `process.stdout.write()` stands in for it in the real
  // interactive paths, without needing a real TTY/pipe to prove the point.
  it('keeps a stream crash-safe for a write that bypasses writeToStream entirely, once any prior call has registered it', async () => {
    const stream = new FailingWritable(makeErrnoException('EPIPE'));

    const { result: firstResult, uncaught: firstUncaught } = await runWithUncaughtExceptionCapture(() =>
      writeToStream(stream, 'plan listing'),
    );
    expect(firstResult).toBe('ok');
    expect(firstUncaught).toEqual([]);

    const { uncaught: secondUncaught } = await runWithUncaughtExceptionCapture(
      () =>
        new Promise<void>((resolve) => {
          stream.write('prompt text', () => resolve());
        }),
    );
    expect(secondUncaught).toEqual([]);
  });
});

// `createInteractiveDeletionConfirm`/`createInteractiveUpgradeApproval` used
// to call `writeToStream` directly and ignore its `'ok' | 'failed'` result —
// a genuine write failure there (anything but the already-tolerated broken
// pipe) was silently swallowed and the prompt proceeded as if nothing had
// gone wrong. Both now route through `writeInteractiveLineOrEscalate`, whose
// own contract this pins directly: it is the one place that escalation is
// realized, so proving it here covers both call sites without needing a
// real interactive `delete`/`upgrade` dispatch wired to a failing stdout.
describe('writeInteractiveLineOrEscalate (cpt-frontx-flow-cli-invocation-run-command, step 8)', () => {
  it('resolves without throwing for an ordinary successful write', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });

    await expect(writeInteractiveLineOrEscalate('Would delete:\n  app/src\n', stream)).resolves.toBeUndefined();
    expect(chunks).toEqual(['Would delete:\n  app/src\n']);
  });

  it('tolerates a broken pipe (EPIPE) exactly as the final envelope write already does', async () => {
    const stream = new FailingWritable(makeErrnoException('EPIPE'));

    const { result, uncaught } = await runWithUncaughtExceptionCapture(async () => {
      await writeInteractiveLineOrEscalate('Would delete:\n  app/src\n', stream);
      return 'no-throw';
    });

    expect(result).toBe('no-throw');
    expect(uncaught).toEqual([]);
  });

  // The defect this pins: a non-EPIPE write failure used to be silently
  // swallowed, and the interactive prompt proceeded as if the plan had
  // actually reached the developer's screen. Now it throws, which — reached
  // from inside `confirmDeletion`/`presentUpgradePlan` during a real
  // dispatch — propagates to `run()`'s own catch and escalates to the
  // internal-error exit code exactly as any other unexpected failure does,
  // without either command's own outcome shape needing a new field to carry
  // a failure that is this entrypoint's own writing, not that command's.
  it('throws for a non-EPIPE write failure instead of silently proceeding', async () => {
    const stream = new FailingWritable(makeErrnoException('ENOSPC'));

    const { result, uncaught } = await runWithUncaughtExceptionCapture(() =>
      writeInteractiveLineOrEscalate('Would delete:\n  app/src\n', stream).then(
        () => 'resolved',
        () => 'threw',
      ),
    );

    expect(result).toBe('threw');
    expect(uncaught).toEqual([]);
  });
});
