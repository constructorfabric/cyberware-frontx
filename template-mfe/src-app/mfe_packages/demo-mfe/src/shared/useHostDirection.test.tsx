import { useRef } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useHostDirection } from './useHostDirection';

function DirectionProbe({ language }: { language: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useHostDirection(containerRef, language);
  return <div ref={containerRef} />;
}

const hosts: HTMLElement[] = [];

// A real shadow root as the render container — rather than
// @frontx-test-utils/mockShadowHost, which spies on getRootNode — so the
// hook's actual getRootNode() walk is what gets exercised.
function shadowMountNode() {
  const host = document.createElement('div');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  const mountNode = document.createElement('div');
  shadowRoot.appendChild(mountNode);
  document.body.appendChild(host);
  hosts.push(host);
  return { host, mountNode };
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    host.remove();
  }
});

describe('useHostDirection', () => {
  it('sets the shadow host direction to rtl for RTL languages and back to ltr', () => {
    const { host, mountNode } = shadowMountNode();

    const { rerender } = render(<DirectionProbe language="en" />, { container: mountNode });

    expect(host.dir).toBe('ltr');

    rerender(<DirectionProbe language="ar" />);

    expect(host.dir).toBe('rtl');

    rerender(<DirectionProbe language="en" />);

    expect(host.dir).toBe('ltr');
  });

  it('is a no-op outside a Shadow DOM', () => {
    render(<DirectionProbe language="ar" />);

    // The document root has no `host`, so no direction is written anywhere.
    expect(document.documentElement.dir).toBe('');
  });
});
