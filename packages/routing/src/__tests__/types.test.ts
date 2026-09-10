import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  BackProjectionDelta,
  DomainKey,
  Entry,
  EntryAddress,
  EngineProviderInput,
  EngineProviderPort,
  ExtensionToken,
  HistoryNotification,
  HistoryVerb,
  Location,
  NavigationHistory,
  NavigationKind,
  Param,
  ParseResult,
  ParseWarning,
  RegisteredExtensionsSource,
  ReleaseFunction,
  SerializeInput,
  Transition,
  TransitionDiff,
} from '../types/index.js';
import { RoutingError, type RoutingErrorCode } from '../errors.js';

// These are compile-time-only assertions (`expectTypeOf`): the `it` bodies
// execute as ordinary, no-op vitest tests so `npm test` stays green, while
// `tsc` is what actually enforces every assertion below — these shapes are
// type contracts with no runtime footprint of their own, so the type
// checker is the tool that verifies them.

describe('Location', () => {
  it('carries exactly path, search, hash', () => {
    expectTypeOf<Location>().toEqualTypeOf<{
      readonly path: string;
      readonly search: string;
      readonly hash: string;
    }>();
  });
});

describe('NavigationKind', () => {
  it('names exactly three kinds', () => {
    expectTypeOf<NavigationKind>().toEqualTypeOf<'push' | 'replace' | 'history'>();
  });
});

describe('NavigationHistory', () => {
  it('exposes exactly location/subscribe/push/replace/go — the FEATURE §1.5 port shape', () => {
    expectTypeOf<NavigationHistory>().toHaveProperty('location');
    expectTypeOf<NavigationHistory>().toHaveProperty('subscribe');
    expectTypeOf<NavigationHistory>().toHaveProperty('push');
    expectTypeOf<NavigationHistory>().toHaveProperty('replace');
    expectTypeOf<NavigationHistory>().toHaveProperty('go');

    expectTypeOf<NavigationHistory['location']>().toEqualTypeOf<Location>();
    expectTypeOf<NavigationHistory['push']>().toEqualTypeOf<(path: string) => void>();
    expectTypeOf<NavigationHistory['replace']>().toEqualTypeOf<(path: string) => void>();
    expectTypeOf<NavigationHistory['go']>().toEqualTypeOf<(delta: number) => void>();

    expectTypeOf<NavigationHistory['subscribe']>().returns.toEqualTypeOf<ReleaseFunction>();
  });

  it('subscribe receives a HistoryNotification of {location, kind}', () => {
    type SubscriberArg = Parameters<NavigationHistory['subscribe']>[0];
    expectTypeOf<Parameters<SubscriberArg>[0]>().toEqualTypeOf<HistoryNotification>();
    expectTypeOf<HistoryNotification>().toEqualTypeOf<{
      readonly location: Location;
      readonly kind: NavigationKind;
    }>();
  });
});

describe('Grammar tokens', () => {
  it('DomainKey and ExtensionToken are nominal (branded) strings, not bare string', () => {
    // A branded type is assignable *to* string, but a bare string literal is
    // not assignable *to* the branded type without an assertion — this is
    // exactly what the brand is for: only a validated value should ever
    // carry it.
    expectTypeOf<DomainKey>().toExtend<string>();
    expectTypeOf<ExtensionToken>().toExtend<string>();
    expectTypeOf<string>().not.toExtend<DomainKey>();
    expectTypeOf<string>().not.toExtend<ExtensionToken>();
  });
});

describe('Entry / Param', () => {
  it('Entry carries {domainKey, extension, params}, params ordered {name, value}', () => {
    expectTypeOf<Entry>().toEqualTypeOf<{
      readonly domainKey: DomainKey;
      readonly extension: ExtensionToken;
      readonly params: readonly Param[];
    }>();
  });
});

describe('ParseResult / SerializeInput', () => {
  it('ParseResult carries shellSubroute, hash, entries, warnings', () => {
    expectTypeOf<ParseResult>().toHaveProperty('shellSubroute').toEqualTypeOf<string>();
    expectTypeOf<ParseResult>().toHaveProperty('hash').toEqualTypeOf<string | undefined>();
    expectTypeOf<ParseResult>().toHaveProperty('entries').toEqualTypeOf<readonly Entry[]>();
    expectTypeOf<ParseResult>()
      .toHaveProperty('warnings')
      .toEqualTypeOf<readonly ParseWarning[]>();
  });

  it('SerializeInput is ParseResult minus warnings', () => {
    expectTypeOf<SerializeInput>().toEqualTypeOf<{
      readonly shellSubroute: string;
      readonly hash: string | undefined;
      readonly entries: readonly Entry[];
    }>();
  });

  it('ParseWarning names only the three normative codes', () => {
    expectTypeOf<ParseWarning['code']>().toEqualTypeOf<
      'malformed-entry' | 'duplicate-parameter' | 'duplicate-extension'
    >();
  });
});

