/**
 * _Blank Domain - Mock Data
 * Replace with your mock responses.
 */

import type { MockMap } from '@gears-frontx/react';
import type { GetBlankStatusResponse } from './types';

/**
 * Mock map for _Blank API service
 * Keys are full URL patterns (including baseURL path)
 */
export const blankMockMap: MockMap = {
  'GET /api/blank/status': (): GetBlankStatusResponse => ({
    message: 'Blank MFE query example is active.',
    generatedAt: new Date('2026-03-23T12:00:00Z').toISOString(),
    capabilities: [
      'query-key-factory',
      'abort-signal-forwarding',
      'mfe-local-api-service',
    ],
  }),
};
