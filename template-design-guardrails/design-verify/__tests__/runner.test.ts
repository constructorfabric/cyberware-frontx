// @vitest-environment node
// Unit tests for the runner's pure layers (config, report, chrome parsing)
// and its CDP protocol handling via an injected fake WebSocket. The
// browser-driving CLI itself is exercised end-to-end against a real app, not
// here - these tests pin the logic every run depends on.
import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  expandMatrix,
  parseArgs,
  resolveServerCwd,
  routeSlug,
  shotName,
} from '../runner/config.mjs';
import { buildReport, diffReports, exitCode, summaryLines } from '../runner/report.mjs';
import {
  CHROME_CANDIDATES,
  discoverCacheChromes,
  findChrome,
  parseDevtoolsEndpoint,
} from '../runner/chrome.mjs';
import { CdpSession } from '../runner/cdp.mjs';
import { isUrlReachable } from '../runner/server.mjs';

describe('config', () => {
  it('parses the full flag surface', () => {
    const { config, errors } = parseArgs([
      '--url', 'http://127.0.0.1:5174/',
      '--routes', '/login,/tasks',
      '--widths', '1440,320',
      '--themes', 'light,dark',
      '--theme-key', 'custom:key',
      '--out', 'shots',
      '--start-server', 'npm run dev:all',
      '--server-cwd', '/apps/best-app',
      '--fail-on-findings',
      '--no-screenshots',
    ]);
    expect(errors).toEqual([]);
    expect(config).toMatchObject({
      url: 'http://127.0.0.1:5174/',
      routes: ['/login', '/tasks'],
      widths: [1440, 320],
      themes: ['light', 'dark'],
      themeKey: 'custom:key',
      outDir: 'shots',
      startServer: 'npm run dev:all',
      serverCwd: '/apps/best-app',
      failOnFindings: true,
      screenshots: false,
    });
  });

  it('applies defaults and rejects unknown flags and bad values', () => {
    expect(parseArgs([]).config).toMatchObject({
      routes: DEFAULTS.routes,
      widths: DEFAULTS.widths,
      themes: DEFAULTS.themes,
      failOnFindings: false,
    });
    // Screenshots are opt-in: findings.json is the evidence channel.
    expect(parseArgs([]).config.screenshots).toBe(false);
    expect(parseArgs(['--screenshots']).config.screenshots).toBe(true);
    expect(parseArgs(['--nope']).errors[0]).toMatch(/unknown flag/);
    expect(parseArgs(['--widths', '1440,huge']).errors[0]).toMatch(/positive integers/);
    // parseInt would silently truncate these; the parser must refuse them.
    expect(parseArgs(['--widths', '1.5']).errors[0]).toMatch(/positive integers/);
    expect(parseArgs(['--widths', '1440px']).errors[0]).toMatch(/positive integers/);
    expect(parseArgs(['--settle-ms', '700ms']).errors[0]).toMatch(/non-negative integer/);
    expect(parseArgs(['--sweep-timeout-ms', '1e3']).errors[0]).toMatch(/non-negative integer/);
    expect(parseArgs(['--settle-ms', ' 700 ']).config.settleMs).toBe(700);
    expect(parseArgs(['--routes']).errors[0]).toMatch(/needs a value/);
  });

  it('expands the matrix route-outermost, width-innermost', () => {
    const states = expandMatrix({ routes: ['/a'], themes: ['light', 'dark'], widths: [1440, 320] });
    expect(states).toEqual([
      { route: '/a', theme: 'light', width: 1440 },
      { route: '/a', theme: 'light', width: 320 },
      { route: '/a', theme: 'dark', width: 1440 },
      { route: '/a', theme: 'dark', width: 320 },
    ]);
  });

  it('parses --menu labels for action-mounted shells', () => {
    const { config, errors } = parseArgs(['--menu', 'Overview, Audit Log']);
    expect(errors).toEqual([]);
    expect(config.menus).toEqual(['Overview', 'Audit Log']);
    expect(parseArgs([]).config.menus).toEqual([]);
  });

  it('runs --start-server from the flag, then npm invocation dir, then cwd', () => {
    // npm runs workspace scripts with cwd inside the package, where the app's
    // dev script does not exist — INIT_CWD points back at the invocation dir.
    expect(resolveServerCwd({ serverCwd: '/explicit' }, { INIT_CWD: '/root' }, '/pkg')).toBe('/explicit');
    expect(resolveServerCwd({ serverCwd: '' }, { INIT_CWD: '/root' }, '/pkg')).toBe('/root');
    expect(resolveServerCwd({ serverCwd: '' }, {}, '/pkg')).toBe('/pkg');
  });

  it('names screenshots stably, with a root fallback slug', () => {
    expect(shotName('/tasks', 'dark', 320)).toBe('tasks-dark-320.png');
    expect(shotName('/a/b?c=1', 'light', 1440)).toBe('a-b-c-1-light-1440.png');
    expect(routeSlug('/')).toBe('root');
  });
});

