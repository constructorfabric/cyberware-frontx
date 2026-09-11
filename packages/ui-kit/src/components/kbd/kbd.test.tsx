import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Kbd, KbdGroup } from './kbd';
import styles from './kbd.module.css';

afterEach(cleanup);

describe('Kbd', () => {
  it('renders a kbd element with the base class', () => {
    render(<Kbd>Esc</Kbd>);
    const kbd = screen.getByText('Esc');
    expect(kbd).toHaveProperty('tagName', 'KBD');
    expect(kbd.className).toContain(styles.kbd);
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<Kbd className="consumer">Esc</Kbd>);
    const kbd = screen.getByText('Esc');
    expect(kbd.className).toContain(styles.kbd);
    expect(kbd.className).toContain('consumer');
  });

  it('forwards native kbd props such as id', () => {
    render(<Kbd id="shortcut">Esc</Kbd>);
    expect(screen.getByText('Esc')).toHaveProperty('id', 'shortcut');
  });
});

describe('KbdGroup', () => {
  it('renders a kbd element (matching upstream, not a div) wrapping several Kbds', () => {
    render(
      <KbdGroup data-testid="group">
        <Kbd>Cmd</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>,
    );
    const group = screen.getByTestId('group');
    expect(group).toHaveProperty('tagName', 'KBD');
    expect(group.className).toContain(styles.kbdGroup);
    expect(screen.getByText('Cmd').closest(`.${styles.kbdGroup}`)).toBe(group);
    expect(screen.getByText('K').closest(`.${styles.kbdGroup}`)).toBe(group);
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(<KbdGroup className="consumer" data-testid="group" />);
    const group = screen.getByTestId('group');
    expect(group.className).toContain(styles.kbdGroup);
    expect(group.className).toContain('consumer');
  });
});