describe('RegisteredExtensionsSource', () => {
  it('is a plain-argument getter, with an optional change subscription', () => {
    expectTypeOf<RegisteredExtensionsSource>().toHaveProperty('getRegistrations');
    type OnChange = RegisteredExtensionsSource['onChange'];
    expectTypeOf<OnChange>().toEqualTypeOf<
      ((callback: () => void) => ReleaseFunction) | undefined
    >();
  });

  it('is generic over an opaque route-owner identity', () => {
    interface MyRouteOwner {
      mountId: string;
    }
    type Source = RegisteredExtensionsSource<MyRouteOwner>;
    type Registrations = ReturnType<Source['getRegistrations']>;
    expectTypeOf<Registrations[number]['routeOwner']>().toEqualTypeOf<MyRouteOwner>();
  });
});

describe('Transition', () => {
  it('carries domainKey, entries, and a five-plus-one-field diff', () => {
    expectTypeOf<Transition>().toHaveProperty('domainKey').toEqualTypeOf<DomainKey>();
    expectTypeOf<TransitionDiff>().toEqualTypeOf<{
      readonly added: readonly ExtensionToken[];
      readonly removed: readonly ExtensionToken[];
      readonly payloadChanged: readonly ExtensionToken[];
      readonly reordered: boolean;
      readonly resolutionChanged: readonly ExtensionToken[];
      readonly unresolved: readonly ExtensionToken[];
    }>();
  });
});

describe('BackProjectionDelta', () => {
  it('names five optional operations, each keyed by extension token', () => {
    expectTypeOf<BackProjectionDelta>().toHaveProperty('added');
    expectTypeOf<BackProjectionDelta>().toHaveProperty('removed');
    expectTypeOf<BackProjectionDelta>().toHaveProperty('payloadChanged');
    expectTypeOf<BackProjectionDelta>().toHaveProperty('replaced');
    expectTypeOf<BackProjectionDelta>().toHaveProperty('reordered');
    // An empty delta is a legal value — every field is optional.
    expectTypeOf<Record<string, never>>().toExtend<BackProjectionDelta>();
  });

  it('HistoryVerb is exactly push | replace, chosen by the caller', () => {
    expectTypeOf<HistoryVerb>().toEqualTypeOf<'push' | 'replace'>();
  });
});

describe('EngineProviderPort', () => {
  it('is a callable from EngineProviderInput to an opaque router', () => {
    expectTypeOf<EngineProviderInput>().toEqualTypeOf<{
      readonly history: NavigationHistory;
      readonly entryAddress: EntryAddress | undefined;
      readonly routeTree: unknown;
    }>();
    expectTypeOf<EngineProviderPort>().parameter(0).toEqualTypeOf<EngineProviderInput>();
  });

  it('entryAddress is undefined for a standalone occupant, never omitted', () => {
    // `entryAddress` must be present as a key (possibly `undefined`), not an
    // optional member — the FEATURE draws a distinction between "no entry
    // address at all" (a real, explicit value) and "wasn't asked for".
    expectTypeOf<EngineProviderInput>().toHaveProperty('entryAddress');
    type Keys = keyof EngineProviderInput;
    expectTypeOf<'entryAddress' extends Keys ? true : false>().toEqualTypeOf<true>();
  });
});

describe('RoutingError', () => {
  // `RoutingError` is a runtime `class extends Error`, not a type-only
  // tagged union (see `../errors.ts`) — its `code` field is the six-code
  // discriminant documented in `../types/index.ts`, so these are ordinary
  // runtime assertions rather than `expectTypeOf` compile-time-only ones.

  it('is an Error subclass discriminated by `code`', () => {
    expectTypeOf<RoutingErrorCode>().toEqualTypeOf<
      | 'invalid-domain-key'
      | 'invalid-extension-token'
      | 'invalid-name'
      | 'duplicate-param-name'
      | 'duplicate-extension'
      | 'reordered-not-permutation'
    >();

    const error = RoutingError.invalidDomainKey('a.b');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RoutingError);
    expect(error.code).toBe('invalid-domain-key');
    expect(error.value).toBe('a.b');
  });

  it('each static factory populates only the field(s) its own code declares', () => {
    const domainKeyError = RoutingError.invalidDomainKey('a.b');
    expect(domainKeyError.value).toBe('a.b');
    expect(domainKeyError.entry).toBeUndefined();
    expect(domainKeyError.entries).toBeUndefined();

    const entry: Entry = {
      domainKey: 'sheet' as DomainKey,
      extension: 'search' as ExtensionToken,
      params: [],
    };
    const duplicateParamError = RoutingError.duplicateParamName(entry);
    expect(duplicateParamError.code).toBe('duplicate-param-name');
    expect(duplicateParamError.entry).toBe(entry);
    expect(duplicateParamError.value).toBeUndefined();

    const other: Entry = { ...entry, extension: 'other' as ExtensionToken };
    const duplicateExtensionError = RoutingError.duplicateExtension([entry, other]);
    expect(duplicateExtensionError.code).toBe('duplicate-extension');
    expect(duplicateExtensionError.entries).toEqual([entry, other]);
  });
});
