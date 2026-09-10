import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from './native-select';
import styles from './native-select.module.css';

afterEach(cleanup);

describe('NativeSelect', () => {
  it('renders a native select with its options and the kit classes', () => {
    render(
      <NativeSelect aria-label="Region" defaultValue="eu">
        <NativeSelectOption value="eu">Europe</NativeSelectOption>
        <NativeSelectOption value="us">Americas</NativeSelectOption>
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox', { name: 'Region' });
    expect(select).toHaveProperty('tagName', 'SELECT');
    expect(select.className).toContain(styles.select);
    expect(select).toHaveProperty('value', 'eu');
    expect(screen.getByRole('option', { name: 'Americas' })).toHaveProperty('tagName', 'OPTION');
  });

  it('defaults to the default size, not the compact one', () => {
    const { container } = render(
      <NativeSelect aria-label="Region">
        <NativeSelectOption value="eu">Europe</NativeSelectOption>
      </NativeSelect>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).not.toContain(styles.sizeSm);
  });

  it('applies the compact size class', () => {
    const { container } = render(
      <NativeSelect size="sm" aria-label="Region">
        <NativeSelectOption value="eu">Europe</NativeSelectOption>
      </NativeSelect>,
    );
    expect(container.firstElementChild?.className).toContain(styles.sizeSm);
  });

  it('marks the wrapper disabled via a data attribute, not a class guess', () => {
    const { container } = render(
      <NativeSelect disabled aria-label="Region">
        <NativeSelectOption value="eu">Europe</NativeSelectOption>
      </NativeSelect>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.getAttribute('data-disabled')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveProperty('disabled', true);
  });

  it('leaves data-disabled absent when not disabled', () => {
    const { container } = render(
      <NativeSelect aria-label="Region">
        <NativeSelectOption value="eu">Europe</NativeSelectOption>
      </NativeSelect>,
    );
    expect(container.firstElementChild?.hasAttribute('data-disabled')).toBe(false);
  });

  it('groups options under an optgroup label', () => {
    render(
      <NativeSelect aria-label="Region">
        <NativeSelectOptGroup label="Europe">
          <NativeSelectOption value="fr">France</NativeSelectOption>
        </NativeSelectOptGroup>
      </NativeSelect>,
    );
    const group = screen.getByRole('group', { name: 'Europe' });
    expect(group).toHaveProperty('tagName', 'OPTGROUP');
    expect(screen.getByRole('option', { name: 'France' })).toHaveProperty('tagName', 'OPTION');
    // The group label styles on its own class, not the option's, so the two
    // can diverge without one dragging the other along.
    expect(group.className).toContain(styles.optgroup);
    expect(group.className).not.toContain(styles.option);
  });

  it('merges a consumer className onto the wrapper', () => {
    const { container } = render(
      <NativeSelect className="consumer" aria-label="Region">
        <NativeSelectOption value="eu">Europe</NativeSelectOption>
      </NativeSelect>,
    );
    expect(container.firstElementChild?.className).toContain('consumer');
  });
});
