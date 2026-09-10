import { afterEach, describe, expect, it, vi } from 'vitest';

const build = vi.fn();
const use = vi.fn();
const createFrontX = vi.fn(() => ({
  use,
}));
const register = vi.fn();
const initialize = vi.fn();
const effects = vi.fn(() => 'effects-plugin');
const queryCacheShared = vi.fn(() => 'query-cache-shared-plugin');
const mock = vi.fn(() => 'mock-plugin');

vi.mock('@gears-frontx/react', () => ({
  createFrontX,
  apiRegistry: {
    register,
    initialize,
  },
  effects,
  mock,
  queryCacheShared,
}));

vi.mock('./api/AccountsApiService', () => ({
  AccountsApiService: class AccountsApiService {
    /** Test double only; `register` needs a constructor reference. */
    static readonly serviceId = 'AccountsApiService';
  },
}));

describe('demo-mfe init', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    use.mockImplementation(() => ({ use, build }));
    build.mockReturnValue({ id: 'mfe-app' });
  });

  it('registers services before building the MFE app and exports the built app', async () => {
    use.mockImplementation(() => ({ use, build }));
    const expectedApp = { id: 'mfe-app' };
    build.mockReturnValue(expectedApp);

    const module = await import('./init');

    expect(register).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(createFrontX).toHaveBeenCalledTimes(1);
    expect(effects).toHaveBeenCalledTimes(1);
    expect(queryCacheShared).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(use).toHaveBeenCalledTimes(3);
    expect(use.mock.calls).toEqual(expect.arrayContaining([
      ['effects-plugin'],
      ['query-cache-shared-plugin'],
      ['mock-plugin'],
    ]));
    expect(build).toHaveBeenCalledTimes(1);
    expect(module.mfeApp).toBe(expectedApp);
  });
});
