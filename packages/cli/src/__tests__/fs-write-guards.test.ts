// An EXECUTABLE enumeration of every raw filesystem call under
// `packages/cli/src/`, replacing a prose claim from an earlier
// round ("an enumeration of every filesystem call with a verdict") that
// named no such enumeration and was never actually built — a comment
// listing calls drifts silently the moment a new one is added; this test
// cannot.
//
// Every call site is found by walking each file's real TypeScript AST (the
// same compiler this package already builds with, `ts.createSourceFile`),
// never by a line-based regex — a regex matching `fs.writeFileSync(` would
// also match this exact doc-comment sentence, and several adapters in this
// directory quote a guarded call's own name, with parentheses, in prose
// explaining why it is safe (`fs-ai-bundle.ts`'s own
// `reclaimNonDirectoryAiAncestor` doc comment is one). An AST walk only ever
// sees real `CallExpression` nodes; a comment is not one.
//
// Each entry in the two allow-lists below (`WRITE_ALLOW_LIST`,
// `READ_ALLOW_LIST`) names the file, the call, and the GUARD — a real
// function name that exists in that same file's source (asserted below,
// not merely claimed) — that makes that one occurrence safe. Entries are
// counted, not line-matched: a file with three `fs.mkdirSync` call sites
// needs three allow-list entries for `fs.mkdirSync`, in any order, so an
// unrelated edit that shifts line numbers elsewhere in the file never
// spuriously breaks this test — only a CHANGE IN COUNT (a call added or
// removed) does.
//
// A new, unguarded call of any listed primitive anywhere under `src/`
// raises the found count past what either allow-list declares for that
// file, and this test fails, naming the file and the call: add it here with
// the guard that protects it, or guard it first.
import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_DIR = path.join(__dirname, '..');

// Every primitive that CREATES, REPLACES or REMOVES something on disk: the
// sync forms this package uses throughout, plus the callback-style async
// forms in case a future change introduces one (none exist under
// `adapters/` today — this same scan proves it by finding zero occurrences).
// A primitive missing from this set is a hole in the sweep, not a pass, so
// add one here before adding its first call site.
const WRITE_CALLS = new Set([
  'writeFileSync',
  'mkdirSync',
  'renameSync',
  'rmSync',
  'rmdirSync',
  'unlinkSync',
  'cpSync',
  'copyFileSync',
  'appendFileSync',
  'truncateSync',
  'openSync',
  'writeSync',
  'symlinkSync',
  'linkSync',
  'createWriteStream',
  'writeFile',
  'mkdir',
  'rename',
  'rm',
  'rmdir',
  'unlink',
  'cp',
  'copyFile',
  'appendFile',
  'truncate',
  'open',
  'symlink',
  'link',
]);

const READ_CALLS = new Set(['readFileSync', 'readdirSync', 'existsSync', 'statSync', 'lstatSync', 'realpathSync']);

interface CallSite {
  file: string;
  call: string; // e.g. "fs.mkdirSync"
  line: number; // 1-indexed, for a human reading a failure message only
}

// Walks one file's real AST (never its raw text) collecting every call of a
// tracked primitive, under EITHER import style: a namespaced call through
// whatever local name `import fs from 'node:fs'` bound, and a bare call of a
// name a destructured `import { rmdirSync } from 'node:fs'` brought in. The
// second form is not hypothetical — `cli.ts` imports three primitives that
// way, and a scan that only understood `fs.<name>(...)` reported that file
// as having no filesystem calls at all. The import declarations are read
// from the same AST, so a local alias (`import * as nodeFs`) is followed and
// an identically named local helper that came from somewhere else is not
// mistaken for one. A THIRD shape, `fs.<primitive>.native(...)`
// (`fs.realpathSync.native`, the platform-native form this package uses for
// case-correct canonicalization), is recognized as the same primitive as
// its plain `fs.<primitive>(...)` form — one call, one allow-list entry —
// rather than as an untracked member access this walk would otherwise miss
// entirely.
function collectFsCallSites(filePath: string, text: string): CallSite[] {
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const sites: CallSite[] = [];
  const targetNames = new Set([...WRITE_CALLS, ...READ_CALLS]);

  // Local names bound to the `node:fs` module object, and local names bound
  // to one of its exported functions directly.
  const namespaceNames = new Set<string>();
  const boundNames = new Map<string, string>(); // local name -> primitive name
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.moduleSpecifier.text.startsWith('node:fs')) continue;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) namespaceNames.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaceNames.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (targetNames.has(imported)) boundNames.set(element.name.text, imported);
    }
  }

  function record(node: ts.Node, primitive: string): void {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    sites.push({ file: path.relative(SRC_DIR, filePath), call: `fs.${primitive}`, line: line + 1 });
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        // `fs.<primitive>.native(...)` (e.g. `fs.realpathSync.native`) —
        // the platform-native form of a tracked primitive, one more member
        // access deeper than the plain `fs.<primitive>(...)` shape below.
        // Recorded under the SAME primitive name as the plain form: it is
        // the identical call for this scan's purposes (one raw filesystem
        // primitive, one allow-list entry per occurrence), not a second,
        // untracked one a `.native` suffix would otherwise let slip past
        // both sweeps unseen.
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'native' &&
        ts.isPropertyAccessExpression(callee.expression) &&
        ts.isIdentifier(callee.expression.expression) &&
        namespaceNames.has(callee.expression.expression.text) &&
        targetNames.has(callee.expression.name.text)
      ) {
        record(node, callee.expression.name.text);
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        namespaceNames.has(callee.expression.text) &&
        targetNames.has(callee.name.text)
      ) {
        record(node, callee.name.text);
      } else if (ts.isIdentifier(callee)) {
        const primitive = boundNames.get(callee.text);
        if (primitive !== undefined) record(node, primitive);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return sites;
}

