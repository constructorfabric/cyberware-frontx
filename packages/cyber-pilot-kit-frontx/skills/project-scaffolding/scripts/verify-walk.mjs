#!/usr/bin/env node
// One walk over a scaffolded application, executed as a program rather than as
// a conversation of browser calls.
//
// Two axes shape the walk, each declared by the caller and neither assumed
// here. The checkpoint axis names the points the walk visits and how each one
// is reached: a destination it is loaded at, a control it is clicked to, or
// both. The variant axis names one UI dimension the whole coverage is repeated
// across: a set of values, a control that opens them, an option handle per
// value, and the label the walk confirms each one from. What either axis stands
// for is the caller's business and never this driver's - addressable pages,
// tabs, steps of a wizard, a display mode, a density, a locale, a layout - and
// nothing below is written in terms of any one of them. An application that
// declares neither axis is walked once, at whatever --host opens, and the
// coverage says exactly that rather than reporting a dimension the application
// does not have.
//
// The skill document beside this file states these same rules as prose. This
// program is the executable copy of them. Prose did not survive a change of
// agent host: three separate hosts driven from identical sources each broke the
// discipline in a different place, and each of them independently wrote a
// browser driver of its own on the way. So the driver ships, and the guards
// below are code rather than paragraphs a run may read late, read partly, or
// read and not apply.
//
// Zero dependencies beyond the node standard library. The browser is reached by
// shelling out to a browser CLI, `npx --yes agent-browser` unless --browser-cmd
// names another.
//
// The driver never retries a failure of its own accord. A failed step is
// recorded in the JSON result and the process exits non-zero, so a retry is a
// decision the run makes, in the open, and discloses. Every failure path in here
// ends in that record: an invocation this driver cannot perform, a file it cannot
// read and a child that never returns all leave a JSON result behind rather than
// a stack trace.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const HELP = `verify-walk - drive one walk over a scaffolded application

Usage:
  node verify-walk.mjs --host <url> --capdir <path> [options]

Required:
  --host <url>              origin of the running dev server, e.g. http://localhost:3000
  --capdir <path>           capture directory for this run; created when absent and
                            refused when it already holds files

Checkpoint axis - the points the walk visits, declared whole or not at all.
Declaring --checkpoint-selector requires --checkpoints; declaring neither of them
walks whatever --host opens, once, and says so in the coverage:
  --checkpoints <list>      comma list of name[:destination[:ready-testid[:handle]]]
                            entries, e.g.
                            orders:/orders:list-orders,stock:/stock:list-stock
                            destination is a path appended to --host and reached by
                            a full load; ready-testid is the handle the walk waits
                            for before capturing; handle is what {handle} takes in
                            --checkpoint-selector
  --checkpoint-selector <pattern>
                            data-testid of the control clicked to reach a
                            checkpoint, with {checkpoint} or {handle} in it.
                            Declared, the walk clicks its way between checkpoints;
                            left out, each checkpoint is loaded at its destination.
                            {checkpoint} takes the short name from --checkpoints.
                            {handle} takes that checkpoint's fourth --checkpoints
                            field, or, when none is declared, the id read off the
                            page carrying the checkpoint's name as a whole segment

Variant axis - one UI dimension the coverage is repeated across, declared whole
or not at all. Declaring any flag in this group requires --variants,
--variant-switcher and --variant-option together; declaring none walks the
checkpoints once and says so in the coverage:
  --variants <list|registry>  comma list of the values to walk, or the word
                            "registry" with --variant-registry naming the file
                            the set was read into
  --variant-switcher <testid>
                            data-testid of the control clicked to open the values
  --variant-option <pattern>
                            data-testid of one value's option, with {variant} in it
  --variant-registry <path> file the value set was read from; recorded as the
                            set's provenance
  --variant-labels <map>    variant=label pairs, comma separated, for a switcher
                            label that does not carry the value's own name as
                            whole words, and where two declared values cannot be
                            told apart from one label (the run is refused until
                            each carries a label of its own)

Optional:
  --overlay-open <testid>   data-testid of the control that opens an overlay the
                            walk has to operate through - a value switcher drawn
                            inside host chrome, say. Clicked at the start of every
                            pass when declared
  --overlay-close <testid>  data-testid of the control that closes that overlay
                            again. Captures are taken with it closed, and the
                            close is confirmed by --overlay-open being back on
                            the page
  --states <path>           JSON file of declared per-checkpoint interactions (see below)
  --cdp-port <n>            debugging port probed before any browser is launched (default: 9222)
  --ready-timeout <ms>      budget for a checkpoint readiness poll (default: 15000)
  --browser-cmd <cmd>       command line the browser CLI is driven through
                            (default: npx --yes agent-browser); a caller pins a
                            version or names an installed binary here. Quote a
                            path that carries spaces, single or double quotes
                            alike: '"/path/with a space/browser-cli" --headless'
  --command-timeout <ms>    budget for one browser command; past it the child is
                            killed and the run records a timeout (default: 60000)
  --json-out <path>         machine-readable result (default: <capdir>/verify-walk.json)
  --coverage <path>         coverage markdown the walk's rows are appended to
                            (default: <capdir>/verification-coverage.md)
  --help                    print this text and exit 0

--states file shape:
  { "<checkpoint name>": [ { "state": "submitted",
                             "actions": [ { "kind": "fill", "testid": "email", "value": "a@b.c" },
                                          { "kind": "click", "testid": "submit" },
                                          { "kind": "read", "testid": "status" } ] } ] }

Exit code is 0 only when every declared checkpoint was reached, every declared
variant became active, every read-back agreed, and every declared capture
landed. Any failure exits non-zero with the reason in the JSON.
`;

// ---------------------------------------------------------------------------
// Argument surface

const FLAGS_WITH_VALUE = new Set([
  '--host', '--variants', '--variant-registry', '--variant-labels', '--capdir',
  '--variant-switcher', '--variant-option', '--checkpoints', '--checkpoint-selector',
  '--overlay-open', '--overlay-close',
  '--states', '--cdp-port', '--ready-timeout', '--browser-cmd', '--command-timeout',
  '--json-out', '--coverage',
]);

// Substituted into the patterns their flags carry. Declared here rather than
// beside the code that substitutes them because the argument validation below
// runs first and reads them.
const CHECKPOINT_TOKEN = '{checkpoint}';
const CHECKPOINT_HANDLE = '{handle}';
const VARIANT_TOKEN = '{variant}';

const ACTION_KINDS = new Set(['fill', 'click', 'read']);
const MAX_TCP_PORT = 65535;
const DEFAULT_BROWSER_COMMAND = 'npx --yes agent-browser';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') return { help: true };
    if (!FLAGS_WITH_VALUE.has(token)) throw new Error(`unknown argument "${token}"`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${token} needs a value`);
    opts[token.slice(2)] = value;
    i += 1;
  }
  return opts;
}

