import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declarationMap, extractRules } from '../../__test-utils__/css-rules';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import styles from './select.module.css';

afterEach(cleanup);

// Parsed once from the raw CSS source (not the hashed `styles` import, which
// has no values left in it) so both the padding-ownership test below and the
// scroll-arrow describe block can read declared property values directly.
const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'select.module.css');
const cssRules = extractRules(readFileSync(cssPath, 'utf8'));

function declaredValue(leadingClass: string, prop: string): string | undefined {
  const rule = cssRules.find((candidate) => candidate.selector.split(',')[0]?.trim() === leadingClass);
  return rule ? declarationMap(rule.body).get(prop) : undefined;
}

const ITEMS = [
  { value: 'eu', label: 'Europe' },
  { value: 'us', label: 'Americas' },
];

function renderSelect(rootProps: Parameters<typeof Select>[0] = {}) {
  return render(
    <Select items={ITEMS} {...rootProps}>
      <SelectTrigger aria-label="Region">
        <SelectValue placeholder="Pick a region" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="eu">Europe</SelectItem>
          <SelectItem value="us">Americas</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>,
  );
}

describe('Select', () => {
  it('renders a closed trigger with the placeholder and kit classes', () => {
    renderSelect();
    const trigger = screen.getByRole('combobox', { name: 'Region' });
    expect(trigger.className).toContain(styles.trigger);
    expect(trigger.className).toContain(styles.sizeDefault);
    // The negative half of the variant axis: `.variantFilter` overrides
    // `.sizeDefault`'s height by source order, so a regression that applied
    // the class unconditionally would silently shrink every default trigger
    // from 40px to 36px while the positive test below kept passing.
    expect(trigger.className).not.toContain(styles.variantFilter);
    expect(trigger.textContent).toContain('Pick a region');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows options when open and marks items with kit classes', () => {
    renderSelect({ defaultOpen: true });
    expect(screen.getByRole('listbox')).toBeTruthy();
    const option = screen.getByRole('option', { name: 'Europe' });
    expect(option.className).toContain(styles.item);
  });

  it('selects an option and reports through onValueChange', () => {
    const onValueChange = vi.fn();
    renderSelect({ defaultOpen: true, onValueChange });
    const option = screen.getByRole('option', { name: 'Europe' });
    // Base UI commits a mouse selection only when the click started on the
    // item (guards against a stray pointerup landing on an item that wasn't
    // clicked), so the pointerdown must precede the click.
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe('eu');
  });

  it('renders the selected value in the trigger', () => {
    renderSelect({ defaultValue: 'us' });
    expect(screen.getByRole('combobox', { name: 'Region' }).textContent).toContain('Americas');
  });

  it('portals the popup into a provided container', () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <Select items={ITEMS} defaultOpen>
        <SelectTrigger aria-label="Region">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent container={container}>
          <SelectGroup>
            <SelectItem value="eu">Europe</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    const listbox = screen.getByRole('listbox');
    expect(container.contains(listbox)).toBe(true);
    container.remove();
  });

  it('applies the sm trigger size', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Compact" size="sm">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="a">A</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'Compact' }).className).toContain(styles.sizeSm);
  });

  it('applies the filter trigger variant', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Status filter" variant="filter">
          <SelectValue placeholder="Filter" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="a">A</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Status filter' });
    expect(trigger.className).toContain(styles.variantFilter);
    // The prop is a styling axis, not a DOM attribute.
    expect(trigger.hasAttribute('variant')).toBe(false);
  });

  it('pads the list directly, so items placed without a SelectGroup are still inset', () => {
    render(
      <Select items={ITEMS} defaultOpen>
        <SelectTrigger aria-label="Region">
          <SelectValue placeholder="Pick a region" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="eu">Europe</SelectItem>
          <SelectItem value="us">Americas</SelectItem>
        </SelectContent>
      </Select>,
    );
    const listbox = screen.getByRole('listbox');
    expect(listbox.className).toContain(styles.list);
    // The class assertion above would still pass if `.list` lost its
    // padding — `styles.list` is just a name. Pin the actual behaviour this
    // test is named for: the list owns the dropdown's inset, and .group
    // carries none of it, so a groupless list stays padded either way.
    expect(declaredValue('.list', 'padding'), '.list should own the dropdown padding').toBe(
      'var(--space-1)',
    );
    expect(
      declaredValue('.group', 'padding'),
      '.group should not duplicate the padding .list already owns',
    ).toBeUndefined();
  });

  it('always opens the popup below the trigger, with no align-with-trigger attribute', () => {
    renderSelect({ defaultOpen: true });
    const popup = screen.getByRole('listbox').closest(`.${styles.popup}`);
    expect(popup).not.toBeNull();
    // The retired overlay mode's attribute is gone entirely (not set to
    // "false") — kept as a regression guard against the prop coming back.
    expect(popup?.hasAttribute('data-align-trigger')).toBe(false);
    // What's actually load-bearing: this kit pins `alignItemWithTrigger=
    // {false}` unconditionally (select.tsx), so Base UI's resolved side is
    // never overridden to 'none' (its overlay-mode value) and always
    // reflects the real positioning result. jsdom computes no layout, so
    // floating-ui never has a reason to flip off the requested `side`
    // default ('bottom') — this is the one placement outcome that's both
    // genuinely computed by the library under jsdom and would go stale
    // (stuck at 'none') if the kit ever went back to overlay mode.
    expect(popup?.getAttribute('data-side')).toBe('bottom');
  });
});

/*
 * jsdom computes no layout, so the scroll-arrow behavior itself (does the
 * list actually scroll and clear the selected item, do the arrows mount at
 * the right edges) can only be verified in a real browser, not here.
 * `.list` and `.scrollArrow` both read a single
 * `--select-scroll-arrow-height` declared once on `.popup` (see
 * select.module.css), so there is no second copy to drift. What IS worth
 * guarding statically, because nothing about it involves layout, is the
 * box-sizing below.
 */
describe('Select scroll-arrow height', () => {
  // Without this, the height above is a content-box size and .scrollArrow's
  // own padding would add on top of it, rendering the arrow taller than the
  // scroll padding .list reserves for it.
  it('keeps .scrollArrow border-box so its height absorbs its own padding', () => {
    expect(declaredValue('.scrollArrow', 'box-sizing')).toBe('border-box');
  });
});