interface AllowEntry {
  guard: string; // a real identifier (or "A + B" for two cooperating guards) that must appear verbatim in the file's own source
  note: string; // why this one occurrence is safe
}

type FileAllowList = Partial<Record<string, AllowEntry[]>>; // call name ("fs.mkdirSync") -> one entry per occurrence

// ============================== WRITE SWEEP ==============================
//
// Every write-shaped call this scan finds under `adapters/`, grouped by
// file. `fs-ai-bundle.ts` and `fs-project-io.ts` carry this round's own two
// fixes (TASK 1's `reclaimNonDirectoryAiAncestor`, TASK 2's
// `inst-psio-resolve-write-destination`); every other file's entries
// describe protections that already existed before this round and are
// recorded here for the first time.
const WRITE_ALLOW_LIST: Record<string, FileAllowList> = {
  'adapters/fs-ai-bundle.ts': {
    'fs.rmSync': [
      {
        guard: 'reclaimNonDirectoryAiAncestor',
        note:
          'TASK 1: reclaims a non-directory ancestor strictly inside `.frontx/ai/`, proven by `isInside(aiNamespaceRoot(...), blocker)` — a directory is never returned by `firstNonDirectoryComponentOf`, so never reached here.',
      },
      {
        guard: 'clearBundleDestination',
        note:
          'Removes whatever stands exactly at the bundle destination — reached only after `createFsCopyBundleFn`\'s own `assertPathWithinProjectRoot` call has already proven `dest` stays inside the project root.',
      },
      {
        guard: 'assertPathWithinProjectRoot',
        note: '`createFsRemoveBundleFn` calls it immediately before this removal.',
      },
    ],
    'fs.mkdirSync': [
      {
        guard: 'assertPathWithinProjectRoot',
        note: '`createFsCopyBundleFn` calls it on `dest` before this, and `reclaimNonDirectoryAiAncestor` (TASK 1) has already cleared any non-directory ancestor blocking the parent chain.',
      },
    ],
    'fs.cpSync': [
      {
        guard: 'assertPathWithinProjectRoot',
        note: 'Called on `dest` at the top of `createFsCopyBundleFn`, before any write.',
      },
    ],
  },
  'adapters/fs-content-store.ts': {
    'fs.mkdirSync': [
      {
        guard: 'assertWithinRoot + assertPathReachableAsDirectory',
        note: '`write()`: containment, then a non-directory-ancestor check, both run immediately above.',
      },
      {
        guard: 'assertWithinRoot + assertPathReachableAsDirectory',
        note: '`replace()`: the identical pair, run immediately above.',
      },
      {
        guard: 'assertWithinRoot',
        note: '`writeBundle` bundle-loop branch: `assertWithinRoot` on `filePath` runs immediately above.',
      },
    ],
    'fs.rmSync': [
      {
        guard: 'assertWithinRoot',
        note:
          '`replace()`: `installedPath` is proven inside `this.root` first; a symlink there is unlinked as a directory entry only, per this call\'s own doc comment.',
      },
    ],
    'fs.writeFileSync': [
      { guard: 'assertWithinRoot', note: '`writeBundle` fallback branch: containment checked immediately above.' },
      { guard: 'assertWithinRoot', note: '`writeBundle` bundle-loop branch: containment checked immediately above.' },
    ],
  },
  'adapters/fs-inventory-index.ts': {
    'fs.mkdirSync': [{ guard: 'assertIndexPathIsSafeToWrite', note: 'Called first in `writeAll`.' }],
    'fs.writeFileSync': [{ guard: 'assertIndexPathIsSafeToWrite', note: 'Writes only the temp file, never `indexPath` itself.' }],
    'fs.renameSync': [{ guard: 'assertIndexPathIsSafeToWrite', note: 'The atomic publish step, onto an already-confirmed-safe destination.' }],
  },
  'adapters/fs-project-io.ts': {
    'fs.mkdirSync': [
      {
        guard: 'resolveWriteParentDir',
        note: '`createFsWriteFileFn`: `destPath` itself is proven inside the project root by the CALLER (`commands/apply.ts`) before this seam runs.',
      },
      {
        guard: 'resolveWriteParentDir',
        note: '`createFsWriteProjectFileFn`: mirrors `createFsWriteFileFn`\'s own contract for the upgrade engine\'s scratch file.',
      },
      {
        guard: 'assertPathWithinProjectRoot',
        note: 'TASK 2: `createFsWriteProjectStateFn` — inline containment, called first in the function, before `writeDestination` is even resolved.',
      },
    ],
    'fs.writeFileSync': [
      {
        guard: 'refuseIfDestinationIsSymlink',
        note: '`createFsWriteFileFn`: called immediately above this line, refusing an existing symlink at `destPath` before this write.',
      },
      {
        guard: 'resolveWriteParentDir',
        note: '`createFsWriteProjectFileFn`: mirrors `createFsWriteFileFn`\'s own contract.',
      },
      {
        guard: 'assertPathWithinProjectRoot',
        note: 'TASK 2: `createFsWriteProjectStateFn` — writes only the temp file, beside the RESOLVED `writeDestination` (`inst-psio-resolve-write-destination`), never onto a symlink found at the original `absolutePath`.',
      },
    ],
    'fs.rmSync': [
      {
        guard: 'createFsAssertPathWithinRootFn',
        note: '`createFsRemoveProjectFileFn`: the CALLER (`commands/delete.ts`) invokes `assertPathWithinRootFn` on the same path before calling this seam.',
      },
    ],
    'fs.renameSync': [
      {
        guard: 'assertPathWithinProjectRoot + resolveNearestExistingAncestor',
        note:
          'TASK 2: `createFsWriteProjectStateFn` — renames onto the RESOLVED `writeDestination` (`inst-psio-resolve-write-destination`), never onto a symlink found at `absolutePath`, so the link survives and the real document is updated.',
      },
    ],
  },
  'adapters/fs-upgrade-io.ts': {
    'fs.mkdirSync': [
      { guard: 'assertPathWithinProjectRoot', note: '`createFsWriteDiskFileFn`: called immediately above.' },
      { guard: 'assertPathWithinProjectRoot', note: '`createFsRenameDiskFileFn`: called immediately above, against `to`.' },
    ],
    'fs.writeFileSync': [{ guard: 'assertPathWithinProjectRoot', note: '`createFsWriteDiskFileFn`: same containment call, above.' }],
    'fs.renameSync': [{ guard: 'assertPathWithinProjectRoot', note: '`createFsRenameDiskFileFn`: same containment call, above, against `to`.' }],
    'fs.unlinkSync': [{ guard: 'assertPathWithinProjectRoot', note: '`createFsUnlinkDiskFileFn`: same containment call, above; the removal is a no-op on `ENOENT`.' }],
    'fs.openSync': [
      {
        guard: 'isReservedTempName',
        note: "`createFsWriteDiskFileFn`: the reserved-temp branch only. Opened `'wx'` (`O_CREAT|O_EXCL`), which refuses anything already standing there — a symlink included — instead of following it; containment was proven above.",
      },
    ],
    'fs.writeSync': [
      { guard: 'isReservedTempName', note: '`createFsWriteDiskFileFn`: writes into the descriptor the exclusive create above just produced, never into a path resolved a second time.' },
    ],
  },
  'cli.ts': {
    'fs.rmdirSync': [
      {
        guard: 'createFsRemoveEmptyDirFn',
        note: "Removes ONLY a directory it has just read as empty, never forcing and never recursing, and swallows a failure rather than escalating; `commands/apply.ts` calls it solely for directories that call itself created (`dirsThisCallCreated`), so a developer's pre-existing directory is never a candidate.",
      },
    ],
  },
  'paths/volume-case.ts': {
    'fs.writeFileSync': [
      {
        guard: 'probeVolumeCaseInsensitive',
        note: 'Creates one uniquely-named, empty marker file under `probeDir` (the OS temp dir by default) to probe volume case-folding; any failure is caught and answered with the conservative fallback.',
      },
    ],
    'fs.rmSync': [
      {
        guard: 'probeVolumeCaseInsensitive',
        note: 'Removes the same marker file this probe just created, `{ force: true }` so a prior failure to create it never surfaces here.',
      },
    ],
  },
};