// `Number('nope')` is NaN, and a NaN deadline is never reached: the readiness
// poll below then asks every 400ms forever, printing nothing and ending never.
// So every numeric flag is a finite positive integer or the invocation is
// refused, and the refusal happens before a directory is made or a browser is
// reached.
function positiveInt(flag, raw, fallback, max) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^[0-9]+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${flag} "${raw}" is not a positive whole number`);
  }
  if (max !== undefined && value > max) throw new Error(`${flag} "${raw}" is above the highest valid value ${max}`);
  return value;
}

// --browser-cmd carries a command line, and an installed binary's path carries
// spaces: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` is one
// argument a whitespace split cuts into four that name nothing, after which the
// run reads as a browser that could not be spawned. Quoted runs stay whole,
// single and double quotes alike, and the quotes themselves come off. An
// unbalanced quote is refused rather than closed by guesswork: both guesses -
// dropping the quote, or ending the token where it opened - spawn a command line
// the caller did not write.
function tokenizeCommand(flag, raw) {
  const tokens = [];
  let token = null;
  let quote = null;
  for (const char of raw) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else token += char;
      continue;
    }
    if (char === '"' || char === "'") {
      token ??= '';
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (token !== null) tokens.push(token);
      token = null;
      continue;
    }
    token = (token ?? '') + char;
  }
  if (quote !== null) {
    throw new Error(`${flag} "${raw}" carries an unbalanced ${quote === '"' ? 'double' : 'single'} quote`);
  }
  if (token !== null) tokens.push(token);
  // A command line that names nothing is refused here, with every other reading
  // of this flag, because the alternative is not a failed browser call: an empty
  // command file reaches `spawnSync` as `ERR_INVALID_ARG_VALUE`, thrown out of
  // the first browser interaction, past the validation that turns a refusal into
  // the result record - a stack trace where the run's own account belongs.
  // Whitespace alone tokenizes to no tokens; a quoted empty command - `'""'` -
  // to one token that is the empty string, which a token count cannot see.
  if (tokens.length === 0 || tokens[0] === '') {
    throw new Error(`${flag} "${raw}" names no command to run`);
  }
  return tokens;
}

// Every part of a capture's file name is caller data - a variant name out of a
// registry, a checkpoint name off the command line, a state name out of the
// states file - and a part carrying a path separator leaves the run's own capture
// directory: `../escape` resolves a level above it, and the file lands where
// nothing in this run is entitled to write. Each part is therefore reduced to the
// file-name alphabet, so no separator, no `..` segment and nothing a shell reads
// specially survives into a path. A part that reduces to nothing at all still has
// to name a file, hence the fallback.
const CAPTURE_FALLBACK_SLUG = 'unnamed';

const slug = (text) => String(text ?? '').toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '') || CAPTURE_FALLBACK_SLUG;

// An axis this run did not declare has no part to name its captures by, and the
// null is dropped rather than slugged: the fallback slug would spell a value the
// invocation never declared, and a real value named "unnamed" would then share
// the file name with it.
const captureName = (variant, checkpoint, state) => `${[variant, checkpoint, state]
  .filter((part) => part !== null).map(slug).join('-')}.png`;

// The state every checkpoint is captured at before anything is driven on it,
// named here because the collision check below enumerates it alongside the
// declared states and the walk takes its capture under the same name.
const FRESH_STATE = 'fresh';

// A checkpoint is name[:destination[:ready-testid[:handle]]]. Only the name is
// required: what a checkpoint is reached by is the caller's declaration, and a
// run whose one checkpoint is whatever --host opens declares no destination at
// all. The ready testid is what the driver waits for before capturing; a
// checkpoint declared without one is captured after a bare settle and marked
// readyConfirmed:false, so the weakness is disclosed in the result rather than
// hidden behind a screenshot that looks fine. The handle is the resolver's
// certain path for a host that keys its controls by an identifier the short name
// cannot spell; a colon separates the fields because such identifiers are built
// from `.` and `~` and carry none.
function parseCheckpoints(spec) {
  const parsed = spec.split(',').filter(Boolean).map((entry) => {
    const [name, destination, ready, handle] = entry.split(':');
    if (!name) throw new Error(`--checkpoints entry "${entry}" is not name[:destination[:ready-testid[:handle]]]`);
    return {
      name,
      destination: destination || null,
      readyTestid: ready || null,
      handle: handle || null,
    };
  });
  if (parsed.length === 0) throw new Error('--checkpoints names no checkpoint to walk');
  return parsed;
}

function parseLabelMap(spec) {
  const map = {};
  for (const pair of (spec ?? '').split(',').filter(Boolean)) {
    const [variant, label] = pair.split('=');
    if (!variant || !label) throw new Error(`--variant-labels entry "${pair}" is not variant=label`);
    map[variant] = label;
  }
  return map;
}

// A label cut into its alphanumeric words. Case and punctuation come off, so
// "Mode: High Contrast" and "mode_high-contrast" both read as the same three
// words, and the words stay separate rather than being run together.
const segments = (text) => (text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Whether a switcher label NAMES a variant, which is not the same claim as
// carrying its name somewhere inside. The name has to occupy a whole
// uninterrupted run of the label's words: a set holding `dense` and `denser`
// used to confirm `dense` off a label reading "Denser", and every capture taken
// in that block was then filed against a variant that never became active. A
// value `en` confirmed off a label reading "Length" is the same mistake one word
// along.
//
// A label that does not carry the value's name as words - "HighContrast" for
// `high-contrast` - reads as not-active rather than as active, which is the
// safe direction, and --variant-labels is where such a label is declared.
function namesVariant(labelText, wantedText) {
  const label = segments(labelText);
  const wanted = segments(wantedText);
  if (wanted.length === 0) return false;
  for (let start = 0; start + wanted.length <= label.length; start += 1) {
    if (wanted.every((word, offset) => label[start + offset] === word)) return true;
  }
  return false;
}

// A file read and a JSON parse at the top level used to throw straight out of
// the program: a missing registry, a truncated states file or a stray comma
// ended the run with a stack trace, no result record and no coverage row - the
// one shape a caller cannot act on, because it cannot tell a driver that refused
// from a driver that crashed. Both readers below raise instead, and the caller
// turns that into an `arguments` failure in the record.
function readJsonFile(flag, file) {
  const resolved = path.resolve(file);
  let raw;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new Error(`${flag} "${resolved}" could not be read: ${error.message}`, { cause: error });
  }
  try {
    return { resolved, parsed: JSON.parse(raw) };
  } catch (error) {
    throw new Error(`${flag} "${resolved}" is not JSON: ${error.message}`, { cause: error });
  }
}

// Accepts an array of names or `{ variants: [...] }`, and nothing else: a file
// holding `{ variants: null }` used to leave the variant set undefined and the walk
// iterating over nothing while the run still read as performed.
function readVariantRegistry(file) {
  const { resolved, parsed } = readJsonFile('--variant-registry', file);
  const variants = Array.isArray(parsed) ? parsed : parsed?.variants;
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error(`--variant-registry "${resolved}" holds neither a non-empty array of variant names nor { "variants": [...] }`);
  }
  for (const variant of variants) {
    if (typeof variant !== 'string' || variant.trim() === '') {
      throw new Error(`--variant-registry "${resolved}" lists ${JSON.stringify(variant)} where a variant name belongs`);
    }
  }
  return { variants, source: `registry:${resolved}` };
}

