/**
 * Pure reporting layer for the design-verify runner: aggregate per-state
 * sweep results into the findings.json shape and decide the exit code.
 *
 * Exit-code contract:
 *   0 - the matrix ran; findings (if any) are advisory
 *   1 - findings present AND --fail-on-findings was passed
 *   2 - environment failure: some state could not produce evidence (checker
 *       absent, page unreachable, sweep threw), or a screenshot the run was
 *       asked for (--screenshots) could not be captured or written. Never
 *       masked by 0/1 - an unverified state is not a pass, and the closing
 *       visual review the verify-interface skill requires cannot happen over
 *       a PNG that was never produced.
 */

/**
 * @typedef {{route: string, theme: string, width: number,
 *   findings?: Array<{id?: string, detail?: string, target?: string}>,
 *   environmentError?: string, screenshot?: string, screenshotError?: string,
 *   consoleLines?: string[]}} StateResult
 */

/**
 * @param {{baseUrl: string, themeKey: string}} meta
 * @param {StateResult[]} states
 */
export function buildReport(meta, states) {
  const byRule = {};
  let totalFindings = 0;
  let statesClean = 0;
  let environmentFailures = 0;
  let screenshotFailures = 0;
  for (const state of states) {
    if (state.environmentError) {
      environmentFailures += 1;
      continue;
    }
    // The sweep ran, so its findings count; but a state whose requested
    // screenshot is missing is not "clean" - part of its evidence is absent.
    const screenshotMissing = Boolean(state.screenshotError);
    if (screenshotMissing) screenshotFailures += 1;
    const findings = state.findings ?? [];
    totalFindings += findings.length;
    if (findings.length === 0 && !screenshotMissing) statesClean += 1;
    for (const finding of findings) {
      const rule = finding.id ?? 'unknown-rule';
      byRule[rule] = (byRule[rule] ?? 0) + 1;
    }
  }
  return {
    tool: 'design-verify runner',
    generatedAt: new Date().toISOString(),
    baseUrl: meta.baseUrl,
    themeKey: meta.themeKey,
    summary: {
      statesRun: states.length,
      statesClean,
      environmentFailures,
      screenshotFailures,
      totalFindings,
      byRule,
    },
    states,
  };
}

/**
 * Identity of a finding across runs: the render state plus rule id plus
 * target locator. The detail string is deliberately excluded - it carries
 * measured pixels that jitter between runs and would make every finding
 * look new.
 *
 * @param {StateResult} state
 * @param {{id?: string, target?: string}} finding
 */
function findingKey(state, finding) {
  return JSON.stringify([
    state.route,
    state.theme,
    state.width,
    finding.id ?? 'unknown-rule',
    finding.target ?? '',
  ]);
}

/** @param {{route: string, theme: string, width: number}} state */
function stateKey(state) {
  return JSON.stringify([state.route, state.theme, state.width]);
}

/**
 * Findings as a multiset: one entry per identity, carrying how many times it
 * occurred. Two instances of the same defect on the same generated target
 * (two identical cards, say) are two findings, and a diff that keyed a plain
 * Map would let the second one arrive unreported.
 *
 * @param {{states?: StateResult[]}} report
 * @returns {Map<string, {route: string, theme: string, width: number, id: string,
 *   target?: string, detail?: string, count: number}>}
 */
function collectFindings(report) {
  const map = new Map();
  for (const state of report.states ?? []) {
    for (const finding of state.findings ?? []) {
      const key = findingKey(state, finding);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      map.set(key, {
        route: state.route,
        theme: state.theme,
        width: state.width,
        id: finding.id ?? 'unknown-rule',
        target: finding.target,
        detail: finding.detail,
        count: 1,
      });
    }
  }
  return map;
}

/**
 * The states a report actually swept to completion. A state with an
 * environmentError produced no evidence, so nothing can be said about the
 * findings it would have had.
 *
 * @param {{states?: StateResult[]}} report
 */
function completedStates(report) {
  const keys = new Set();
  for (const state of report.states ?? []) {
    if (!state.environmentError) keys.add(stateKey(state));
  }
  return keys;
}

