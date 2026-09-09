// The ONE way this suite creates a FIFO, and the one place it decides
// whether it can. Eight test files each carried an identical three-line
// `makeFifo` calling `mkfifo` unguarded — one formulation in eight copies,
// and every one of them a hard failure on a platform without that utility.
// `cpt-frontx-constraint-cli-platform-path-identity` names Windows as a
// supported platform while CI runs Linux only, so a suite that cannot even
// start there tells nobody anything.
//
// `fifosAvailable()` is what a test branches on; `makeFifo` throws if called
// anyway, rather than silently creating an ordinary file that would make the
// assertion pass for the wrong reason.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cached: boolean | undefined;

/** Whether this platform can create a FIFO at all. Probed once. */
export function fifosAvailable(): boolean {
  if (cached !== undefined) return cached;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontx-fifo-probe-'));
  const probe = path.join(dir, 'probe');
  try {
    execFileSync('mkfifo', [probe], { stdio: 'ignore' });
    cached = fs.lstatSync(probe).isFIFO();
  } catch {
    cached = false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return cached;
}

/** Creates a FIFO at `fifoPath`. Call only under `fifosAvailable()`. */
export function makeFifo(fifoPath: string): void {
  if (!fifosAvailable()) {
    throw new Error(`FIFOs are not available on this platform; guard the caller with fifosAvailable(): ${fifoPath}`);
  }
  execFileSync('mkfifo', [fifoPath]);
}