// Validated whole before the first browser call, because a malformed entry
// reached mid-walk costs the captures already taken: the throw came out of the
// state loop, past `finish()`, and the run lost the record of everything that had
// worked. Checkpoint names are checked against the walked set for the same reason
// a bad action kind is - a states file keyed by a checkpoint nobody walks drives
// nothing, reports nothing, and reads as a state that passed.
function readStates(file, checkpoints) {
  const { resolved, parsed } = readJsonFile('--states', file);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`--states "${resolved}" is not an object keyed by checkpoint name`);
  }
  // A run that declared no checkpoint axis has no name to key interactions by,
  // so the file cannot address anything this walk visits. Said outright rather
  // than through the per-key message below, which would read as a typo in a
  // --checkpoints list the invocation never carried.
  if (checkpoints.length === 0 && Object.keys(parsed).length > 0) {
    throw new Error(`--states "${resolved}" is keyed by checkpoint name, and this run declares no checkpoint axis to key against`);
  }
  const walked = new Set(checkpoints.map((checkpoint) => checkpoint.name));
  for (const [checkpoint, declared] of Object.entries(parsed)) {
    if (!walked.has(checkpoint)) throw new Error(`--states "${resolved}" declares checkpoint "${checkpoint}", which --checkpoints does not name`);
    if (!Array.isArray(declared)) throw new Error(`--states "${resolved}" holds ${JSON.stringify(declared)} under "${checkpoint}" where an array of states belongs`);
    for (const entry of declared) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`--states "${resolved}": every entry under "${checkpoint}" is an object with "state" and "actions"`);
      }
      if (typeof entry.state !== 'string' || entry.state.trim() === '') {
        throw new Error(`--states "${resolved}": an entry under "${checkpoint}" carries no non-empty "state"`);
      }
      if (!Array.isArray(entry.actions)) {
        throw new Error(`--states "${resolved}": "${checkpoint}"/"${entry.state}" carries no "actions" array`);
      }
      for (const action of entry.actions) {
        if (action === null || typeof action !== 'object' || Array.isArray(action)) {
          throw new Error(`--states "${resolved}": every action under "${checkpoint}"/"${entry.state}" is an object`);
        }
        if (!ACTION_KINDS.has(action.kind)) {
          throw new Error(`--states "${resolved}": action kind ${JSON.stringify(action.kind)} under "${checkpoint}"/"${entry.state}" is not one of fill, click, read`);
        }
        if (typeof action.testid !== 'string' || action.testid === '') {
          throw new Error(`--states "${resolved}": an action under "${checkpoint}"/"${entry.state}" carries no "testid"`);
        }
        if (action.kind === 'fill' && typeof action.value !== 'string') {
          throw new Error(`--states "${resolved}": the fill of "${action.testid}" under "${checkpoint}"/"${entry.state}" needs a string "value"`);
        }
        // A fill is confirmed by comparing the field's own value afterwards
        // against this string, and that reading comes back through `lastLine`:
        // the last non-empty line, trimmed, with surrounding quotes off. A value
        // that reading cannot return verbatim - one carrying a newline, leading
        // or trailing whitespace, or wrapping quotes - can never read back as
        // equal, so the run would exit non-zero over a value the field took.
        // Refused here rather than discovered against a browser.
        if (action.kind === 'fill' && typeof action.value === 'string' && lastLine(action.value) !== action.value) {
          throw new Error(`--states "${resolved}": the fill of "${action.testid}" under "${checkpoint}"/"${entry.state}" declares a value the read-back cannot confirm, because the field's value is read back as the last non-empty line with surrounding whitespace and quotes removed: ${JSON.stringify(action.value)}`);
        }
        if (action.kind === 'read' && action.contains !== undefined && typeof action.contains !== 'string') {
          throw new Error(`--states "${resolved}": the read of "${action.testid}" under "${checkpoint}"/"${entry.state}" declares a non-string "contains"`);
        }
      }
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Process plumbing

// Assigned from --command-timeout before the first child is spawned. Read at
// call time rather than captured, so the bound is the one the invocation asked
// for and not the default it was declared with.
let commandTimeoutMs = 60000;

// NODE_NO_WARNINGS on every invocation, and stdout captured on its own pipe.
// Both guard the same failure from two sides: a deprecation warning printed by
// the runner's own toolchain lands in the output a run parses, and a value read
// off a polluted stream is a reading of the warning. Separate pipes make the
// pollution structurally impossible; the flag keeps the noise out of the log a
// human reads afterwards.
//
// `timeout` is what keeps the walk finite. Every browser interaction is a child
// process, and an unbounded one blocks the driver forever on a browser that
// stopped answering - the failure mode this file's own fetch probes are already
// bounded against, and the one AGENTS.md requires bounding with the issuing
// tool's own timeout parameter rather than a shell wrapper. SIGKILL because a
// runner that ignored the budget is exactly the runner that ignores SIGTERM.
function run(command, args, input) {
  return spawnSync(command, args, {
    input,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: commandTimeoutMs,
    killSignal: 'SIGKILL',
  });
}

// Assigned during argument validation; `browser` reads it at call time.
let browserCommand = tokenizeCommand('--browser-cmd', DEFAULT_BROWSER_COMMAND);

const browser = (args, input) => run(browserCommand[0], [...browserCommand.slice(1), ...args], input);

