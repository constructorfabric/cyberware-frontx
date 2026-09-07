// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-standard-test-convention:p1
import { describe, expect, it } from 'vitest';
import { baseRefFromArgv, runCli } from './contracts-policy.mjs';

/**
 * A fake Runner that records every `npm run <script> ... <args>` call this
 * policy would have made, instead of actually spawning npm - keeps these
 * tests fast and independent of a real git ref or workspace install, the
 * same reason check-lib.test.ts stays in-memory rather than shelling out.
 * @param {Record<string, number>} [exitCodes] npmScript -> exit code to
 *   return for that call (default 0).
 */
function fakeRunner(exitCodes = {}) {
  /** @type {{ npmScript: string; args: string[] }[]} */
  const calls = [];
  return {
    calls,
    /**
     * @param {string} npmScript
     * @param {string[]} args
     */
    run(npmScript, args) {
      calls.push({ npmScript, args });
      return exitCodes[npmScript] ?? 0;
    },
  };
}

describe('baseRefFromArgv', () => {
  it('reads a --base-ref <ref> pair', () => {
    expect(baseRefFromArgv(['--base-ref', 'origin/develop'])).toBe('origin/develop');
  });

  it('reads a --base-ref=<ref> single token', () => {
    expect(baseRefFromArgv(['--base-ref=origin/develop'])).toBe('origin/develop');
  });

  it('is undefined when no --base-ref flag is present', () => {
    expect(baseRefFromArgv(['--json'])).toBeUndefined();
  });
});

describe('runCli', () => {
  it('runs guard then compat with the given base ref, then coverage, in order', () => {
    const runner = fakeRunner();
    const exit = runCli({ argv: ['--base-ref', 'origin/develop'], env: {}, log: () => {}, runner });
    expect(exit).toBe(0);
    expect(runner.calls).toEqual([
      { npmScript: 'contracts:check', args: ['guard', '--base', 'origin/develop'] },
      { npmScript: 'contracts:check', args: ['compat', '--base', 'origin/develop'] },
      { npmScript: 'contracts:coverage', args: [] },
    ]);
  });

  it('falls back to CONTRACTS_POLICY_BASE_REF when no --base-ref flag is given', () => {
    const runner = fakeRunner();
    runCli({ argv: [], env: { CONTRACTS_POLICY_BASE_REF: 'HEAD~1' }, log: () => {}, runner });
    expect(runner.calls[0]).toEqual({ npmScript: 'contracts:check', args: ['guard', '--base', 'HEAD~1'] });
  });

  it('prefers an explicit --base-ref over CONTRACTS_POLICY_BASE_REF', () => {
    const runner = fakeRunner();
    runCli({ argv: ['--base-ref', 'origin/develop'], env: { CONTRACTS_POLICY_BASE_REF: 'HEAD~1' }, log: () => {}, runner });
    expect(runner.calls[0].args).toEqual(['guard', '--base', 'origin/develop']);
  });

  it('skips guard and compat, but still runs coverage, when no base ref is given anywhere', () => {
    const runner = fakeRunner();
    /** @type {string[]} */
    const messages = [];
    const exit = runCli({ argv: [], env: {}, log: (line) => messages.push(line), runner });
    expect(exit).toBe(0);
    expect(runner.calls).toEqual([{ npmScript: 'contracts:coverage', args: [] }]);
    expect(messages.some((line) => line.includes('No base ref given'))).toBe(true);
  });

  it('stops after guard and propagates its exit code, without running compat or coverage', () => {
    const runner = fakeRunner({ 'contracts:check': 1 });
    const exit = runCli({ argv: ['--base-ref', 'origin/develop'], env: {}, log: () => {}, runner });
    expect(exit).toBe(1);
    expect(runner.calls).toEqual([{ npmScript: 'contracts:check', args: ['guard', '--base', 'origin/develop'] }]);
  });

  it('never lets a nonzero coverage exit fail the policy - coverage is informational only', () => {
    const runner = fakeRunner({ 'contracts:coverage': 1 });
    const exit = runCli({ argv: ['--base-ref', 'origin/develop'], env: {}, log: () => {}, runner });
    expect(exit).toBe(0);
  });
});
