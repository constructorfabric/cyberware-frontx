import { afterEach, describe, expect, it, vi } from 'vitest';

const build = vi.fn();
const use = vi.fn();
const createFrontX = vi.fn(() => ({
  use,
}));
const registerSlice = vi.fn();
const register = vi.fn();
const initialize = vi.fn();
const effects = vi.fn(() => 'effects-plugin');
const queryCacheShared = vi.fn(() => 'query-cache-shared-plugin');
const mock = vi.fn(() => 'mock-plugin');

vi.mock('@gears-frontx/react', () => ({
  createFrontX,
  registerSlice,
  apiRegistry: {
    register,
    initialize,
  },
  effects,
  mock,
  queryCacheShared,
}));

vi.mock('./api/_BlankApiService', () => ({
  _BlankApiService: class BlankApiService {
    static {
      void 0;
    }
  },
}));

vi.mock('./slices/homeSlice', () => ({
  homeSlice: { name: '_blank/home' },
}));

vi.mock('./effects/homeEffects', () => ({
  initHomeEffects: vi.fn(),
}));

describe('_blank-mfe init', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    use.mockImplementation(() => ({ use, build }));
    build.mockReturnValue({ id: 'blank-mfe-app' });
  });

  it('registers services before build and registers slices after build', async () => {
    use.mockImplementation(() => ({ use, build }));
    const expectedApp = { id: 'blank-mfe-app' };
    build.mockReturnValue(expectedApp);

    const { initHomeEffects } = await import('./effects/homeEffects');
    const module = await import('./init');

    expect(register).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(createFrontX).toHaveBeenCalledTimes(1);
    expect(effects).toHaveBeenCalledTimes(1);
    expect(queryCacheShared).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(use.mock.calls).toEqual(expect.arrayContaining([
      ['effects-plugin'],
      ['query-cache-shared-plugin'],
      ['mock-plugin'],
    ]));
    expect(build).toHaveBeenCalledTimes(1);
    expect(registerSlice).toHaveBeenCalledWith({ name: '_blank/home' }, initHomeEffects);
    expect(module.mfeApp).toBe(expectedApp);
  });
});