/**
 * Regression diff against a prior findings.json, as a multiset comparison:
 *
 *   new         - absent from the baseline, or present with a lower count
 *                 (the entry's `count` is the number of additional instances);
 *   resolved    - the baseline had it and the SAME state ran to completion
 *                 now and no longer shows it (or shows fewer);
 *   unverified  - the baseline had it but the current run has no completed
 *                 sweep of that state (environment error, or a narrower
 *                 matrix left it out), so its absence is not evidence;
 *   carriedOver - instances present in both.
 *
 * States the baseline never swept produce "new" findings - evidence the
 * baseline lacked is not a pass to inherit - and a state the current run did
 * not complete can resolve nothing: a finding is only gone once the state it
 * lived in was re-observed without it.
 *
 * @param {{states?: StateResult[]}} baseline a prior buildReport() result
 * @param {{states?: StateResult[]}} current
 */
export function diffReports(baseline, current) {
  const before = collectFindings(baseline);
  const after = collectFindings(current);
  const completed = completedStates(current);
  const added = [];
  const resolved = [];
  const unverified = [];
  let carriedOver = 0;
  for (const [key, entry] of after) {
    const previous = before.get(key)?.count ?? 0;
    carriedOver += Math.min(previous, entry.count);
    if (entry.count > previous) added.push({ ...entry, count: entry.count - previous });
  }
  for (const [key, entry] of before) {
    const now = after.get(key)?.count ?? 0;
    if (now >= entry.count) continue;
    const gone = { ...entry, count: entry.count - now };
    if (completed.has(stateKey(entry))) resolved.push(gone);
    else unverified.push(gone);
  }
  return { new: added, resolved, unverified, carriedOver };
}

/**
 * @param {ReturnType<typeof buildReport>} report
 * @param {{failOnFindings: boolean}} config
 * @param {ReturnType<typeof diffReports>} [diff] baseline comparison; when
 *   given, --fail-on-findings gates on new findings only. Unverified findings
 *   do not gate here: the environment-error case already exits 2 above, and a
 *   deliberately narrower matrix is the caller's choice - the summary names
 *   what it left unconfirmed.
 */
export function exitCode(report, config, diff) {
  if (report.summary.environmentFailures > 0) return 2;
  if (report.summary.screenshotFailures > 0) return 2;
  if (!config.failOnFindings) return 0;
  if (diff) return diff.new.length > 0 ? 1 : 0;
  return report.summary.totalFindings > 0 ? 1 : 0;
}

/**
 * One-paragraph terminal summary; the JSON is the full result.
 * @param {ReturnType<typeof buildReport>} report
 * @param {ReturnType<typeof diffReports>} [diff]
 */
export function summaryLines(report, diff) {
  const s = report.summary;
  const lines = [
    `design-verify: ${s.statesRun} state(s) swept - ${s.statesClean} clean, ` +
      `${s.totalFindings} finding(s), ${s.environmentFailures} environment failure(s), ` +
      `${s.screenshotFailures} screenshot failure(s)`,
  ];
  if (diff) {
    const total = (/** @type {Array<{count: number}>} */ entries) =>
      entries.reduce((sum, entry) => sum + entry.count, 0);
    lines.push(
      `  vs baseline: ${total(diff.new)} new, ${total(diff.resolved)} resolved, ` +
        `${total(diff.unverified)} unverified, ${diff.carriedOver} carried over`,
    );
    const describe = (/** @type {{route: string, theme: string, width: number, id: string, target?: string, count: number}} */ f) =>
      `${f.route} ${f.theme} ${f.width}px: ${f.id}${f.target ? ` @ ${f.target}` : ''}` +
      (f.count > 1 ? ` (x${f.count})` : '');
    for (const f of diff.new) lines.push(`  NEW ${describe(f)}`);
    for (const f of diff.resolved) lines.push(`  RESOLVED ${describe(f)}`);
    // Not a fix: the state this finding lived in was not re-observed.
    for (const f of diff.unverified) lines.push(`  UNVERIFIED ${describe(f)}`);
  }
  for (const [rule, count] of Object.entries(s.byRule)) {
    lines.push(`  ${rule}: ${count}`);
  }
  for (const state of report.states) {
    if (state.environmentError) {
      lines.push(
        `  ENVIRONMENT ${state.route} ${state.theme} ${state.width}px: ${state.environmentError}`,
      );
    } else if (state.screenshotError) {
      lines.push(
        `  SCREENSHOT ${state.route} ${state.theme} ${state.width}px: ${state.screenshotError}`,
      );
    }
  }
  return lines;
}
