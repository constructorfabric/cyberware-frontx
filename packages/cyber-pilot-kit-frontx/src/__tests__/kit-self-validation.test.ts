// @cpt-algo:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { FORBIDDEN_BODY_NAMES, findForbiddenSolutionName, validateKitManifest } from '../validate-manifest.js';
import { createFsResourceBodyReader } from '../resource-body-reader.js';
import type { KitManifest, KitResourceEntry, ResourceBodyReader } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Kit package root: src/__tests__/ -> src/ -> package root
const kitRoot = path.resolve(__dirname, '../..');
const manifestPath = path.join(kitRoot, '.cf-studio-kit.toml');

// Every spawnSync below drives the real driver, which drives a browser command
// of its own. Without a bound here, a driver that stops returning does not fail
// this suite - it holds CI open until the job is killed, and the suite reports
// nothing about why.
//
// Strictly above the driver's own default --command-timeout (60000ms), and
// deliberately not equal to it: at equal budgets a driver correctly killing a
// stuck child races the parent killing the driver, and the run that loses that
// race reports a hung driver where the driver was doing its job. A timeout at
// this level therefore means the driver itself hung rather than a child it was
// already bounding.
const DRIVER_TIMEOUT_MS = 120_000;

// Handed to every stub-driven run below, so no such run leans on the driver's
// 60000ms default and every one of them is bounded well inside the parent bound
// above. A test that needs the kill to happen sooner passes its own value after
// these, and the later flag is the one the driver reads.
const STUB_COMMAND_TIMEOUT_MS = '15000';

// The manifest under test is the REAL shipped file, parsed from disk — not a
// literal transcribed by hand. A hardcoded copy cannot detect the manifest
// drifting away from what this validator accepts, and previously did not:
// the file could be deleted outright with the whole suite still green.
//
// Loaded lazily inside each test rather than at module scope: an import-time
// read would abort collection of the whole file on a missing or malformed
// manifest, so the existence assertion below could never run and report it.
let cachedManifest: KitManifest | undefined;
function loadShippedManifest(): KitManifest {
  cachedManifest ??= parseToml(fs.readFileSync(manifestPath, 'utf8')) as unknown as KitManifest;
  return cachedManifest;
}

// cpt-frontx-adr-ai-tooling-framework-packaging mandates a check asserting that
// every resource identifier in the shipped manifest matches ^frontx_ (KIT-1).
// The ADR claimed this existed; it did not. These assertions are that check,
// and they read the real file rather than a transcription of it.
describe('shipped manifest on disk — canonical shape and KIT-1 prefix', () => {
  it('.cf-studio-kit.toml exists and parses as TOML', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const shippedManifest = loadShippedManifest();
    expect(shippedManifest.manifest_version).toBe('1.0');
    expect(Array.isArray(shippedManifest.kits)).toBe(true);
    expect(shippedManifest.kits.length).toBeGreaterThan(0);
  });

  it('legacy Cypilot manifest.toml is gone', () => {
    expect(fs.existsSync(path.join(kitRoot, 'manifest.toml'))).toBe(false);
  });

  it('every resource id in the shipped manifest matches ^frontx_ (KIT-1)', () => {
    const ids = loadShippedManifest().kits.flatMap((kit) => kit.resources.map((r) => r.id));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^frontx_/);
    }
  });

  it('manifest version matches package.json version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(kitRoot, 'package.json'), 'utf8')) as { version: string };
    expect(loadShippedManifest().kits[0].version).toBe(pkg.version);
  });

  it('core.toml registration version matches the shipped manifest', () => {
    const corePath = path.resolve(kitRoot, '../../.cf-studio/config/core.toml');
    const core = parseToml(fs.readFileSync(corePath, 'utf8')) as unknown as {
      kits: Record<string, { version: string }>;
    };
    const registration = core.kits['cyber-pilot-kit-frontx'];
    expect(registration).toBeDefined();
    expect(registration.version).toBe(loadShippedManifest().kits[0].version);
  });

  it('every declared resource source exists on disk', () => {
    for (const kit of loadShippedManifest().kits) {
      for (const resource of kit.resources) {
        expect(fs.existsSync(path.join(kitRoot, resource.source))).toBe(true);
      }
    }
  });

  // Existing on disk is not enough: npm publishes only what `files` covers, so
  // a source outside it leaves the resource declared, validated here, and
  // ABSENT from the published package - the manifest points at nothing on any
  // machine that installed the kit rather than checked out this repository
  // (cpt-frontx-dod-ai-project-scaffolding-declared-skill-surface, clause c).
  // Assumes `files` holds literal paths, which it does: a glob entry would need
  // matching rather than the prefix comparison below, and this kit declares none.
  it('every declared resource source is covered by the package published file set', () => {
    const published = (
      JSON.parse(fs.readFileSync(path.join(kitRoot, 'package.json'), 'utf8')) as { files: string[] }
    ).files.map((entry) => entry.replace(/\/+$/, ''));

    for (const kit of loadShippedManifest().kits) {
      for (const resource of kit.resources) {
        const source = resource.source.replace(/\/+$/, '');
        const covered = published.some((entry) => source === entry || source.startsWith(`${entry}/`));
        expect(covered, `${resource.id}: "${resource.source}" is not covered by package.json "files"`).toBe(true);
      }
    }
  });

  it('the real shipped manifest passes validateKitManifest', () => {
    const result = validateKitManifest(loadShippedManifest());
    expect(result.violations).toEqual([]);
    expect(result.status).toBe('PASS');
  });
});

describe('kit self-validation — shipped resource BODY scan (cpt-frontx-adr-solution-ai-content-placement)', () => {
  // inst-scan-solution-content — real on-disk shipped content, no bodyReader (baseline, id/description only)
  it('manifest id/description-only scan (no bodyReader) → PASS on shipped manifest', () => {
    const result = validateKitManifest(loadShippedManifest());
    expect(result.status).toBe('PASS');
  });

  // inst-scan-solution-content — proves the body scan reads real shipped files and finds no leak
  it('real shipped AGENTS.md / SKILL.md / guidelines/* bodies contain no specific template/solution name → PASS', () => {
    const reader = createFsResourceBodyReader(kitRoot);
    const result = validateKitManifest(loadShippedManifest(), reader);
    expect(result.status).toBe('PASS');
    expect(result.violations).toHaveLength(0);
  });

  // inst-scan-solution-content / inst-if-solution-content / inst-record-solution-violation —
  // regression test for the fixed ADR-0026 violation: AGENTS.md previously shipped with a body
  // naming `frontx-template-standard`; manifest id/description alone never caught this.
  it('AGENTS.md-body leak naming a specific template → FAIL SOLUTION_SPECIFIC_CONTENT (caught by body scan, not by id/description scan)', () => {
    const leakingReader: ResourceBodyReader = {
      read(entry: KitResourceEntry): string[] {
        if (entry.id === 'frontx_agents') {
          return [
            [
              '# FrontX AI Tooling Kit — Agent Navigation Rules',
              '',
              '## Package Boundaries (always enforce)',
              '',
              '- Template packages: `frontx-template-standard` and its sub-packages',
            ].join('\n'),
          ];
        }
        return [''];
      },
    };

    // Sanity: the manifest-metadata-only scan does NOT catch this leak (id/description are clean).
    const metadataOnly = validateKitManifest(loadShippedManifest());
    expect(metadataOnly.status).toBe('PASS');

    // The body scan MUST catch it.
    const result = validateKitManifest(loadShippedManifest(), leakingReader);
    expect(result.status).toBe('FAIL');
    expect(
      result.violations.some(
        (v) => v.code === 'SOLUTION_SPECIFIC_CONTENT' && v.message.includes('frontx-template-standard'),
      ),
    ).toBe(true);
  });

  // inst-scan-solution-content — the other explicitly-named leak case (bare "template-standard")
  it('resource body naming "template-standard" (without frontx- prefix) → FAIL SOLUTION_SPECIFIC_CONTENT', () => {
    const leakingReader: ResourceBodyReader = {
      read(entry: KitResourceEntry): string[] {
        if (entry.id === 'frontx_guidelines') {
          return ['## Template Territory\n\n`packages/template-standard/` is template territory.'];
        }
        return [''];
      },
    };
    const result = validateKitManifest(loadShippedManifest(), leakingReader);
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.code === 'SOLUTION_SPECIFIC_CONTENT')).toBe(true);
  });

  // inst-scan-solution-content — regression guard for the CURRENT identities after the
  // issue #470 shell/mfe split. SPECIFIC_TEMPLATE_NAMES keeps the historical
  // `frontx-template-standard`/`template-standard` entries (tested above) AND adds
  // `frontx-template-shell`/`template-shell`/`frontx-template-mfe`/`template-mfe` —
  // a leak naming either current product must be caught exactly like the legacy name.
  it('AGENTS.md-body leak naming the current shell package "frontx-template-shell" → FAIL SOLUTION_SPECIFIC_CONTENT', () => {
    const leakingReader: ResourceBodyReader = {
      read(entry: KitResourceEntry): string[] {
        if (entry.id === 'frontx_agents') {
          return [
            [
              '# FrontX AI Tooling Kit — Agent Navigation Rules',
              '',
              '## Package Boundaries (always enforce)',
              '',
              '- Template packages: `frontx-template-shell` and its sub-packages',
            ].join('\n'),
          ];
        }
        return [''];
      },
    };

    const result = validateKitManifest(loadShippedManifest(), leakingReader);
    expect(result.status).toBe('FAIL');
    expect(
      result.violations.some(
        (v) => v.code === 'SOLUTION_SPECIFIC_CONTENT' && v.message.includes('frontx-template-shell'),
      ),
    ).toBe(true);
  });

  // inst-scan-solution-content — mfe counterpart, bare form (no frontx- prefix)
  it('resource body naming "template-mfe" (without frontx- prefix) → FAIL SOLUTION_SPECIFIC_CONTENT', () => {
    const leakingReader: ResourceBodyReader = {
      read(entry: KitResourceEntry): string[] {
        if (entry.id === 'frontx_guidelines') {
          return ['## Template Territory\n\n`src-app/mfe_packages/` ships from `template-mfe/`.'];
        }
        return [''];
      },
    };
    const result = validateKitManifest(loadShippedManifest(), leakingReader);
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.code === 'SOLUTION_SPECIFIC_CONTENT')).toBe(true);
  });

  // inst-scan-solution-content — the FRAMEWORK half of the body scan. Asserting
  // that FORBIDDEN_BODY_NAMES contains the names proves the list; only feeding a
  // body through the scan proves the behaviour. Without this case, dropping
  // FRAMEWORK_NAMES from the scan leaves the whole suite green.
  it.each(['React', 'vue', 'Angular', 'svelte'])(
    'resource body naming the framework "%s" → FAIL SOLUTION_SPECIFIC_CONTENT',
    (framework) => {
      const leakingReader: ResourceBodyReader = {
        read(entry: KitResourceEntry): string[] {
          const body = `Prefer the ${framework} lifecycle for this unit.`;
          return entry.id === 'frontx_guidelines' ? [body] : [''];
        },
      };

      const result = validateKitManifest(loadShippedManifest(), leakingReader);

      expect(result.status).toBe('FAIL');
      expect(
        result.violations.some(
          (v) => v.code === 'SOLUTION_SPECIFIC_CONTENT' && v.message.toLowerCase().includes(framework.toLowerCase()),
        ),
      ).toBe(true);
    },
  );

  // inst-scan-solution-content — abstract use of the generic word "template" in guidelines is NOT a false positive
  it('body abstractly describing the template mechanism (no specific name) → PASS', () => {
    const abstractReader: ResourceBodyReader = {
      read(entry: KitResourceEntry): string[] {
        const body = 'Templates are independently installed solutions the CLI resolves by source-spec; the base names none.';
        // Public resources (frontx_skill, frontx_agents) must still carry applicability
        // metadata for this scenario to isolate the solution-content scan being tested.
        return entry.public ? [`---\ndescription: "test fixture"\n---\n\n${body}`] : [body];
      },
    };
    const result = validateKitManifest(loadShippedManifest(), abstractReader);
    expect(result.status).toBe('PASS');
  });

  // inst-scan-solution-content — unreadable resource body is reported as a violation, not silently ignored
  it('unreadable resource body → FAIL RESOURCE_BODY_UNREADABLE', () => {
    const throwingReader: ResourceBodyReader = {
      read(): string[] {
        throw new Error('ENOENT: no such file');
      },
    };
    const result = validateKitManifest(loadShippedManifest(), throwingReader);
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.code === 'RESOURCE_BODY_UNREADABLE')).toBe(true);
  });
});

