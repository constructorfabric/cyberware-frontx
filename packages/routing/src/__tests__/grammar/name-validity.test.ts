import { describe, expect, it } from 'vitest';
import { deriveExtensionToken, namesEqual, validateName } from '../../grammar/name.js';

// cpt-frontx-algo-routing-navigation-substrate-name-validity

describe('validateName', () => {
  it('accepts a lowercase letter followed by lowercase letters, digits, and hyphens', () => {
    expect(validateName('a')).toBe(true);
    expect(validateName('dashboard')).toBe(true);
    expect(validateName('tenant-details')).toBe(true);
    expect(validateName('line-a1')).toBe(true);
  });

  it('rejects the empty string', () => {
    expect(validateName('')).toBe(false);
  });

  it('rejects a first character that is a digit or hyphen', () => {
    expect(validateName('1a')).toBe(false);
    expect(validateName('-a')).toBe(false);
  });

  it('rejects characters outside the name alphabet', () => {
    expect(validateName('a.b')).toBe(false);
    expect(validateName('a/b')).toBe(false);
    expect(validateName('a;b')).toBe(false);
    expect(validateName('a=b')).toBe(false);
    expect(validateName('a&b')).toBe(false);
    expect(validateName('a#b')).toBe(false);
    expect(validateName('Abc')).toBe(false);
    expect(validateName('a%20')).toBe(false);
  });
});

describe('deriveExtensionToken', () => {
  it('returns undefined when the input carries no route at all', () => {
    // Not the sentinel string `'not-routable'`: that string is itself a
    // valid `name` an occupant could register as its own route, so it
    // would be ambiguous with a real extension token.
    expect(deriveExtensionToken(undefined)).toBeUndefined();
  });

  it('strips exactly one leading slash before validating', () => {
    expect(deriveExtensionToken('/dashboard')).toBe('dashboard');
    expect(deriveExtensionToken('dashboard')).toBe('dashboard');
  });

  it('returns undefined when the normalized candidate is not a valid name', () => {
    expect(deriveExtensionToken('/a/b')).toBeUndefined();
    expect(deriveExtensionToken('//dashboard')).toBeUndefined();
    expect(deriveExtensionToken('')).toBeUndefined();
  });
});

describe('namesEqual', () => {
  it('reports true only for character-by-character identical values', () => {
    expect(namesEqual('dashboard', 'dashboard')).toBe(true);
    expect(namesEqual('dashboard', 'settings')).toBe(false);
  });

  it('applies no percent-decoding — a name admits no escapes to decode', () => {
    expect(namesEqual('line-a', 'line-a')).toBe(true);
  });
});
