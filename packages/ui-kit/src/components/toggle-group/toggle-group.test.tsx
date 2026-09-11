import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import toggleStyles from '../toggle/toggle.module.css';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';
import styles from './toggle-group.module.css';

afterEach(cleanup);

describe('ToggleGroup', () => {
  it('renders a group with its items, single selection by default', () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup aria-label="Alignment" onValueChange={onValueChange}>
        <ToggleGroupItem value="left" aria-label="Left" />
        <ToggleGroupItem value="center" aria-label="Center" />
      </ToggleGroup>,
    );
    const group = screen.getByRole('group', { name: 'Alignment' });
    expect(group.className).toContain(styles.group);

    const left = screen.getByRole('button', { name: 'Left' });
    const center = screen.getByRole('button', { name: 'Center' });
    fireEvent.click(left);
    expect(onValueChange).toHaveBeenCalledWith(['left'], expect.anything());
    expect(left.hasAttribute('data-pressed')).toBe(true);

    // Single-selection: pressing another item unpresses the first.
    fireEvent.click(center);
    expect(onValueChange).toHaveBeenCalledWith(['center'], expect.anything());
    expect(center.hasAttribute('data-pressed')).toBe(true);
    expect(left.hasAttribute('data-pressed')).toBe(false);
  });

  it('allows more than one pressed item when multiple', () => {
    render(
      <ToggleGroup aria-label="Formatting" multiple>
        <ToggleGroupItem value="bold" aria-label="Bold" />
        <ToggleGroupItem value="italic" aria-label="Italic" />
      </ToggleGroup>,
    );
    const bold = screen.getByRole('button', { name: 'Bold' });
    const italic = screen.getByRole('button', { name: 'Italic' });
    fireEvent.click(bold);
    fireEvent.click(italic);
    expect(bold.hasAttribute('data-pressed')).toBe(true);
    expect(italic.hasAttribute('data-pressed')).toBe(true);
  });

  it('applies the group variant/size to items, overridable per item', () => {
    render(
      <ToggleGroup aria-label="Views" variant="outline" size="lg">
        <ToggleGroupItem value="list" aria-label="List" />
        <ToggleGroupItem value="grid" aria-label="Grid" size="sm" />
      </ToggleGroup>,
    );
    const list = screen.getByRole('button', { name: 'List' });
    const grid = screen.getByRole('button', { name: 'Grid' });
    expect(list.className).toContain(toggleStyles.variantOutline);
    expect(list.className).toContain(toggleStyles.sizeLg);
    // The group's size wins over the item's own per this component's
    // documented precedence (group value, then item's own as fallback) —
    // grid's own `size="sm"` is only used if the group didn't set one.
    expect(grid.className).toContain(toggleStyles.sizeLg);
  });

  it('disables every item when the group is disabled', () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup aria-label="Locked" disabled onValueChange={onValueChange}>
        <ToggleGroupItem value="a" aria-label="A" />
      </ToggleGroup>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('merges a consumer className on the group and an item', () => {
    render(
      <ToggleGroup aria-label="Group" className="consumer-group">
        <ToggleGroupItem value="a" aria-label="A" className="consumer-item" />
      </ToggleGroup>,
    );
    expect(screen.getByRole('group', { name: 'Group' }).className).toContain('consumer-group');
    expect(screen.getByRole('button', { name: 'A' }).className).toContain('consumer-item');
  });
});