// The runner prints human-facing lines before the value on some commands, so
// the value is the last non-empty line of stdout and nothing else. Surrounding
// quotes come off: a string result is printed quoted and a comparison against
// the quoted form silently never matches.
function lastLine(stdout) {
  const lines = (stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const value = lines.length > 0 ? lines[lines.length - 1] : '';
  return value.replace(/^["']|["']$/g, '');
}

// ---------------------------------------------------------------------------
// Page access, shadow-piercing throughout

// Content renders inside shadow roots and an outside selector does not see in:
// a plain CSS fill matches nothing, types into whatever held focus, and still
// reports success. Every read and every drive in this driver descends through
// shadowRoot instead.
//
// What every page-side helper answers in place of an element the page does not
// carry. Spelled once, and both sides derive from this one name: the prelude
// installs it into the page and the read check compares against it. Written out
// twice, a change to the prelude's copy left the check comparing against a
// string the page never returns, and an absent control then read as a `read`
// action that passed.
const MISSING = '__verify_walk_missing__';

// Every name here is installed on globalThis rather than declared. The runner
// evaluates each script in the page's one persistent global scope, so a
// top-level `const __find` from the first eval is still bound when the second
// arrives and the runtime refuses it with "Identifier '__find' has already been
// declared" - a page-side throw that reads, through the callers, as an element
// holding an empty string. `??=` installs the helper once per page lifetime and
// a reload reinstalls it, so no eval after the first has anything to redeclare.
const PRELUDE = `
globalThis.__find ??= (id) => {
  const sel = '[data-testid="' + id + '"]';
  const walk = (root) => {
    const hit = root.querySelector(sel);
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) { const deep = walk(el.shadowRoot); if (deep) return deep; }
    }
    return null;
  };
  return walk(document);
};
globalThis.__MISSING ??= ${JSON.stringify(MISSING)};
globalThis.__testids ??= () => {
  const seen = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('[data-testid]')) seen.push(el.getAttribute('data-testid'));
    for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) walk(el.shadowRoot); }
  };
  walk(document);
  return JSON.stringify(seen);
};
`;

// Returned in place of a value the eval never produced. Distinct from
// __MISSING on purpose: "the page holds no such element" and "the script never
// ran" call for different repairs, and collapsing both into an empty string is
// what sent a run hunting a rendering race that did not exist.
const EVAL_ERROR = '__verify_walk_eval_error__';

// A runner invocation fails either as a non-zero exit or as a line on stderr,
// depending on the runner build, and in both cases stdout is empty -
// indistinguishable from a command that legitimately printed nothing. Both
// shapes are read here, at the one place that can still see the status; a
// caller reading only stdout has already lost the difference. The launcher's
// own `npm warn exec` chatter does not carry an Error name.
const ERROR_SHAPED = /\b\w*Error\b/;

// A child that never returned carries its reason on `proc.error` and leaves
// `status` null with empty pipes, which reads through every stdout-only path as
// a command that printed nothing. A child that ran, rejected the script it was
// handed on its stdin, and exited also carries `proc.error` - EPIPE from the
// write that broke - and the two are told apart by the error code, never by
// whether `status` arrived. Reaping and pipe-teardown order are not specified
// relative to each other, so the same EPIPE has been seen with `status` set and
// with it left null; only an eval command passes input on stdin, so EPIPE is
// structurally that command's failure and is read off the error code alone,
// ahead of the status-less spawn/timeout check below. Collapsing it into "could
// not be run" buries the reason the child printed under a stage naming the one
// repair - install the runner - that the run did not need.
function invocationOutcome(proc) {
  const stderr = (proc.stderr ?? '').trim();
  if (proc.error && proc.error.code === 'EPIPE') {
    return {
      failed: true,
      stage: null,
      detail: `${proc.status === null ? 'exited' : `exited ${proc.status}`} while the script was still being`
        + ` written to it (EPIPE): ${stderr || '(nothing on stderr)'}`,
    };
  }
  // Neither hang nor missing runner ever carries EPIPE, so both remain keyed on
  // `proc.error` alone here - status is never consulted for this branch, since a
  // status that arrives late or not at all is exactly the ambiguity EPIPE above
  // exists to settle before this check is reached.
  if (proc.error) {
    const timedOut = proc.error.code === 'ETIMEDOUT';
    return {
      failed: true,
      stage: timedOut ? 'timeout' : 'spawn',
      detail: timedOut
        ? `was killed after ${commandTimeoutMs}ms without returning`
        : `could not be run: ${proc.error.message}`,
    };
  }
  if (proc.status !== 0 || ERROR_SHAPED.test(stderr)) {
    return { failed: true, stage: null, detail: `exited ${proc.status}: ${stderr || '(nothing on stderr)'}` };
  }
  return { failed: false, stage: null, detail: '' };
}

function evaluate(script) {
  const proc = browser(['eval', '--stdin'], `${PRELUDE}\n${script}`);
  const outcome = invocationOutcome(proc);
  if (outcome.failed) {
    fail(outcome.stage ?? 'eval-error', `browser eval ${outcome.detail}`, { script });
    return EVAL_ERROR;
  }
  return lastLine(proc.stdout);
}

// 'yes' | 'no' | EVAL_ERROR. The tri-state exists for waitFor: a poll that
// cannot tell a refused eval from an absent element keeps asking until the
// timeout and files the same failure on every turn.
const probeExists = (testid) => evaluate(`(() => (__find(${JSON.stringify(testid)}) ? 'yes' : 'no'))()`);

// true | false | null, where null is "the page was never asked". Collapsing a
// refused eval into "absent" is exactly the misdiagnosis EVAL_ERROR exists to
// prevent, and a caller that treats it as absence reports a missing control
// where the eval is what failed.
const confirmExists = (testid) => {
  const probe = probeExists(testid);
  return probe === EVAL_ERROR ? null : probe === 'yes';
};

const readText = (testid) =>
  evaluate(`(() => { const el = __find(${JSON.stringify(testid)}); return el ? (el.textContent || '').trim() : __MISSING; })()`);

// Every data-testid the page carries, shadow roots included. Read as JSON
// rather than as a delimited line because the ids this exists to find are
// built from exactly the punctuation any delimiter would have to avoid. Null
// means the list could not be read at all, which is a different answer from a
// page carrying none.
function readTestids() {
  const raw = evaluate('__testids()');
  if (raw === EVAL_ERROR) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // falls through to the one failure below, so both shapes of unreadable
    // answer are reported the same way
  }
  fail('handle-resolve', `the page's data-testid list did not read back as JSON: "${raw}"`);
  return null;
}

// Why a driven step did not take. A missing control and a refused eval are
// different repairs, and one shared "not found" message is what made a broken
// eval look like a surface that had not rendered yet.
const outcomeReason = (outcome) =>
  (outcome === EVAL_ERROR ? 'the eval did not run' : 'no control carries that data-testid');

// A synthetic .click() carries none of the pointer sequence around it, so a
// control listening for pointerdown sees nothing and the page stays as it was.
// Every click here is the full native sequence.
const click = (testid) => evaluate(`(() => {
  const el = __find(${JSON.stringify(testid)});
  if (!el) return __MISSING;
  const box = el.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true,
    clientX: box.left + box.width / 2, clientY: box.top + box.height / 2,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
  const up = { ...init, buttons: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', init));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  el.dispatchEvent(new PointerEvent('pointerup', up));
  el.dispatchEvent(new MouseEvent('mouseup', up));
  el.dispatchEvent(new MouseEvent('click', up));
  return 'dispatched';
})()`);

// The fill returns the field's own value afterwards, so the caller reads back
// what landed instead of believing an exit report. The native value setter is
// used because a controlled field ignores a direct assignment.
const fill = (testid, value) => evaluate(`(() => {
  const el = __find(${JSON.stringify(testid)});
  if (!el) return __MISSING;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  return el.value;
})()`);

// Synchronous by design: the whole driver is a straight line of blocking calls,
// and a timer would need the loop to be free, which it is not between polls.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The poll lives here rather than inside the page: an async helper handed to the
// runner can come back as the promise instead of its value, and a run that reads
// that as a result waits on nothing. A driver-side loop of synchronous existence
// checks cannot land in that state.
function waitFor(testid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const probe = probeExists(testid);
    if (probe === 'yes') return true;
    // A refused eval refuses again on the next turn, so polling on would spend
    // the whole budget filing the same failure over and over. The first one is
    // already recorded and carries the reason.
    if (probe === EVAL_ERROR) return false;
    if (Date.now() >= deadline) return false;
    sleep(400);
  }
}

// ---------------------------------------------------------------------------
// Result record

const result = {
  driver: 'verify-walk',
  resultVersion: 1,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  ok: false,
  host: null,
  capdir: null,
  browser: { probe: null, mode: null, cdpPort: null, command: null },
  // `declared: false` on either axis is the run's own statement that no such
  // axis was asked of it, which is not the same claim as an axis that was asked
  // for and came back empty - the second is refused before the walk starts. A
  // reader of this record can tell an unexercised dimension from a failed one.
  variantAxis: { declared: false, source: null, variants: [] },
  checkpointAxis: { declared: false, reach: null, checkpoints: [] },
  checkpointResolution: [],
  variants: [],
  failures: [],
  coverageFile: null,
};

function fail(stage, detail, extra = {}) {
  result.failures.push({ stage, detail, at: new Date().toISOString(), ...extra });
}

// fs.writeSync to fd 1 rather than process.stdout.write: the stream queues on a
// pipe and process.exit() does not drain the queue, so the JSON a caller parses
// arrives truncated exactly when it is being piped into something. A pipe also
// accepts partial writes, hence the loop, and a closed reader is not this
// program's failure to report - the record has already been written to disk.
//
// A non-blocking pipe with a slow reader answers EAGAIN rather than accepting
// the write, and a retry that comes straight back pins a core for as long as the
// reader takes to drain. The wait between turns is what keeps this loop off the
// CPU while it waits for room.
const STDOUT_RETRY_MS = 10;

function writeStdout(payload) {
  const bytes = Buffer.from(payload, 'utf8');
  let written = 0;
  while (written < bytes.length) {
    try {
      written += fs.writeSync(1, bytes, written, bytes.length - written);
    } catch (error) {
      if (error.code === 'EAGAIN') {
        sleep(STDOUT_RETRY_MS);
        continue;
      }
      return;
    }
  }
}

function finish(options) {
  result.finishedAt = new Date().toISOString();
  result.ok = result.failures.length === 0;
  if (options?.jsonOut) {
    try {
      fs.mkdirSync(path.dirname(options.jsonOut), { recursive: true });
      fs.writeFileSync(options.jsonOut, `${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      // The run's own account of itself could not be filed where it was asked
      // for. It still has to reach the caller, so the write failure joins the
      // record and stdout carries the whole thing: a result that went nowhere is
      // indistinguishable from a run that never happened.
      fail('output', `the result could not be written to "${options.jsonOut}": ${error.message}`);
      result.ok = false;
    }
  }
  writeStdout(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Coverage rows

// A `|` in a page reading or in a control's name closes the cell it is written
// into and shifts every column after it, so a table filled from what the page
// said is a table the page can corrupt. Newlines fold for the same reason.
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// What a row says about an axis the invocation never declared. Not "absent" and
// not "none": the axis was not exercised by this run, which is a statement about
// the run and not a claim about the application. A row reading "no" would let a
// report conclude the application has no such dimension, which no part of this
// walk established.
const VARIANT_AXIS_NOT_DECLARED = 'no variant axis was declared for this run';
const CHECKPOINT_AXIS_NOT_DECLARED = 'no checkpoint axis was declared for this run';

// One row per cell of the walk's own grid - every pass of the variant axis
// against every point of the checkpoint axis - rather than one column per point.
// A column per point could only be written once the points were known and fixed,
// which is exactly the assumption this driver does not make: an axis that was
// never declared contributes its single null coordinate and the row says so in
// its own cell, so the table has the same shape whether one axis was declared,
// both were, or neither.
function appendCoverage(coveragePath, checkpoints) {
  const header = '| Variant | Active | Checkpoint | States captured | Visually distinct from previous |\n'
    + `|${'---|'.repeat(5)}\n`;
  const firstActive = result.variants.findIndex((pass) => pass.labelConfirmed === true);
  const rows = result.variants.flatMap((pass, passIndex) => {
    let active;
    if (pass.variant === null) {
      active = `not-exercised (${VARIANT_AXIS_NOT_DECLARED})`;
    } else if (pass.labelConfirmed) {
      active = 'verified';
    } else if (pass.controlFailure !== null) {
      active = `not-active (${cell(pass.controlFailure)})`;
    } else {
      active = `not-active (label read "${cell(pass.labelRead)}")`;
    }
    const variantName = pass.variant === null ? '(none declared)' : cell(pass.variant);

    return checkpoints.map((checkpoint) => {
      const name = checkpoint === null ? null : checkpoint.name;
      const captured = pass.captures.filter((capture) => capture.checkpoint === name);
      const driven = pass.drivenOnly.filter((capture) => capture.checkpoint === name);
      // readyConfirmed rides into the cell because a report filled from this
      // file has no other way to tell a capture taken after its checkpoint's
      // ready handle appeared from one taken after a bare settle.
      const parts = captured.map((capture) => `${cell(capture.state)} (${cell(path.basename(capture.file))}, ready ${capture.readyConfirmed ? 'confirmed' : 'unconfirmed'})`)
        .concat(driven.map((capture) => `${cell(capture.state)} driven, not captured`));
      const states = parts.length > 0 ? parts.join(', ') : 'none';

      const comparisons = pass.comparisons.filter((comparison) => comparison.checkpoint === name);
      let distinct;
      if (comparisons.length > 0) {
        distinct = comparisons.map((comparison) => `${cell(comparison.state)}: ${comparison.verdict} (cmp exit ${comparison.exit})`).join('; ');
      } else if (pass.variant === null) {
        distinct = `not-compared (${VARIANT_AXIS_NOT_DECLARED})`;
      } else if (!pass.labelConfirmed) {
        distinct = 'not-compared (the variant did not become active)';
      } else if (passIndex === firstActive) {
        distinct = 'first variant';
      } else {
        distinct = 'not-compared (no capture pair)';
      }

      const checkpointCell = name === null
        ? `not-exercised (${CHECKPOINT_AXIS_NOT_DECLARED})`
        : cell(name);
      return `| ${variantName} | ${active} | ${checkpointCell} | ${states} | ${distinct} |\n`;
    });
  }).join('');

  // The coverage file is this step's stated deliverable, so a filesystem refusal
  // is a failure of the run rather than an exception out of its last line: the
  // JSON result still lands and names the path that could not be written.
  try {
    fs.mkdirSync(path.dirname(coveragePath), { recursive: true });
    const fresh = !fs.existsSync(coveragePath) || fs.readFileSync(coveragePath, 'utf8').trim() === '';
    fs.appendFileSync(coveragePath, (fresh ? header : '') + rows);
    result.coverageFile = coveragePath;
  } catch (error) {
    fail('coverage', `the coverage rows could not be written to "${coveragePath}": ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Walk

// A malformed argument list and a missing required flag used to end in help text
// on stderr, an exit of 2 and an empty stdout, which is the one shape a caller
// cannot act on: it reads the same as a driver that died before it could say
// anything. Both are refusals like every other, so both leave a result record
// behind. It goes to stdout even here, where --json-out has not been read yet and
// there is no file to write it to - stdout is the one channel every invocation
// has, the same reason an unwritable --json-out still prints. The help text stays
// on stderr, where it is this refusal's repair and cannot corrupt the record.
function refuseArguments(detail) {
  process.stderr.write(`${detail}\n\n${HELP}`);
  fail('arguments', detail);
  finish({ jsonOut: null });
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (error) {
  refuseArguments(error.message);
}
if (opts.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

for (const required of ['host', 'capdir']) {
  if (!opts[required]) refuseArguments(`missing required argument --${required}`);
}

// The flag a checkpoint axis cannot be walked without: the points themselves.
const CHECKPOINT_AXIS_REQUIRED = ['checkpoints'];

// Declared alongside them, and meaningless without them: a pattern with nothing
// to substitute into it names one control the walk would click for every point
// it does not have.
const CHECKPOINT_AXIS_OPTIONAL = ['checkpoint-selector'];

// The three flags a variant axis cannot be walked without: the values, the
// control that opens them, and the handle that picks one.
const VARIANT_AXIS_REQUIRED = ['variants', 'variant-switcher', 'variant-option'];

// Declared alongside them, and meaningless without them. They join the group so
// that a caller who pins a registry or a label map and forgets the rest is told
// so, rather than having the axis silently drop out of the walk.
const VARIANT_AXIS_OPTIONAL = ['variant-registry', 'variant-labels'];

// Each axis is declared as a whole or not at all. A partial declaration is the
// one shape that cannot be answered honestly: dropping the axis would discard a
// dimension the caller asked for, and walking it would need handles the
// invocation never named. Refused here, before a directory is made or a browser
// is reached, for the same reason every other invalid invocation is.
function declaredAxis(axis, required, optional) {
  const declaredFlags = [...required, ...optional].filter((flag) => opts[flag]);
  if (declaredFlags.length === 0) return false;
  const missing = required.filter((flag) => !opts[flag]);
  if (missing.length > 0) {
    refuseArguments(`--${declaredFlags[0]} declares a ${axis} axis, which also needs `
      + `${missing.map((flag) => `--${flag}`).join(' and ')}; declare the whole axis or none of it`);
  }
  return true;
}

const checkpointAxisDeclared = declaredAxis('checkpoint', CHECKPOINT_AXIS_REQUIRED, CHECKPOINT_AXIS_OPTIONAL);
const variantAxisDeclared = declaredAxis('variant', VARIANT_AXIS_REQUIRED, VARIANT_AXIS_OPTIONAL);
result.checkpointAxis.declared = checkpointAxisDeclared;
result.variantAxis.declared = variantAxisDeclared;

// How the walk moves from one checkpoint to the next, derived from what the
// caller declared rather than picked out of a closed set of names. A selector
// pattern means the walk clicks its way between the points; its absence means
// each one is loaded at its own destination. There is no third reading and no
// default, so no invocation asserts that the application carries a particular
// kind of chrome.
const reach = opts['checkpoint-selector'] ? 'selector' : 'destination';

// Everything the invocation itself has to get right is settled here, in one
// place, before a directory is created or a browser is reached: an invocation
// this driver cannot perform costs nothing on disk and says why in its own
// result record rather than in a stack trace.
//
// capdir is resolved before anything reads it, and every capture path is built
// from it, because the runner takes a relative screenshot path as relative to
// its own temporary working directory and reports the write as a success. The
// files land somewhere the byte-compare and the coverage cells never look, and
// the run reads as a walk that captured nothing it can point at.
let capdir;
let jsonOut;
let coveragePath;
let readyTimeout;
let cdpPort;
let labels;
let checkpoints;
let states;
let walkedVariants;
let walkedCheckpoints;
try {
  capdir = path.resolve(opts.capdir);
  jsonOut = path.resolve(opts['json-out'] ?? path.join(capdir, 'verify-walk.json'));
  coveragePath = path.resolve(opts.coverage ?? path.join(capdir, 'verification-coverage.md'));

  readyTimeout = positiveInt('--ready-timeout', opts['ready-timeout'], 15000);
  cdpPort = positiveInt('--cdp-port', opts['cdp-port'], 9222, MAX_TCP_PORT);
  commandTimeoutMs = positiveInt('--command-timeout', opts['command-timeout'], 60000);

  browserCommand = tokenizeCommand('--browser-cmd', opts['browser-cmd'] ?? DEFAULT_BROWSER_COMMAND);

  labels = parseLabelMap(opts['variant-labels']);
  checkpoints = checkpointAxisDeclared ? parseCheckpoints(opts.checkpoints) : [];

  if (checkpointAxisDeclared) {
    result.checkpointAxis = { declared: true, reach, checkpoints };

    if (checkpoints.length > 1 && reach === 'selector'
      && !opts['checkpoint-selector'].includes(CHECKPOINT_TOKEN)
      && !opts['checkpoint-selector'].includes(CHECKPOINT_HANDLE)) {
      throw new Error(`--checkpoint-selector "${opts['checkpoint-selector']}" carries neither ${CHECKPOINT_TOKEN} nor ${CHECKPOINT_HANDLE}, so every checkpoint would be reached by clicking one same control`);
    }

    // A point with no destination is reached by clicking, and the first point of
    // a pass is additionally reached by the pass-boundary load of --host itself.
    // A later point with neither is a point this walk has no way to arrive at,
    // and walking on would capture whatever the previous point left on the page
    // under this one's name.
    for (const [index, checkpoint] of checkpoints.entries()) {
      if (index > 0 && checkpoint.destination === null && reach !== 'selector') {
        throw new Error(`checkpoint "${checkpoint.name}" declares no destination and this run declares no --checkpoint-selector, so nothing in it can reach that checkpoint`);
      }
    }
  }

  if (variantAxisDeclared) {
    // The value set is recorded with its provenance, so a report cannot claim it
    // came from the host's own registration of that dimension when it was typed
    // in by hand.
    if (opts.variants === 'registry') {
      if (!opts['variant-registry']) throw new Error('--variants registry needs --variant-registry <file the set was read into>');
      result.variantAxis = { declared: true, ...readVariantRegistry(opts['variant-registry']) };
    } else {
      result.variantAxis = { declared: true, source: 'literal', variants: opts.variants.split(',').filter(Boolean) };
    }
    if (result.variantAxis.variants.length === 0) throw new Error('the variant set is empty');
    if (result.variantAxis.variants.length > 1 && !opts['variant-option'].includes(VARIANT_TOKEN)) {
      throw new Error(`--variant-option "${opts['variant-option']}" carries no ${VARIANT_TOKEN}, so every variant would click one same option`);
    }

    // Two values one switcher label can name at once are refused rather than
    // guessed at: where one value's words are a whole run of another's, every
    // label naming the longer names the shorter too, and the confirmation cannot
    // say which one actually became active. Declaring a label per value with
    // --variant-labels is how such a pair is separated, so the check reads the
    // labels rather than the bare names.
    const wantedNames = result.variantAxis.variants.map((variant) => ({ variant, wanted: labels[variant] ?? variant }));
    for (const shorter of wantedNames) {
      for (const longer of wantedNames) {
        if (shorter === longer || !namesVariant(longer.wanted, shorter.wanted)) continue;
        throw new Error(`variants "${shorter.variant}" and "${longer.variant}" cannot be told apart from a switcher label: a label reading "${longer.wanted}" names "${shorter.wanted}" as well, so give each one a label of its own with --variant-labels`);
      }
    }
  }

  // What the walk iterates over, one list per axis. An axis nobody declared
  // contributes a single null coordinate, and that null is what every downstream
  // branch reads as "this run declared no such dimension" - a value chosen
  // because no declared value can equal it, so a pass over a real value can never
  // be mistaken for the axis-less one.
  walkedVariants = variantAxisDeclared ? result.variantAxis.variants : [null];
  walkedCheckpoints = checkpointAxisDeclared ? checkpoints : [null];

  states = opts.states ? readStates(opts.states, checkpoints) : {};

  // Reducing a name to the file-name alphabet can map two names the invocation
  // tells apart onto one file, and the second capture would then overwrite the
  // first while both coverage cells claim a capture of their own. Enumerated over
  // the walk's whole capture set rather than checked per name, because the
  // collision can also come from where the boundaries between the parts fall:
  // variant "a-b" checkpoint "c" and variant "a" checkpoint "b-c" name one same
  // file.
  const declaredAs = (variant, checkpoint, state) => [
    variant === null ? null : `variant "${variant}"`,
    checkpoint === null ? null : `checkpoint "${checkpoint}"`,
    `state "${state}"`,
  ].filter((part) => part !== null).join(' / ');
  const captureNames = new Map();
  for (const variant of walkedVariants) {
    for (const checkpoint of walkedCheckpoints) {
      const name = checkpoint === null ? null : checkpoint.name;
      const declaredStates = (name === null ? [] : states[name] ?? []).map((declared) => declared.state);
      for (const state of [FRESH_STATE, ...declaredStates]) {
        const file = captureName(variant, name, state);
        const claim = declaredAs(variant, name, state);
        const taken = captureNames.get(file);
        if (taken !== undefined) {
          throw new Error(taken === claim
            ? `${claim} is declared twice, and both captures would be written to "${file}"`
            : `${taken} and ${claim} both name the capture file "${file}", because a capture name is reduced to lowercase letters, digits and hyphens; give one of them a name that stays distinct after that reduction`);
        }
        captureNames.set(file, claim);
      }
    }
  }
} catch (error) {
  fail('arguments', error.message);
  finish({ jsonOut: null });
}

result.host = opts.host;
result.capdir = capdir;
result.browser.cdpPort = cdpPort;
result.browser.command = browserCommand.join(' ');

// A capture directory shared with an earlier run leaves that run's files exactly
// where this one goes looking, and neither the byte-compare nor the coverage
// cells can tell which run wrote a file they address by name.
try {
  if (fs.existsSync(capdir)) {
    if (fs.readdirSync(capdir).length > 0) {
      fail('capdir', `capture directory "${capdir}" already holds files; give this run a directory of its own`);
      finish({ jsonOut: null });
    }
  } else {
    fs.mkdirSync(capdir, { recursive: true });
  }
} catch (error) {
  fail('capdir', `capture directory "${capdir}" could not be prepared: ${error.message}`);
  finish({ jsonOut: null });
}

// Fail fast on a dead application before a browser is involved: a runner error
// against an origin nothing serves reads as a browser problem and sends the run
// looking in the wrong place.
try {
  await fetch(opts.host, { signal: AbortSignal.timeout(5000) });
} catch (error) {
  fail('host-probe', `nothing answered at ${opts.host}: ${error.message}`);
  finish({ jsonOut });
}

// Probe before launching. A self-launched browser has hung mid-run where an
// attached one returned every capture asked of it, and the probe is one request.
try {
  const probe = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(2000) });
  result.browser.probe = probe.ok ? 'answered' : `status ${probe.status}`;
} catch {
  result.browser.probe = 'refused';
}
if (result.browser.probe === 'answered') {
  const connected = browser(['connect', String(cdpPort)]);
  const outcome = invocationOutcome(connected);
  result.browser.mode = outcome.failed ? 'connect-failed' : 'connected';
  if (outcome.failed) fail(outcome.stage ?? 'browser', `connect ${cdpPort} ${outcome.detail}`);
} else {
  result.browser.mode = 'launched';
}
if (result.failures.length > 0) finish({ jsonOut });

// The capture directory with a separator on the end, so a sibling whose name
// merely starts with it - "<capdir>-old" beside "<capdir>" - is not read as a
// path inside it.
const CAPDIR_PREFIX = capdir.endsWith(path.sep) ? capdir : `${capdir}${path.sep}`;

function capture(variant, checkpoint, state) {
  const file = path.resolve(capdir, captureName(variant, checkpoint, state));
  // What a capture failure calls the capture it was taking, in the same shape as
  // the file name: an axis this run did not declare has no value to name it by,
  // and a literal `null` in the message names nothing the invocation declared.
  const of = [variant, checkpoint, state].filter((part) => part !== null).join('/');
  // The second lock on the escape the slug already closes: whatever the names
  // reduce to, the path handed to the browser has to resolve inside this run's
  // own capture directory. Unreachable while the slug holds, and kept because a
  // file written outside it is not a failure this run can take back.
  if (!file.startsWith(CAPDIR_PREFIX)) {
    fail('capture', `the capture path for ${of} resolved to "${file}", which is outside this run's capture directory "${capdir}"`, { file });
    return null;
  }
  const shot = browser(['screenshot', file]);
  const outcome = invocationOutcome(shot);
  if (outcome.failed || !fs.existsSync(file)) {
    fail(outcome.stage ?? 'capture', `screenshot for ${of} did not land: ${outcome.detail || 'the runner reported success and wrote no file'}`, { file, exit: shot.status });
    return null;
  }
  return file;
}

// ---------------------------------------------------------------------------
// Checkpoint handle resolution

// A host may key its controls by an identifier the short name cannot spell - a
// whole composed identity rather than a label - and such identifiers are
// alphanumeric segments joined by punctuation. The checkpoint is named by one of
// those segments. Matching on a bare substring would let a checkpoint called
// "task" claim "tasks", so the name has to stand as a whole segment or not at
// all.
const idSegments = (id) => id.split(/[^A-Za-z0-9]+/).filter(Boolean);

const resolvedSelectors = new Map();

// Reading the ids back off the page is what one run had to do by hand: the
// pattern was inexpressible, the run fell back to loading each destination, and
// the clicks it still owed were driven one at a time outside the driver. One
// candidate is the answer; anything else is a refusal, never a pick, because a
// wrong control moves the page somewhere real and every reading after it is a
// reading of the wrong place.
function discoverHandle(pattern, checkpoint) {
  const [prefix, suffix] = pattern.split(CHECKPOINT_HANDLE);
  const onPage = readTestids();
  if (onPage === null) return null;

  const candidates = [...new Set(onPage
    .filter((id) => id.length > prefix.length + suffix.length && id.startsWith(prefix) && id.endsWith(suffix))
    .map((id) => id.slice(prefix.length, id.length - suffix.length))
    .filter((id) => idSegments(id).includes(checkpoint.name)))];

  if (candidates.length === 1) return candidates[0];
  fail('handle-resolve', candidates.length === 0
    ? `no data-testid on the page matches "${pattern}" with "${checkpoint.name}" as a segment of its id; the page carries ${JSON.stringify(onPage)}`
    : `${JSON.stringify(candidates)} all carry "${checkpoint.name}" as a segment; declare the checkpoint's handle as the fourth field of its --checkpoints entry`);
  return null;
}

// Resolved once per checkpoint and remembered: the controls are re-rendered at
// every variant boundary but their ids are not re-issued, so a second discovery
// would spend an eval to learn what the first one already knows.
function checkpointSelector(checkpoint) {
  if (resolvedSelectors.has(checkpoint.name)) return resolvedSelectors.get(checkpoint.name);

  // {checkpoint} is substituted first and unconditionally, so a host whose
  // controls are keyed by the short name resolves exactly as it always did - and
  // without an eval, since a pattern that spells the whole id needs nothing read
  // off the page.
  const pattern = opts['checkpoint-selector'].split(CHECKPOINT_TOKEN).join(checkpoint.name);
  let testid = pattern;
  let handle = null;
  let source = 'pattern';

  if (pattern.includes(CHECKPOINT_HANDLE)) {
    handle = checkpoint.handle ?? discoverHandle(pattern, checkpoint);
    source = handle === null ? 'unresolved' : checkpoint.handle === null ? 'discovered' : 'declared';
    testid = handle === null ? null : pattern.split(CHECKPOINT_HANDLE).join(handle);
  }

  // Recorded for every checkpoint, resolved or not: which handle the walk
  // clicked is part of what the run has to be able to show, and "the pattern as
  // given" is an answer a report may need as much as a discovered id.
  result.checkpointResolution.push({ checkpoint: checkpoint.name, testid, handle, source });
  resolvedSelectors.set(checkpoint.name, testid);
  return testid;
}

// ---------------------------------------------------------------------------
// Reaching a checkpoint

// What reaching a checkpoint established, which is not the same question as
// whether a command succeeded: a point may be arrived at and still carry no
// handle to confirm the arrival with.
const REACH_FAILED = 'failed';
const REACH_UNCONFIRMED = 'unconfirmed';
const REACH_READY = 'ready';

// open and reload used to be fired and forgotten. A load that never happened
// then surfaced only as a readiness timeout a full budget later, and on a
// checkpoint declared without a ready testid it never surfaced at all - the walk
// carried on capturing the previous point under this one's name. Same class as
// the discarded eval status: the runner said so, and nobody read it.
function load(args, checkpoint) {
  const proc = browser(args);
  const outcome = invocationOutcome(proc);
  if (!outcome.failed) return true;
  const of = checkpoint === null ? 'the host' : `checkpoint "${checkpoint.name}"`;
  fail(outcome.stage ?? 'reach-error', `"${args.join(' ')}" for ${of} ${outcome.detail}`);
  return false;
}

function clickTo(checkpoint) {
  const testid = checkpointSelector(checkpoint);
  if (testid === null) return false;
  const outcome = click(testid);
  if (outcome === 'dispatched') return true;
  fail('reach-error', `the control "${testid}" for checkpoint "${checkpoint.name}" was not clicked: ${outcomeReason(outcome)}`);
  return false;
}

// `passBoundary` is the first checkpoint of a pass, and it is always reached by
// a load: the reload discards every field filled and dialog opened under the
// previous pass, so a capture named fresh is fresh. A point with no destination
// of its own is not reached by that load - --host opens wherever the application
// opens - so the declared selector is clicked after it.
function reachCheckpoint(checkpoint, passBoundary) {
  const destination = checkpoint?.destination ?? null;
  if (passBoundary) {
    if (!load(['open', `${opts.host}${destination ?? ''}`], checkpoint)) return REACH_FAILED;
    if (!load(['reload'], checkpoint)) return REACH_FAILED;
    if (checkpoint !== null && destination === null && reach === 'selector' && !clickTo(checkpoint)) return REACH_FAILED;
  } else if (reach === 'selector') {
    if (!clickTo(checkpoint)) return REACH_FAILED;
  } else {
    if (!load(['open', `${opts.host}${destination}`], checkpoint)) return REACH_FAILED;
    if (!load(['reload'], checkpoint)) return REACH_FAILED;
  }
  if (checkpoint === null || !checkpoint.readyTestid) return REACH_UNCONFIRMED;
  if (waitFor(checkpoint.readyTestid, readyTimeout)) return REACH_READY;
  fail('ready', `checkpoint "${checkpoint.name}" never showed ${checkpoint.readyTestid} within ${readyTimeout}ms`);
  return REACH_UNCONFIRMED;
}

// Every declared control operation has to report as dispatched. Discarded, the
// outcome let a run pass with no switcher on the page at all: a single-value run
// already showing the requested value reads a label that matches, so the label
// check agrees and the walk captures a state nothing switched into. The failure
// names the test id that was not found, because the symptom the run saw otherwise
// - a switcher label reading back the missing-element sentinel - reads as a value
// that never became active rather than as a handle that does not exist.
function operate(record, testid, what) {
  const outcome = click(testid);
  if (outcome === 'dispatched') return true;
  record.controlFailure = `${what} "${testid}" was not clicked: ${outcomeReason(outcome)}`;
  fail('control', `${what} "${testid}" was not clicked${underVariant(record.variant)}: ${outcomeReason(outcome)}`);
  return false;
}

// How a failure names the pass it happened in. A run with no variant axis has one
// pass and nothing to qualify it by, so the qualifier disappears rather than
// being filled with a placeholder value the invocation never declared.
const underVariant = (variant) => (variant === null ? '' : ` under variant "${variant}"`);

// The states declared for a point, and none at all for the null coordinate an
// undeclared axis contributes: there is no name for such a file to be keyed by,
// which the states reader already refused the whole file over.
const statesFor = (checkpoint) => (checkpoint === null ? [] : states[checkpoint.name] ?? []);

for (const variant of walkedVariants) {
  const record = {
    // null on both counts where no axis was declared: there is no value this pass
    // walked, and no switcher label to have confirmed one from. `false` would
    // read as a confirmation that was attempted and failed.
    variant,
    labelConfirmed: variant === null ? null : false,
    labelRead: null,
    labelReadBack: null,
    controlFailure: null,
    overlayClosed: null, captures: [], drivenOnly: [], readBacks: [], comparisons: [],
  };
  result.variants.push(record);

  const first = walkedCheckpoints[0];
  const firstReach = reachCheckpoint(first, true);

  // A control operation that did not dispatch stops this pass where it stands:
  // captures taken past a missing switcher belong to whatever the page was
  // already showing, and the label check cannot tell the difference.
  if (opts['overlay-open'] && !operate(record, opts['overlay-open'], 'overlay open control')) continue;

  // The whole switch-and-confirm sub-step belongs to the variant axis, so a run
  // that declared none never operates a control it was not given a handle for
  // and never reads a label back. What it does instead is exactly the rest of
  // this loop body, once.
  if (variant !== null) {
    if (!operate(record, opts['variant-switcher'], 'variant switcher')) continue;
    if (!operate(record, opts['variant-option'].split(VARIANT_TOKEN).join(variant), `variant option for "${variant}"`)) continue;

    // The switcher's own label is the only source of truth for which value is
    // active. It is read twice: the second reading is a confirmation, not a
    // retry, and both readings are recorded so a disagreement is visible. Both
    // readings have to name this value, in the whole-word sense above; the value
    // set was refused before the walk if two of its names cannot be told apart
    // that way.
    const wanted = labels[variant] ?? variant;
    record.labelRead = readText(opts['variant-switcher']);
    record.labelReadBack = readText(opts['variant-switcher']);
    record.labelConfirmed = namesVariant(record.labelRead, wanted)
      && namesVariant(record.labelReadBack, wanted);

    if (!record.labelConfirmed) {
      // Not active: capture nothing under it rather than file this value's row
      // from a page still showing the previous one. The walk carries on so every
      // declared value gets a row, and the run still exits non-zero.
      fail('variant-switch', `variant "${variant}" did not become active; switcher label read "${record.labelRead}" then "${record.labelReadBack}"`);
      continue;
    }
  }

  // An open overlay is host chrome drawn over the surface under verification.
  // Closing it is confirmed by the open control being present afterwards, which
  // it is only while the overlay is closed.
  if (opts['overlay-close']) {
    if (!operate(record, opts['overlay-close'], 'overlay close control')) continue;
    record.overlayClosed = opts['overlay-open'] ? confirmExists(opts['overlay-open']) : null;
    if (opts['overlay-open'] && record.overlayClosed !== true) {
      fail('overlay', record.overlayClosed === null
        ? `the overlay's close${underVariant(variant)} could not be confirmed: the eval did not run`
        : `the overlay did not close${underVariant(variant)}; captures would carry host chrome`);
      continue;
    }
  }

  for (const [index, checkpoint] of walkedCheckpoints.entries()) {
    const reached = index === 0 ? firstReach : reachCheckpoint(checkpoint, false);
    // A checkpoint the page never reached files nothing under its name. A capture
    // taken here would show whichever place the failed reach left on the page, and
    // its coverage cell would claim a state no run ever saw.
    if (reached === REACH_FAILED) continue;

    const name = checkpoint === null ? null : checkpoint.name;
    const ready = reached === REACH_READY;
    const freshFile = capture(variant, name, FRESH_STATE);
    if (freshFile) record.captures.push({ checkpoint: name, state: FRESH_STATE, file: freshFile, readyConfirmed: ready });

    for (const declared of statesFor(checkpoint)) {
      for (const action of declared.actions ?? []) {
        if (action.kind === 'fill') {
          const readBack = fill(action.testid, action.value);
          const ok = readBack === action.value;
          record.readBacks.push({ checkpoint: name, state: declared.state, action: 'fill', testid: action.testid, expected: action.value, actual: readBack, ok });
          if (!ok) fail('read-back', `fill of "${action.testid}"${underVariant(variant)} read back "${readBack}"`);
        } else if (action.kind === 'click') {
          const outcome = click(action.testid);
          const ok = outcome === 'dispatched';
          record.readBacks.push({ checkpoint: name, state: declared.state, action: 'click', testid: action.testid, actual: outcome, ok });
          if (!ok) fail('click', `control "${action.testid}" was not clicked${underVariant(variant)}: ${outcomeReason(outcome)}`);
        } else if (action.kind === 'read') {
          const text = readText(action.testid);
          // The sentinel is ruled out before `contains` is consulted rather than
          // as its fallback: MISSING comes back as text, and a declared substring
          // the sentinel itself carries - "missing" is one - confirmed a control
          // the page never held, filing the state as read back.
          const ok = text !== EVAL_ERROR && text !== MISSING
            && (action.contains === undefined || text.includes(action.contains));
          record.readBacks.push({ checkpoint: name, state: declared.state, action: 'read', testid: action.testid, expected: action.contains ?? null, actual: text, ok });
          if (!ok) fail('read', `reading "${action.testid}"${underVariant(variant)} gave "${text}"`);
        } else {
          // Unreachable while the parse-time states validation holds. Kept so
          // that loosening the validator cannot turn an unknown kind into a
          // silent no-op the coverage table then reports as a captured state.
          fail('states', `action kind "${action.kind}" is not one of fill, click, read`);
        }
      }
      const stateFile = capture(variant, name, declared.state);
      if (stateFile) record.captures.push({ checkpoint: name, state: declared.state, file: stateFile, readyConfirmed: ready });
      else record.drivenOnly.push({ checkpoint: name, state: declared.state });
    }
  }

  // Byte-compare against the previous pass whose value actually became active.
  // The verdict is the command's own exit code and nothing else: identical files
  // are a recorded fact, not a failure, and a pair no command ran over gets no
  // verdict at all. A run with no variant axis has one pass and therefore no pair
  // to compare, which `labelConfirmed === null` on that single record already says.
  const previous = [...result.variants].reverse().find((other) => other.variant !== variant && other.labelConfirmed === true);
  if (previous) {
    for (const shot of record.captures) {
      const before = previous.captures.find((c) => c.checkpoint === shot.checkpoint && c.state === shot.state);
      if (!before) continue;
      const cmp = spawnSync('cmp', ['-s', before.file, shot.file], {
        encoding: 'utf8',
        timeout: commandTimeoutMs,
        killSignal: 'SIGKILL',
      });
      record.comparisons.push({
        against: previous.variant, checkpoint: shot.checkpoint, state: shot.state,
        command: `cmp -s ${path.basename(before.file)} ${path.basename(shot.file)}`,
        exit: cmp.status, verdict: cmp.status === 0 ? 'identical' : cmp.status === 1 ? 'differs' : 'not-compared',
      });
      if (cmp.status !== 0 && cmp.status !== 1) fail('compare', `cmp over ${shot.file} exited ${cmp.status}`);
    }
  }
}

appendCoverage(coveragePath, walkedCheckpoints);
finish({ jsonOut });
