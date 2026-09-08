// @cpt-algo:cpt-frontx-algo-template-resolution-resolve-to-inventory:p1
// @cpt-algo:cpt-frontx-algo-template-resolution-bounded-update:p1
//
// Real-filesystem, end-to-end coverage for the local inventory store's WRITE
// side (`adapters/fs-inventory-index.ts`, `adapters/fs-content-store.ts`),
// driven through the real CLI entrypoint (`run()`) rather than by
// constructing the adapters directly — the READ side of this same store
// already has that unit-level coverage (`fs-inventory-index.test.ts`,
// `fs-content-store.test.ts`), but "the refusal reaches a caller as a proper
// `--json` envelope" is a fact about the CLI's own top-level dispatch and
// catch (`cli.ts`), not about the adapter in isolation. `createRealDeps()`
// plus the TEST-ONLY `FRONTX_TEST_LOCAL_SOURCE_DIR`/`FRONTX_INVENTORY_ROOT`
// env hooks (`adapters/local-fetch.ts`, `adapters/github-fetch.ts`'s
// `resolveInventoryRoot`) is the SAME construction `cli-local-source-env.test.ts`
// already uses to exercise `install` fully offline, reused here rather than
// a second, independently wired harness.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';
import { run, createRealDeps } from '../cli';

const SPEC = 'github:acme/fixture@main';

describe('local inventory store write-side refusals (real filesystem, end-to-end through run())', () => {
  const originalInventoryRoot = process.env.FRONTX_INVENTORY_ROOT;
  const originalLocalSource = process.env.FRONTX_TEST_LOCAL_SOURCE_DIR;

  let storeRoot: string;
  let templateSourceDir: string;
  let outside: string;

  beforeEach(() => {
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-inventory-store-'));
    templateSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-inventory-template-source-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-inventory-store-outside-'));

    fs.writeFileSync(
      joinWithinRoot(templateSourceDir, 'frontx-template.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', description: 'fixture template', excludedSubtrees: [] }),
      'utf-8',
    );

    process.env.FRONTX_INVENTORY_ROOT = storeRoot;
    process.env.FRONTX_TEST_LOCAL_SOURCE_DIR = templateSourceDir;
  });

  afterEach(() => {
    fs.rmSync(storeRoot, { recursive: true, force: true });
    fs.rmSync(templateSourceDir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    if (originalInventoryRoot === undefined) delete process.env.FRONTX_INVENTORY_ROOT;
    else process.env.FRONTX_INVENTORY_ROOT = originalInventoryRoot;
    if (originalLocalSource === undefined) delete process.env.FRONTX_TEST_LOCAL_SOURCE_DIR;
    else process.env.FRONTX_TEST_LOCAL_SOURCE_DIR = originalLocalSource;
  });

  // inst-resolve-index-guard — DEFECT 1: `store/index.json` a symlink to an
  // outside file used to report `{"ok":true,...}` exit 0 while the outside
  // file was overwritten with 436 bytes of inventory index.
  it('install refuses with one INVALID_PATH envelope, non-zero exit, when index.json is a symlink escaping the store, and the outside file survives byte-for-byte', async () => {
    const outsideFile = joinWithinRoot(outside, 'devfile.json');
    fs.writeFileSync(outsideFile, '{}', 'utf-8');
    fs.symlinkSync(outsideFile, joinWithinRoot(storeRoot, 'index.json'));

    const outcome = await run(['install', SPEC, '--json'], createRealDeps());

    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error?: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('INVALID_PATH');

    expect(fs.readFileSync(outsideFile, 'utf-8')).toBe('{}');
  });

  // inst-resolve-write-guard — DEFECT 2: a symlink INSIDE the store at the
  // installed content path, pointing to an outside directory, used to report
  // `{"ok":true,...}` exit 0 while the template's payload landed in that
  // outside directory.
  it('install refuses with one INVALID_PATH envelope, non-zero exit, when the installed content path is a symlink escaping the store, and the outside directory survives untouched', async () => {
    fs.writeFileSync(joinWithinRoot(outside, 'keep.txt'), 'DEVELOPER-OWNED — must survive', 'utf-8');
    fs.symlinkSync(outside, joinWithinRoot(storeRoot, 'fixture'), 'dir');

    const outcome = await run(['install', SPEC, '--json'], createRealDeps());

    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error?: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('INVALID_PATH');

    expect(fs.readdirSync(outside)).toEqual(['keep.txt']);
    expect(fs.readFileSync(joinWithinRoot(outside, 'keep.txt'), 'utf-8')).toBe('DEVELOPER-OWNED — must survive');
  });

  // inst-bupd-lookup-guard — DEFECT 3(a): `index.json` resolving to non-JSON
  // content used to crash with a raw `SyntaxError` message and exit 2, no
  // `--json` envelope at all.
  it('install refuses with one CONTENT_CONFLICT envelope, non-zero exit, when index.json is not valid JSON', async () => {
    fs.writeFileSync(joinWithinRoot(storeRoot, 'index.json'), 'DEVFILE-PRECIOUS\n', 'utf-8');

    const outcome = await run(['install', SPEC, '--json'], createRealDeps());

    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error?: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('CONTENT_CONFLICT');
  });

  // inst-bupd-lookup-guard — DEFECT 3(b): `index.json` valid JSON of the
  // wrong SHAPE used to crash with `Cannot read properties of undefined
  // (reading 'endsWith')` and exit 2, no `--json` envelope at all.
  it('install refuses with one CONTENT_CONFLICT envelope, non-zero exit, when index.json is valid JSON of the wrong shape', async () => {
    fs.writeFileSync(joinWithinRoot(storeRoot, 'index.json'), JSON.stringify({ precious: 'not-an-entry-map' }), 'utf-8');

    const outcome = await run(['install', SPEC, '--json'], createRealDeps());

    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error?: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('CONTENT_CONFLICT');
  });

  // inst-resolve-write-guard — DEFECT 3(c): a non-directory standing at a
  // scoped identity's own leading segment used to report `INTERNAL` (exit 2)
  // from a bare, unstructured `ENOTDIR` rather than a named, actionable
  // refusal.
  it('install refuses with one CONTENT_CONFLICT envelope, non-zero exit, when a non-directory blocks the installed content path', async () => {
    fs.writeFileSync(joinWithinRoot(storeRoot, 'fixture'), 'not-a-directory', 'utf-8');

    const outcome = await run(['install', SPEC, '--json'], createRealDeps());

    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.stderr).toBeUndefined();
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean; error?: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe('CONTENT_CONFLICT');
  });

  it('sanity check: install succeeds against a clean store, proving the fixture and harness are otherwise valid', async () => {
    const outcome = await run(['install', SPEC, '--json'], createRealDeps());
    const envelope = JSON.parse(outcome.stdout ?? '') as { ok: boolean };
    expect(envelope.ok).toBe(true);
    expect(outcome.exitCode).toBe(0);
  });
});
