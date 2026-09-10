// @cpt-dod:cpt-frontx-dod-unit-test-generation-and-agent-verification-blank-mfe-tests:p1
import type { ApiPluginBase, ApiProtocol } from '@gears-frontx/react';
import { describe, expect, it } from 'vitest';
import { attachRegisteredRestMocks } from '@gears-frontx/mfe-test-support/attachRegisteredRestMocks';
import { _BlankApiService } from './_BlankApiService';

type ApiServiceWithRegisteredMocks = _BlankApiService & {
  getPlugins(): Iterable<readonly [ApiProtocol, Iterable<ApiPluginBase>]>;
};

describe('_BlankApiService', () => {
  it('exposes the status endpoint descriptor and mock response contract', async () => {
    const service = new _BlankApiService() as ApiServiceWithRegisteredMocks;

    attachRegisteredRestMocks(service);

    const key = service.getStatus.key;
    expect(key[1]).toBe('GET');
    expect(String(key[2]).endsWith('/status')).toBe(true);

    const response = await service.getStatus.fetch();

    expect(response).toEqual(expect.objectContaining({
      message: expect.any(String),
      generatedAt: expect.any(String),
      capabilities: expect.arrayContaining([
        'query-key-factory',
        'mfe-local-api-service',
      ]),
    }));
    expect(response.message.length).toBeGreaterThan(0);
    expect(new Date(response.generatedAt).toISOString()).toBe(response.generatedAt);
  });
});
