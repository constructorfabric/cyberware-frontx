// @cpt-dod:cpt-frontx-dod-composed-provenance-contract-ownership:p1
//
// Real-filesystem, whole-CLI coverage for defect-1: a malformed RECORDED
// `TemplateEntry.excludedSubtrees` must make the WHOLE project state
// document `PROJECT_INVALID` for every command that reads it — `delete`,
// `apply`, `list`, and `validate --project` alike — never silently accepted
// and never destructive. Reproduced live before this fix:
//
//   excludedSubtrees: 123
//     frontx validate --project --json  => {"ok":true,...}           exit 0
//     frontx delete . --dry-run --json  => `... is not iterable`     exit 2
//
//   excludedSubtrees: [""]
//     frontx validate --project --json  => {"ok":true,...}           exit 0
//     frontx delete . --yes --json      => {"ok":true, "toDelete":
//       ["a.txt","userland/mine.txt"], ...}   exit 0 — and both files were
//       genuinely removed, the developer's own included.
//
// This suite drives the real `run()` entrypoint (`../cli.ts`) against a
// real temporary project directory (`process.chdir`'d into for the
// duration of each case), so a REGRESSION back to accepting a malformed
// value is caught at the one place a developer would actually see it: the
// CLI's own stdout envelope, and the file it would otherwise have destroyed
// still standing on disk afterward.
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, createRealDeps } from '../cli';
import type { CliDeps } from '../cli';
import type { ProjectStateDocument } from '../project-state/types';

let root: string | undefined;
let originalCwd: string;
let originalInventoryRoot: string | undefined;
let inventoryRoot: string | undefined;

beforeEach(() => {
  originalCwd = process.cwd();
  originalInventoryRoot = process.env.FRONTX_INVENTORY_ROOT;
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalInventoryRoot === undefined) {
    delete process.env.FRONTX_INVENTORY_ROOT;
  } else {
    process.env.FRONTX_INVENTORY_ROOT = originalInventoryRoot;
  }
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
  if (inventoryRoot !== undefined) {
    await rm(inventoryRoot, { recursive: true, force: true });
    inventoryRoot = undefined;
  }
});

async function writeMalformedProjectState(repoRoot: string, excludedSubtreesRaw: unknown): Promise<void> {
  await mkdir(path.join(repoRoot, '.frontx'), { recursive: true });
  const raw =
    `{"formatVersion":1,"templates":{"appTemplate":{"origin":"path:vendor-a","version":"1.0.0",` +
    `"targets":["."],"excludedSubtrees":${JSON.stringify(excludedSubtreesRaw)}}},"projectOwnedRoots":[]}`;
  await writeFile(path.join(repoRoot, '.frontx', 'project.json'), raw, 'utf-8');
}

function realDeps(): CliDeps {
  return createRealDeps();
}

const MALFORMED_CASES: { label: string; value: unknown }[] = [
  { label: 'a number', value: 123 },
  { label: 'a string', value: 'userland/' },
  { label: 'an array containing an empty string', value: [''] },
  { label: 'an array containing a non-string', value: [42] },
  { label: 'a value addressing no location (".." escaping the target)', value: ['../'] },
];

describe('a malformed RECORDED excludedSubtrees makes the project state document PROJECT_INVALID (real filesystem, whole CLI)', () => {
  for (const { label, value } of MALFORMED_CASES) {
    describe(`excludedSubtrees is ${label}`, () => {
      beforeEach(async () => {
        root = await mkdtemp(path.join(tmpdir(), 'frontx-excluded-subtrees-shape-'));
        inventoryRoot = await mkdtemp(path.join(tmpdir(), 'frontx-excluded-subtrees-shape-inventory-'));
        process.env.FRONTX_INVENTORY_ROOT = inventoryRoot;

        await mkdir(path.join(root, 'userland'), { recursive: true });
        await writeFile(path.join(root, 'a.txt'), 'template-owned', 'utf-8');
        await writeFile(path.join(root, 'userland', 'mine.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
        await writeMalformedProjectState(root, value);

        process.chdir(root);
      });

      it('refuses validate --project with PROJECT_INVALID', async () => {
        const outcome = await run(['validate', '--project', '--json'], realDeps());
        const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error?: { code: string } };
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.code).toBe('PROJECT_INVALID');
      });

      it('refuses delete with PROJECT_INVALID, leaving the developer\'s file untouched', async () => {
        const outcome = await run(['delete', '.', '--dry-run', '--yes', '--json'], realDeps());
        const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error?: { code: string } };
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.code).toBe('PROJECT_INVALID');

        const survived = await readFile(path.join(root!, 'userland', 'mine.txt'), 'utf-8');
        expect(survived).toBe('DEVELOPER-OWNED — must survive');
      });

      it('refuses apply with PROJECT_INVALID', async () => {
        const outcome = await run(['apply', '--input', '{"templates":{}}', '--json'], realDeps());
        const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error?: { code: string } };
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.code).toBe('PROJECT_INVALID');
      });

      it('refuses list with PROJECT_INVALID', async () => {
        const outcome = await run(['list', '--json'], realDeps());
        const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error?: { code: string } };
        expect(envelope.ok).toBe(false);
        expect(envelope.error?.code).toBe('PROJECT_INVALID');
      });

      // The document itself is never rewritten by a mere refusal to read it.
      it('leaves the malformed document itself byte-for-byte unchanged after every refusal above', async () => {
        await run(['validate', '--project', '--json'], realDeps());
        await run(['delete', '.', '--dry-run', '--yes', '--json'], realDeps());
        await run(['apply', '--input', '{"templates":{}}', '--json'], realDeps());
        await run(['list', '--json'], realDeps());

        const stateAfter = JSON.parse(
          await readFile(path.join(root!, '.frontx', 'project.json'), 'utf-8'),
        ) as ProjectStateDocument;
        expect((stateAfter.templates.appTemplate as unknown as { excludedSubtrees: unknown }).excludedSubtrees).toEqual(
          value,
        );
      });
    });
  }
});
