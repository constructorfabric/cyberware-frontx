// End-to-end coverage for the git-shaped half of the harness: `runCompat`
// and `runGuard` themselves, driven against a purpose-built fixture
// repository rather than against this package.
//
// check-lib.test.ts proves the decision rules over in-memory JSON and
// check-lib.compat-e2e.test.ts proves them against a real GTS store, but
// neither ever reaches `checkCompatForUnit` or `runCompat` - so every rule
// that is ABOUT the repository (which contracts existed at the base ref,
// which of them nothing compares itself against any more, whether the base
// ref resolves at all, what puts a component in the guard's scope) was
// asserted by nothing. Each case below is one such rule, and each of them
// printed PASS before the change this suite arrived with.
//
// What is real here: `git init`, real commits, the real change-set
// collection, the real rename detection, the real base-ref lookups, the real
// GTS store and the real decision rules. What is injected through
// CheckContext: the overlay listing, the export listing and the freshness
// comparison - all three resolve paths against compile.ts's own kit root, so
// bound to this package they can only answer questions about this package.
// The compile-and-diff path they stand in for is what button/accordion/
// data-table's own contract suites assert, for real, against real sources.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { OPEN_UNEVALUATED } from './compile';
import { runCompat, runCoverage, runGuard, type CheckContext } from './check';
import { BASE_TYPE_ID, passthroughTypeId, propsSchemaId } from './ids';
import { applyContractTestTimeout } from './testing';

// Each case builds a git repository and runs the real GTS store over it;
// that is real work, and it gets the same 120s margin as the rest of the
// contracts test surface. Must run before any describe()/it() in the file;
// see applyContractTestTimeout's own comment in testing.ts.
applyContractTestTimeout();

const createdRepos: string[] = [];

afterAll(() => {
  for (const repo of createdRepos) rmSync(repo, { recursive: true, force: true });
});

// A fixed identity and no global/system git config: the fixture's history
// must be identical on a developer's machine and on a runner, and a global
// `core.excludesFile` would otherwise decide which of the fixture's own files
// `git ls-files --others` reports as untracked.
function initRepo(root: string): void {
  const emptyExcludes = join(root, '.git-empty-excludes');
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  writeFileSync(emptyExcludes, '');
  for (const [key, value] of [
    ['user.name', 'Contract Fixture'],
    ['user.email', 'contract-fixture@example.invalid'],
    ['commit.gpgsign', 'false'],
    ['core.excludesFile', emptyExcludes],
  ]) {
    execFileSync('git', ['config', '--local', key, value], { cwd: root, stdio: 'ignore' });
  }
}

function pascalCase(stem: string): string {
  return stem
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

// A minimal but real compiled-shape props schema: the same $id grammar and
// base-derivation allOf compile.ts emits for every real component, plus the
// passthrough $ref that `compat` reads the host element off.
function contractJson(
  component: string,
  options: { major?: number; element?: string; properties?: Record<string, unknown>; required?: string[] } = {},
): Record<string, unknown> {
  const { major = 1, element, properties = {}, required = [] } = options;
  return {
    $id: propsSchemaId(component, major),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    allOf: [{ $ref: BASE_TYPE_ID }, ...(element === undefined ? [] : [{ $ref: passthroughTypeId(element) }])],
    properties,
    required,
    unevaluatedProperties: OPEN_UNEVALUATED,
  };
}

function passthroughJson(element: string, properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    $id: passthroughTypeId(element),
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `UiKit ${element} passthrough`,
    type: 'object',
    properties,
    required,
  };
}

