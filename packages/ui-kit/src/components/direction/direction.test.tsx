import { cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DirectionProvider, useDirection } from './direction';

afterEach(cleanup);

describe('DirectionProvider', () => {
  it('defaults consumers to ltr with no provider mounted', () => {
    const { result } = renderHook(() => useDirection());
    expect(result.current).toBe('ltr');
  });

  it('shares an explicit direction with descendant consumers', () => {
    const { result } = renderHook(() => useDirection(), {
      wrapper: ({ children }) => <DirectionProvider direction="rtl">{children}</DirectionProvider>,
    });
    expect(result.current).toBe('rtl');
  });

  it('renders children with no wrapper element of its own', () => {
    const { container } = render(
      <DirectionProvider direction="rtl">
        <span data-testid="child">content</span>
      </DirectionProvider>,
    );
    // A bare Context.Provider contributes no DOM node — the child's parent
    // is the test's own render container, not an intermediate wrapper this
    // component introduced.
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.getAttribute('data-testid')).toBe('child');
  });
});