// ============================== READ SWEEP ================================
//
// `readdirSync`/`existsSync`/`statSync`/`lstatSync`/`realpathSync` never open
// a file for content and so never share `readFileSync`'s own FIFO-hang
// hazard; each entry below still names the real function whose logic makes
// that read meaningful (a dirent-typed walk that never follows a symlink, a
// probe gated by a prior containment check, or a shape check that gates a
// SEPARATE `readFileSync` call from ever reaching a FIFO). Read behaviour
// itself is UNCHANGED by this round — this sweep only records the verdicts
// that were never written down anywhere executable before now.
const READ_ALLOW_LIST: Record<string, FileAllowList> = {
  'adapters/fs-ai-bundle.ts': {
    'fs.lstatSync': [
      {
        guard: 'createFsBundleExistsFn',
        note: 'Read-only existence probe on the bundle path; only `ENOENT` is treated as absence, every other failure propagates.',
      },
    ],
  },
  'adapters/fs-content-store.ts': {
    'fs.readFileSync': [
      { guard: 'readBundle', note: 'Reads only a path `listFilesRecursive` already found via `entry.isFile()`.' },
      { guard: 'readBundle', note: 'Same guard, the multi-file bundle loop.' },
    ],
    'fs.existsSync': [
      { guard: 'replace', note: 'Containment already proven earlier in the same method.' },
      { guard: 'read', note: 'Metadata-only probe on the CLI\'s own local inventory store path.' },
      { guard: 'has', note: 'Metadata-only probe on the CLI\'s own local inventory store path.' },
    ],
    'fs.readdirSync': [
      { guard: 'has', note: 'Metadata-only listing on the CLI\'s own local inventory store path.' },
      { guard: 'listFilesRecursive', note: 'Dirent-typed walk; never follows a symlink for recursion or reading.' },
    ],
  },
  'adapters/fs-existing-content.ts': {
    'fs.readdirSync': [{ guard: 'listFilesRecursive', note: 'Dirent-typed; a symlink is reported, never descended into or opened.' }],
    'fs.readFileSync': [
      { guard: 'listFilesRecursive', note: 'Only reached for a dirent that is `entry.isFile()` — never a symlink, FIFO, socket, or device.' },
      { guard: 'blockingComponentOf', note: 'Only reached once `stat.isFile()` is confirmed; a FIFO/socket/device is reported via `SPECIAL_CONTENT_MARKER` instead, never opened.' },
    ],
    'fs.existsSync': [
      { guard: 'createFsReadInstalledContentFn', note: 'Metadata-only probe on a template\'s own installed content path.' },
      { guard: 'createFsReadExistingContentFn', note: 'Reached only after `blockingComponentOf` already confirmed no non-directory ancestor blocks `target`.' },
    ],
    'fs.lstatSync': [{ guard: 'blockingComponentOf', note: 'Never dereferences a symlink found on the way — reports it via `SYMLINK_CONTENT_MARKER` instead.' }],
  },
  'adapters/fs-project-io.ts': {
    'fs.lstatSync': [
      { guard: 'refuseIfDestinationIsSymlink', note: 'Read-only probe; only `ENOENT` is the ordinary case.' },
      { guard: 'resolvePathKind', note: 'The one FIFO-safe shape probe run before any content read.' },
      { guard: 'createFsResolveDeclaredExclusionFn', note: 'A broken symlink is distinguished from absence without ever being opened.' },
      { guard: 'resolveNearestExistingAncestor', note: 'The core symlink-resolving walk; read-only throughout.' },
      { guard: 'firstNonDirectoryComponentOf', note: 'Walk-up probe; read-only throughout.' },
    ],
    'fs.statSync': [
      { guard: 'resolvePathKind', note: 'Only reached once a symlink is already confirmed by `lstatSync`.' },
      { guard: 'walkFiles', note: 'Only reached once a resolved symlink target is proven `isInside(root, ...)`.' },
      { guard: 'createFsListTargetFilesFn', note: '`root` is already `realPathOrNull`-resolved.' },
      { guard: 'createFsListUnenumerableTargetEntriesFn', note: 'Same pattern as its sibling enumerator.' },
    ],
    'fs.readFileSync': [{ guard: 'resolvePathKind', note: 'Only reached once the `\'file\'` kind is confirmed.' }],
    'fs.existsSync': [
      { guard: 'createFsCanonicalizeTargetFn', note: 'Containment already proven by canonicalization.' },
      { guard: 'createFsAssertPathWithinRootFn', note: 'Caller-side guard, `commands/delete.ts`.' },
    ],
    'fs.realpathSync': [
      {
        guard: 'realPathOrNull',
        note:
          'Wrapped: a broken symlink or vanished path returns `null`. Calls the platform-native `.realpathSync.native` form so an existing path\'s ON-DISK spelling is returned on a case-insensitive volume, never the caller\'s own spelling.',
      },
    ],
    'fs.readdirSync': [{ guard: 'walkFiles', note: 'Dirent-typed; a symlink is resolved only afterward, explicitly.' }],
  },
  'adapters/fs-read-content-items.ts': {
    'fs.existsSync': [{ guard: 'createFsReadContentItemsFn', note: 'Metadata-only probe on a template\'s own installed content path.' }],
    'fs.readdirSync': [{ guard: 'listContentItems', note: 'Dirent-typed walk; never follows a symlink.' }],
    'fs.readFileSync': [{ guard: 'listContentItems', note: 'Only reached for a dirent that is `dirEntry.isFile()`.' }],
  },
  'adapters/fs-upgrade-io.ts': {
    'fs.lstatSync': [{ guard: 'createFsReadDiskEntryFn', note: 'Classifies the entry before ever reading content; a special entry never reaches `readFileSync`.' }],
    'fs.readFileSync': [{ guard: 'createFsReadDiskEntryFn', note: 'Only reached once `stat.isFile()` is confirmed.' }],
    'fs.existsSync': [{ guard: 'createFsListDiskFilesFn', note: 'Metadata-only probe before the walk.' }],
    'fs.readdirSync': [{ guard: 'walkRegularFiles', note: 'Dirent-typed; `entry.isSymbolicLink()` is checked first and never descended into.' }],
  },
  'adapters/local-fetch.ts': {
    'fs.existsSync': [{ guard: 'createLocalFetchFn', note: 'Metadata-only probe on the configured local fetch source directory.' }],
    'fs.statSync': [{ guard: 'createLocalFetchFn', note: 'Only used to confirm `isDirectory()`; never opens content.' }],
    'fs.readFileSync': [{ guard: 'walkDirectory', note: 'Only reached for a dirent that is `entry.isFile()`.' }],
    'fs.readdirSync': [{ guard: 'walkDirectory', note: 'Dirent-typed walk; never follows a symlink.' }],
  },
  'cli.ts': {
    'fs.readdirSync': [
      { guard: 'createFsRemoveEmptyDirFn', note: 'Names-only listing used purely to decide emptiness; never opens an entry, so no shape can block it.' },
    ],
    'fs.realpathSync': [
      { guard: 'isMainModule', note: "Resolves `process.argv[1]` to decide whether this module was started as the executable; touches no project path, and a failure is caught into `isMainModule = false`." },
      { guard: 'isMainModule', note: "The other half of the same comparison, resolving this module's own URL; identical reasoning." },
    ],
  },
  'paths/volume-case.ts': {
    'fs.statSync': [
      { guard: 'probeVolumeCaseInsensitive', note: 'Stats the marker file this probe just created, by its own (lower-case) spelling.' },
      { guard: 'probeVolumeCaseInsensitive', note: 'Stats the SAME marker file by its upper-case spelling, comparing device and inode to the call above.' },
    ],
  },
};