describe('report', () => {
  const clean = { route: '/', theme: 'light', width: 1440, findings: [] };
  const dirty = {
    route: '/',
    theme: 'dark',
    width: 320,
    findings: [{ id: 'page-horizontal-scroll', detail: 'body overflows' }, { id: 'tiny-text', detail: '8px' }],
  };
  const broken = { route: '/x', theme: 'light', width: 1440, environmentError: 'checker unavailable' };

  it('aggregates counts by rule and separates environment failures', () => {
    const report = buildReport({ baseUrl: 'http://x/', themeKey: 'k' }, [clean, dirty, broken]);
    expect(report.summary).toEqual({
      statesRun: 3,
      statesClean: 1,
      environmentFailures: 1,
      screenshotFailures: 0,
      totalFindings: 2,
      byRule: { 'page-horizontal-scroll': 1, 'tiny-text': 1 },
    });
    expect(summaryLines(report).join('\n')).toContain('ENVIRONMENT /x light 1440px');
  });

  it('parses --baseline as a value flag', () => {
    expect(parseArgs(['--baseline', 'prior/findings.json']).config.baseline).toBe(
      'prior/findings.json',
    );
    expect(parseArgs([]).config.baseline).toBe('');
    expect(parseArgs(['--baseline']).errors[0]).toMatch(/needs a value/);
  });

  it('diffs runs by state + rule + target, ignoring the jittery detail text', () => {
    const meta = { baseUrl: 'u', themeKey: 'k' };
    const finding = (id: string, target: string, detail: string) => ({ id, target, detail });
    const baseline = buildReport(meta, [
      {
        route: '/a', theme: 'light', width: 320,
        findings: [finding('tiny-text', 'p.hint', '8px'), finding('clipped-text', 'h1', 'clip')],
      },
    ]);
    const current = buildReport(meta, [
      {
        route: '/a', theme: 'light', width: 320,
        // Same identity as the baseline's tiny-text, different measurement.
        findings: [finding('tiny-text', 'p.hint', '9px'), finding('skipped-heading', 'h3', 'h1->h3')],
      },
      // A state the baseline never swept: its findings count as new.
      { route: '/b', theme: 'dark', width: 1440, findings: [finding('tiny-text', 'em', '7px')] },
    ]);
    const diff = diffReports(baseline, current);
    expect(diff.carriedOver).toBe(1);
    expect(diff.new.map((f) => [f.route, f.id])).toEqual([
      ['/a', 'skipped-heading'],
      ['/b', 'tiny-text'],
    ]);
    expect(diff.resolved.map((f) => f.id)).toEqual(['clipped-text']);
    expect(diff.unverified).toEqual([]);
    expect(summaryLines(current, diff).join('\n')).toContain(
      '2 new, 1 resolved, 0 unverified, 1 carried over',
    );

    // With a baseline, --fail-on-findings gates on new findings only.
    expect(exitCode(current, { failOnFindings: true }, diff)).toBe(1);
    const allKnown = diffReports(current, current);
    expect(exitCode(current, { failOnFindings: true }, allKnown)).toBe(0);
    expect(exitCode(current, { failOnFindings: true })).toBe(1);
  });

  // Two identical cards each missing padding are two findings with one key.
  // A plain Map would keep one and let the second instance arrive unreported,
  // so a baseline with one and a run with two must report the extra as new,
  // and a run that drops from two to one must report one resolved, not zero.
  it('compares findings as a multiset: extra instances are new, fewer are resolved', () => {
    const meta = { baseUrl: 'u', themeKey: 'k' };
    const pad = { id: 'card-missing-padding', target: 'div.card', detail: 'left 0px' };
    const state = (findings: object[]) => ({ route: '/a', theme: 'light', width: 320, findings });
    const one = buildReport(meta, [state([pad])]);
    const two = buildReport(meta, [state([pad, pad])]);

    const grew = diffReports(one, two);
    expect(grew.new).toEqual([expect.objectContaining({ id: 'card-missing-padding', count: 1 })]);
    expect(grew.resolved).toEqual([]);
    expect(grew.carriedOver).toBe(1);
    expect(exitCode(two, { failOnFindings: true }, grew)).toBe(1);
    expect(summaryLines(two, grew).join('\n')).toContain('1 new, 0 resolved, 0 unverified, 1 carried over');

    const shrank = diffReports(two, one);
    expect(shrank.new).toEqual([]);
    expect(shrank.resolved).toEqual([expect.objectContaining({ id: 'card-missing-padding', count: 1 })]);
    expect(shrank.carriedOver).toBe(1);

    // Both instances new at once: the count travels with the entry and the
    // summary line shows the multiplicity.
    const fromNothing = diffReports(buildReport(meta, [state([])]), two);
    expect(fromNothing.new).toEqual([expect.objectContaining({ count: 2 })]);
    expect(summaryLines(two, fromNothing).join('\n')).toContain('NEW /a light 320px: card-missing-padding @ div.card (x2)');
  });

  // Absence is only evidence when the state was re-observed. A baseline
  // finding whose state hit an environment error now, or was left out of a
  // narrower matrix, is unverified - never resolved.
  it('does not resolve findings in states the current run did not complete', () => {
    const meta = { baseUrl: 'u', themeKey: 'k' };
    const f = { id: 'tiny-text', target: 'p.hint', detail: '8px' };
    const baseline = buildReport(meta, [
      { route: '/a', theme: 'light', width: 320, findings: [f] },
      { route: '/b', theme: 'dark', width: 1440, findings: [f] },
      { route: '/c', theme: 'light', width: 768, findings: [f] },
    ]);
    const current = buildReport(meta, [
      // /a re-observed clean: resolved.
      { route: '/a', theme: 'light', width: 320, findings: [] },
      // /b could not be swept: unverified, not resolved.
      { route: '/b', theme: 'dark', width: 1440, environmentError: 'checker unavailable' },
      // /c not in this run's matrix at all: unverified.
    ]);
    const diff = diffReports(baseline, current);
    expect(diff.resolved.map((e) => e.route)).toEqual(['/a']);
    expect(diff.unverified.map((e) => e.route)).toEqual(['/b', '/c']);
    expect(diff.new).toEqual([]);
    const lines = summaryLines(current, diff).join('\n');
    expect(lines).toContain('0 new, 1 resolved, 2 unverified, 0 carried over');
    expect(lines).toContain('UNVERIFIED /b dark 1440px: tiny-text @ p.hint');
    expect(lines).toContain('UNVERIFIED /c light 768px: tiny-text @ p.hint');
    // The environment failure still owns the exit code.
    expect(exitCode(current, { failOnFindings: true }, diff)).toBe(2);
  });

  it('exit codes: environment failure always wins; findings gate only when asked', () => {
    const meta = { baseUrl: 'u', themeKey: 'k' };
    expect(exitCode(buildReport(meta, [clean, dirty]), { failOnFindings: false })).toBe(0);
    expect(exitCode(buildReport(meta, [clean, dirty]), { failOnFindings: true })).toBe(1);
    expect(exitCode(buildReport(meta, [dirty, broken]), { failOnFindings: false })).toBe(2);
    expect(exitCode(buildReport(meta, [clean]), { failOnFindings: true })).toBe(0);
  });

  // A screenshot the run was asked for and could not produce is missing
  // evidence: the closing visual review cannot happen over it, so the state is
  // not clean and the run must not exit 0 - even when the sweep itself found
  // nothing and --fail-on-findings is off.
  it('treats a failed requested screenshot as incomplete verification (exit 2)', () => {
    const meta = { baseUrl: 'u', themeKey: 'k' };
    const shotLost = {
      route: '/', theme: 'light', width: 1440, findings: [], screenshotError: 'ENOSPC: disk full',
    };
    const report = buildReport(meta, [clean, shotLost]);
    expect(report.summary).toMatchObject({
      statesRun: 2,
      statesClean: 1,
      environmentFailures: 0,
      screenshotFailures: 1,
      totalFindings: 0,
    });
    expect(exitCode(report, { failOnFindings: false })).toBe(2);
    expect(exitCode(report, { failOnFindings: true }, diffReports(report, report))).toBe(2);
    expect(summaryLines(report).join('\n')).toContain('SCREENSHOT / light 1440px: ENOSPC: disk full');
    expect(summaryLines(report)[0]).toContain('1 screenshot failure(s)');
    // A captured screenshot is not a failure.
    const shotOk = { ...clean, screenshot: 'root-light-1440.png' };
    expect(buildReport(meta, [shotOk]).summary).toMatchObject({ statesClean: 1, screenshotFailures: 0 });
  });
});