// The kit's own test suite asserting its declared-resource-surface DoD clauses
// (a)-(c) against the REAL shipped manifest and resource files on disk, per the
// DoD's own verifiable clause (d) and cpt-frontx-adr-ai-tooling-framework-packaging Confirmation.
// Traceability marker for this DoD lives in validate-manifest.ts, the production
// code that enforces it (test files are excluded from marker scanning).
describe('kit self-validation — declared public resource surface (cpt-frontx-dod-ai-kit-packaging-declared-resource-surface)', () => {
  const publicResources = () => loadShippedManifest().kits.flatMap((kit) => kit.resources.filter((r) => r.public === true));
  const nonPublicResources = () => loadShippedManifest().kits.flatMap((kit) => kit.resources.filter((r) => r.public !== true));

  // DoD clause (a): every public resource is kind skill|rule
  it('every public resource has kind "skill" or "rule"', () => {
    expect(publicResources().length).toBeGreaterThan(0);
    for (const resource of publicResources()) {
      expect(['skill', 'rule']).toContain(resource.kind);
    }
  });

  // DoD clause (b): each public resource document carries non-empty applicability
  // metadata (frontmatter description) — read the real shipped file, not a mock.
  it('every public resource document carries a non-empty frontmatter description', () => {
    for (const resource of publicResources()) {
      const body = fs.readFileSync(path.join(kitRoot, resource.source), 'utf8');
      const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      expect(frontmatter, `${resource.id}: expected frontmatter in ${resource.source}`).not.toBeNull();
      const description = frontmatter?.[1].match(/^description:\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
      expect(description, `${resource.id}: expected non-empty frontmatter description`).toBeTruthy();
    }
  });

  // DoD clause (c): supporting knowledge content (frontx_guidelines) ships as a
  // declared non-public resource, not as an undeclared public entry point.
  it('frontx_guidelines is declared and is not public', () => {
    const guidelines = nonPublicResources().find((r) => r.id === 'frontx_guidelines');
    expect(guidelines).toBeDefined();
    expect(guidelines?.public).not.toBe(true);
  });

  // DoD clause (d): validateKitManifest itself asserts (a) and (b) via the real
  // fs body reader, over the real shipped manifest — end-to-end, not mocked.
  it('validateKitManifest PASSes clauses (a) and (b) against the real shipped manifest and files', () => {
    const reader = createFsResourceBodyReader(kitRoot);
    const result = validateKitManifest(loadShippedManifest(), reader);
    expect(result.violations).toEqual([]);
    expect(result.status).toBe('PASS');
  });
});

// The two entry points this kit declares for routing and for scaffolding from a
// stated intent (cpt-frontx-dod-ai-project-scaffolding-declared-skill-surface).
// Both are documents rather than modules, so the shipped files ARE the
// implementation and these assertions read them off disk.
describe('kit self-validation — routing and scaffolding entry points (cpt-frontx-dod-ai-project-scaffolding-declared-skill-surface)', () => {
  const SCAFFOLDING_ID = 'frontx_project_scaffolding';
  const ROUTING_ID = 'frontx_skill';

  function resourceById(id: string): KitResourceEntry | undefined {
    return loadShippedManifest().kits.flatMap((kit) => kit.resources).find((r) => r.id === id);
  }

  function shippedBody(id: string): string {
    const resource = resourceById(id);
    if (!resource) throw new Error(`resource "${id}" is not declared in the shipped manifest`);
    return fs.readFileSync(path.join(kitRoot, resource.source), 'utf8');
  }

  it('declares the scaffolding entry point as a public skill under the frontx_ prefix', () => {
    expect(resourceById(SCAFFOLDING_ID)).toMatchObject({
      kind: 'skill',
      public: true,
      type: 'file',
      // Pinned: without it the body assertions below would still pass if the
      // registration pointed at some other document carrying the same commands.
      source: 'skills/project-scaffolding/SKILL.md',
    });
  });

  // The routing responsibility extends the EXISTING top-level resource rather
  // than arriving as a second one: a resource whose only content is a pointer to
  // another adds a hop and no capability, and a second entry claiming the
  // top-level name is not declarable.
  it('carries routing in the existing top-level resource instead of a second top-level entry', () => {
    const topLevel = loadShippedManifest()
      .kits.flatMap((kit) => kit.resources)
      .filter((r) => r.source === 'SKILL.md');

    expect(topLevel.map((r) => r.id)).toEqual([ROUTING_ID]);
  });

  it('states the routing responsibility in a delimited section of the top-level document', () => {
    const body = shippedBody(ROUTING_ID);

    expect(body).toContain('<!-- frontx:routing:begin -->');
    expect(body).toContain('<!-- frontx:routing:end -->');
  });

  // The routing flow's whole point: a request to create a new project resolves
  // to the scaffolding entry point and to nothing else.
  it('routes a request to create a new project to the scaffolding entry point', () => {
    const body = shippedBody(ROUTING_ID);
    const routing = body.slice(
      body.indexOf('<!-- frontx:routing:begin -->'),
      body.indexOf('<!-- frontx:routing:end -->'),
    );

    expect(routing).toContain(SCAFFOLDING_ID);
  });

  // The kit orchestrates the CLI over its command surface and never links it, so
  // the entry point that applies templates must reach them by running the
  // executable (cpt-frontx-dod-ai-project-scaffolding-command-surface-only).
  // The absence of an import specifier is asserted separately, over every
  // shipped document, in no-cli-package-edge.test.ts.
  it('names the executable commands it drives the CLI through, in the scaffolding document', () => {
    const body = shippedBody(SCAFFOLDING_ID);

    // The commands the scaffolding flow actually drives, per
    // `cpt-frontx-flow-ai-project-scaffolding-scaffold-from-intent`: read the
    // installed set, register each template it selects, then materialize them
    // as ONE explicit batch. An earlier revision of this test pinned `frontx
    // seed` and `frontx add` instead — `add` no longer exists at all, and
    // `seed` accepts only the CLI's official defaults, which this flow never
    // uses. Asserting a retired command kept the document stale by making the
    // correction fail the suite.
    expect(body).toContain('frontx list --json');
    expect(body).toContain('frontx register');
    expect(body).toContain('frontx apply');
    expect(body).not.toContain('frontx add');
  });

  // Selection reads the installed set at invocation time; a document that named
  // a template would be a built-in mapping from a request to a product name,
  // which is what the solution-agnostic base forbids.
  //
  // Scanning the document DIRECTLY rather than asserting that the whole-manifest
  // run produced no violation for it: the suite's existing "violations is empty"
  // case already subsumes that assertion, so a per-resource restatement of it
  // can never fail on its own and documents an intent it does not test. Reading
  // the shipped file and applying the production scan makes this case fail by
  // itself the moment this specific document names a product — and it imports
  // that scan rather than transcribing its list, so there is one authority for
  // what is forbidden and no copy here to drift out of step with it.
  it('names no concrete template, solution, or framework in the scaffolding document', () => {
    expect(findForbiddenSolutionName(shippedBody(SCAFFOLDING_ID))).toBeUndefined();
  });

  // Reads the exported list itself, so the scan above is known to be checking a
  // non-empty set of real product names rather than passing because the list
  // emptied out. This is the consumer the list is exported for.
  it('scans against a non-empty forbidden-name list that includes the shipped template identities', () => {
    expect(FORBIDDEN_BODY_NAMES.length).toBeGreaterThan(0);
    expect(FORBIDDEN_BODY_NAMES).toContain('template-shell');
    expect(FORBIDDEN_BODY_NAMES).toContain('react');
  });

  it('names no concrete template, solution, or framework in the routing document', () => {
    expect(findForbiddenSolutionName(shippedBody(ROUTING_ID))).toBeUndefined();
  });

  // The scaffolding flow's verification is accounted for by a checklist shipped
  // beside the skill: the skill holds the mechanics, the checklist holds what
  // those mechanics have to establish, and the report walks its categories.
  // Three things can break that arrangement silently, so each is asserted here.
  describe('verification checklist resource', () => {
    const CHECKLIST_ID = 'frontx_verification_checklist';

    // Studio infers `kind` from a source whose file name ends in `checklist.md`
    // (`_resource_kind_from_path`, studio engine v1.6.2). A rename to any other
    // file name would leave the declared kind and the inferred one disagreeing,
    // which no other assertion in this suite would notice.
    it('is declared as a non-public checklist whose file name backs the kind inference', () => {
      const resource = resourceById(CHECKLIST_ID);

      expect(resource).toMatchObject({
        kind: 'checklist',
        type: 'file',
        source: 'skills/project-scaffolding/verification-checklist.md',
      });
      // Absent rather than false: Studio rejects `public = true` for this kind
      // outright, so the key is left off exactly as it is for frontx_guidelines.
      expect(resource?.public).toBeUndefined();
      expect(resource?.source.endsWith('checklist.md')).toBe(true);
    });

    // The format of record for a Studio checklist: MUST HAVE / MUST NOT HAVE
    // partitions, and every item carrying a severity from the document's own
    // dictionary. An item added without one reads as unprioritized and gives a
    // report no basis for deciding whether a failure blocks.
    it('partitions into MUST HAVE / MUST NOT HAVE and gives every item a declared severity', () => {
      const body = shippedBody(CHECKLIST_ID);

      expect(body).toContain('\n# MUST HAVE\n');
      expect(body).toContain('\n# MUST NOT HAVE\n');

      const items = [...body.matchAll(/^### (VER-[A-Z-]*\d{3}): .+\n\*\*Severity\*\*: (\w+)$/gm)];
      const headings = [...body.matchAll(/^### (VER-[A-Z-]*\d{3}):/gm)];

      // Every item heading matched the stricter pattern, so none is missing the
      // severity line that has to sit directly under it.
      expect(items.length).toBe(headings.length);
      expect(items.length).toBeGreaterThan(0);
      for (const [, id, severity] of items) {
        expect(['CRITICAL', 'HIGH', 'MEDIUM'], `${id} carries severity "${severity}"`).toContain(severity);
      }
    });

    // The wiring is what makes the checklist load-bearing rather than a file
    // nobody opens: Step 7 names it as the browser walk's definition of done,
    // and Step 8 requires the per-category status walk over it.
    it('is named by the scaffolding document as the walk definition of done and as the report status walk', () => {
      const body = shippedBody(SCAFFOLDING_ID);

      expect(body).toContain('verification-checklist.md');
      expect(body).toContain(CHECKLIST_ID);
      expect(body).toContain('per-category status walk');
    });
  });

  // The variant walk's mechanics ship twice over: as prose in the scaffolding
  // document, and as a program that performs them. The prose copy did not
  // survive a change of agent host, which is the whole reason the program
  // exists, so the wiring that makes it reachable and runnable is asserted here.
  describe('verification driver resource', () => {
    // Every run below drives the real driver against a temporary tree, and the
    // removal of that tree used to sit as the last statement of each test body -
    // which a failing assertion skips, leaving the tree in os.tmpdir() for the
    // rest of the machine's life. Registered here instead, so the removal happens
    // on the failing path too, and so a case added later cannot forget it: there
    // is no per-test cleanup call left to omit.
    const pendingCleanups: (() => void)[] = [];

    afterEach(() => {
      while (pendingCleanups.length > 0) pendingCleanups.pop()?.();
    });

    // The one way a case in here makes a temporary directory. Returns the path
    // and registers its removal in the same breath, so the two cannot drift.
    function tempDir(prefix: string): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
      pendingCleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
      return dir;
    }

    const DRIVER_ID = 'frontx_verify_walk';
    const DRIVER_SOURCE = 'skills/project-scaffolding/scripts/verify-walk.mjs';
    const driverPath = () => path.join(kitRoot, DRIVER_SOURCE);

    it('is declared as a non-public script resource at the path the skill names', () => {
      const resource = resourceById(DRIVER_ID);

      expect(resource).toMatchObject({ kind: 'script', type: 'file', source: DRIVER_SOURCE });
      // Absent rather than false, exactly as for the checklist: Studio rejects
      // `public = true` outside the skill/agent/rule kinds outright.
      expect(resource?.public).toBeUndefined();
    });

    it('ships as an executable node program', () => {
      expect(fs.readFileSync(driverPath(), 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
    });

    // Without this, the driver could ship, validate and still be reached by
    // nobody: the document is the only thing that sends a run to it.
    it('is named by the scaffolding document as what the walk runs, with hand-driving as the fallback', () => {
      const body = shippedBody(SCAFFOLDING_ID);

      expect(body).toContain(DRIVER_ID);
      expect(body).toContain(DRIVER_SOURCE);
      expect(body).toContain('Hand-authored browser calls are the fallback');
    });

    // Everything a project contributes reaches this driver as a caller-declared
    // axis, and the driver's own vocabulary is the kit's: checkpoints, controls,
    // labels, captures. Two template concepts were baked in here instead, each
    // naming flags, result fields, capture files and coverage columns. "theme"
    // was one dimension the walk repeated over. The other was a whole navigation
    // model - screens carrying a route, reached by a menu click, with a dev panel
    // of host chrome drawn over them - which asserted of every project that it
    // has URL-addressable pages and a menu to click between them. Guarding the
    // words themselves is what catches a reintroduction, because one comes back
    // in a comment or a help line long before it reaches a flag.
    const TEMPLATE_NOUNS = ['theme', 'screen', 'route', 'menu', 'nav', 'panel'];

    // The one word on that list the driver still has to spell, and it is not the
    // kit's: `screenshot` is the browser CLI's own command name, issued verbatim.
    // Removed from the text before the scan rather than dropped from the list, so
    // "screen" and "screens" stay guarded on their own.
    const BROWSER_COMMAND_WORD = 'screenshot';

    it.each(TEMPLATE_NOUNS)('carries no trace of the template concept "%s" anywhere in its contract', (noun) => {
      const source = fs.readFileSync(driverPath(), 'utf8').toLowerCase().replaceAll(BROWSER_COMMAND_WORD, '');

      expect(source).not.toContain(noun);
    });

    // The same rule one level up, for the one dimension the kit's own documents
    // have no honest use for: the ecosystem PRD states that no theme schema is an
    // ecosystem-level concept, so the kit has no abstraction to reference it
    // through. The rest of the list is not guarded in prose, because these
    // documents legitimately name a template's own vocabulary where they say it
    // belongs to the template - which is the correction the word needs, not
    // deletion.
    it.each([['the scaffolding document', SCAFFOLDING_ID], ['the verification checklist', 'frontx_verification_checklist']])(
      'is documented in %s without that dimension either',
      (_what, id) => {
        expect(shippedBody(id).toLowerCase()).not.toContain('theme');
      });

    // The navigation model leaked one level further out than the driver and the
    // scaffolding document: `frontx_agents` is a rule-kind resource loaded at the
    // start of every session in every FrontX project, scaffolding or not, so a
    // template concept written into it reaches projects that never run this walk
    // at all. Its verification block states the standing rules the walk realises,
    // and every one of them has to be phrased over what the run declared.
    it('states the standing verification rules without naming a template concept', () => {
      const body = shippedBody('frontx_agents');
      const section = /\n## When verifying a user interface\n([\s\S]*?)\n## /.exec(body);
      if (section === null) throw new Error('frontx_agents no longer carries a "When verifying a user interface" section');

      const prose = section[1].toLowerCase().replaceAll(BROWSER_COMMAND_WORD, '');
      for (const noun of TEMPLATE_NOUNS) {
        expect(prose, `the verification rules name the template concept "${noun}"`).not.toContain(noun);
      }
    });

    it('prints its flag surface and exits 0 on --help', () => {
      const help = spawnSync(process.execPath, [driverPath(), '--help'], {
        encoding: 'utf8',
        timeout: DRIVER_TIMEOUT_MS,
      });

      expect(help.status).toBe(0);
      expect(help.stdout).toContain('--capdir');
      expect(help.stdout).toContain('--checkpoints');
      expect(help.stdout).toContain('--variants');
      // The Usage line carries every required flag. One that lists a flag as
      // required and leaves it out of the invocation form teaches the shorter
      // form, and the shorter form is refused.
      const usage = help.stdout.slice(help.stdout.indexOf('Usage:'), help.stdout.indexOf('Required:'));
      for (const flag of ['--host', '--capdir']) {
        expect(usage, `Usage: omits the required ${flag}`).toContain(flag);
      }
      // And both axes stay out of the required set, in the text a caller reads
      // before writing an invocation: a Usage line carrying either teaches an
      // axis every project has to declare, which is the coupling the driver's
      // contract does not have. `--checkpoints` sits here rather than above it
      // for exactly that reason - the walk has a place to go without one.
      for (const flag of ['--checkpoints', '--checkpoint-selector', '--variants', '--variant-switcher', '--variant-option']) {
        expect(usage, `Usage: presents the optional ${flag} as required`).not.toContain(flag);
      }
    });

    // The failure path is the one that matters: a driver that exits 0 on a run
    // it could not perform hands back a pass nobody established. Against an
    // origin nothing serves, it must refuse before a browser is involved, and
    // the refusal must be readable by machine.
    it('exits non-zero with a well-formed JSON failure record when nothing serves the host', () => {
      const capdir = tempDir('verify-walk-');
      fs.rmdirSync(capdir); // the driver creates it, and refuses one that already holds files

      const run = spawnSync(process.execPath, [
        driverPath(),
        '--host', 'http://127.0.0.1:1',
        '--variants', 'alpha,beta',
        '--checkpoints', 'orders:/orders:at-orders',
        '--capdir', capdir,
        '--variant-switcher', 'axis-switcher',
        '--variant-option', 'axis-option-{variant}',
      ], { encoding: 'utf8', timeout: DRIVER_TIMEOUT_MS });

      expect(run.status).not.toBe(0);
      expectResultRecord(run);

      const parsed = JSON.parse(run.stdout) as {
        ok: boolean;
        variantAxis: { source: string; variants: string[] };
        failures: { stage: string; detail: string }[];
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.failures[0].stage).toBe('host-probe');
      // The set's provenance is recorded, so a report cannot claim a hand-typed
      // set was read out of the host's own registration of that dimension.
      expect(parsed.variantAxis).toEqual({ declared: true, source: 'literal', variants: ['alpha', 'beta'] });
      // Written to disk as well as printed: the run's own record survives the
      // conversation that produced it.
      expect(JSON.parse(fs.readFileSync(path.join(capdir, 'verify-walk.json'), 'utf8')).ok).toBe(false);

    });

    // The runner evaluates every script in one persistent page scope, so the
    // prelude is re-entered on each call rather than once per run. Declared
    // lexically, its helpers throw "already been declared" from the second eval
    // onward, and the callers read that throw as an element holding nothing:
    // three agent hosts driven from identical sources each reported empty variant
    // labels on every variant rather than the redeclaration underneath.
    it('installs its page helpers as globals, so evaluating the prelude twice in one scope does not throw', () => {
      const source = fs.readFileSync(driverPath(), 'utf8');
      const preludeMatch = /const PRELUDE = `([\s\S]*?)`;/.exec(source);
      if (preludeMatch === null) throw new Error('the driver no longer carries a PRELUDE template literal');

      // What reaches the page is the interpolated prelude, so the sentinel's
      // substitution is resolved here from the driver's own declaration of it -
      // running the raw literal would be running a text no page ever sees. Any
      // other substitution stops this test rather than being evaluated broken.
      const sentinelMatch = /^const MISSING = ('[^']*');$/m.exec(source);
      if (sentinelMatch === null) throw new Error('the driver no longer declares MISSING as a single-quoted literal');
      const prelude = preludeMatch[1].replaceAll('${JSON.stringify(MISSING)}', sentinelMatch[1]);
      if (prelude.includes('${')) throw new Error('the prelude carries a substitution this test cannot resolve');

      // Column zero is the prelude's own top level; the indented declarations
      // are inside the helper bodies, where a fresh scope makes them safe.
      expect(prelude).not.toMatch(/^(?:const|let|class)\b/m);

      const context = vm.createContext({});
      vm.runInContext(prelude, context);

      expect(() => vm.runInContext(prelude, context)).not.toThrow();
      expect(vm.runInContext('typeof __find', context)).toBe('function');
      expect(vm.runInContext('__MISSING', context)).toBe('__verify_walk_missing__');
    });

    // The value the prelude installs into the page and the value the read check
    // compares a reading against are the same claim, and they were written out
    // as two literals. Changing one alone left the check comparing against a
    // string the page never returns, which reads as an absent control passing a
    // `read` action. One spelling in the whole file is what keeps them together.
    it('spells the missing-element sentinel exactly once, so the prelude and the read check cannot drift', () => {
      const source = fs.readFileSync(driverPath(), 'utf8');
      const spellings = source.match(/__verify_walk_missing__/g) ?? [];

      expect(spellings).toHaveLength(1);
      // And that one spelling is a named definition rather than a use, so both
      // sides are derived from it.
      expect(source).toMatch(/^const MISSING = '__verify_walk_missing__';$/m);
    });

    // A refused eval and an element holding an empty string leave the same empty
    // stdout behind. Reading only stdout made the first indistinguishable from
    // the second, and a run spent its budget diagnosing a rendering race that
    // was a redeclaration throw. The refusal now has a stage of its own.
    it('records a refused browser eval as an eval-error failure carrying the runner stderr', () => {
      const workdir = tempDir('verify-walk-eval-');

      // The driver reaches the browser only through `npx agent-browser`, so a
      // stub earlier on PATH is the whole of the failure injection: no real
      // browser is launched and nothing on the machine is touched.
      const stubDir = path.join(workdir, 'bin');
      fs.mkdirSync(stubDir, { recursive: true });
      fs.writeFileSync(path.join(stubDir, 'npx'),
        "#!/bin/sh\necho \"SyntaxError: Identifier '__find' has already been declared\" >&2\nexit 1\n",
        { mode: 0o755 });

      const run = spawnSync(process.execPath, [
        driverPath(),
        // A data URL is the stand-in for a served origin: it answers the host
        // probe, which is all the probe asks of it, and it keeps this test off
        // the network and off any port a parallel run might also want.
        '--host', 'data:text/plain,ok',
        '--variants', 'alpha',
        '--checkpoints', 'orders:/orders:at-orders',
        '--capdir', path.join(workdir, 'shots'),
        '--variant-switcher', 'axis-switcher',
        '--variant-option', 'axis-option-{variant}',
        // Port 1 answers nothing, so the driver takes its no-debugger path and
        // never asks the stub to attach to a browser.
        '--cdp-port', '1',
        '--ready-timeout', '5000',
      ], {
        encoding: 'utf8',
        timeout: DRIVER_TIMEOUT_MS,
        env: { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ''}` },
      });

      expect(run.status).not.toBe(0);
      expectResultRecord(run);

      const parsed = JSON.parse(run.stdout) as { ok: boolean; failures: { stage: string; detail: string }[] };
      const evalErrors = parsed.failures.filter((failure) => failure.stage === 'eval-error');

      expect(parsed.ok).toBe(false);
      expect(evalErrors.length).toBeGreaterThan(0);
      expect(evalErrors[0].detail).toContain("Identifier '__find' has already been declared");
      // The readiness poll gives up on a refused eval rather than re-asking every
      // 400ms: unguarded, the 5s budget alone would file a dozen identical
      // records and bury the reason under them.
      expect(evalErrors.length).toBeLessThan(10);
      // The caller of a refused eval keeps the two apart rather than reporting
      // an absent control: the switcher click is the first operation that cannot
      // be dispatched, and its failure names the refused eval as the reason
      // instead of "no control carries that data-testid".
      const control = parsed.failures.find((failure) => failure.stage === 'control');
      expect(control?.detail).toContain('variant switcher');
      expect(control?.detail).toContain('the eval did not run');

    });

    // The script is handed to the runner on its stdin, so a script larger than
    // the stdin pipe buffer is still being written when the runner exits. That
    // makes the shape below certain here rather than a race a fast machine wins
    // and a loaded one loses: the testid is carried into the eval script
    // verbatim, and 100KB of it is past the 64KB a pipe holds while staying
    // under the 128KB a single argument may carry.
    const MIDWRITE_EXIT_TESTID = `axis-switcher-${'x'.repeat(100_000)}`;

    // A runner that rejects the script on sight exits while that write is still
    // in flight, and the write then fails with EPIPE - so `proc.error` is set
    // over a child that ran, exited 1 and printed why. Classified off the error
    // first, the refusal was filed as a runner that could not be run: the
    // eval-error record above went missing, its stage named the one repair the
    // run did not need, and the reason the runner printed reached nothing. The
    // child's own report is what the record carries, and "could not be run" is
    // left for a child that reported nothing at all.
    it('reads an eval the runner exited from mid-write off its own report, not off the broken write', () => {
      const runWithStub = (stub: string, readyTimeout: string) => {
        const workdir = tempDir('verify-walk-midwrite-');
        const stubDir = path.join(workdir, 'bin');
        fs.mkdirSync(stubDir, { recursive: true });
        fs.writeFileSync(path.join(stubDir, 'npx'), stub, { mode: 0o755 });

        const run = spawnSync(process.execPath, [
          driverPath(),
          '--host', 'data:text/plain,ok',
          '--variants', 'alpha',
          '--checkpoints', 'orders:/orders:at-orders',
          '--capdir', path.join(workdir, 'shots'),
          '--variant-switcher', MIDWRITE_EXIT_TESTID,
          '--variant-option', 'axis-option-{variant}',
          '--cdp-port', '1',
          '--ready-timeout', readyTimeout,
        ], {
          encoding: 'utf8',
          timeout: DRIVER_TIMEOUT_MS,
          env: { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ''}` },
        });

        expectResultRecord(run);
        const parsed = JSON.parse(run.stdout) as { ok: boolean; failures: { stage: string; detail: string }[] };
          return { ...parsed, exitStatus: run.status };
      };

      const refused = runWithStub(
        "#!/bin/sh\necho \"SyntaxError: Identifier '__find' has already been declared\" >&2\nexit 1\n",
        '5000');
      const evalErrors = refused.failures.filter((failure) => failure.stage === 'eval-error');

      expect(refused.ok).toBe(false);
      expect(evalErrors.length).toBeGreaterThan(0);
      expect(evalErrors[0].detail).toContain("Identifier '__find' has already been declared");
      // The stages for a runner that never reported, claimed over one that did,
      // send the repair after an installation and a hang that were both fine.
      expect(refused.failures.some((failure) => failure.stage === 'spawn' || failure.stage === 'timeout')).toBe(false);

      // A zero exit over the same broken write cannot clear the invocation
      // either: the runner answered some prefix of the script, so its stdout is
      // an answer to a text the driver never sent. Trusted, it reads as a
      // dispatched click - the walk then captures under a variant it never asked
      // the page for. This stub answers every readiness probe with the same
      // line, so the poll ahead of the switcher is given 1ms and gives up on the
      // first turn rather than spending a budget on an answer that never changes.
      //
      // Neither this stub nor the one above ever reads its stdin, so the write of
      // MIDWRITE_EXIT_TESTID breaks on both in the same way - but what spawnSync
      // reports for that break is not the same. macOS surfaces it as EPIPE, and
      // `invocationOutcome` stays keyed on that error code, filing it as
      // eval-error the same as the refusal above. Linux has been observed to
      // surface nothing at this layer at all for this exact stub - no error, no
      // signal, status 0 - so the truncated eval is caught only downstream, by
      // the walk's own read-backs disagreeing with what a dispatched click or a
      // confirmed label would have to show. `invocationOutcome` cannot detect a
      // write the kernel never reports as broken, and the assertion below claims
      // only what holds on both: the run never passes.
      const partial = runWithStub('#!/bin/sh\necho dispatched\nexit 0\n', '1');

      expect(partial.ok).toBe(false);
      expect(partial.exitStatus).not.toBe(0);
    });

    // The runner resolves a relative screenshot path against its own temporary
    // working directory and still reports the write as a success, so captures
    // taken under a relative capdir land where neither the byte-compare nor the
    // coverage cells look. Every path the driver hands out is absolute.
    it('resolves a relative capture directory against the caller, not the runner', () => {
      const workdir = tempDir('verify-walk-cwd-');

      const run = spawnSync(process.execPath, [
        driverPath(),
        '--host', 'http://127.0.0.1:1',
        '--variants', 'alpha',
        '--checkpoints', 'orders:/orders:at-orders',
        '--capdir', 'shots',
        '--variant-switcher', 'axis-switcher',
        '--variant-option', 'axis-option-{variant}',
      ], { encoding: 'utf8', cwd: workdir, timeout: DRIVER_TIMEOUT_MS });

      expectResultRecord(run);
      const parsed = JSON.parse(run.stdout) as { capdir: string };

      expect(path.isAbsolute(parsed.capdir)).toBe(true);
      expect(path.basename(parsed.capdir)).toBe('shots');
      expect(fs.existsSync(path.join(workdir, 'shots', 'verify-walk.json'))).toBe(true);

    });

    // A page the driver can complete a walk against, standing in for the
    // browser at the one seam the driver has: `npx agent-browser`. It answers
    // from a declared id list rather than a real DOM, and records every command
    // it was given, so a test asserts on what the driver actually drove instead
    // of on the driver's own account of it. Nothing here mocks the driver.
    const STUB_AGENT_BROWSER = `
const fs = require('node:fs');
const path = require('node:path');

const log = (line) => fs.appendFileSync(process.env.STUB_LOG, line + '\\n');
const ids = JSON.parse(process.env.STUB_IDS);
const argv = process.argv.slice(4); // past node, this file, --yes, agent-browser
const command = argv[0];

// A child that never returns anything, for the timeout path. The driver has to
// kill it and record that; nothing else in the run can end it.
if (process.env.STUB_HANG === '1') {
  log('hang ' + argv.join(' '));
  setInterval(() => {}, 1000);
  return;
}

if (command === 'open' && process.env.STUB_FAIL_OPEN === '1') {
  log('open-refused ' + argv[1]);
  process.stderr.write('LoadError: net::ERR_CONNECTION_REFUSED\\n');
  process.exit(3);
}
if (command === 'screenshot') {
  // Identical bytes across variants on request: two registered variants can differ
  // only in tokens the captured surface never consumes, and the identical
  // verdict that produces is a recorded fact the driver has to be able to reach.
  const body = process.env.STUB_IDENTICAL_SHOTS === '1' ? 'png:identical' : 'png:' + path.basename(argv[1]);
  fs.writeFileSync(argv[1], body);
  log('screenshot ' + path.basename(argv[1]));
  process.exit(0);
}
if (command !== 'eval') {
  log(argv.join(' '));
  process.exit(0);
}

const script = fs.readFileSync(0, 'utf8');
const found = /__find\\("([^"]*)"\\)/.exec(script);
const id = found === null ? null : found[1];
const present = id !== null && ids.includes(id);
// A switcher whose option click dispatches and whose variant does not change:
// the page goes on showing the variant named here whatever is clicked. It is the
// application failure the label check exists to catch, and without it every
// label read back agrees with what was just asked for.
const variant = () => (process.env.STUB_STICKY_VARIANT
  ? process.env.STUB_STICKY_VARIANT
  : (fs.existsSync(process.env.STUB_VARIANT)
    ? fs.readFileSync(process.env.STUB_VARIANT, 'utf8')
    : 'alpha'));

// One refused existence probe, for the difference between "the page holds no
// such element" and "the script never ran". Scoped to the probe so the control
// it names can still be clicked.
if (script.includes("'yes' : 'no'") && id === process.env.STUB_EVAL_ERROR_PROBE) {
  process.stderr.write('EvalError: the page refused the probe\\n');
  process.exit(1);
}

if (script.includes('__testids()')) {
  process.stdout.write(JSON.stringify(ids) + '\\n');
} else if (script.includes('setter.call')) {
  // Checked before the click branch: a fill dispatches input and change events,
  // so a stub that greps for dispatchEvent first answers every fill as a click.
  const typed = /setter\\.call\\(el, "((?:[^"\\\\]|\\\\.)*)"\\)/.exec(script)[1];
  log('fill ' + id + ' ' + typed);
  // A field that took something other than what was typed into it. Without it
  // the read-back is asserted only against a stub that always agrees, which is
  // the one case a read-back cannot catch anything in.
  const landed = process.env.STUB_FILL_DRIFT === '1' ? 'drift:' + typed : typed;
  process.stdout.write((present ? landed : '__verify_walk_missing__') + '\\n');
} else if (script.includes('dispatchEvent')) {
  log('click ' + id);
  // The event names are logged on their own line so a test can assert the whole
  // native sequence arrived. Greping for dispatchEvent alone cannot: a driver
  // reduced to one bare event still reads as a click here.
  log('events ' + [...script.matchAll(/new (?:Pointer|Mouse)Event\\('([a-z]+)'/g)].map((m) => m[1]).join(','));
  if (present && id.startsWith('axis-option-')) {
    fs.writeFileSync(process.env.STUB_VARIANT, id.slice('axis-option-'.length));
  }
  process.stdout.write((present ? 'dispatched' : '__verify_walk_missing__') + '\\n');
} else if (script.includes("'yes' : 'no'")) {
  process.stdout.write((present ? 'yes' : 'no') + '\\n');
} else {
  // The switcher's label answers with the variant this page was last switched
  // into, so a walk over several variants is confirmed against a moving reading
  // rather than against a constant that agrees with everything.
  if (id === 'axis-switcher' && present) process.stdout.write('Active: ' + variant() + '\\n');
  else process.stdout.write((present ? 'text of ' + id : '__verify_walk_missing__') + '\\n');
}
process.exit(0);
`;

    interface StubRun {
      status: number | null;
      result: {
        ok: boolean;
        coverageFile: string | null;
        browser: { command: string | null };
        variantAxis: { declared: boolean; source: string | null; variants: string[] };
        checkpointAxis: {
          declared: boolean;
          reach: string | null;
          checkpoints: { name: string; destination: string | null; readyTestid: string | null; handle: string | null }[];
        };
        checkpointResolution: { checkpoint: string; testid: string | null; handle: string | null; source: string }[];
        variants: {
          // Both null on a pass the walk took with no variant axis declared: no
          // value was walked, and no switcher label was read to confirm one.
          variant: string | null;
          labelConfirmed: boolean | null;
          labelRead: string | null;
          overlayClosed: boolean | null;
          // `checkpoint` is null on every row of a run that declared no
          // checkpoint axis, for the same reason `variant` is.
          captures: { checkpoint: string | null; state: string; readyConfirmed: boolean }[];
          // `expected` is absent on a click, which declares nothing to compare against.
          readBacks: { action: string; testid: string; expected?: string | null; actual: string; ok: boolean }[];
          comparisons: { against: string; checkpoint: string | null; state: string; command: string; exit: number | null; verdict: string }[];
        }[];
        failures: { stage: string; detail: string }[];
      };
      commands: string[];
      coverage: string;
      // Where the run was told to write, and the directory that holds it: a
      // capture is confined to the first, and the second is where a name that
      // escaped it would land.
      capdir: string;
      workdir: string;
    }

    // The driver answers every run it cannot perform with a JSON result record,
    // malformed arguments included, so a stdout that does not open with `{` means
    // the driver died without recording anything rather than that it refused.
    // Named here for the same reason `run.error` is: a bare JSON.parse failure
    // never mentions the driver's own output, and the output is where the reason
    // is.
    function expectResultRecord(run: { stdout: string; stderr: string; status: number | null }): void {
      if (!run.stdout.trimStart().startsWith('{')) {
        throw new Error(`the driver printed no result record and exited ${run.status}`
          + `\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
      }
      // A record that opened with `{` and did not parse is a third outcome, and a
      // bare JSON.parse failure names neither the driver nor its output. The
      // partial-write path in `writeStdout` is exactly how it would arrive.
      try {
        JSON.parse(run.stdout);
      } catch (error) {
        throw new Error(`the driver's result record did not parse (${(error as Error).message})`
          + ` and it exited ${run.status}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`,
        { cause: error });
      }
    }

    // `files` writes the driver's JSON inputs into the run's own directory and
    // declares them, so a test states the states/registry content it needs
    // rather than managing a second temporary tree for it.
    // Both axes are optional in the driver's contract, so the invocation this
    // helper builds declares the variant axis by default and a run that needs the
    // axis-less shape asks for it here - omitting the flags in `args` cannot
    // express it, because this helper would put them back. The checkpoint axis is
    // never supplied here: every case that wants one names its own points.
    function runAgainstStub(
      args: string[],
      ids: string[],
      env: NodeJS.ProcessEnv = {},
      files: { states?: unknown; registry?: unknown } = {},
      variantAxis: 'declared' | 'none' = 'declared',
    ): StubRun {
      const workdir = tempDir('verify-walk-walk-');
      const stubDir = path.join(workdir, 'bin');
      fs.mkdirSync(stubDir, { recursive: true });

      const stubFile = path.join(stubDir, 'agent-browser.cjs');
      fs.writeFileSync(stubFile, STUB_AGENT_BROWSER);
      // The shim hardcodes this interpreter rather than resolving `node` off the
      // PATH it is itself prepended to, so the stub cannot end up running under
      // whatever else that PATH happens to offer.
      fs.writeFileSync(path.join(stubDir, 'npx'),
        `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(stubFile)} "$@"\n`,
        { mode: 0o755 });

      const logFile = path.join(workdir, 'commands.log');
      fs.writeFileSync(logFile, '');

      const declared: string[] = [];
      if (files.states !== undefined) {
        const statesFile = path.join(workdir, 'states.json');
        fs.writeFileSync(statesFile, JSON.stringify(files.states));
        declared.push('--states', statesFile);
      }
      if (files.registry !== undefined) {
        const registryFile = path.join(workdir, 'variants.json');
        fs.writeFileSync(registryFile, JSON.stringify(files.registry));
        declared.push('--variants', 'registry', '--variant-registry', registryFile);
      }

      const axis = variantAxis === 'declared'
        ? ['--variants', 'alpha', '--variant-switcher', 'axis-switcher', '--variant-option', 'axis-option-{variant}']
        : [];

      const capdir = path.join(workdir, 'shots');
      const run = spawnSync(process.execPath, [
        driverPath(),
        // Answers the host probe without a port, exactly as in the eval test.
        '--host', 'data:text/plain,ok',
        '--capdir', capdir,
        ...axis,
        '--cdp-port', '1',
        '--ready-timeout', '5000',
        '--command-timeout', STUB_COMMAND_TIMEOUT_MS,
        ...declared,
        ...args,
      ], {
        encoding: 'utf8',
        timeout: DRIVER_TIMEOUT_MS,
        env: {
          ...process.env, ...env,
          PATH: `${stubDir}${path.delimiter}${process.env.PATH ?? ''}`,
          STUB_LOG: logFile,
          STUB_IDS: JSON.stringify(ids),
          STUB_VARIANT: path.join(workdir, 'active-variant'),
        },
      });

      // A driver killed at the bound above leaves no result to parse, and the
      // JSON.parse failure that follows says nothing about why. Named here.
      if (run.error) throw new Error(`the driver did not return: ${run.error.message}`);
      expectResultRecord(run);

      const coverageFile = path.join(capdir, 'verification-coverage.md');
      return {
        status: run.status,
        result: JSON.parse(run.stdout) as StubRun['result'],
        commands: fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean),
        coverage: fs.existsSync(coverageFile) ? fs.readFileSync(coverageFile, 'utf8') : '',
        capdir,
        workdir,
      };
    }

    // Every input-validation refusal has to happen on the arguments alone, so
    // these runs need no stub, no server and no browser: what they assert is
    // that the driver never got as far as one.
    function runRefusal(
      extra: string[],
      variantAxis: 'declared' | 'none' = 'declared',
      checkpointAxis: 'declared' | 'none' = 'declared',
    ): {
      status: number | null;
      failures: { stage: string; detail: string }[];
      capdirExists: boolean;
    } {
      const workdir = tempDir('verify-walk-args-');
      const capdir = path.join(workdir, 'shots');

      // As in runAgainstStub: a refusal that turns on an axis being declared in
      // part cannot be expressed by leaving flags out of `extra`, because this
      // helper supplies both axes whole by construction.
      const variants = variantAxis === 'declared'
        ? ['--variants', 'alpha', '--variant-switcher', 'axis-switcher', '--variant-option', 'axis-option-{variant}']
        : [];
      const points = checkpointAxis === 'declared'
        ? ['--checkpoints', 'orders:/orders:at-orders']
        : [];

      const run = spawnSync(process.execPath, [
        driverPath(),
        '--host', 'http://127.0.0.1:1',
        '--capdir', capdir,
        ...points,
        ...variants,
        ...extra,
      ], { encoding: 'utf8', timeout: DRIVER_TIMEOUT_MS });

      if (run.error) throw new Error(`the driver did not return: ${run.error.message}`);
      expectResultRecord(run);

      return {
        status: run.status,
        failures: (JSON.parse(run.stdout) as { failures: { stage: string; detail: string }[] }).failures,
        capdirExists: fs.existsSync(capdir),
      };
    }

    // Counted on unescaped pipes only, which is what a markdown reader treats as
    // a cell boundary: every row has to hold exactly the columns the header
    // declares, whatever text was written into it.
    function expectWholeRows(coverage: string): void {
      const cellBoundary = /(?<!\\)\|/;
      const lines = coverage.split('\n').filter(Boolean);
      const columns = lines[0].split(cellBoundary).length;
      // Past the header and its separator: every remaining line is a walk row.
      for (const row of lines.slice(2)) {
        expect(row.split(cellBoundary), `row "${row}" does not hold ${columns} cells`).toHaveLength(columns);
      }
    }

    // A host may key its controls by a whole composed identity rather than by a
    // short label, and such an identity is exactly what a `{checkpoint}` pattern
    // cannot spell.
    const ID_PREFIX = 'gts.frontx.mfes.ext.extension.v1~frontx.demo.area.main.v1~best';
    const LOGIN_ID = `${ID_PREFIX}.login.units.login.v1`;
    const TASKS_ID = `${ID_PREFIX}.tasks.units.tasks.v1`;
    const REPORTS_ID = `${ID_PREFIX}.reports.units.reports.v1`;
    const HOST_IDS = ['axis-switcher', 'axis-option-alpha', 'at-login', 'at-tasks', 'at-reports'];

    // Neither axis is a flag the driver requires, and a run that declares
    // neither is not a narrowed run: it walks whatever --host opens, once, and
    // both coverage cells say the axis was not exercised - a statement about
    // this run rather than a claim that the application has no such dimension.
    it('walks whatever the host opens, once, when neither axis is declared', () => {
      // Nothing on the page but the one handle this run waits for nowhere: a run
      // reaching for a switcher, an option or a point-selecting control would
      // fail here rather than pass quietly.
      const run = runAgainstStub([], ['nothing-the-walk-asks-for'], {}, {}, 'none');

      expect(run.result.failures).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.result.variantAxis).toEqual({ declared: false, source: null, variants: [] });
      expect(run.result.checkpointAxis).toEqual({ declared: false, reach: null, checkpoints: [] });

      // One pass over one point, and the point is the host's own origin: no path
      // was appended to it, because none was declared.
      expect(run.commands).toContain('open data:text/plain,ok');
      expect(run.result.variants).toHaveLength(1);
      expect(run.result.variants[0].captures).toEqual([
        { checkpoint: null, state: 'fresh', file: path.join(run.capdir, 'fresh.png'), readyConfirmed: false },
      ]);

      // The capture name carries neither axis's part, because there is no value
      // and no point to name it by and a placeholder would spell one the caller
      // never declared.
      expect(fs.readdirSync(run.capdir).sort()).toEqual([
        'fresh.png', 'verification-coverage.md', 'verify-walk.json',
      ]);

      expect(run.coverage).toContain('| Variant | Active | Checkpoint | States captured | Visually distinct from previous |');
      expect(run.coverage).toContain('| (none declared) | not-exercised (no variant axis was declared for this run)'
        + ' | not-exercised (no checkpoint axis was declared for this run)'
        + ' | fresh (fresh.png, ready unconfirmed)'
        + ' | not-compared (no variant axis was declared for this run) |');
      expectWholeRows(run.coverage);

    });

    // The checkpoint axis alone: the points are declared and no dimension is
    // repeated over them, which is the shape of a project that varies along
    // nothing the walk was asked to cover.
    it('walks every declared checkpoint once and records the variant axis as unexercised', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login,tasks:/tasks:at-tasks',
      ], ['at-login', 'at-tasks'], {}, {}, 'none');

      expect(run.result.failures).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.result.checkpointAxis.declared).toBe(true);
      expect(run.result.checkpointAxis.reach).toBe('destination');

      // One pass, carrying no value and no label confirmation. Null rather than
      // false on both: false reads as a confirmation that was attempted and
      // disagreed, which is a different outcome from one never asked for.
      expect(run.result.variants).toHaveLength(1);
      expect(run.result.variants[0].variant).toBeNull();
      expect(run.result.variants[0].labelConfirmed).toBeNull();
      expect(run.result.variants[0].captures.map((capture) => capture.checkpoint)).toEqual(['login', 'tasks']);

      expect(fs.readdirSync(run.capdir).sort()).toEqual([
        'login-fresh.png', 'tasks-fresh.png', 'verification-coverage.md', 'verify-walk.json',
      ]);

      // One row per point, each naming the axis that was not exercised.
      expect(run.coverage).toContain('| (none declared) | not-exercised (no variant axis was declared for this run) | login |');
      expect(run.coverage).toContain('| (none declared) | not-exercised (no variant axis was declared for this run) | tasks |');
      expectWholeRows(run.coverage);

    });

    // The variant axis alone: a dimension repeated over a walk that has one
    // place to stand. The comparison still has a pair, because the pair is per
    // point and the point is the same one in both passes.
    it('repeats an undeclared checkpoint axis once per variant, and compares the pair', () => {
      const run = runAgainstStub([
        '--variants', 'alpha,beta',
      ], [...HOST_IDS, 'axis-option-beta']);

      expect(run.result.failures).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.result.checkpointAxis.declared).toBe(false);
      expect(run.result.variants.map((variant) => variant.variant)).toEqual(['alpha', 'beta']);

      expect(fs.readdirSync(run.capdir).sort()).toEqual([
        'alpha-fresh.png', 'beta-fresh.png', 'verification-coverage.md', 'verify-walk.json',
      ]);
      expect(run.result.variants[1].comparisons).toEqual([{
        against: 'alpha',
        checkpoint: null,
        state: 'fresh',
        command: 'cmp -s alpha-fresh.png beta-fresh.png',
        exit: 1,
        verdict: 'differs',
      }]);
      expectWholeRows(run.coverage);

    });

    // Both axes declared: the rows are the cartesian product of the two, and a
    // column per point could never have expressed it - the points are the
    // caller's and their number is not known when the table is written.
    it('walks the cartesian product of both axes, one coverage row per pair', () => {
      const run = runAgainstStub([
        '--variants', 'alpha,beta',
        '--checkpoints', 'login:/login:at-login,tasks:/tasks:at-tasks',
      ], [...HOST_IDS, 'axis-option-beta']);

      expect(run.result.failures).toEqual([]);
      expect(run.status).toBe(0);

      expect(fs.readdirSync(run.capdir).sort()).toEqual([
        'alpha-login-fresh.png', 'alpha-tasks-fresh.png',
        'beta-login-fresh.png', 'beta-tasks-fresh.png',
        'verification-coverage.md', 'verify-walk.json',
      ]);

      // Four rows under one header, and the distinctness verdict rides on the
      // row of the point it was taken at rather than being crammed into one cell
      // beside every other point's.
      const rows = run.coverage.split('\n').filter(Boolean).slice(2);
      expect(rows).toHaveLength(4);
      expect(run.coverage).toContain('| alpha | verified | login | fresh (alpha-login-fresh.png, ready confirmed) | first variant |');
      expect(run.coverage).toContain('| beta | verified | tasks | fresh (beta-tasks-fresh.png, ready confirmed) | fresh: differs (cmp exit 1) |');
      expectWholeRows(run.coverage);

    });

    // Each axis is one declaration. A partial one has no honest reading: dropping
    // it discards a dimension the caller asked for, and walking it needs handles
    // the invocation never named. Refused on the arguments, like every other
    // invocation the driver cannot perform.
    it.each<[string, string[], 'declared' | 'none', 'declared' | 'none']>([
      ['a variant axis of the values alone', ['--variants', 'alpha'], 'none', 'declared'],
      ['a variant axis of the switcher alone', ['--variant-switcher', 'axis-switcher'], 'none', 'declared'],
      ['a variant axis of the option pattern alone', ['--variant-option', 'axis-option-{variant}'], 'none', 'declared'],
      ['a variant axis of a registry and nothing else', ['--variant-registry', '/nonexistent/variants.json'], 'none', 'declared'],
      ['a variant axis of a label map and nothing else', ['--variant-labels', 'alpha=Alpha'], 'none', 'declared'],
      ['a variant axis of the values and the switcher, without the option pattern',
        ['--variants', 'alpha', '--variant-switcher', 'axis-switcher'], 'none', 'declared'],
      ['a checkpoint axis of the selector alone', ['--checkpoint-selector', 'reach-{checkpoint}'], 'declared', 'none'],
    ])('refuses %s, before a browser is reached', (_what, declared, variantAxis, checkpointAxis) => {
      const run = runRefusal(declared, variantAxis, checkpointAxis);

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain('declare the whole axis or none of it');
      expect(run.capdirExists).toBe(false);

    });

    // A point with no destination is reached by clicking, and the first point of
    // a pass is additionally reached by the pass-boundary load of --host. A later
    // point with neither is a point nothing in the invocation can arrive at, and
    // walking on would capture whatever the previous point left on the page under
    // this one's name.
    it('refuses a later checkpoint that declares no destination when no selector was declared', () => {
      const run = runRefusal(['--checkpoints', 'login:/login:at-login,tasks'], 'none', 'none');

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain('checkpoint "tasks" declares no destination');
      expect(run.failures[0].detail).toContain('--checkpoint-selector');
      expect(run.capdirExists).toBe(false);

    });

    // How the walk moves between points is derived from what the caller
    // declared, not chosen from a closed set of names: declaring a selector is
    // what makes the walk click, and its absence is what makes each point load
    // at its own destination. Both readings are exercised here, because a driver
    // that clicked either way would pass a test of the click alone.
    it('loads each checkpoint at its destination when no selector is declared', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login,tasks:/tasks:at-tasks',
      ], HOST_IDS);

      expect(run.result.failures).toEqual([]);
      expect(run.result.checkpointAxis.reach).toBe('destination');
      expect(run.commands).toContain('open data:text/plain,ok/login');
      expect(run.commands).toContain('open data:text/plain,ok/tasks');
      // Nothing was resolved, because nothing was clicked to get anywhere.
      expect(run.result.checkpointResolution).toEqual([]);

    });

    it('clicks its way to every checkpoint after the first when a selector is declared', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login,tasks:/tasks:at-tasks',
        '--checkpoint-selector', 'reach-{checkpoint}',
      ], [...HOST_IDS, 'reach-login', 'reach-tasks']);

      expect(run.result.failures).toEqual([]);
      expect(run.result.checkpointAxis.reach).toBe('selector');
      // The first point still comes from a load: the reload is the pass boundary
      // reset, and a click cannot discard what the previous pass left behind.
      expect(run.commands).toContain('open data:text/plain,ok/login');
      expect(run.commands).not.toContain('click reach-login');
      expect(run.commands).toContain('click reach-tasks');
      expect(run.commands).not.toContain('open data:text/plain,ok/tasks');
      expect(run.result.checkpointResolution).toEqual([
        { checkpoint: 'tasks', testid: 'reach-tasks', handle: null, source: 'pattern' },
      ]);

    });

    // A point declared with no destination at all is reached by its selector,
    // including where it is the first point of the pass - the load of --host
    // lands wherever the application opens, which is that point only by
    // coincidence.
    it('clicks to the first checkpoint too when it declares no destination', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login::at-login',
        '--checkpoint-selector', 'reach-{checkpoint}',
      ], [...HOST_IDS, 'reach-login']);

      expect(run.result.failures).toEqual([]);
      expect(run.commands).toContain('open data:text/plain,ok');
      expect(run.commands).toContain('click reach-login');

    });

    // A host may key each control by a whole composed identity rather than by a
    // short label, and `{checkpoint}` cannot spell one: one run found the pattern
    // inexpressible, loaded each destination instead, and then owed every click
    // by hand.
    it('reaches a control keyed by a composed identity, discovered or declared', () => {
      const run = runAgainstStub([
        '--checkpoints', `login:/login:at-login,tasks:/tasks:at-tasks,reports:/reports:at-reports:${REPORTS_ID}`,
        '--checkpoint-selector', 'reach-{handle}',
      ], [...HOST_IDS, `reach-${LOGIN_ID}`, `reach-${TASKS_ID}`, `reach-${REPORTS_ID}`]);

      // The whole walk completes through those controls: this is the run that
      // previously had no expressible pattern at all.
      expect(run.result.failures).toEqual([]);
      expect(run.status).toBe(0);

      // `tasks` names no handle, so the driver reads the page's ids back and
      // keeps the one carrying "tasks" as a segment; `reports` declares its own
      // and costs no eval. Both are disclosed with the source they came from.
      expect(run.result.checkpointResolution).toEqual([
        { checkpoint: 'tasks', testid: `reach-${TASKS_ID}`, handle: TASKS_ID, source: 'discovered' },
        { checkpoint: 'reports', testid: `reach-${REPORTS_ID}`, handle: REPORTS_ID, source: 'declared' },
      ]);
      // The clicks landed on the full ids, not on anything derived from the
      // short name - which is the part a JSON record alone could not prove.
      expect(run.commands).toContain(`click reach-${TASKS_ID}`);
      expect(run.commands).toContain(`click reach-${REPORTS_ID}`);

    });

    // One candidate is the answer and anything else is a refusal: a wrong control
    // moves the page somewhere real, and every reading after it is a reading of
    // the wrong place under this checkpoint's name.
    it('refuses an ambiguous handle candidate set rather than picking the first of them', () => {
      const NEIGHBOUR_ID = `${ID_PREFIX}.tasks.units.tasks_archive.v1`;
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login,tasks:/tasks:at-tasks',
        '--checkpoint-selector', 'reach-{handle}',
      ], [...HOST_IDS, `reach-${LOGIN_ID}`, `reach-${TASKS_ID}`, `reach-${NEIGHBOUR_ID}`]);

      expect(run.status).not.toBe(0);

      const ambiguous = run.result.failures.filter((failure) => failure.stage === 'handle-resolve');
      expect(ambiguous).toHaveLength(1);
      expect(ambiguous[0].detail).toContain(TASKS_ID);
      expect(ambiguous[0].detail).toContain(NEIGHBOUR_ID);

      // Unresolved is disclosed as unresolved, and no control is clicked at all -
      // the failure mode a pick would produce is a click that landed.
      expect(run.result.checkpointResolution).toEqual([
        { checkpoint: 'tasks', testid: null, handle: null, source: 'unresolved' },
      ]);
      expect(run.commands.some((line) => line.startsWith('click reach-'))).toBe(false);
      expect(run.result.variants[0].captures.map((capture) => capture.checkpoint)).not.toContain('tasks');

    });

    // The coverage file is this step's stated deliverable: a report is filled
    // from it, and a run that composed one without writing the file left the
    // developer with the project and none of the record.
    it('writes the coverage rows to a file, with each capture and its readiness in the cell', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login,tasks:/tasks',
      ], HOST_IDS);

      expect(run.result.failures).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.result.coverageFile).not.toBeNull();

      expect(run.coverage).toContain('| Variant | Active | Checkpoint | States captured | Visually distinct from previous |');
      expect(run.coverage).toContain('| alpha | verified | login |');
      // A checkpoint declaring a ready handle is captured after that handle
      // appears; one declaring none is captured after a bare settle. A cell that
      // cannot tell them apart reports the weaker capture as the stronger one.
      expect(run.coverage).toContain('fresh (alpha-login-fresh.png, ready confirmed)');
      expect(run.coverage).toContain('fresh (alpha-tasks-fresh.png, ready unconfirmed)');
      expectWholeRows(run.coverage);

    });

    // A cell filled from a name the invocation supplied is a cell that name can
    // corrupt: one `|` in it closes the cell and shifts every column after it.
    it('escapes a pipe in a variant name instead of letting it close the cell', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
        // ONE variant whose name carries a pipe, not two variants. Its option testid
        // becomes `axis-option-alpha|beta`, which the stub's ids do not carry,
        // so the option click cannot be dispatched and the variant is recorded as
        // not-active. The pipe reaches the table through the variant-name cell and
        // through the control failure written beside it.
        '--variants', 'alpha|beta',
      ], HOST_IDS);

      expect(run.result.variants[0].labelConfirmed).toBe(false);
      expect(run.coverage).toContain('| alpha\\|beta |');
      expect(run.coverage).toContain('variant option for "alpha\\|beta" "axis-option-alpha\\|beta" was not clicked');
      expectWholeRows(run.coverage);

    });

    // The other side of the same cell: a pipe the page itself put into a reading
    // the table quotes back. The label of a value that never became active is written
    // into the row verbatim, so the page decides that text and not the caller.
    it('escapes a pipe read off the page instead of letting it close the cell', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
      ], HOST_IDS, { STUB_STICKY_VARIANT: 'al|pha' });

      expect(run.status).not.toBe(0);
      expect(run.result.variants[0].labelRead).toBe('Active: al|pha');
      expect(run.result.variants[0].labelConfirmed).toBe(false);
      // Escaped in the cell, unescaped in the JSON record: the table is what a
      // pipe corrupts, and the record is what a report reads the truth from.
      expect(run.coverage).toContain('not-active (label read "Active: al\\|pha")');
      expectWholeRows(run.coverage);

    });

    // A variant name out of a registry and a checkpoint name off the command line
    // both reach the capture path, and a name carrying path separators used to
    // resolve out of the run's own directory: `../escape` writes a level above the
    // capture directory, where nothing in this run is entitled to write and where
    // neither the byte-compare nor the coverage cells ever look. The name is
    // reduced to the file-name alphabet rather than refused, so the walk still
    // runs and the traversal is gone from the file it writes.
    it.each<[string, string[], string]>([
      ['a variant name', ['--variants', '../escape', '--checkpoints', 'login:/login:at-login'], 'escape-login-fresh.png'],
      ['a checkpoint name', ['--variants', 'alpha', '--checkpoints', '../login:/login:at-login'], 'alpha-login-fresh.png'],
    ])('confines a capture to the capture directory when %s carries a path traversal', (_what, declared, file) => {
      const run = runAgainstStub(declared,
        ['axis-switcher', 'axis-option-alpha', 'axis-option-../escape', 'at-login']);

      // The odd name costs the run nothing: the variant opens, and the capture is
      // taken and recorded like any other.
      expect(run.result.failures).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.result.variants[0].labelConfirmed).toBe(true);
      expect(run.result.variants[0].captures.map((capture) => capture.state)).toEqual(['fresh']);

      // Written inside the capture directory, under a name the traversal is
      // reduced out of rather than resolved through.
      expect(fs.readdirSync(run.capdir).sort()).toEqual([file, 'verification-coverage.md', 'verify-walk.json']);
      expect(run.coverage).toContain(`fresh (${file}, ready confirmed)`);
      // And nothing landed in the directory above it, which is where the
      // unreduced name pointed.
      expect(fs.readdirSync(run.workdir).filter((entry) => entry.endsWith('.png'))).toEqual([]);

    });

    // The whole native sequence, not a synthetic click: a control listening for
    // pointerdown sees nothing of a bare click() and the page stays as it was,
    // while the command still reports success.
    it('drives every click as the full native pointer sequence', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
      ], HOST_IDS);

      const sequences = run.commands.filter((line) => line.startsWith('events '));
      expect(sequences.length).toBeGreaterThan(0);
      for (const sequence of sequences) {
        expect(sequence).toBe('events pointerdown,mousedown,pointerup,mouseup,click');
      }

    });

    // Every declared control operation has to report as dispatched. Discarded,
    // the outcome let a single-variant run already showing the requested variant
    // pass with no variant option on the page at all: the label agreed, and
    // nothing had switched.
    it('fails the variant when a declared control is not on the page, naming the test id', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
        '--overlay-open', 'overlay-open',
        '--overlay-close', 'overlay-close',
        // The switcher is there and the label reads the same either way, which is
        // exactly how a missing option used to pass unnoticed.
      ], ['axis-switcher', 'at-login']);

      expect(run.status).not.toBe(0);

      const control = run.result.failures.filter((failure) => failure.stage === 'control');
      expect(control).toHaveLength(1);
      expect(control[0].detail).toContain('overlay-open');
      expect(control[0].detail).toContain('no control carries that data-testid');
      // Nothing is captured under a variant whose controls could not be operated.
      expect(run.result.variants[0].captures).toEqual([]);
      expect(run.coverage).toContain('not-active (overlay open control "overlay-open" was not clicked');

    });

    // Confirmation used to be a substring test over the label with its
    // punctuation stripped, so a set holding `dense` and `denser` confirmed
    // `dense` off a label reading "Denser" - and every capture in that block was
    // filed against a value that never became active. The requested name has to
    // occupy whole words of the label.
    it('does not confirm a variant off a label that merely carries its name inside another word', () => {
      const wrong = runAgainstStub([
        '--variants', 'dense',
        '--checkpoints', 'login:/login:at-login',
        // The option click dispatches, and the page goes on showing "denser".
      ], [...HOST_IDS, 'axis-option-dense'], { STUB_STICKY_VARIANT: 'denser' });

      expect(wrong.status).not.toBe(0);
      expect(wrong.result.variants[0].labelConfirmed).toBe(false);
      // The click landed, so this is not a control failure being reported: the
      // label is what refused the variant.
      expect(wrong.commands).toContain('click axis-option-dense');
      expect(wrong.result.failures.some((failure) => failure.stage === 'control')).toBe(false);

      const refused = wrong.result.failures.filter((failure) => failure.stage === 'variant-switch');
      expect(refused).toHaveLength(1);
      expect(refused[0].detail).toContain('Active: denser');
      // Nothing is captured or compared under a value that never became active.
      expect(wrong.result.variants[0].captures).toEqual([]);

      // The same rule still confirms the variant whose name the label does carry
      // as a word, so this is not a check that refuses everything.
      const right = runAgainstStub([
        '--variants', 'denser',
        '--checkpoints', 'login:/login:at-login',
      ], [...HOST_IDS, 'axis-option-denser'], { STUB_STICKY_VARIANT: 'denser' });

      expect(right.result.failures).toEqual([]);
      expect(right.status).toBe(0);
      expect(right.result.variants[0].labelConfirmed).toBe(true);
    });

    // Where one variant's words are a whole run of another's, every label naming
    // the longer one names the shorter one too. A confirmation cannot say which
    // variant opened, so the run is refused on the variant set alone rather than
    // filing captures under a guess.
    it('refuses a variant set holding two names one switcher label could name at once', () => {
      const run = runRefusal(['--variants', 'dense,dense grid']);

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain('cannot be told apart');
      expect(run.failures[0].detail).toContain('--variant-labels');
      // Refused on the arguments: no capture directory, no browser, no host.
      expect(run.capdirExists).toBe(false);

      // And a label declared per variant is the way out of it, so the refusal is a
      // gate rather than a dead end.
      const separated = runRefusal([
        '--variants', 'dense,dense grid',
        '--variant-labels', 'dense=Dense Classic,dense grid=Dense Grid',
      ]);

      expect(separated.failures.map((failure) => failure.stage)).toEqual(['host-probe']);
    });

    // The overlay controls are optional, and the one that closes it fails later
    // than the one that opens it: the label has already confirmed by then, so a
    // discarded close outcome leaves the variant reading as opened and its
    // captures carrying host chrome.
    it('fails the variant when the overlay close control is not on the page', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
        '--overlay-open', 'overlay-open',
        '--overlay-close', 'overlay-close',
      ], [...HOST_IDS, 'overlay-open']);

      expect(run.status).not.toBe(0);
      expect(run.result.variants[0].labelConfirmed).toBe(true);

      const control = run.result.failures.filter((failure) => failure.stage === 'control');
      expect(control).toHaveLength(1);
      expect(control[0].detail).toContain('overlay-close');
      expect(run.result.variants[0].captures).toEqual([]);

    });

    // Neither overlay flag is required, and a run that declares neither must
    // reach for no such control at all: a project with no chrome over its
    // surface is not a project this driver refuses.
    it('operates no overlay control when a run declares none', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
      ], HOST_IDS);

      expect(run.result.failures).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.result.variants[0].overlayClosed).toBeNull();
      expect(run.commands.filter((line) => line.startsWith('click '))).toEqual([
        'click axis-switcher', 'click axis-option-alpha',
      ]);

    });

    // "The page holds no such element" and "the script never ran" call for
    // different repairs, and collapsing both into absence is what sent a run
    // hunting a rendering race that did not exist.
    it('keeps a refused existence probe apart from an absent control', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
        '--overlay-open', 'overlay-open',
        '--overlay-close', 'overlay-close',
      ], [...HOST_IDS, 'overlay-open', 'overlay-close'], { STUB_EVAL_ERROR_PROBE: 'overlay-open' });

      expect(run.status).not.toBe(0);

      const overlay = run.result.failures.filter((failure) => failure.stage === 'overlay');
      expect(overlay).toHaveLength(1);
      expect(overlay[0].detail).toContain('could not be confirmed');
      expect(overlay[0].detail).toContain('the eval did not run');
      // Not false: the page was never asked, and a report cannot say the overlay
      // stayed open on the strength of a probe that did not run.
      expect(run.result.variants[0].overlayClosed).toBeNull();

    });

    // open and reload were fired and forgotten. A load that never happened
    // surfaced only as a readiness timeout a full budget later, and on a
    // checkpoint declared without a ready testid never at all - the walk carried
    // on capturing whatever was still on the page under the next point's name.
    it('fails a load loudly on the runner exit status, and files nothing under the checkpoint it never reached', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login,tasks:/tasks:at-tasks',
        '--checkpoint-selector', 'reach-{checkpoint}',
      ], [...HOST_IDS, 'reach-login', 'reach-tasks'], { STUB_FAIL_OPEN: '1' });

      expect(run.status).not.toBe(0);

      const reachErrors = run.result.failures.filter((failure) => failure.stage === 'reach-error');
      expect(reachErrors).toHaveLength(1);
      expect(reachErrors[0].detail).toContain('open data:text/plain,ok/login');
      expect(reachErrors[0].detail).toContain('net::ERR_CONNECTION_REFUSED');
      // The failure is caught where it happened, not one readiness budget later.
      expect(run.result.failures.some((failure) => failure.stage === 'ready')).toBe(false);

      // Nothing is filed under the point the page never reached; the point that
      // was reached is still walked, so one bad load does not cost the run its
      // other coverage.
      const captured = run.result.variants[0].captures.map((capture) => capture.checkpoint);
      expect(captured).not.toContain('login');
      expect(captured).toContain('tasks');

    });

    // The states file is where every read-back comes from, and a read-back that
    // cannot disagree is not one: the exit-code contract says every read-back
    // agreed, so a fill whose field took something else has to break it.
    it('records every declared read-back and passes the run when they all agree', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
      ], [...HOST_IDS, 'field-name', 'control-submit', 'readout-status'], {}, {
        states: {
          login: [{
            state: 'submitted',
            actions: [
              { kind: 'fill', testid: 'field-name', value: 'Grace' },
              { kind: 'click', testid: 'control-submit' },
              { kind: 'read', testid: 'readout-status', contains: 'text of readout-status' },
            ],
          }],
        },
      });

      expect(run.result.failures).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.result.variants[0].readBacks.map((back) => [back.action, back.ok])).toEqual([
        ['fill', true], ['click', true], ['read', true],
      ]);
      expect(run.commands).toContain('fill field-name Grace');
      expect(run.coverage).toContain('submitted (alpha-login-submitted.png, ready confirmed)');

    });

    // A states file addresses the points by name, and a run that declared no
    // checkpoint axis has no name for it to address. Said outright rather than
    // as a checkpoint the list does not name, which reads as a typo in a list
    // this invocation never carried.
    it('refuses a states file when the run declares no checkpoint axis to key it against', () => {
      const workdir = tempDir('verify-walk-states-');
      const statesFile = path.join(workdir, 'states.json');
      fs.writeFileSync(statesFile, JSON.stringify({
        login: [{ state: 'submitted', actions: [{ kind: 'click', testid: 'control-submit' }] }],
      }));

      const run = runRefusal(['--states', statesFile], 'none', 'none');

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain('declares no checkpoint axis to key against');
      expect(run.capdirExists).toBe(false);

    });

    // The other half of the sentinel: a `read` of a control the page does not
    // carry has to fail. It reads back the sentinel, and a check comparing
    // against anything else - a second literal one edit out of step, say - would
    // accept that reading and report the state as read.
    it('fails a read of a control the page does not carry', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
      ], HOST_IDS, {}, {
        states: {
          login: [{ state: 'submitted', actions: [{ kind: 'read', testid: 'readout-status' }] }],
        },
      });

      expect(run.status).not.toBe(0);

      const reads = run.result.failures.filter((failure) => failure.stage === 'read');
      expect(reads).toHaveLength(1);
      expect(reads[0].detail).toContain('readout-status');
      expect(run.result.variants[0].readBacks[0]).toMatchObject({
        action: 'read', testid: 'readout-status', actual: '__verify_walk_missing__', ok: false,
      });

    });

    // The sentinel is text, so a declared `contains` it happens to carry read an
    // absent control as a state that was read back: "missing" is a substring of
    // __verify_walk_missing__, the substring test passed on the sentinel itself,
    // and the coverage row claimed a reading of a control the page never held.
    it('fails a read of an absent control whose declared contains is a substring of the missing sentinel', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
      ], HOST_IDS, {}, {
        states: {
          login: [{
            state: 'submitted',
            actions: [{ kind: 'read', testid: 'readout-status', contains: 'missing' }],
          }],
        },
      });

      expect(run.status).not.toBe(0);

      const reads = run.result.failures.filter((failure) => failure.stage === 'read');
      expect(reads).toHaveLength(1);
      expect(reads[0].detail).toContain('readout-status');
      expect(run.result.variants[0].readBacks[0]).toMatchObject({
        action: 'read',
        testid: 'readout-status',
        expected: 'missing',
        actual: '__verify_walk_missing__',
        ok: false,
      });

    });

    // A value the read-back cannot return verbatim can never agree with itself,
    // so the run would exit non-zero over a value the field actually took. The
    // reading is the last non-empty line, trimmed, with surrounding quotes off,
    // and a declared value outside that shape is refused before a browser is
    // reached rather than discovered as a disagreement.
    it.each([
      ['a newline', 'first\nsecond'],
      ['leading whitespace', '  Grace'],
      ['trailing whitespace', 'Grace  '],
      ['wrapping quotes', '"Grace"'],
    ])('refuses a fill value carrying %s, on the arguments alone', (_what, value) => {
      const workdir = tempDir('verify-walk-fill-');
      const statesFile = path.join(workdir, 'states.json');
      fs.writeFileSync(statesFile, JSON.stringify({
        orders: [{ state: 'typed', actions: [{ kind: 'fill', testid: 'name', value }] }],
      }));

      const run = runRefusal(['--states', statesFile]);

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain('the read-back cannot confirm');
      expect(run.capdirExists).toBe(false);

    });

    it('fails the run when a fill reads back something other than what was typed', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
      ], [...HOST_IDS, 'field-name'], { STUB_FILL_DRIFT: '1' }, {
        states: {
          login: [{ state: 'submitted', actions: [{ kind: 'fill', testid: 'field-name', value: 'Grace' }] }],
        },
      });

      expect(run.status).not.toBe(0);

      const readBack = run.result.failures.filter((failure) => failure.stage === 'read-back');
      expect(readBack).toHaveLength(1);
      expect(readBack[0].detail).toContain('field-name');
      expect(readBack[0].detail).toContain('drift:Grace');
      expect(run.result.variants[0].readBacks[0].ok).toBe(false);

    });

    // The verdict is the comparison command's own exit code and nothing else.
    // Identical captures are a recorded fact: two registered variants can differ
    // only in tokens the captured surface never consumes, and a run that reported
    // them as visibly distinct claimed something it never saw.
    it('records identical captures as identical, from the comparison command exit code', () => {
      const run = runAgainstStub([
        '--variants', 'alpha,beta',
        '--checkpoints', 'login:/login:at-login',
      ], [...HOST_IDS, 'axis-option-beta'], { STUB_IDENTICAL_SHOTS: '1' });

      expect(run.result.failures).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.result.variants.map((variant) => [variant.variant, variant.labelConfirmed])).toEqual([
        ['alpha', true], ['beta', true],
      ]);
      expect(run.result.variants[1].comparisons).toEqual([{
        against: 'alpha',
        checkpoint: 'login',
        state: 'fresh',
        command: 'cmp -s alpha-login-fresh.png beta-login-fresh.png',
        exit: 0,
        verdict: 'identical',
      }]);
      expect(run.coverage).toContain('fresh: identical (cmp exit 0)');

    });

    it('records a differing pair as differs, from that same exit code', () => {
      const run = runAgainstStub([
        '--variants', 'alpha,beta',
        '--checkpoints', 'login:/login:at-login',
      ], [...HOST_IDS, 'axis-option-beta']);

      expect(run.result.failures).toEqual([]);
      expect(run.result.variants[1].comparisons.map((cmp) => [cmp.verdict, cmp.exit])).toEqual([['differs', 1]]);
      expect(run.coverage).toContain('fresh: differs (cmp exit 1)');

    });

    // Provenance: a report claiming the set came from the host's own
    // registration of that dimension is a claim this field either backs or
    // contradicts.
    it('records a variant set read from a registry file as coming from that file', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
      ], [...HOST_IDS, 'axis-option-beta'], {}, { registry: { variants: ['alpha', 'beta'] } });

      expect(run.result.failures).toEqual([]);
      expect(run.result.variantAxis.variants).toEqual(['alpha', 'beta']);
      expect(run.result.variantAxis.source?.startsWith('registry:')).toBe(true);
      expect(run.result.variantAxis.source?.endsWith('variants.json')).toBe(true);

    });

    // The one hang the driver could not survive: every browser interaction is a
    // child process, and an unbounded one blocks the walk forever on a runner
    // that stopped answering.
    it('kills a browser command that never returns, and records it as a timeout', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
        '--command-timeout', '800',
      ], HOST_IDS, { STUB_HANG: '1' });

      expect(run.status).not.toBe(0);

      const timeouts = run.result.failures.filter((failure) => failure.stage === 'timeout');
      expect(timeouts.length).toBeGreaterThan(0);
      expect(timeouts[0].detail).toContain('killed after 800ms');
      expect(run.result.variants[0].captures).toEqual([]);

    });

    // --browser-cmd may name an installed binary, and an installed binary's path
    // carries spaces: a whitespace split cuts
    // "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" into four
    // pieces that name nothing, and every browser command then fails to spawn.
    // The quoted path stays one argument, and what follows it stays an argument of
    // its own rather than being glued onto the path.
    it('drives a --browser-cmd whose quoted path carries spaces, keeping the rest as separate arguments', () => {
      const workdir = tempDir('verify-walk-browser-cmd-');
      const spaced = path.join(workdir, 'dir with space');
      fs.mkdirSync(spaced, { recursive: true });
      const stubFile = path.join(spaced, 'agent-browser.cjs');
      fs.writeFileSync(stubFile, STUB_AGENT_BROWSER);
      const logFile = path.join(workdir, 'commands.log');
      fs.writeFileSync(logFile, '');

      // Records the argument handed to it after the path and then drops it, so
      // what the stub itself sees is the argv shape the PATH shim produces
      // everywhere else in this suite. Both halves of the assertion come out of
      // that: the flag arrived on its own, and the whole walk ran through a
      // launcher whose path a split would have destroyed.
      const launcher = path.join(spaced, 'browser launcher');
      fs.writeFileSync(launcher,
        `#!/bin/sh\nprintf 'launched with %s\\n' "$1" >> ${JSON.stringify(logFile)}\nshift\n`
        + `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(stubFile)} --yes agent-browser "$@"\n`,
        { mode: 0o755 });

      const capdir = path.join(workdir, 'shots');
      const run = spawnSync(process.execPath, [
        driverPath(),
        '--host', 'data:text/plain,ok',
        '--variants', 'alpha',
        '--checkpoints', 'login:/login:at-login',
        '--capdir', capdir,
        '--variant-switcher', 'axis-switcher',
        '--variant-option', 'axis-option-{variant}',
        '--cdp-port', '1',
        '--ready-timeout', '5000',
        '--command-timeout', STUB_COMMAND_TIMEOUT_MS,
        // The launcher is reached by the path alone, so this run needs no stub on
        // PATH at all: what is under test is the driver's reading of the value.
        '--browser-cmd', `"${launcher}" --forwarded`,
      ], {
        encoding: 'utf8',
        timeout: DRIVER_TIMEOUT_MS,
        env: {
          ...process.env,
          STUB_LOG: logFile,
          STUB_IDS: JSON.stringify(HOST_IDS),
          STUB_VARIANT: path.join(workdir, 'active-variant'),
        },
      });

      if (run.error) throw new Error(`the driver did not return: ${run.error.message}`);
      expectResultRecord(run);

      const result = JSON.parse(run.stdout) as StubRun['result'];
      expect(result.failures).toEqual([]);
      expect(run.status).toBe(0);
      expect(result.browser.command).toBe(`${launcher} --forwarded`);

      const commands = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
      expect(commands).toContain('launched with --forwarded');
      expect(commands).toContain('screenshot alpha-login-fresh.png');

    });

    // Either way of closing an unbalanced quote - dropping it, or ending the
    // token where it opened - spawns a command line the caller did not write, so
    // the invocation is refused instead of guessed at.
    it('refuses a --browser-cmd carrying an unbalanced quote', () => {
      const run = runRefusal(['--browser-cmd', '"/tmp/dir with space/stub --flag']);

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain('unbalanced double quote');
      expect(run.capdirExists).toBe(false);

    });

    // A --browser-cmd naming nothing is the one reading of this flag that cannot
    // be answered by a failed browser call: an empty command file reaches
    // spawnSync as ERR_INVALID_ARG_VALUE, thrown out of the first browser
    // interaction and past the validation that records a refusal, so the caller
    // gets a stack trace instead of a result record. Whitespace alone tokenizes
    // to no tokens; a quoted empty command to one token that is empty, which the
    // token count the tokenizer used to be trusted for cannot see.
    it.each([
      ['whitespace alone', '   '],
      ['a quoted empty command', '""'],
      ['a quoted empty command carrying flags', "'' --headless"],
    ])('refuses a --browser-cmd that is %s, before a browser is reached', (_what, value) => {
      const run = runRefusal(['--browser-cmd', value]);

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain('--browser-cmd');
      expect(run.failures[0].detail).toContain('names no command to run');
      expect(run.capdirExists).toBe(false);

    });

    // The result has to reach the caller even when the path it was asked for
    // cannot be written: a record that went nowhere is indistinguishable from a
    // run that never happened.
    it('still prints its result, and says so, when the output path cannot be written', () => {
      const run = runAgainstStub([
        '--checkpoints', 'login:/login:at-login',
        // A path under a file rather than a directory: the mkdir fails ENOTDIR.
        '--json-out', '/dev/null/nope/verify-walk.json',
      ], HOST_IDS);

      expect(run.status).not.toBe(0);
      expect(run.result.ok).toBe(false);
      const output = run.result.failures.filter((failure) => failure.stage === 'output');
      expect(output).toHaveLength(1);
      expect(output[0].detail).toContain('/dev/null/nope/verify-walk.json');

    });

    // A capture directory shared with an earlier run leaves that run's files
    // exactly where this one goes looking, and neither the byte-compare nor the
    // coverage cells can tell which run wrote a file they address by name.
    it('refuses a capture directory that already holds files, before reaching the host', () => {
      const workdir = tempDir('verify-walk-capdir-');
      fs.writeFileSync(path.join(workdir, 'alpha-orders-fresh.png'), 'an earlier run left this');

      const run = spawnSync(process.execPath, [
        driverPath(),
        '--host', 'http://127.0.0.1:1',
        '--variants', 'alpha',
        '--checkpoints', 'orders:/orders:at-orders',
        '--capdir', workdir,
        '--variant-switcher', 'axis-switcher',
        '--variant-option', 'axis-option-{variant}',
      ], { encoding: 'utf8', timeout: DRIVER_TIMEOUT_MS });

      expect(run.status).not.toBe(0);
      expectResultRecord(run);

      const parsed = JSON.parse(run.stdout) as { failures: { stage: string; detail: string }[] };
      expect(parsed.failures.map((failure) => failure.stage)).toEqual(['capdir']);
      expect(parsed.failures[0].detail).toContain('already holds files');
      // The earlier run's file is still there: the refusal writes nothing over it.
      expect(fs.readdirSync(workdir)).toEqual(['alpha-orders-fresh.png']);

    });

    // Unvalidated, `--ready-timeout nope` made the readiness deadline NaN and
    // the poll asked every 400ms forever, printing nothing and ending never.
    // The same class reached the debugging port. Each is refused on the
    // arguments alone, before a directory exists or a browser is reached.
    it.each([
      ['--ready-timeout', 'nope'],
      ['--ready-timeout', '0'],
      ['--cdp-port', '99999'],
      ['--cdp-port', '1.5'],
      ['--command-timeout', 'soon'],
    ])('refuses %s "%s" as an arguments failure and creates nothing', (flag, value) => {
      const run = runRefusal([flag, value]);

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain(flag);
      expect(run.capdirExists).toBe(false);

    });

    // A pattern that substitutes nothing clicks one same control for every variant
    // or every checkpoint, which reads as a walk that covered all of them.
    it.each<[string, string[]]>([
      ['{variant}', ['--variants', 'alpha,beta', '--variant-option', 'axis-option-alpha']],
      ['{checkpoint}', ['--checkpoints', 'login:/login,tasks:/tasks', '--checkpoint-selector', 'reach-login']],
    ])('refuses a pattern carrying no %s placeholder when it has to vary', (token, extra) => {
      const run = runRefusal(extra);

      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain(token);

    });

    // A declared input file that is missing, malformed, or holds the wrong shape
    // used to throw out of the top level: no result record, no coverage row, and
    // a stack trace where the run's own account of itself belongs.
    it.each<[string, string, string | null]>([
      ['--variant-registry', 'is absent', null],
      ['--variant-registry', 'is not JSON', '{ variants: [alpha] '],
      ['--variant-registry', 'holds a null variant list', '{ "variants": null }'],
      ['--variant-registry', 'lists something that is not a variant name', '{ "variants": [7] }'],
      ['--states', 'is absent', null],
      ['--states', 'is not JSON', '{'],
      ['--states', 'holds a non-array under a checkpoint', '{ "orders": { "state": "submitted" } }'],
      ['--states', 'holds an action of an unknown kind', '{ "orders": [{ "state": "submitted", "actions": [{ "kind": "tap", "testid": "x" }] }] }'],
      ['--states', 'holds a fill with no value to type', '{ "orders": [{ "state": "submitted", "actions": [{ "kind": "fill", "testid": "x" }] }] }'],
      ['--states', 'names a checkpoint the walk never visits', '{ "checkout": [] }'],
    ])('refuses a %s file that %s', (flag, _situation, content) => {
      const inputDir = tempDir('verify-walk-input-');
      const file = path.join(inputDir, 'input.json');
      if (content !== null) fs.writeFileSync(file, content);

      const run = runRefusal(flag === '--variant-registry'
        ? ['--variants', 'registry', '--variant-registry', file]
        : ['--states', file]);

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain(file);
      expect(run.capdirExists).toBe(false);

    });

    // Reducing a name to the file-name alphabet is what keeps a traversal out of
    // the capture path, and it can map two names the invocation tells apart onto
    // one file: the second capture overwrites the first, and both coverage cells
    // go on claiming a capture of their own. Refused on the arguments, so no
    // capture is taken under a name that cannot be told from another.
    it('refuses two declared names that reduce to one capture file name', () => {
      const run = runRefusal(['--checkpoints', 'my point:/a:at-login,my-point:/b:at-login'], 'declared', 'none');

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toContain('alpha-my-point-fresh.png');
      expect(run.failures[0].detail).toContain('my point');
      expect(run.capdirExists).toBe(false);

    });

    // A malformed argument list used to print help text on stderr, exit 2 and
    // leave stdout empty - the one shape a caller cannot act on, because it reads
    // exactly like a driver that died before it could say anything. A refusal on
    // the argument list is a refusal like every other, so it carries a record.
    it.each<[string, string[], string]>([
      ['an unknown flag', ['--nope', 'x'], 'unknown argument "--nope"'],
      ['a flag left without a value', ['--checkpoint-selector'], '--checkpoint-selector needs a value'],
    ])('records %s as an arguments failure in its result record', (_what, argv, detail) => {
      const run = runRefusal(argv);

      expect(run.status).not.toBe(0);
      expect(run.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(run.failures[0].detail).toBe(detail);
      expect(run.capdirExists).toBe(false);

    });

    // The same for a required flag that is not there at all, which needs an
    // invocation the refusal helper above cannot make: it supplies every required
    // flag by construction.
    it('records a missing required flag as an arguments failure in its result record', () => {
      // Inside a directory this test just made, so the closing assertion that the
      // driver created nothing is about the driver and not about whatever else on
      // the machine may hold a fixed path.
      const capdir = path.join(tempDir('verify-walk-missing-'), 'shots');
      const run = spawnSync(process.execPath, [
        driverPath(),
        '--variants', 'alpha',
        '--checkpoints', 'orders:/orders:at-orders',
        '--capdir', capdir,
        '--variant-switcher', 'axis-switcher',
        '--variant-option', 'axis-option-{variant}',
      ], { encoding: 'utf8', timeout: DRIVER_TIMEOUT_MS });

      if (run.error) throw new Error(`the driver did not return: ${run.error.message}`);
      expectResultRecord(run);

      const parsed = JSON.parse(run.stdout) as { ok: boolean; failures: { stage: string; detail: string }[] };
      expect(run.status).not.toBe(0);
      expect(parsed.ok).toBe(false);
      expect(parsed.failures.map((failure) => failure.stage)).toEqual(['arguments']);
      expect(parsed.failures[0].detail).toBe('missing required argument --host');
      // The flag surface still reaches a human, on the channel the record does not
      // use: stdout carries the record and nothing else, so a caller parsing it
      // never has to step over help text.
      expect(run.stderr).toContain('--host <url>');
      expect(fs.existsSync(capdir)).toBe(false);
    });
  });
});
