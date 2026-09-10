// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-blank-mfe-tests:p1
import { describe, expect, it } from 'vitest';
import type { GetBlankStatusResponse } from './types';
import { blankMockMap } from './mocks';

describe('blankMockMap', () => {
  it('returns a well-formed status payload shape for the blank template', () => {
    const statusEntry = Object.entries(blankMockMap).find(([key]) => {
      return key.startsWith('GET ') && key.endsWith('/status');
    });

    expect(statusEntry).toBeDefined();

    if (!statusEntry) {
      throw new Error('Expected a GET /status mock handler');
    }

    const [, handler] = statusEntry;

    expect(typeof handler).toBe('function');

    const response = handler() as GetBlankStatusResponse;
    expect(typeof response.message).toBe('string');
    expect(response.message.length).toBeGreaterThan(0);
    // generatedAt must be a round-trip-stable ISO 8601 string
    expect(typeof response.generatedAt).toBe('string');
    expect(new Date(response.generatedAt).toISOString()).toBe(response.generatedAt);
    expect(Array.isArray(response.capabilities)).toBe(true);
    expect(response.capabilities.length).toBeGreaterThan(0);
    expect(response.capabilities.every((c) => typeof c === 'string')).toBe(true);
  });
});