describe('server', () => {
  it('reports reachability as a boolean, any HTTP answer counting as up', async () => {
    await expect(isUrlReachable('http://x/', { fetchImpl: async () => ({}) as never })).resolves.toBe(true);
    await expect(
      isUrlReachable('http://x/', { fetchImpl: async () => { throw new Error('refused'); } }),
    ).resolves.toBe(false);
  });
});

describe('chrome', () => {
  it('parses the DevTools endpoint from startup stderr', () => {
    expect(
      parseDevtoolsEndpoint('DevTools listening on ws://127.0.0.1:39511/devtools/browser/ab-cd\n'),
    ).toBe('http://127.0.0.1:39511');
    expect(parseDevtoolsEndpoint('starting up...')).toBeUndefined();
  });

  it('resolves the executable by explicit path, then $CHROME_PATH, then candidates', () => {
    const exists = (p: string) => p === '/custom/chrome' || p === CHROME_CANDIDATES[1];
    expect(findChrome({ chromePath: '/custom/chrome', env: {}, exists })).toBe('/custom/chrome');
    expect(findChrome({ env: { CHROME_PATH: '/custom/chrome' }, exists })).toBe('/custom/chrome');
    expect(findChrome({ env: {}, exists })).toBe(CHROME_CANDIDATES[1]);
    expect(() => findChrome({ env: {}, exists: () => false })).toThrow(/--cdp-url/);
  });

  it('discovers Playwright/Puppeteer cache browsers, newest revision first', () => {
    const dirs: Record<string, string[]> = {
      // 999 vs 1000 and 99 vs 115: a string sort would rank the shorter,
      // older revisions first.
      '/h/.cache/ms-playwright': ['chromium-999', 'chromium-1208', 'chromium-1237', 'ffmpeg-1011', 'b'],
      '/h/.cache/ms-playwright/chromium-999': ['chrome-linux'],
      '/h/.cache/ms-playwright/chromium-1208': ['chrome-linux64'],
      '/h/.cache/ms-playwright/chromium-1237': ['chrome-linux'],
      '/h/.cache/puppeteer/chrome': ['linux-99.0.4844.51', 'linux-115.0.5790.98'],
      '/h/.cache/puppeteer/chrome/linux-99.0.4844.51': ['chrome-linux64'],
      '/h/.cache/puppeteer/chrome/linux-115.0.5790.98': ['chrome-linux64'],
    };
    const listDir = (dir: string) => dirs[dir] ?? [];
    expect(discoverCacheChromes({ home: '/h', listDir })).toEqual([
      '/h/.cache/ms-playwright/chromium-1237/chrome-linux/chrome',
      '/h/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
      '/h/.cache/ms-playwright/chromium-999/chrome-linux/chrome',
      '/h/.cache/puppeteer/chrome/linux-115.0.5790.98/chrome-linux64/chrome',
      '/h/.cache/puppeteer/chrome/linux-99.0.4844.51/chrome-linux64/chrome',
    ]);
    // findChrome falls through the fixed candidates into the caches.
    const cached = '/h/.cache/ms-playwright/chromium-1237/chrome-linux/chrome';
    expect(findChrome({ env: {}, exists: (p: string) => p === cached, home: '/h', listDir })).toBe(cached);
  });
});

