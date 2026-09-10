// TEST-ONLY — exercises the env-gated TEST-ONLY hook in `createRealDeps`
// (`packages/cli/src/cli.ts`) that realizes the EXISTING `FetchFn` seam with
// the local content adapter (`adapters/local-fetch.ts`) when
// `FRONTX_TEST_LOCAL_SOURCE_DIR` is set, so `frontx install` can assemble a
// template OFFLINE. Carries NO `@cpt` marker and traces to NO FEATURE
// instruction — this is test-only infrastructure, not product behavior.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { joinWithinRoot } from '@gears-frontx/test-support/path-guard';
import { createRealDeps } from '../cli';

describe('createRealDeps — TEST-ONLY FRONTX_TEST_LOCAL_SOURCE_DIR hook', () => {
  const originalEnv = process.env.FRONTX_TEST_LOCAL_SOURCE_DIR;
  let localDir: string;

  beforeEach(() => {
    localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-cli-local-source-'));
  });

  afterEach(() => {
    fs.rmSync(localDir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.FRONTX_TEST_LOCAL_SOURCE_DIR;
    else process.env.FRONTX_TEST_LOCAL_SOURCE_DIR = originalEnv;
  });

  it('wires the local adapter when the env var is set — fetchFn reads the local directory, ignoring the url', async () => {
    fs.writeFileSync(joinWithinRoot(localDir, 'frontx-template.json'), '{"name":"fixture","version":"1.0.0"}');
    process.env.FRONTX_TEST_LOCAL_SOURCE_DIR = localDir;

    const deps = createRealDeps();
    const fetchOutcome = await deps.fetchFn('https://api.github.com/repos/acme/anything/tarball/v1');
    // `deps.fetchFn` is the real `FetchFn` union (`string | FetchResult`):
    // the local adapter this env var wires in returns a bare string (it has
    // no pin to report), but the STATIC type is the union every `FetchFn`
    // carries, so this narrows the same way `resolve.ts` does rather than
    // assuming the string arm.
    const content = typeof fetchOutcome === 'string' ? fetchOutcome : fetchOutcome.content;

    expect(JSON.parse(content)).toEqual({
      $frontxTemplateFiles: { 'frontx-template.json': '{"name":"fixture","version":"1.0.0"}' },
    });
  });

  it('preserves the production GitHub fetchFn when the env var is unset — a bogus url fails the network path, not the local-adapter path', async () => {
    delete process.env.FRONTX_TEST_LOCAL_SOURCE_DIR;

    const deps = createRealDeps();

    // The production `createGithubFetchFn` performs a real network GET; a
    // deliberately unreachable host fails via that HTTP path (fetch
    // rejects/network error), never via the local adapter's
    // "does not exist or is not a directory" error — proving default
    // behavior is unchanged when the test env var is unset.
    await expect(deps.fetchFn('https://this-host-does-not-resolve.invalid.example/x')).rejects.not.toThrow(
      /does not exist or is not a directory/,
    );
  });
});
