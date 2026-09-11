import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from '../button/public';
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from './button-group';
import styles from './button-group.module.css';

afterEach(cleanup);

describe('ButtonGroup', () => {
  it('renders a group role with the base and default (horizontal) orientation class', () => {
    render(
      <ButtonGroup>
        <Button>One</Button>
        <Button>Two</Button>
      </ButtonGroup>,
    );
    const group = screen.getByRole('group');
    expect(group.className).toContain(styles.group);
    expect(group.className).toContain(styles.orientationHorizontal);
    expect(group.getAttribute('data-orientation')).toBe('horizontal');
  });

  it('switches to the vertical orientation class and data attribute', () => {
    render(
      <ButtonGroup orientation="vertical">
        <Button>One</Button>
        <Button>Two</Button>
      </ButtonGroup>,
    );
    const group = screen.getByRole('group');
    expect(group.className).toContain(styles.orientationVertical);
    expect(group.getAttribute('data-orientation')).toBe('vertical');
  });

  it('merges a consumer className and forwards native div props', () => {
    render(
      <ButtonGroup className="consumer" aria-label="Actions">
        <Button>One</Button>
      </ButtonGroup>,
    );
    const group = screen.getByRole('group', { name: 'Actions' });
    expect(group.className).toContain(styles.group);
    expect(group.className).toContain('consumer');
  });

  it('renders ButtonGroupText as a div by default with the text class', () => {
    render(<ButtonGroupText>$</ButtonGroupText>);
    const text = screen.getByText('$');
    expect(text).toHaveProperty('tagName', 'DIV');
    expect(text.className).toContain(styles.text);
  });

  it('renders ButtonGroupText through a custom render element', () => {
    render(<ButtonGroupText render={<label htmlFor="amount" />}>Amount</ButtonGroupText>);
    const text = screen.getByText('Amount');
    expect(text).toHaveProperty('tagName', 'LABEL');
    expect(text.className).toContain(styles.text);
  });

  it('renders ButtonGroupSeparator vertical by default (opposite of Separator itself)', () => {
    const { container } = render(<ButtonGroupSeparator />);
    const separator = container.firstElementChild;
    expect(separator?.getAttribute('data-orientation')).toBe('vertical');
    expect(separator?.className).toContain(styles.separator);
  });

  it('lets ButtonGroupSeparator opt into horizontal', () => {
    const { container } = render(<ButtonGroupSeparator orientation="horizontal" />);
    expect(container.firstElementChild?.getAttribute('data-orientation')).toBe('horizontal');
  });
});