describe('CdpSession protocol handling', () => {
  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor(public url: string) {
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(data: string) {
      this.sent.push(data);
      const msg = JSON.parse(data);
      // Auto-acknowledge the enable calls issued by connect().
      if (String(msg.method).endsWith('.enable')) {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: msg.id, result: {} }) }));
      }
    }
    close() {
      this.onclose?.();
    }
    reply(payload: object) {
      this.onmessage?.({ data: JSON.stringify(payload) });
    }
  }

  async function connected() {
    const session = new CdpSession('ws://fake', { WebSocketImpl: FakeWebSocket as never });
    await session.connect();
    const ws = FakeWebSocket.instances.at(-1) as FakeWebSocket;
    return { session, ws };
  }

  it('correlates responses to requests and surfaces CDP errors as rejections', async () => {
    const { session, ws } = await connected();
    const pending = session.send('Page.navigate', { url: 'http://x/' });
    const sent = JSON.parse(ws.sent.at(-1) as string);
    expect(sent.method).toBe('Page.navigate');
    ws.reply({ id: sent.id, result: { frameId: 'f' } });
    await expect(pending).resolves.toEqual({ frameId: 'f' });

    const failing = session.send('Page.navigate');
    const failId = JSON.parse(ws.sent.at(-1) as string).id;
    ws.reply({ id: failId, error: { code: -32000, message: 'nope' } });
    await expect(failing).rejects.toThrow('CDP -32000: nope');
  });

  it('returns page exceptions as data, not runner crashes', async () => {
    const { session, ws } = await connected();
    const pending = session.evaluate('window.__frontxDesignDefects()', { awaitPromise: true });
    const id = JSON.parse(ws.sent.at(-1) as string).id;
    ws.reply({
      id,
      result: {
        result: { type: 'object' },
        exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: not a function' } },
      },
    });
    await expect(pending).resolves.toEqual({ error: 'TypeError: not a function' });
  });

  it('rejects in-flight commands when the socket closes or the session is closed', async () => {
    const { session, ws } = await connected();
    const navigating = session.navigate('http://x/');
    const evaluating = session.evaluate('1 + 1');
    ws.onclose?.();
    await expect(navigating).rejects.toThrow(/CDP WebSocket closed/);
    await expect(evaluating).rejects.toThrow(/CDP WebSocket closed/);
    expect(session.pending.size).toBe(0);

    const second = await connected();
    const shot = second.session.screenshot();
    second.session.close();
    await expect(shot).rejects.toThrow(/session closed/);

    const third = await connected();
    const failing = third.session.send('Page.navigate');
    third.ws.onerror?.();
    await expect(failing).rejects.toThrow(/CDP WebSocket error/);
  });

  it('tears the session down when a command gets no reply within the deadline', async () => {
    const session = new CdpSession('ws://fake', {
      WebSocketImpl: FakeWebSocket as never,
      commandTimeoutMs: 30,
    });
    await session.connect();
    const stalled = session.navigate('http://x/');
    const bystander = session.evaluate('1 + 1');
    await expect(stalled).rejects.toThrow(/Page\.navigate got no reply within 30ms/);
    await expect(bystander).rejects.toThrow(/no reply within 30ms/);
    expect(session.pending.size).toBe(0);
  });

  it('collects console lines and waitForConsoleLine matches only from the given index', async () => {
    const { session, ws } = await connected();
    ws.reply({
      method: 'Runtime.consoleAPICalled',
      params: { type: 'log', args: [{ value: '[design-defects] clean: no objective design defects detected' }] },
    });
    ws.reply({ method: 'Log.entryAdded', params: { entry: { level: 'error', text: 'boom' } } });
    expect(session.consoleLines).toEqual([
      'log: [design-defects] clean: no objective design defects detected',
      'log.error: boom',
    ]);
    await expect(
      session.waitForConsoleLine(/\[design-defects\]/, 0, 50),
    ).resolves.toContain('[design-defects] clean');
    await expect(session.waitForConsoleLine(/\[design-defects\]/, 1, 50)).resolves.toBeUndefined();
  });
});
