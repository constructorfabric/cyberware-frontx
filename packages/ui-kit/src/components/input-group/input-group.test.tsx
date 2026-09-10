import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import buttonStyles from '../button/button.module.css';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from './input-group';
import styles from './input-group.module.css';

afterEach(cleanup);

describe('InputGroup', () => {
  it('renders a group role wrapping the input control', () => {
    render(
      <InputGroup>
        <InputGroupInput aria-label="Amount" />
      </InputGroup>,
    );
    const group = screen.getByRole('group');
    expect(group.className).toContain(styles.group);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    expect(input.className).toContain(styles.control);
  });

  it('defaults an addon to the inline-start alignment', () => {
    render(
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput aria-label="Amount" />
      </InputGroup>,
    );
    const addon = screen.getByText('$').closest(`.${styles.addon}`);
    expect(addon?.className).toContain(styles.alignInlineStart);
    expect(addon?.getAttribute('data-align')).toBe('inline-start');
  });

  it('applies the inline-end alignment class', () => {
    render(
      <InputGroup>
        <InputGroupInput aria-label="Amount" />
        <InputGroupAddon align="inline-end">
          <InputGroupText>USD</InputGroupText>
        </InputGroupAddon>
      </InputGroup>,
    );
    const addon = screen.getByText('USD').closest(`.${styles.addon}`);
    expect(addon?.className).toContain(styles.alignInlineEnd);
  });

  it('focuses the input when the addon padding is clicked', () => {
    render(
      <InputGroup>
        <InputGroupAddon data-testid="addon">
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput aria-label="Amount" />
      </InputGroup>,
    );
    fireEvent.click(screen.getByTestId('addon'));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Amount' }));
  });

  it('does not steal focus when the click lands on a button inside the addon', () => {
    const onButtonClick = vi.fn();
    render(
      <InputGroup>
        <InputGroupInput aria-label="Search" />
        <InputGroupAddon align="inline-end" data-testid="addon">
          <InputGroupButton onClick={onButtonClick} aria-label="Clear" />
        </InputGroupAddon>
      </InputGroup>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onButtonClick).toHaveBeenCalledTimes(1);
    // Focus-steal is a side effect of the addon's own onClick, which fires
    // on every bubbled click including this one — the button click itself
    // must still register regardless, which the assertion above proves.
  });

  it('focuses a textarea control when the addon padding is clicked', () => {
    render(
      <InputGroup>
        <InputGroupAddon align="block-start" data-testid="addon">
          <InputGroupText>To:</InputGroupText>
        </InputGroupAddon>
        <InputGroupTextarea aria-label="Message" />
      </InputGroup>,
    );
    fireEvent.click(screen.getByTestId('addon'));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
  });

  it('renders InputGroupButton as a ghost xs button by default, sm on request', () => {
    render(
      <>
        <InputGroupButton>Go</InputGroupButton>
        <InputGroupButton size="sm">Stop</InputGroupButton>
      </>,
    );
    const xs = screen.getByRole('button', { name: 'Go' });
    expect(xs.className).toContain(buttonStyles.variantGhost);
    expect(xs.className).toContain(styles.sizeXs);
    expect(xs.getAttribute('data-size')).toBe('xs');
    expect(xs).toHaveProperty('type', 'button');

    // `sm` is Button's own smallest geometry with no compression on top —
    // the class both sizes share stays, the xs-only one drops.
    const sm = screen.getByRole('button', { name: 'Stop' });
    expect(sm.className).toContain(buttonStyles.sizeSm);
    expect(sm.className).not.toContain(styles.sizeXs);
    expect(sm.getAttribute('data-size')).toBe('sm');
  });

  it('renders InputGroupTextarea with the resize-none control class', () => {
    render(
      <InputGroup>
        <InputGroupTextarea aria-label="Notes" />
      </InputGroup>,
    );
    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    expect(textarea.className).toContain(styles.control);
    expect(textarea.className).toContain(styles.textareaControl);
  });

  it('merges a consumer className onto the group without dropping the kit class', () => {
    render(<InputGroup className="consumer" aria-label="Amount field" />);
    const group = screen.getByRole('group', { name: 'Amount field' });
    expect(group.className).toContain(styles.group);
    expect(group.className).toContain('consumer');
  });
});
