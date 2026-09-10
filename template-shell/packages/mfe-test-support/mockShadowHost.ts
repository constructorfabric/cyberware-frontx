import { vi } from 'vitest';

type MockShadowHostTarget = HTMLElement | typeof HTMLDivElement;

/**
 * Makes getRootNode() resolve to a real shadow root backed by `host`.
 */
export function mockShadowHost(
  target: MockShadowHostTarget,
  host: HTMLElement = document.createElement('div')
): { host: HTMLElement; shadowRoot: ShadowRoot } {
  const shadowRoot = host.attachShadow({ mode: 'open' });

  if (target === HTMLDivElement) {
    vi.spyOn(
      HTMLDivElement.prototype as Pick<HTMLElement, 'getRootNode'>,
      'getRootNode'
    ).mockReturnValue(shadowRoot);
  } else {
    vi.spyOn(target as Pick<HTMLElement, 'getRootNode'>, 'getRootNode').mockReturnValue(
      shadowRoot
    );
  }

  return { host, shadowRoot };
}