interface Fixture {
  root: string;
  lines: string[];
  context: CheckContext;
  // Components whose committed artifacts the injected freshness comparison
  // reports as stale.
  stale: Set<string>;
  // Components the injected suite listing reports as shipping no
  // `*.contract.test.ts`.
  missingSuite: Set<string>;
  write: (relativePath: string, contents: unknown) => void;
  remove: (relativePath: string) => void;
  git: (...args: string[]) => void;
  output: () => string;
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'contracts-check-e2e-'));
  createdRepos.push(root);
  initRepo(root);

  const lines: string[] = [];
  const stale = new Set<string>();
  const missingSuite = new Set<string>();

  const overlayStems = (directory: string): string[] => {
    const dir = join(root, 'src', 'components', directory);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.contract.yaml'))
      .map((name) => name.slice(0, -'.contract.yaml'.length))
      .sort();
  };

  return {
    root,
    lines,
    stale,
    missingSuite,
    write(relativePath, contents) {
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`);
    },
    remove(relativePath) {
      rmSync(join(root, relativePath), { force: true });
    },
    git(...args) {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    },
    output: () => lines.join('\n'),
    context: {
      kitRoot: root,
      overlayStems,
      // A covered directory in these fixtures ships a conformance suite
      // unless a case says otherwise, so the shape every other case wants is
      // the ordinary one; `missingSuite` is how a case opts out.
      contractTestExists: (directory) => !missingSuite.has(directory),
      isComponentFresh: (directory) => !stale.has(directory),
      // One exported component per overlay, so a covered directory with all
      // its overlays present reads as complete - the shape every fixture here
      // wants unless it is testing the incomplete case.
      componentExportNames: (directory) => overlayStems(directory).map(pascalCase),
      exportedDeclarationNames: (directory) => overlayStems(directory).map(pascalCase),
      // No TypeScript source in a fixture repo, so nothing to build a program
      // over - the two export listings above answer from the overlays.
      prepareExtraction: () => {},
      log: (line) => lines.push(line),
    },
  };
}

// The ordinary starting point: one covered component with an overlay, a
// contract and the element surface it composes, all committed.
function committedButtonKit(fixture: Fixture, options: { properties?: Record<string, unknown> } = {}): void {
  fixture.write('scripts/contracts/covered.json', ['button']);
  fixture.write('scripts/contracts/passthrough/dom_button.json', passthroughJson('dom_button', {
    className: { type: 'string' },
    disabled: { type: 'boolean' },
  }));
  fixture.write('src/components/button/button.contract.yaml', 'component: button\n');
  fixture.write(
    'src/components/button/button.contract.json',
    contractJson('button', { element: 'dom_button', properties: options.properties ?? { variant: { type: 'string' } } }),
  );
  fixture.git('add', '-A');
  fixture.git('commit', '-m', 'base state');
}

describe('compat: a change that drops the forwarded surface', () => {
  it('refuses the contract instead of skipping the comparison it can no longer address', () => {
    // The contract stops composing the passthrough type altogether. Reading
    // the element off the NEW contract alone left nothing to look up, so the
    // whole forwarded-surface block was skipped and every forwarded prop
    // vanished under a PASS. Still the case the removal path has to catch
    // now that the surfaces are hand-written: a contract can stop composing
    // one without any file changing.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.write('src/components/button/button.contract.json', contractJson('button', { properties: { variant: { type: 'string' } } }));

    expect(runCompat('HEAD', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('passthrough: prop "className" removed');
    expect(fixture.output()).toContain('passthrough: prop "disabled" removed');
    expect(fixture.output()).toContain('no longer composes the forwarded surface');
  });
});

describe('compat: a contract present at the base reference and gone now', () => {
  it('refuses a removal the coverage allowlist still promises', () => {
    // No unit on disk visits this contract, so before the base-ref sweep the
    // deletion was not passed so much as never looked at.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.remove('src/components/button/button.contract.json');
    fixture.remove('src/components/button/button.contract.yaml');

    expect(runCompat('HEAD', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('button: contract removed');
    expect(fixture.output()).toContain('still listed in covered.json');
  });

  it('accepts the same removal once covered.json no longer names the component', () => {
    // The one acknowledgement the harness records, and the same one the
    // guard demands of a removed directory.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.remove('src/components/button/button.contract.json');
    fixture.remove('src/components/button/button.contract.yaml');
    fixture.write('scripts/contracts/covered.json', []);

    expect(runCompat('HEAD', { json: false }, fixture.context)).toBe(0);
    expect(fixture.output()).toContain('[REMOVED]');
    expect(fixture.output()).toContain('the removal is acknowledged');
  });

  it('reports a renamed contract as renamed, not as a removal plus a new contract', () => {
    // resolveRenameSource pairs the two halves by $id, so the base-ref path
    // is claimed and never reaches the removal sweep.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.remove('src/components/button/button.contract.json');
    fixture.remove('src/components/button/button.contract.yaml');
    fixture.write('src/components/action-button/action-button.contract.yaml', 'component: action-button\n');
    fixture.write(
      'src/components/action-button/action-button.contract.json',
      contractJson('button', { element: 'dom_button', properties: { variant: { type: 'string' } } }),
    );
    fixture.write('scripts/contracts/covered.json', ['action-button']);

    expect(runCompat('HEAD', { json: false }, fixture.context)).toBe(0);
    expect(fixture.output()).toContain('renamed from src/components/button/button.contract.json');
    expect(fixture.output()).not.toContain('contract removed');
  });
});

describe('compat: a change of host element', () => {
  it('refuses a forwarded prop that disappears across the move', () => {
    // A component re-rendered over a different element - a <button> wrapper
    // that becomes a <div> - forwards a different set of React attributes,
    // and `disabled` is one a <div> does not take. Both surfaces are
    // committed, so this is comparable and is compared.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.write('scripts/contracts/passthrough/dom_div.json', passthroughJson('dom_div', {
      className: { type: 'string' },
    }));
    fixture.write(
      'src/components/button/button.contract.json',
      contractJson('button', { element: 'dom_div', properties: { variant: { type: 'string' } } }),
    );

    expect(runCompat('HEAD', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('passthrough: prop "disabled" removed');
    expect(fixture.output()).toContain('host element moved "dom_button" -> "dom_div"');
  });

  it('accepts the same move when every forwarded prop survives it', () => {
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.write('scripts/contracts/passthrough/dom_div.json', passthroughJson('dom_div', {
      className: { type: 'string' },
      disabled: { type: 'boolean' },
      role: { type: 'string' },
    }));
    fixture.write(
      'src/components/button/button.contract.json',
      contractJson('button', { element: 'dom_div', properties: { variant: { type: 'string' } } }),
    );

    expect(runCompat('HEAD', { json: false }, fixture.context)).toBe(0);
    expect(fixture.output()).toContain('host element moved "dom_button" -> "dom_div"');
  });

  it('refuses a narrowing of the shared surface itself, for every component that composes it', () => {
    // The surfaces are hand-written and shared, so editing one is not a
    // per-component change: dropping `disabled` from the <button> surface
    // narrows what every component rendering a button accepts, and the
    // element does not have to move for that to be a break.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.write('scripts/contracts/passthrough/dom_button.json', passthroughJson('dom_button', {
      className: { type: 'string' },
    }));

    expect(runCompat('HEAD', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('passthrough: prop "disabled" removed');
  });
});

describe('a base reference that does not resolve', () => {
  it('refuses both subcommands by name instead of reporting a green kit against nothing', () => {
    const fixture = createFixture();
    committedButtonKit(fixture);

    expect(runCompat('never-fetched-branch', { json: false }, fixture.context)).toBe(1);
    expect(runGuard('never-fetched-branch', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('does not resolve to a commit in this repository');
    // Nothing was compared or reported: the run stopped at the ref.
    expect(fixture.output()).not.toContain('new contract');
  });
});

describe('guard: the coverage allowlist itself', () => {
  it('re-checks every entry when covered.json changes, and fails one that names no directory', () => {
    // Editing the file that grants coverage used to widen nothing, so an
    // entry could be added for a directory that does not exist and be
    // checked by nothing until some unrelated change touched it.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.write('scripts/contracts/covered.json', ['button', 'ghost']);

    expect(runGuard('HEAD', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('guard: covered.json changed');
    expect(fixture.output()).toContain('ghost: directory removed but still listed in covered.json');
    // The widening reaches every entry, not only the offending one.
    expect(fixture.output()).toContain('button: covered and fresh');
  });

  it('fails an entry whose directory exists but carries no overlay', () => {
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.write('src/components/spinner/spinner.module.css', '.root {}\n');
    fixture.write('scripts/contracts/covered.json', ['button', 'spinner']);

    expect(runGuard('HEAD', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('spinner: covered by covered.json but has no spinner.contract.yaml overlay');
  });

  it('reports an allowlist entry that grants coverage over nothing, without counting it as coverage', () => {
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.write('scripts/contracts/covered.json', ['button', 'ghost']);

    expect(runCoverage({ json: false }, fixture.context)).toBe(0);
    expect(fixture.output()).toContain('1 of 1 components covered by contracts.');
    expect(fixture.output()).toContain('ghost: named in covered.json but no such component directory');
  });
});

describe('the happy path', () => {
  it('passes compat and the guard when a covered component is edited and recompiled', () => {
    const fixture = createFixture();
    committedButtonKit(fixture);
    // A widening change: one more optional own prop, nothing removed.
    fixture.write(
      'src/components/button/button.contract.json',
      contractJson('button', {
        element: 'dom_button',
        properties: { variant: { type: 'string' }, size: { type: 'string' } },
      }),
    );

    expect(runCompat('HEAD', { json: false }, fixture.context)).toBe(0);
    expect(runGuard('HEAD', { json: false }, fixture.context)).toBe(0);
    expect(fixture.output()).toContain('button: backward compatible');
    expect(fixture.output()).toContain('button: covered and fresh');
  });

  it('still fails the guard when a covered component is edited without recompiling', () => {
    // The rule the guard exists for, asserted through the same entry point
    // as everything above rather than through evaluateGuard alone.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.stale.add('button');
    fixture.write('src/components/button/button.contract.yaml', 'component: button\nsummary: edited\n');

    expect(runGuard('HEAD', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('committed contract artifacts are stale');
  });
});

describe('guard: an overlay elsewhere in the kit', () => {
  it("re-checks every covered component when any overlay changes, because a children list decides another component's parent", () => {
    // The widening the derived `parent` made necessary. Editing the accordion
    // overlay changes what AccordionItem's compiled contract says about where
    // it may be mounted - a contract in the same directory here, and in a
    // different one as soon as one component's children name another's. A
    // change-set mapping alone would put only the edited directory in scope.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.stale.add('button');
    fixture.write('src/components/accordion/accordion.contract.yaml', 'component: accordion\n');

    expect(runGuard('HEAD', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('guard: an overlay changed');
    expect(fixture.output()).toContain('button: covered by covered.json but its committed contract artifacts are stale');
  });

  it('does not widen when only a compiled artifact changed', () => {
    // Downstream of an overlay, so it can make nothing else stale - the
    // guard's scope stays the directory the change actually touched.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.write('src/components/accordion/accordion.contract.json', contractJson('accordion'));

    expect(runGuard('HEAD', { json: false }, fixture.context)).toBe(0);
    expect(fixture.output()).not.toContain('guard: an overlay changed');
  });
});

describe('guard: a dependency bump', () => {
  it("re-checks every covered component when the package's own package.json changes", () => {
    // A committed contract carries the checker's printed type text for every
    // property the provider-safe subset cannot express, so a dependency bump
    // reshapes artifacts with no file under src/components or
    // scripts/contracts touched at all.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.stale.add('button');
    fixture.write('package.json', { name: 'fixture', dependencies: { '@base-ui/react': '^1.1.0' } });

    expect(runGuard('HEAD', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('guard: a dependency manifest changed');
    expect(fixture.output()).toContain('button: covered by covered.json but its committed contract artifacts are stale');
  });

  it('re-checks every covered component when the lockfile changes, which a package-relative diff cannot see', () => {
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.stale.add('button');
    fixture.write('package-lock.json', { lockfileVersion: 3 });
    fixture.git('add', '-A');
    fixture.git('commit', '-m', 'refresh the lockfile');

    expect(runGuard('HEAD~1', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('guard: a dependency manifest changed');
  });
});

describe('guard: a covered component with no conformance suite', () => {
  it('fails, because the freshness comparison would then only ever run in continuous integration', () => {
    // The comparison is asserted twice on purpose - here, and in the unit run
    // of whoever changed the component. A covered directory shipping no
    // suite silently halves that.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.missingSuite.add('button');
    // An edit inside the directory, so the component is in scope the
    // ordinary way rather than through one of the widening signals.
    fixture.write('src/components/button/button.module.css', '.root {}\n');

    expect(runGuard('HEAD', { json: false }, fixture.context)).toBe(1);
    expect(fixture.output()).toContain('ships no button.contract.test.ts');
  });
});

describe('guard: a component dropped from the coverage allowlist', () => {
  it('reports the de-listing instead of letting it leave scope in silence', () => {
    // The new list alone takes the component out of scope with no line in
    // any output, and the same edit is what the removal sweep accepts as an
    // acknowledgement - so the edit that drops coverage must not also be the
    // edit nothing looks at. Reported, not failed: de-listing is allowed.
    const fixture = createFixture();
    committedButtonKit(fixture);
    fixture.write('scripts/contracts/covered.json', []);

    expect(runGuard('HEAD', { json: false }, fixture.context)).toBe(0);
    expect(fixture.output()).toContain('button: dropped from covered.json by this change');
    expect(fixture.output()).toContain('no longer guarded');
  });
});
