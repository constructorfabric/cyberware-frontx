import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from './bubble';
import styles from './bubble.module.css';

afterEach(cleanup);

describe('Bubble', () => {
  it('renders a div with the base class and defaults to the default variant and start alignment', () => {
    render(<Bubble data-testid="bubble">Hi</Bubble>);
    const bubble = screen.getByTestId('bubble');
    expect(bubble.tagName).toBe('DIV');
    expect(bubble.className).toContain(styles.bubble);
    expect(bubble.className).toContain(styles.variantDefault);
    expect(bubble.getAttribute('data-variant')).toBe('default');
    expect(bubble.getAttribute('data-align')).toBe('start');
  });

  it.each([
    ['default', styles.variantDefault],
    ['secondary', styles.variantSecondary],
    ['muted', styles.variantMuted],
    ['tinted', styles.variantTinted],
    ['outline', styles.variantOutline],
    ['ghost', styles.variantGhost],
    ['destructive', styles.variantDestructive],
  ] as const)('applies the %s variant class and data attribute', (variant, variantClass) => {
    render(
      <Bubble data-testid="bubble" variant={variant}>
        Hi
      </Bubble>,
    );
    const bubble = screen.getByTestId('bubble');
    expect(bubble.className).toContain(variantClass);
    expect(bubble.getAttribute('data-variant')).toBe(variant);
  });

  it('treats an explicit null variant as the default, in class and attribute alike', () => {
    render(
      <Bubble data-testid="bubble" variant={null}>
        Hi
      </Bubble>,
    );
    const bubble = screen.getByTestId('bubble');
    expect(bubble.className).toContain(styles.variantDefault);
    expect(bubble.getAttribute('data-variant')).toBe('default');
  });

  it('reflects align="end" as a data attribute', () => {
    render(
      <Bubble data-testid="bubble" align="end">
        Hi
      </Bubble>,
    );
    expect(screen.getByTestId('bubble').getAttribute('data-align')).toBe('end');
  });

  it('merges a consumer className without dropping the kit class', () => {
    render(
      <Bubble data-testid="bubble" className="consumer">
        Hi
      </Bubble>,
    );
    const bubble = screen.getByTestId('bubble');
    expect(bubble.className).toContain(styles.bubble);
    expect(bubble.className).toContain('consumer');
  });
});

describe('BubbleContent', () => {
  it('renders a div with the content class by default', () => {
    render(<BubbleContent data-testid="content">Hi</BubbleContent>);
    const content = screen.getByTestId('content');
    expect(content.tagName).toBe('DIV');
    expect(content.className).toContain(styles.bubbleContent);
  });

  it('renders as a different element via the render prop, keeping the kit class', () => {
    render(<BubbleContent render={<button type="button" onClick={() => {}} />}>Click here</BubbleContent>);
    const button = screen.getByRole('button', { name: 'Click here' });
    expect(button.className).toContain(styles.bubbleContent);
  });
});

describe('BubbleGroup', () => {
  it('renders a div with the group class', () => {
    render(
      <BubbleGroup data-testid="group">
        <Bubble>One</Bubble>
        <Bubble>Two</Bubble>
      </BubbleGroup>,
    );
    expect(screen.getByTestId('group').className).toContain(styles.bubbleGroup);
  });
});

describe('BubbleReactions', () => {
  it('defaults to side="bottom" and align="end"', () => {
    render(<BubbleReactions data-testid="reactions">👍</BubbleReactions>);
    const reactions = screen.getByTestId('reactions');
    expect(reactions.className).toContain(styles.bubbleReactions);
    expect(reactions.className).toContain(styles.sideBottom);
    expect(reactions.className).toContain(styles.alignEnd);
    expect(reactions.getAttribute('data-side')).toBe('bottom');
    expect(reactions.getAttribute('data-align')).toBe('end');
  });

  it.each([
    ['top', styles.sideTop],
    ['bottom', styles.sideBottom],
  ] as const)('applies the %s side class', (side, sideClass) => {
    render(
      <BubbleReactions data-testid="reactions" side={side}>
        👍
      </BubbleReactions>,
    );
    expect(screen.getByTestId('reactions').className).toContain(sideClass);
  });

  it.each([
    ['start', styles.alignStart],
    ['end', styles.alignEnd],
  ] as const)('applies the %s align class', (align, alignClass) => {
    render(
      <BubbleReactions data-testid="reactions" align={align}>
        👍
      </BubbleReactions>,
    );
    expect(screen.getByTestId('reactions').className).toContain(alignClass);
  });
});
