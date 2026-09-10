import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Guards the AI docs layer: every component ships a colocated usage doc, is
// indexed in llms.txt, and the doc mentions every value of every cva styling
// axis the component's CSS module actually defines (naming convention:
// `.<axis>Xxx`, e.g. `.variantOutline` / `.sizeSm` / `.shapePlain` /
// `.densityCompact`). AXES lists the axis names in use across the kit —
// extend it when a component introduces a new one, or its values ship
// undocumented.

const srcDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(srcDir, '..');
const componentsDir = join(srcDir, 'components');
const components = readdirSync(componentsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const llms = readFileSync(join(packageRoot, 'llms.txt'), 'utf8');

const AXES = ['variant', 'size', 'shape', 'density', 'tone'] as const;

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

describe.each(components)('%s docs', (name) => {
  const dir = join(componentsDir, name);

  it('has a colocated usage doc', () => {
    expect(() => readFileSync(join(dir, `${name}.md`), 'utf8')).not.toThrow();
  });

  it('is indexed in llms.txt', () => {
    expect(llms).toContain(`dist/docs/${name}.md`);
  });

  it('documents every styling-axis value from the CSS module', () => {
    const doc = readFileSync(join(dir, `${name}.md`), 'utf8');
    const css = readFileSync(join(dir, `${name}.module.css`), 'utf8');
    const tokens = Array.from(
      css.matchAll(new RegExp(`\\.(?:${AXES.join('|')})([A-Z][A-Za-z0-9]*)`, 'g')),
      (match) => lowerFirst(match[1] ?? ''),
    );
    for (const token of Array.from(new Set(tokens))) {
      expect(doc, `"${token}" is missing from ${name}.md`).toContain(token);
    }
  });
});
