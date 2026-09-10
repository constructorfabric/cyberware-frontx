/**
 * `@gears-frontx/routing` — runtime error type.
 *
 * ADR 0003 ("Occupant Identity Lexical Rule") and FEATURE
 * (navigation-substrate) §3 (Domain-Key Composition, Grammar Serialize)
 * specify a *thrown* error at a handful of synchronous input paths; FEATURE
 * (route-ownership-signal) §3 (URL Back-Projection Helper) adds a sixth.
 * This module supplies the single runtime value every one of those `throw`
 * statements constructs — see `RoutingErrorCode`'s own doc comment for the
 * six shapes, documented in `src/types/index.ts`.
 *
 * A single `RoutingError` class, not one subclass per code, because every
 * variant is a plain data-carrying error with no behaviour of its own beyond
 * carrying `code` plus whichever offending value(s) that code names — a
 * subclass hierarchy would add ceremony with no behavioural payoff. `code`
 * still discriminates like a tagged union's own field would; the static
 * factories below are what keeps each construction site honest about which
 * fields a given code actually populates (only the fields its own error
 * shape declares are ever set — never all of them at once).
 *
 * @packageDocumentation
 */

import type { DomainKey, Entry, ExtensionToken } from './types/index.js';

/** The six codes a thrown `RoutingError` carries — see `src/types/index.ts`
 * for the field shape each one populates. */
export type RoutingErrorCode =
  | 'invalid-domain-key'
  | 'invalid-extension-token'
  | 'invalid-name'
  | 'duplicate-param-name'
  | 'duplicate-extension'
  | 'reordered-not-permutation';

export class RoutingError extends Error {
  readonly code: RoutingErrorCode;
  /** Set only for `invalid-domain-key` / `invalid-extension-token` / `invalid-name`. */
  readonly value?: string;
  /** Set for `duplicate-param-name`, and for `invalid-domain-key` /
   * `invalid-extension-token` only when thrown by grammar serialize (FEATURE
   * §3, Grammar Serialize, step 1.1), naming the offending entry. */
  readonly entry?: Entry;
  /** Set only for `duplicate-extension`. */
  readonly entries?: readonly [Entry, Entry];
  /** Set only for `reordered-not-permutation`. */
  readonly domainKey?: DomainKey;
  /** Set only for `reordered-not-permutation`. */
  readonly reordered?: readonly ExtensionToken[];

  private constructor(
    code: RoutingErrorCode,
    message: string,
    extra?: {
      value?: string;
      entry?: Entry;
      entries?: readonly [Entry, Entry];
      domainKey?: DomainKey;
      reordered?: readonly ExtensionToken[];
    },
  ) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
    this.value = extra?.value;
    this.entry = extra?.entry;
    this.entries = extra?.entries;
    this.domainKey = extra?.domainKey;
    this.reordered = extra?.reordered;
  }

  /**
   * A `domainKey` argument failed the `domain-key` production (ADR 0003,
   * "Tokens"). `entry` is set only when this is thrown by grammar serialize,
   * which names the offending entry, not merely its `domainKey` value
   * (FEATURE §3, Grammar Serialize, step 1.1).
   */
  static invalidDomainKey(value: string, entry?: Entry): RoutingError {
    return new RoutingError('invalid-domain-key', `Invalid domain key: "${value}"`, {
      value,
      entry,
    });
  }

  /**
   * An `extension` argument failed the `name` alphabet. `entry` is set only
   * when this is thrown by grammar serialize (see `invalidDomainKey`).
   */
  static invalidExtensionToken(value: string, entry?: Entry): RoutingError {
    return new RoutingError(
      'invalid-extension-token',
      `Invalid extension token: "${value}"`,
      { value, entry },
    );
  }

  /** A nested domain's own locally-chosen `name` argument failed the `name` alphabet. */
  static invalidName(value: string): RoutingError {
    return new RoutingError('invalid-name', `Invalid name: "${value}"`, { value });
  }

  /** A serialize-input entry carried two params of the identical `name`. */
  static duplicateParamName(entry: Entry): RoutingError {
    return new RoutingError(
      'duplicate-param-name',
      `Entry "${entry.domainKey}=${entry.extension}" carries a duplicate param name`,
      { entry },
    );
  }

  /** A serialize-input list carried two entries sharing the identical `domainKey` and `extension`. */
  static duplicateExtension(entries: readonly [Entry, Entry]): RoutingError {
    return new RoutingError(
      'duplicate-extension',
      `Duplicate entry "${entries[0].domainKey}=${entries[0].extension}"`,
      { entries },
    );
  }

  /**
   * A back-projection call's own `reordered` list is not exactly a
   * permutation of `domainKey`'s own entries surviving the delta's other
   * operations — missing a survivor, naming an extra token, or naming one
   * twice.
   */
  static reorderedNotPermutation(
    domainKey: DomainKey,
    reordered: readonly ExtensionToken[],
  ): RoutingError {
    return new RoutingError(
      'reordered-not-permutation',
      `"${domainKey}" back-projection reordered list is not a permutation of its surviving entries: [${reordered.join(', ')}]`,
      { domainKey, reordered },
    );
  }
}
