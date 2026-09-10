/**
 * Pure configuration layer for the design-verify runner: CLI argument
 * parsing, verification-matrix expansion, and the screenshot naming
 * convention. No I/O — everything here is unit-testable without a browser.
 */

export const DEFAULTS = Object.freeze({
  url: 'http://127.0.0.1:5173/',
  routes: ['/'],
  menus: [],
  widths: [1440, 768, 320],
  themes: ['light', 'dark'],
  themeKey: 'frontx:studio:theme',
  outDir: 'design-verify-report',
  cdpUrl: '',
  chromePath: '',
  startServer: '',
  serverCwd: '',
  serverTimeoutMs: 120_000,
  sweepTimeoutMs: 20_000,
  settleMs: 700,
  screenshots: false,
  failOnFindings: false,
  baseline: '',
});

const LIST_FLAGS = new Set(['--routes', '--menu', '--widths', '--themes']);
const VALUE_FLAGS = new Set([
  ...LIST_FLAGS,
  '--url',
  '--theme-key',
  '--out',
  '--cdp-url',
  '--chrome',
  '--start-server',
  '--server-cwd',
  '--server-timeout-ms',
  '--sweep-timeout-ms',
  '--settle-ms',
  '--baseline',
]);
const BOOL_FLAGS = new Set(['--fail-on-findings', '--screenshots', '--no-screenshots', '--help']);

/**
 * `Number.parseInt` swallows suffixes (`700ms` -> 700, `1.5` -> 1); only a
 * string that is entirely digits counts as an integer here.
 *
 * @param {string} raw
 * @returns {number | null}
 */
export function parseWholeInteger(raw) {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * @param {string[]} argv raw args after the script name
 * @returns {{config: typeof DEFAULTS & {help: boolean}, errors: string[]}}
 */
export function parseArgs(argv) {
  const config = { ...DEFAULTS, help: false };
  const errors = [];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (BOOL_FLAGS.has(flag)) {
      if (flag === '--fail-on-findings') config.failOnFindings = true;
      else if (flag === '--screenshots') config.screenshots = true;
      else if (flag === '--no-screenshots') config.screenshots = false;
      else config.help = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) {
      errors.push(`unknown flag: ${flag}`);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      errors.push(`flag ${flag} needs a value`);
      continue;
    }
    i += 1;
    switch (flag) {
      case '--routes':
        config.routes = value.split(',').map((r) => r.trim()).filter(Boolean);
        break;
      case '--menu':
        config.menus = value.split(',').map((m) => m.trim()).filter(Boolean);
        break;
      case '--widths': {
        const widths = value.split(',').map((w) => parseWholeInteger(w));
        if (widths.some((w) => w === null || w <= 0)) {
          errors.push(`--widths must be positive integers, got: ${value}`);
        } else {
          config.widths = widths;
        }
        break;
      }
      case '--themes':
        config.themes = value.split(',').map((t) => t.trim()).filter(Boolean);
        break;
      case '--url':
        config.url = value;
        break;
      case '--theme-key':
        config.themeKey = value;
        break;
      case '--out':
        config.outDir = value;
        break;
      case '--cdp-url':
        config.cdpUrl = value;
        break;
      case '--chrome':
        config.chromePath = value;
        break;
      case '--start-server':
        config.startServer = value;
        break;
      case '--server-cwd':
        config.serverCwd = value;
        break;
      case '--baseline':
        config.baseline = value;
        break;
      case '--server-timeout-ms':
      case '--sweep-timeout-ms':
      case '--settle-ms': {
        const ms = parseWholeInteger(value);
        if (ms === null || ms < 0) {
          errors.push(`${flag} must be a non-negative integer, got: ${value}`);
        } else if (flag === '--server-timeout-ms') config.serverTimeoutMs = ms;
        else if (flag === '--sweep-timeout-ms') config.sweepTimeoutMs = ms;
        else config.settleMs = ms;
        break;
      }
      default:
    }
  }
  if (config.routes.length === 0) errors.push('--routes resolved to an empty list');
  if (config.themes.length === 0) errors.push('--themes resolved to an empty list');
  return { config, errors };
}