// Every `.ts` file under `src/`, recursively, minus the test trees
// themselves: the sweep covers the whole package, not one directory. Keys in
// both allow-lists are therefore `src`-relative paths (`adapters/fs-project-
// io.ts`, `cli.ts`), not bare basenames.
function loadSourceFiles(): { name: string; absPath: string; text: string }[] {
  const collected: { name: string; absPath: string; text: string }[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(absPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.test.ts')) continue;
      collected.push({ name: path.relative(SRC_DIR, absPath), absPath, text: fs.readFileSync(absPath, 'utf-8') });
    }
  }
  walk(SRC_DIR);
  return collected.sort((a, b) => a.name.localeCompare(b.name));
}

function groupByCall(sites: CallSite[]): Map<string, CallSite[]> {
  const grouped = new Map<string, CallSite[]>();
  for (const site of sites) {
    const list = grouped.get(site.call) ?? [];
    list.push(site);
    grouped.set(site.call, list);
  }
  return grouped;
}

function checkSweep(sweepName: string, allowList: Record<string, FileAllowList>, calls: Set<string>): void {
  const files = loadSourceFiles();
  for (const { name, absPath, text } of files) {
    const sites = collectFsCallSites(absPath, text).filter((site) => calls.has(site.call.slice('fs.'.length)));
    const found = groupByCall(sites);
    const declared = allowList[name] ?? {};

    // Every call name actually found in this file must have exactly as many
    // allow-list entries as occurrences — never more, never fewer.
    for (const [call, callSites] of found) {
      const entries = declared[call] ?? [];
      if (entries.length !== callSites.length) {
        const lines = callSites.map((s) => s.line).join(', ');
        throw new Error(
          `${sweepName} sweep: ${name} has ${callSites.length} occurrence(s) of ${call} (line(s) ${lines}), ` +
            `but the allow-list in this test declares ${entries.length}. ` +
            `Add ${call} to the allow-list for "${name}" with the guard function that protects each occurrence, ` +
            `or guard the new occurrence with an existing one, before this test can pass.`,
        );
      }
      // Every declared guard must be a real name findable in the file's own
      // source — never a hand-wave. A compound guard ("A + B") is split and
      // each half checked independently.
      for (const entry of entries) {
        for (const guardName of entry.guard.split('+').map((part) => part.trim())) {
          if (!text.includes(guardName)) {
            throw new Error(
              `${sweepName} sweep: ${name}'s allow-list names guard "${guardName}" for ${call}, but that identifier ` +
                `does not appear anywhere in ${name}'s own source — a guard must be a real, findable function name.`,
            );
          }
        }
      }
    }

    // The reverse direction: an allow-list entry for a call this file no
    // longer makes at all (or makes fewer times than declared) is stale —
    // caught by the same length comparison above when `found` still has the
    // call; this branch catches the case where `found` has NO entry for
    // that call whatsoever (the call was removed entirely).
    for (const call of Object.keys(declared)) {
      if (!found.has(call) && (declared[call]?.length ?? 0) > 0) {
        throw new Error(
          `${sweepName} sweep: ${name}'s allow-list declares ${declared[call]?.length} occurrence(s) of ${call}, ` +
            `but this file no longer contains any — remove the stale entry.`,
        );
      }
    }
  }
}

