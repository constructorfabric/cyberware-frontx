import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Which components ship a `'use client'` banner is a fact about the source
 * — one directive per file — that four other places restate in prose or in
 * a bash array. They had all drifted: README.md and llms.txt each named
 * three components, buildPlugin.ts's comment named five, and
 * verify-consumer.sh's CLIENT_COMPONENTS (the one list a script actually
 * reads) named fifteen.
 *
 * The directives are the only source of truth here. buildPlugin.ts no
 * longer restates them at all (it reads the directive itself), and every
 * remaining copy is checked against them below, so a component that gains
 * or loses its banner fails this test instead of quietly leaving three
 * documents wrong.
 */

const srcDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(srcDir, '..');
const componentsDir = join(srcDir, 'components');

/**
 * Whether a module's FIRST statement is the directive — a directive is only
 * a directive there, so a mention of the same text anywhere else in the
 * file must not count. Skips one leading whitespace run, line comment, or
 * block comment at a time; see buildPlugin.ts's own copy for why this is a
 * loop rather than the obvious single regex (that shape backtracks
 * catastrophically on a heavily commented file).
 */
function hasClientDirective(code: string): boolean {
  let rest = code;
  for (;;) {
    const skipped = /^\s+|^\/\/[^\n]*|^\/\*[\s\S]*?\*\//.exec(rest);
    if (!skipped) {
      break;
    }
    rest = rest.slice(skipped[0].length);
  }
  return /^['"]use client['"];?/.test(rest);
}

function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

const clientComponents = readdirSync(componentsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) =>
    readdirSync(join(componentsDir, name))
      .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
      .filter((file) => !file.includes('.test.'))
      .some((file) => hasClientDirective(readFileSync(join(componentsDir, name, file), 'utf8'))),
  )
  .sort();

/**
 * The one sentence README.md and llms.txt each spell the list out in.
 * Anchored on its own wording so a reflow (or an edit elsewhere in either
 * document) cannot move it: everything from the anchor to the sentence's
 * full stop is the list.
 */
const LIST_SENTENCE = /carry a `'use client'` banner of their own:\s*([^.]+)\./;

function documentedNames(file: string): string[] {
  const text = readFileSync(join(packageRoot, file), 'utf8');
  const match = LIST_SENTENCE.exec(text);
  expect(match, `${file} no longer carries the client-component list sentence`).not.toBeNull();
  return (match?.[1] ?? '')
    .split(',')
    .map((name) => name.replace(/\s+/g, ' ').trim())
    .sort();
}

describe('client boundaries', () => {
  it('finds the components whose source declares the directive', () => {
    // A floor, not the list itself: the assertions below compare against
    // whatever the source says, and would all pass vacuously against an
    // empty result if the directive scan ever silently stopped matching.
    expect(clientComponents.length).toBeGreaterThan(10);
  });

  it("matches verify-consumer.sh's CLIENT_COMPONENTS", () => {
    const script = readFileSync(join(packageRoot, 'scripts', 'verify-consumer.sh'), 'utf8');
    const declared = /^CLIENT_COMPONENTS=\(([^)]*)\)/m.exec(script)?.[1];
    expect(declared, 'CLIENT_COMPONENTS is no longer a single-line bash array').toBeDefined();
    expect((declared ?? '').trim().split(/\s+/).sort()).toEqual(clientComponents);
  });

  it.each(['README.md', 'llms.txt'])('matches the list documented in %s', (file) => {
    expect(documentedNames(file)).toEqual(clientComponents.map(toPascalCase).sort());
  });
});
