import type { ComponentType, ReactElement, ReactNode } from 'react';
import {
  render,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';

/**
 * Bag for tuple-style provider props (JSON-serialisable structure, widened for
 * nested config objects) without using `unknown`.
 */
type ProviderTuplePropValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ProviderTuplePropValue[]
  | { readonly [key: string]: ProviderTuplePropValue };

/**
 * Provider contract expected by {@link renderWithProviders}. Use `void` (the
 * default) when the component only receives `children`; otherwise pass the
 * prop bag shape for tuple-style `[Provider, props]` entries.
 */
export type ProviderComponent<
  TProps extends Record<string, ProviderTuplePropValue> | void = void,
> = [TProps] extends [void]
  ? ComponentType<{ children: ReactNode }>
  : ComponentType<Extract<TProps, Record<string, ProviderTuplePropValue>> & { children: ReactNode }>;

/**
 * Either a plain provider component or a `[Component, props]` tuple for
 * providers that need configuration (e.g. a pre-seeded query client).
 */
export type ProviderEntry =
  | ProviderComponent
  | readonly [ProviderComponent<Record<string, ProviderTuplePropValue>>, Record<string, ProviderTuplePropValue>];

export interface RenderWithProvidersOptions
  extends Omit<RenderOptions, 'wrapper'> {
  /**
   * Providers applied outside the component under test, outermost first.
   * Leave empty (or omit) to get behaviour identical to a bare
   * `render(ui, options)` call — which is how most screen tests in this repo
   * start out, since they stub their providers via `vi.mock` instead of
   * wrapping.
   */
  providers?: readonly ProviderEntry[];
}

/**
 * Convenience wrapper around React Testing Library's `render` that composes
 * an ordered list of providers outside the component under test. The helper
 * intentionally does NOT bake in any specific i18n / query / theme provider:
 * - Screen tests in this repo mock translation hooks (`useTranslation`,
 *   `useScreenTranslations`) via `vi.mock` at module top, which has to stay
 *   in the test file to be hoisted.
 * - Teardown is handled by the shared `afterEach` hook in `vitest.setup.ts`,
 *   so callers never need to invoke `cleanup()` themselves.
 *
 * Keeping the wrapper provider-agnostic lets both host-app and MFE tests
 * adopt it incrementally without reshaping their existing mock setup.
 *
 * @example
 * ```ts
 * renderWithProviders(<ProfileScreen bridge={bridge} />);
 *
 * renderWithProviders(<ProfileScreen bridge={bridge} />, {
 *   providers: [TooltipProvider, [QueryClientProvider, { client: queryClient }]],
 * });
 * ```
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const { providers, ...rest } = options;

  if (!providers || providers.length === 0) {
    return render(ui, rest);
  }

  const Wrapper = ({ children }: { children: ReactNode }) => {
    let element: ReactNode = children;
    // Iterate right-to-left so the first provider in the list is the
    // outermost wrapper, matching how developers read nested JSX.
    for (let index = providers.length - 1; index >= 0; index -= 1) {
      const entry = providers[index];
      if (Array.isArray(entry)) {
        const [Provider, providerProps] = entry;
        element = <Provider {...providerProps}>{element}</Provider>;
      } else {
        const Provider = entry as ProviderComponent;
        element = <Provider>{element}</Provider>;
      }
    }
    return <>{element}</>;
  };

  return render(ui, { ...rest, wrapper: Wrapper });
}

/**
 * Default return value for mocked translation hooks (`useTranslation`,
 * `useScreenTranslations`). `t(key)` returns the key verbatim so assertions
 * stay locale-agnostic, and `loading: false` keeps `<TextLoader>` and screen
 * skeleton gates out of the way.
 *
 * Callers still mock the hook themselves via `vi.mock` — this helper just
 * removes the repeated inline `{ t: (key) => key, loading: false }` literal.
 */
export function createTranslationStub(): {
  t: (key: string) => string;
  loading: false;
} {
  return { t: (key) => key, loading: false };
}