describe('fs-write-guards — executable enumeration of every raw filesystem call under src/', () => {
  it('every write-shaped call is named in the allow-list with a real guard', () => {
    expect(() => checkSweep('WRITE', WRITE_ALLOW_LIST, WRITE_CALLS)).not.toThrow();
  });

  it('every read-shaped call is named in the allow-list with a real guard', () => {
    expect(() => checkSweep('READ', READ_ALLOW_LIST, READ_CALLS)).not.toThrow();
  });

  it('sanity: the AST walk actually finds calls (a silently-empty scan would make both checks above vacuous)', () => {
    const files = loadSourceFiles();
    const totalWrite = files.reduce(
      (sum, { absPath, text }) => sum + collectFsCallSites(absPath, text).filter((s) => WRITE_CALLS.has(s.call.slice(3))).length,
      0,
    );
    const totalRead = files.reduce(
      (sum, { absPath, text }) => sum + collectFsCallSites(absPath, text).filter((s) => READ_CALLS.has(s.call.slice(3))).length,
      0,
    );
    // The destructured-import form must be seen too: `cli.ts` imports its
    // primitives that way, and a scan blind to it reported that file clean.
    const cliFile = files.find(({ name }) => name === 'cli.ts');
    if (cliFile === undefined) throw new Error('cli.ts was not scanned at all');
    expect(collectFsCallSites(cliFile.absPath, cliFile.text).length).toBeGreaterThan(0);
    expect(totalWrite).toBeGreaterThan(0);
    expect(totalRead).toBeGreaterThan(0);
  });
});