export const USAGE = `design-verify runner - drive the dev-only design-defect checker across a
width x theme matrix in headless Chrome and emit findings.json.

Usage: node runner/cli.mjs [flags]

  --url <base>              App base URL (default ${DEFAULTS.url})
  --routes /a,/b            Routes to verify by URL navigation (default "/")
  --menu "A,B"              Verify screens by clicking these sidebar menu
                            labels instead of navigating routes - REQUIRED for
                            shells that mount screens on menu action, where a
                            deep-linked URL renders only the empty shell and a
                            route sweep would measure nothing. Replaces
                            --routes when given; screenshots are named by the
                            label
  --widths 1440,768,320     Viewport widths in CSS px (default ${DEFAULTS.widths.join(',')})
  --themes light,dark       Theme ids to exercise (default ${DEFAULTS.themes.join(',')})
  --theme-key <key>         localStorage key the app restores its theme from
                            (default ${DEFAULTS.themeKey})
  --out <dir>               Report directory (default ${DEFAULTS.outDir})
  --cdp-url <http>          Attach to an already-running Chrome DevTools
                            endpoint (e.g. http://127.0.0.1:9222) instead of
                            launching one
  --chrome <path>           Chrome/Chromium executable to launch (default:
                            $CHROME_PATH, then common install locations)
  --start-server "<cmd>"    Start the dev server with this shell command and
                            stop it afterwards (default: attach to --url).
                            Skipped, with a log line, when --url already
                            answers - the incumbent server is measured then
  --server-cwd <dir>        Directory to run --start-server in (default:
                            $INIT_CWD - where npm was invoked, so the app
                            root when using "npm run verify:ui" from there -
                            then the current directory)
  --server-timeout-ms <ms>  Max wait for the app URL (default ${DEFAULTS.serverTimeoutMs})
  --sweep-timeout-ms <ms>   Max wait for the checker's console line (default ${DEFAULTS.sweepTimeoutMs})
  --settle-ms <ms>          Settle delay after a resize (default ${DEFAULTS.settleMs})
  --screenshots             Capture PNGs per state (default off during the fix
                            loop: findings.json is the evidence channel; pass
                            it on the closing full pass for the final visual
                            review)
  --no-screenshots          Explicitly skip PNG capture
  --baseline <file>         Compare against a prior findings.json: the report
                            and summary split findings into new, resolved, and
                            carried-over relative to it. With
                            --fail-on-findings, only NEW findings gate the
                            exit code - known findings stay advisory
  --fail-on-findings        Exit 1 when any finding is reported (default:
                            advisory - findings never fail the run; exit 2 is
                            reserved for environment failures and for a
                            requested screenshot that could not be captured
                            or written, either way)
  --help                    Print this message
`;

/**
 * Resolve the directory --start-server runs in. npm executes workspace
 * scripts with cwd set to the workspace package, so a bare process.cwd()
 * would run "npm run dev:all" inside design-verify, where no such script
 * exists; $INIT_CWD (set by npm to the invocation directory) points back at
 * the app root in the documented "npm run verify:ui" invocation.
 *
 * @param {{serverCwd?: string}} config
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [cwd]
 */
export function resolveServerCwd(config, env = process.env, cwd = process.cwd()) {
  return config.serverCwd || env.INIT_CWD || cwd;
}

/**
 * Expand the verification matrix in sweep order: per route, per theme
 * (each theme change reloads the page), per width (cheap resize innermost).
 *
 * @param {{routes: string[], themes: string[], widths: number[]}} config
 */
export function expandMatrix(config) {
  const states = [];
  for (const route of config.routes) {
    for (const theme of config.themes) {
      for (const width of config.widths) {
        states.push({ route, theme, width });
      }
    }
  }
  return states;
}

/** @param {string} route */
export function routeSlug(route) {
  const slug = route.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'root' : slug;
}

/** Stable screenshot naming: <route>-<theme>-<width>.png */
export function shotName(route, theme, width) {
  return `${routeSlug(route)}-${theme}-${width}.png`;
}
