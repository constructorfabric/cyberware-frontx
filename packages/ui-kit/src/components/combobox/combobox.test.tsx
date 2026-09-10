import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractRules } from '../../__test-utils__/css-rules';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxValue,
  useComboboxAnchor,
} from './combobox';
import styles from './combobox.module.css';

afterEach(cleanup);

// Parsed once from the raw CSS source, same shape as select.test.tsx — only
// used here to confirm the module actually defines a class this test
// asserts on, not to read declared values (no padding-ownership test needed
// for this file).
const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'combobox.module.css');
const cssRules = extractRules(readFileSync(cssPath, 'utf8'));

const REGIONS = ['Europe', 'Americas'];

function renderCombobox(rootProps: Parameters<typeof Combobox>[0] = {}) {
  return render(
    <Combobox items={REGIONS} {...rootProps}>
      <ComboboxInput aria-label="Region" placeholder="Pick a region" />
      <ComboboxContent>
        <ComboboxEmpty>No regions found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>,
  );
}

describe('Combobox', () => {
  it('renders a closed input with the placeholder and kit classes', () => {
    renderCombobox();
    const input = screen.getByRole('combobox', { name: 'Region' });
    expect(input.className).toContain(styles.input);
    expect(input.getAttribute('placeholder')).toBe('Pick a region');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens the popup via the trigger button', () => {
    renderCombobox();
    const trigger = screen.getByRole('button', { name: 'Toggle options' });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('filters items as the user types, and applies the kit item class', () => {
    renderCombobox({ defaultOpen: true });
    const input = screen.getByRole('combobox', { name: 'Region' });
    fireEvent.change(input, { target: { value: 'Euro' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toBe('Europe');
    expect(options[0]?.className).toContain(styles.item);
  });

  it('renders the Empty part when filtering matches nothing', () => {
    renderCombobox({ defaultOpen: true });
    const input = screen.getByRole('combobox', { name: 'Region' });
    fireEvent.change(input, { target: { value: 'zz-no-match' } });
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByText('No regions found.').className).toContain(styles.empty);
  });

  it('selects an option and reports through onValueChange', () => {
    const onValueChange = vi.fn();
    renderCombobox({ defaultOpen: true, onValueChange });
    const option = screen.getByRole('option', { name: 'Europe' });
    // Base UI commits a mouse selection only when the click started on the
    // item (guards against a stray pointerup landing on an item that wasn't
    // clicked), so the pointerdown must precede the click — same guard as
    // select.test.tsx's equivalent case.
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toBe('Europe');
  });

  it('closes the popup on Escape', () => {
    renderCombobox({ defaultOpen: true });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Region' }), {
      key: 'Escape',
      code: 'Escape',
    });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('applies the kit group/label/separator classes', () => {
    render(
      <Combobox items={[{ value: 'eu', label: 'Europe' }]} defaultOpen>
        <ComboboxInput aria-label="Region" />
        <ComboboxContent>
          <ComboboxEmpty>No regions found.</ComboboxEmpty>
          <ComboboxList>
            <ComboboxGroup>
              <ComboboxLabel>Europe</ComboboxLabel>
              <ComboboxItem value="eu">Frankfurt</ComboboxItem>
            </ComboboxGroup>
            <ComboboxSeparator />
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    );
    expect(screen.getByText('Europe', { selector: `.${styles.groupLabel}` })).toBeTruthy();
    const separator = document.querySelector(`.${styles.separator}`);
    expect(separator).not.toBeNull();
  });

  it('portals the popup into a provided container', () => {
    const container = document.createElement('div');
    container.id = 'themed-section';
    document.body.appendChild(container);
    render(
      <Combobox items={REGIONS} defaultOpen>
        <ComboboxInput aria-label="Region" />
        <ComboboxContent container={container}>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    );
    const listbox = screen.getByRole('listbox');
    expect(container.contains(listbox)).toBe(true);
    container.remove();
  });

  // Two independent renders, not one render()+rerender(): Base UI warns
  // (correctly) if a combobox switches between uncontrolled and controlled
  // across its own lifetime, which passing `value` on a second render of the
  // same instance would trigger.
  it('shows no clear button while uncontrolled and empty', () => {
    render(
      <Combobox items={REGIONS}>
        <ComboboxInput aria-label="Region" showClear />
        <ComboboxContent>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    );
    expect(screen.getByRole('button', { name: 'Toggle options' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear value' })).toBeNull();
  });

  it('shows the clear button once a value is chosen', () => {
    render(
      <Combobox items={REGIONS} defaultValue="Europe">
        <ComboboxInput aria-label="Region" showClear />
        <ComboboxContent>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    );
    // Clear mounts (Base UI's default keepMounted={false} means it isn't in
    // the DOM at all without a value) — CSS then hides the trigger in the
    // same slot (see combobox.module.css's :has() rule, checked separately
    // below since jsdom computes no layout to observe it through).
    expect(screen.getByRole('button', { name: 'Clear value' })).toBeTruthy();
  });

  // The three buttons this component renders are icon-only, so these
  // strings ARE their accessible names — hardcoding them made an English
  // combobox the only one the kit could ship.
  it('takes an override for every label it renders itself', () => {
    render(
      <Combobox multiple items={REGIONS} defaultValue={['Europe']}>
        <ComboboxChips>
          <ComboboxChip removeLabel="Entfernen">Europe</ComboboxChip>
          <ComboboxChipsInput aria-label="Region" />
        </ComboboxChips>
        <ComboboxInput
          aria-label="Region"
          showClear
          toggleLabel="Optionen umschalten"
          clearLabel="Auswahl löschen"
        />
      </Combobox>,
    );
    expect(screen.getByRole('button', { name: 'Optionen umschalten' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Auswahl löschen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeTruthy();
  });

  it('adds and removes a chip in multi-select mode', () => {
    const onValueChange = vi.fn();

    function MultiSelect() {
      const anchor = useComboboxAnchor();
      return (
        <Combobox multiple items={REGIONS} onValueChange={onValueChange} defaultOpen>
          <ComboboxChips ref={anchor}>
            <ComboboxValue>
              {(values: string[]) => (
                <>
                  {values.map((value) => (
                    <ComboboxChip key={value}>{value}</ComboboxChip>
                  ))}
                  <ComboboxChipsInput aria-label="Region" />
                </>
              )}
            </ComboboxValue>
          </ComboboxChips>
          <ComboboxContent anchor={anchor}>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      );
    }

    render(<MultiSelect />);
    const option = screen.getByRole('option', { name: 'Europe' });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).toEqual(['Europe']);

    const chip = screen.getByText('Europe', { selector: `.${styles.chip}` });
    expect(chip).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onValueChange).toHaveBeenCalledTimes(2);
    expect(onValueChange.mock.calls[1]?.[0]).toEqual([]);
  });
});

describe('Combobox styling', () => {
  // Regression guard for the shared inline-end slot: without .inputWrap's
  // :has() rule, a showClear combobox with a value would render both the
  // trigger and the clear button stacked in the same corner.
  it('hides the trigger while the clear button is mounted', () => {
    const rule = cssRules.find(
      (candidate) => candidate.selector === '.inputWrap:has(.inputClear) .inputTrigger',
    );
    expect(rule).toBeDefined();
  });
});
