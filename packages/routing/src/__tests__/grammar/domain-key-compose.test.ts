import { describe, expect, it } from 'vitest';
import { composeDomainKey } from '../../grammar/compose.js';
import { expectRoutingError } from '../helpers.js';
import type { DomainKey, ExtensionToken } from '../../types/index.js';

// cpt-frontx-algo-routing-navigation-substrate-domain-key-compose

describe('composeDomainKey', () => {
  it('composes parent-key.parent-extension.name (ADR 0003 worked example)', () => {
    const composed = composeDomainKey(
      'screen' as DomainKey,
      'dashboard' as ExtensionToken,
      'tabs',
    );
    expect(composed).toBe('screen.dashboard.tabs');
  });

  it('throws invalid-domain-key naming the enclosing key when it is malformed', () => {
    const error = expectRoutingError(() =>
      composeDomainKey('a.b' as DomainKey, 'dashboard' as ExtensionToken, 'tabs'),
    );
    expect(error.code).toBe('invalid-domain-key');
  });

  it('throws invalid-extension-token naming the enclosing extension when it is malformed', () => {
    const error = expectRoutingError(() =>
      composeDomainKey('screen' as DomainKey, 'Dashboard' as ExtensionToken, 'tabs'),
    );
    expect(error.code).toBe('invalid-extension-token');
  });

  it('throws invalid-name naming the locally-chosen name when it is malformed', () => {
    const error = expectRoutingError(() =>
      composeDomainKey('screen' as DomainKey, 'dashboard' as ExtensionToken, 'Tabs'),
    );
    expect(error.code).toBe('invalid-name');
  });
});
