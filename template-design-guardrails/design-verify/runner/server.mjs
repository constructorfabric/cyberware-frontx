/**
 * Dev-server handling for the runner: bounded readiness polling against the
 * app URL, and optional spawning of the server command. Bounded by contract
 * - the verify-interface skill treats open-ended waits as a hung agent, so
 * every wait here has a deadline and a named failure.
 */
import { spawn } from 'node:child_process';

/**
 * Poll `url` until it answers any HTTP status, or the deadline passes.
 *
 * @param {string} url
 * @param {{timeoutMs?: number, intervalMs?: number, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<void>} rejects with a named error on timeout
 */
export async function waitForUrl(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';
  for (;;) {
    try {
      await fetchImpl(url, { signal: AbortSignal.timeout(Math.min(intervalMs * 2, 5_000)) });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) {
      throw new Error(`app URL never became reachable within ${timeoutMs}ms: ${url} (${lastError})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * One quick reachability probe, for deciding whether a server already holds
 * the URL before --start-server spawns a second one. A second server on an
 * occupied port dies instantly (or binds elsewhere) while the sweep silently
 * measures whatever was already listening — attaching explicitly instead
 * keeps the report honest about which server produced the evidence.
 *
 * @param {string} url
 * @param {{timeoutMs?: number, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<boolean>}
 */
export async function isUrlReachable(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    await fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 1_500) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the dev-server command in its own process group so stop() can take
 * down the whole tree (npm run spawns children).
 *
 * @param {string} command shell command, e.g. "npm run dev:all"
 * @param {{cwd?: string}} [options]
 * @returns {{stop: () => void}}
 */
export function startServer(command, options = {}) {
  const child = spawn(command, {
    shell: true,
    cwd: options.cwd ?? process.cwd(),
    stdio: 'ignore',
    detached: true,
  });
  return {
    stop: () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          /* already gone */
        }
      }
    },
  };
}
