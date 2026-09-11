/**
 * Unit tests for useMfeRegistry hook.
 *
 * Uses a minimal mock app — no real framework build — so tests run fast and
 * don't depend on the GTS singleton state. The hook only accesses
 * app.mfeRegistry.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useMfeRegistry } from '../useMfeRegistry';
import { FrontXContext } from '../../../FrontXContext';
import type { FrontXApp, MfeRegistry } from '@gears-frontx/framework';

// ─── Render helper ────────────────────────────────────────────────────────────

function renderWithApp(app: FrontXApp) {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(FrontXContext.Provider, { value: app }, children);

  return renderHook(() => useMfeRegistry(), { wrapper });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useMfeRegistry', () => {
  it('returns the registry when the microfrontends plugin is present', () => {
    const registry = { getExtension: () => undefined } as unknown as MfeRegistry;
    const app = { mfeRegistry: registry } as unknown as FrontXApp;

    const { result } = renderWithApp(app);

    expect(result.current).toBe(registry);
  });

  it('throws a descriptive error when mfeRegistry is absent', () => {
    const app = { mfeRegistry: undefined } as unknown as FrontXApp;

    expect(() => renderWithApp(app)).toThrow(/useMfeRegistry requires the microfrontends plugin/i);
  });
});
