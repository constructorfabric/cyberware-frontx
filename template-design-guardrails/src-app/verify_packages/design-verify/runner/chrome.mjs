/**
 * Locate and launch a headless Chrome/Chromium for the runner, or attach to
 * one that is already running. The runner ships no browser: it uses whatever
 * Chrome the machine has (CI images and dev machines carry one; the error
 * message names the remedy when none is found).
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Common executable locations, tried after $CHROME_PATH. */
export const CHROME_CANDIDATES = Object.freeze([
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]);

/**
 * Newest first, comparing embedded numbers numerically so `chromium-1000`
 * outranks `chromium-999` and `linux-115.0.5790.98` outranks `linux-99.0.1.1`
 * (a plain string sort would get both wrong).
 *
 * @param {string} a @param {string} b
 */
export function compareVersionsDesc(a, b) {
  const split = (s) => s.split(/(\d+)/);
  const pa = split(a);
  const pb = split(b);
  for (let k = 0; k < Math.max(pa.length, pb.length); k += 1) {
    const x = pa[k] ?? '';
    const y = pb[k] ?? '';
    if (x === y) continue;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(y) - Number(x);
    return y < x ? -1 : 1;
  }
  return 0;
}

/**
 * Browsers that test tooling has already downloaded: Playwright and Puppeteer
 * keep full Chromium builds under ~/.cache, and on agent/CI boxes those are
 * often the ONLY browsers present (the guardrails pilot machine had no system
 * Chrome, and its agent spent turns hunting for these by hand). Newest
 * revision first, so a stale download never shadows a fresh one.
 *
 * @param {{home?: string, listDir?: (dir: string) => string[]}} [options]
 * @returns {string[]} candidate executable paths (existence unchecked)
 */
export function discoverCacheChromes(options = {}) {
  const home = options.home ?? os.homedir();
  const listDir =
    options.listDir ??
    ((dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    });
  const found = [];
  const playwrightRoot = path.join(home, '.cache', 'ms-playwright');
  for (const entry of listDir(playwrightRoot)
    .filter((e) => /^chromium-\d+$/.test(e))
    .sort(compareVersionsDesc)) {
    for (const sub of listDir(path.join(playwrightRoot, entry)).filter((s) =>
      s.startsWith('chrome-linux'),
    )) {
      found.push(path.join(playwrightRoot, entry, sub, 'chrome'));
    }
  }
  const puppeteerRoot = path.join(home, '.cache', 'puppeteer', 'chrome');
  for (const entry of listDir(puppeteerRoot).sort(compareVersionsDesc)) {
    for (const sub of listDir(path.join(puppeteerRoot, entry)).filter((s) =>
      s.startsWith('chrome-linux'),
    )) {
      found.push(path.join(puppeteerRoot, entry, sub, 'chrome'));
    }
  }
  return found;
}

/**
 * @param {{chromePath?: string, env?: Record<string, string | undefined>, exists?: (p: string) => boolean,
 *   home?: string, listDir?: (dir: string) => string[]}} [options]
 * @returns {string} executable path
 */
export function findChrome(options = {}) {
  const env = options.env ?? process.env;
  const exists =
    options.exists ??
    ((p) => {
      try {
        accessSync(p, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  const candidates = [
    options.chromePath,
    env.CHROME_PATH,
    ...CHROME_CANDIDATES,
    ...discoverCacheChromes(options),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  throw new Error(
    'no Chrome/Chromium executable found - install one, set $CHROME_PATH, pass --chrome <path>, ' +
      'or attach to a running browser with --cdp-url http://127.0.0.1:9222',
  );
}

/**
 * Extract the DevTools HTTP endpoint from Chrome's startup stderr line
 * ("DevTools listening on ws://127.0.0.1:PORT/devtools/browser/...").
 * Pure, so the parsing is testable without launching anything.
 *
 * @param {string} text accumulated stderr
 * @returns {string | undefined} http://host:port, if announced yet
 */
export function parseDevtoolsEndpoint(text) {
  const match = text.match(/DevTools listening on ws:\/\/([^:\s]+):(\d+)\//);
  if (!match) return undefined;
  return `http://${match[1]}:${match[2]}`;
}

/**
 * Launch headless Chrome with a random DevTools port and resolve to the
 * announced HTTP endpoint. The child is detached from the report's fate:
 * callers must stop() it in a finally block.
 *
 * @param {string} execPath
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{endpoint: string, stop: () => void}>}
 */
export function launchChrome(execPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  // A dedicated throwaway profile: without it, builds defaulting to the
  // user's profile dir refuse to start while a browser holds SingletonLock,
  // and runs would inherit whatever state that profile carries.
  const profileDir = mkdtempSync(path.join(os.tmpdir(), 'design-verify-chrome-'));
  const child = spawn(
    execPath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const stop = () => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`Chrome did not announce a DevTools endpoint within ${timeoutMs}ms:\n${stderr}`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      const endpoint = parseDevtoolsEndpoint(stderr);
      if (endpoint) {
        clearTimeout(timer);
        resolve({ endpoint, stop });
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      stop();
      reject(new Error(`failed to launch Chrome at ${execPath}: ${error.message}`));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      stop();
      reject(new Error(`Chrome exited before announcing DevTools (code ${code}):\n${stderr}`));
    });
  });
}
