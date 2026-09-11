/**
 * `@gears-frontx/routing` — public type contracts.
 *
 * Types only: no runtime behaviour lives in this module (`export interface` /
 * `export type` erase entirely at compile time). The shapes below are the
 * field-level contracts owned by:
 *
 *   - cpt-frontx-feature-routing-navigation-substrate    (FEATURE §1.5, §3)
 *   - cpt-frontx-feature-routing-route-ownership-signal  (FEATURE §1.5, §3)
 *   - cpt-frontx-routing-adr-domain-occupancy-addressing-granularity (ADR 0003)
 *
 * Traceability markers (`@cpt-flow` / `@cpt-algo` / `@cpt-dod`) are omitted
 * here per the kit's marker contract: markers wrap implementation blocks that
 * fulfil a CDSL instruction, not type declarations. Every exported type below
 * is named after the FEATURE section that defines its shape; see the
 * per-type doc comment for its own anchor.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Navigation Substrate — §1.5 Contract Shapes, "Location shape"
// ---------------------------------------------------------------------------

/**
 * The shape `NavigationHistory`'s own `location` member exposes, and the
 * shape carried inside every subscriber notification.
 *
 * `path` is the shell subroute (pathname component) — this package's own
 * private-territory copy, never interpreted for occupancy. `search` is the
 * current URL's query string; `hash` is the current URL's fragment.
 *
 * FEATURE (navigation-substrate) §1.5, "Location shape".
 */
export interface Location {
  readonly path: string;
  readonly search: string;
  readonly hash: string;
}

// ---------------------------------------------------------------------------
// Navigation Substrate — §1.5 Contract Shapes, "Subscriber notification shape"
// ---------------------------------------------------------------------------

/**
 * Which of the three kinds of navigation triggered a dispatched round.
 *
 * - `'push'` / `'replace'` — an entry added or replaced through this
 *   instance's own `push`/`replace` call, dispatched directly.
 * - `'history'` — everything observed only through the underlying browser
 *   subscription: a `go` call issued through this instance, a user's own
 *   back/forward step, a third-party call that moves through existing
 *   history entries (e.g. `history.go`), or an observed third-party
 *   addition such as a fragment-only anchor activation. The FEATURE
 *   deliberately does not distinguish these from one another, so this
 *   package names the whole group `'history'` rather than inventing a
 *   finer split the FEATURE itself does not draw.
 *
 * FEATURE (navigation-substrate) §1.5, "Navigation kind".
 */
export type NavigationKind = 'push' | 'replace' | 'history';

/**
 * The value passed to each callback a `subscribe` caller registers, once per
 * dispatched round.
 *
 * FEATURE (navigation-substrate) §1.5, "Subscriber notification shape".
 */
export interface HistoryNotification {
  readonly location: Location;
  readonly kind: NavigationKind;
}

/**
 * The callback signature `NavigationHistory#subscribe` accepts.
 *
 * FEATURE (navigation-substrate) §1.5, "Subscriber notification shape";
 * §3, Fan-Out Subscription Dispatch.
 */
export type HistorySubscriber = (notification: HistoryNotification) => void;

/**
 * A zero-argument function that unsubscribes whatever it was returned from.
 * Calling it more than once is a no-op after the first call.
 *
 * FEATURE (navigation-substrate) §3, Fan-Out Subscription Dispatch, step 5;
 * FEATURE (route-ownership-signal) §1.5, "Release function".
 */
export type ReleaseFunction = () => void;

// ---------------------------------------------------------------------------
// Navigation Substrate — §1.5 Contract Shapes, "Navigation method signatures"
// ---------------------------------------------------------------------------

/**
 * `NavigationHistory`'s own imperative surface — the realm-shared,
 * single navigation-history instance every unit reads and writes.
 *
 * Deliberately narrower than any concrete engine's own history contract
 * (`cpt-frontx-constraint-routing-no-engine-leak`): no entry-carried state,
 * no route object, no engine-specific navigation options.
 *
 * FEATURE (navigation-substrate) §1.5, "Navigation method signatures";
 * DESIGN §3.1, Domain Model, "Navigation History".
 */
export interface NavigationHistory {
  /** Current location; already reflects the navigation that produced it
   * (§1.5, "Contract commitment") by the time any subscriber callback for
   * that round runs. */
  readonly location: Location;
  /** Registers a listener against the realm-shared fan-out; returns its own
   * release function. */
  subscribe(subscriber: HistorySubscriber): ReleaseFunction;
  /** Appends a new history entry for `path` (pathname, optionally a query
   * string and a fragment, exactly as composed by the caller). */
  push(path: string): void;
  /** Overwrites the current history entry with `path`, leaving every other
   * entry untouched. */
  replace(path: string): void;
  /** Moves through existing history entries by a signed step count; observed
   * asynchronously through the underlying browser subscription, never
   * dispatched directly. */
  go(delta: number): void;
}

// ---------------------------------------------------------------------------
// URL Grammar tokens — ADR 0003, "Tokens"; FEATURE (navigation-substrate) §3,
// Name Validity And Equality / Domain-Key Composition
// ---------------------------------------------------------------------------

declare const domainKeyBrand: unique symbol;
declare const extensionTokenBrand: unique symbol;

/**
 * A value conforming to the grammar's `domain-key` production: `name`, or
 * `domain-key "." extension "." name` for a nested domain (ADR 0003,
 * "Tokens"). Branded rather than a bare `string` because every call site
 * that accepts one (observer creation, the back-projection helper,
 * domain-key composition) validates it synchronously and throws on a
 * malformed value (§2.3, O3a of DESIGN) — the brand marks "already validated
 * against the `domain-key` production", not merely "some string".
 * `ParamName`/`ParamValue` are not branded the same way: their own grammar
 * production admits any decoded string once escapes are resolved, so there
 * is no further lexical rule this package enforces on them the way it does
 * on `DomainKey`/`ExtensionToken` (see the `ParamName` doc comment below).
 */
export type DomainKey = string & { readonly [domainKeyBrand]: true };

/**
 * A value conforming to the grammar's `name` alphabet, used as an entry's
 * own extension segment. Sourced from an extension registration's own
 * normalized `presentation.route` (`cpt-frontx-routing-adr-occupant-identity-stability`).
 * Branded for the identical reason `DomainKey` is (see above).
 */
export type ExtensionToken = string & { readonly [extensionTokenBrand]: true };

/**
 * A parameter name, percent-decoded exactly once on read. Not branded: the
 * grammar's `param-name` production (`1*( pchar-safe | pct-encoded )`)
 * admits any decoded string once escapes are resolved — there is no
 * further lexical rule this package enforces on a decoded name the way it
 * does on `DomainKey`/`ExtensionToken` (ADR 0003, "Entry").
 */
export type ParamName = string;

/**
 * A parameter value, percent-decoded exactly once on read. Not branded, for
 * the identical reason `ParamName` is not (ADR 0003, "Entry"). A bare
 * `param-name` with no `=` and an explicit `param-name=` both decode to the
 * empty string (`''`) here — the two forms are indistinguishable once
 * parsed (ADR 0003, "Entry").
 */
export type ParamValue = string;

// ---------------------------------------------------------------------------
// Grammar codec shapes — FEATURE (navigation-substrate) §1.5, "Grammar codec
// shapes"; §3, Grammar Parse / Grammar Serialize
// ---------------------------------------------------------------------------

/**
 * One `{name, value}` pair inside an entry's own ordered parameter list.
 *
 * FEATURE (navigation-substrate) §1.5, "Grammar codec shapes".
 */
export interface Param {
  readonly name: ParamName;
  readonly value: ParamValue;
}

/**
 * One occupant's own projection into the URL: `domain-key "=" extension
 * *( ";" param )` (ADR 0003, "Entry").
 *
 * FEATURE (navigation-substrate) §1.5, "Grammar codec shapes".
 */
export interface Entry {
  readonly domainKey: DomainKey;
  readonly extension: ExtensionToken;
  readonly params: readonly Param[];
}

/**
 * Which parse-time edge rule produced a given `ParseWarning`.
 *
 * Only three codes exist normatively: a malformed escape or invalid UTF-8
 * inside a param collapses into `'malformed-entry'` rather than its own
 * code — the FEATURE drops the *whole* entry for that case and reports it
 * exactly like any other malformed entry (§3, Grammar Parse, step 5.5.4).
 */
export type ParseWarningCode =
  | 'malformed-entry'
  | 'duplicate-parameter'
  | 'duplicate-extension';

/**
 * One warning a parse produced, naming the raw text of the entry it
 * concerns and which edge rule produced it.
 *
 * FEATURE (navigation-substrate) §1.5, "Grammar codec shapes — Parse result".
 */
export interface ParseWarning {
  readonly code: ParseWarningCode;
  readonly rawEntry: string;
}

/**
 * The output of a grammar parse: the shell subroute and hash copied
 * verbatim, the ordered entry list kept, and every warning produced along
 * the way. Parsing never throws (FEATURE §3, Grammar Parse).
 *
 * `hash` is `undefined` when the input carries no `#` at all; a present
 * `hash` never includes the leading `#` (parse strips it, serialize
 * re-adds it only when the value is non-empty).
 *
 * FEATURE (navigation-substrate) §1.5, "Grammar codec shapes — Parse result".
 */
export interface ParseResult {
  readonly shellSubroute: string;
  readonly hash: string | undefined;
  readonly entries: readonly Entry[];
  readonly warnings: readonly ParseWarning[];
}

/**
 * The input a grammar serialize accepts: the identical shape a parse
 * produces, minus the warnings — serialize is never fed a raw parse
 * warning, only the entries that survived them (FEATURE §1.5, "Grammar
 * codec shapes — Serialize input").
 */
export interface SerializeInput {
  readonly shellSubroute: string;
  readonly hash: string | undefined;
  readonly entries: readonly Entry[];
}

// ---------------------------------------------------------------------------
// Route Ownership Signal — §1.5 Contract Shapes, "Registered-extensions
// source"; §3, Entry Resolution
// ---------------------------------------------------------------------------

/**
 * One route owner's own declaration inside a domain's registered-extensions
 * source: an extension token paired with whichever value the consumer uses
 * to identify the route owner it names. `TRouteOwner` is opaque to this
 * package (`cpt-frontx-routing-adr-occupant-reference-boundary`) — never
 * the concrete `mfes` `Extension` type.
 */
export interface ExtensionRegistration<TRouteOwner = unknown> {
  readonly extension: ExtensionToken;
  readonly routeOwner: TRouteOwner;
}

/**
 * A domain's own registered-extensions source, supplied by the consumer as
 * a plain argument — never an injected port (§1.5). Modelled as a getter,
 * not a static snapshot property, because `getRegistrations` is re-read at
 * observer creation and on every subsequent navigation (FEATURE §3,
 * Observable Transition Signal, step 2.1: "reading the consumer's own
 * registered-extensions source at this same moment") — a snapshot could not
 * reflect a set that changes after creation without the separate `onChange`
 * notification below.
 *
 * `onChange` is present only for a source whose own registered set can
 * change after observer creation; a source that never changes may omit it
 * entirely (§1.5: "a consumer whose set never changes after creation may
 * supply a static snapshot with no change notification").
 */
export interface RegisteredExtensionsSource<TRouteOwner = unknown> {
  getRegistrations(): readonly ExtensionRegistration<TRouteOwner>[];
  onChange?(callback: () => void): ReleaseFunction;
}

/**
 * One entry's own resolution outcome: the matching route owner when a
 * registered extension matches, or unresolved when none does.
 *
 * FEATURE (route-ownership-signal) §3, Entry Resolution.
 */
export type EntryResolution<TRouteOwner = unknown> =
  | { readonly resolved: true; readonly routeOwner: TRouteOwner }
  | { readonly resolved: false };

/**
 * One entry currently carrying a domain's own key, paired with its
 * resolution — the shape `Transition#entries` carries.
 *
 * FEATURE (route-ownership-signal) §1.5, "Transition — Entries".
 */
export interface ResolvedEntry<TRouteOwner = unknown> {
  readonly extension: ExtensionToken;
  readonly params: readonly Param[];
  readonly resolution: EntryResolution<TRouteOwner>;
}

// ---------------------------------------------------------------------------
// Route Ownership Signal — §1.5 Contract Shapes, "Transition"
// ---------------------------------------------------------------------------

/**
 * The diff a transition carries against the previously reported ordered
 * list, per FEATURE (route-ownership-signal) §1.5, "Transition — Diff".
 *
 * `reordered` is a single boolean, not a token list: "whether the relative
 * order of the extension tokens present in both reports changed" (§1.5) —
 * the FEATURE never asks which positions moved, only whether any did.
 * `unresolved` restates a subset of the *current* `Transition#entries`; it
 * is not itself computed against the previous report the way the other
 * five fields are (§1.5: "not itself a diff category against the previous
 * report, only a restated subset of the current Entries").
 */
export interface TransitionDiff {
  readonly added: readonly ExtensionToken[];
  readonly removed: readonly ExtensionToken[];
  readonly payloadChanged: readonly ExtensionToken[];
  readonly reordered: boolean;
  readonly resolutionChanged: readonly ExtensionToken[];
  readonly unresolved: readonly ExtensionToken[];
}

/**
 * The value delivered to the callback a consumer registers when creating a
 * domain's own observer — never delivered at all when every one of the
 * diff's five change categories is empty or false (FEATURE §1.5,
 * "Transition").
 */
export interface Transition<TRouteOwner = unknown> {
  readonly domainKey: DomainKey;
  readonly entries: readonly ResolvedEntry<TRouteOwner>[];
  readonly diff: TransitionDiff;
}

/**
 * The release function returned at observer creation, alongside registering
 * its callback (FEATURE (route-ownership-signal) §1.5, "Release function").
 * A direct alias of `ReleaseFunction`, not a wrapper object of its own — the
 * FEATURE names no member beyond "release", so there is nothing a wrapper
 * would carry that the function itself does not already provide.
 */
export type ObserverHandle = ReleaseFunction;

// ---------------------------------------------------------------------------
// Route Ownership Signal — §1.5 Contract Shapes, "URL back-projection"
// ---------------------------------------------------------------------------

/**
 * One entry the caller wants added or used as the new side of a
 * replacement — `{extension, params}`, per FEATURE (route-ownership-signal)
 * §1.5, "URL back-projection — input".
 */
export interface EntryInit {
  readonly extension: ExtensionToken;
  readonly params: readonly Param[];
}

/**
 * One payload-changed pair: the extension token is unchanged, and `params`
 * is the entry's *entire* new ordered parameter list, replacing (never
 * merging with) the one it already carries (FEATURE §1.5, "URL
 * back-projection — input").
 */
export interface PayloadChange {
  readonly extension: ExtensionToken;
  readonly params: readonly Param[];
}

/**
 * One replaced pair: an existing entry's own extension token, `oldExtension`,
 * swapped for `entry` at that same position — triggering the identical
 * structural reset a removal of `oldExtension` would trigger, in the same
 * history write (FEATURE §1.5, "URL back-projection — input").
 */
export interface ReplacedEntry {
  readonly oldExtension: ExtensionToken;
  readonly entry: EntryInit;
}

/**
 * The delta a caller passes to the URL back-projection helper, naming only
 * what changed for one domain key. Every field is optional, not
 * required-but-possibly-empty — the caller "names only what changed"
 * (§1.5), so a call that only adds an entry never has to spell out
 * `removed: []`, `payloadChanged: []`, and so on for the four operations it
 * does not use; an absent field is equivalent to an empty list for that
 * kind of change.
 *
 * The FEATURE does not state what happens when a caller names the identical
 * token in more than one operation for the same call — the implementation
 * (`src/signal/url-back-projection.ts`) resolves that silently, by
 * precedence, in the order the transform loop checks each map:
 * `replaced` wins over `removed`, which wins over `payloadChanged`, for a
 * token present in more than one of those three. `added` naming a token
 * that also currently survives is not caught here at all — it is only
 * caught downstream, by grammar serialize's own `duplicate-extension` check
 * once the composed list is serialized.
 *
 * FEATURE (route-ownership-signal) §1.5, "URL back-projection — input";
 * §3, URL Back-Projection Helper Via Own-Key Rewrite.
 */
export interface BackProjectionDelta {
  readonly added?: readonly EntryInit[];
  readonly removed?: readonly ExtensionToken[];
  readonly payloadChanged?: readonly PayloadChange[];
  readonly replaced?: readonly ReplacedEntry[];
  /** A new relative order for this domain's own currently-present entries,
   * confined to the positions they already occupy. Absent means "no
   * reorder for this call." */
  readonly reordered?: readonly ExtensionToken[];
}

/**
 * The history verb a back-projection caller chooses for its own call —
 * never fixed by the helper itself (§1.4, Binding obligation, point 6;
 * §3, URL Back-Projection Helper, "Rationale").
 */
export type HistoryVerb = 'push' | 'replace';

// ---------------------------------------------------------------------------
// Navigation Substrate — §1.5 Contract Shapes, "Engine-provider port shape"
// ---------------------------------------------------------------------------

/**
 * The entry address an occupant was mounted at: its own domain key and its
 * own extension. Uniform across every domain in the tree, at any depth and
 * any occupant count (§1.5, "Engine-provider port shape").
 */
export interface EntryAddress {
  readonly domainKey: DomainKey;
  readonly extension: ExtensionToken;
}

/**
 * The construction input a conforming engine-provider port **MUST** accept
 * (§1.5, "Engine-provider port shape"): the realm-shared `NavigationHistory`
 * instance; the entry address this occupant was mounted at, or `undefined`
 * when the unit is served standalone with no entry address at all; and the
 * microfrontend's own route tree, carried opaquely (`TRouteTree`) and never
 * inspected by this package.
 */
export interface EngineProviderInput<TRouteTree = unknown> {
  readonly history: NavigationHistory;
  readonly entryAddress: EntryAddress | undefined;
  readonly routeTree: TRouteTree;
}

/**
 * The port's own normative contract: a conforming provider is a function
 * from `EngineProviderInput` to a constructed, mounted router (`TRouter`,
 * opaque to this package — the ecosystem's own default provider and any
 * other conforming provider each choose their own concrete shape). Modelled
 * as a callable rather than a class/constructor shape because the FEATURE
 * states the contract as "a function that accepts ... and returns ..."
 * (§1.5) — a plain function is the smallest shape satisfying that.
 *
 * FEATURE (navigation-substrate) §1.5, "Engine-provider port shape" — this
 * package's single normative statement of the port; a provider's own
 * adaptation of it is a worked example recorded in that provider's own
 * FEATURE, never a second normative copy.
 */
export type EngineProviderPort<TRouteTree = unknown, TRouter = unknown> = (
  input: EngineProviderInput<TRouteTree>,
) => TRouter;

// ---------------------------------------------------------------------------
// Errors thrown at validated input paths — ADR 0003, "Occupant Identity
// Lexical Rule"; FEATURE (navigation-substrate) §3, Domain-Key Composition,
// Grammar Serialize; FEATURE (route-ownership-signal) §3, Observable
// Transition Signal, URL Back-Projection Helper
// ---------------------------------------------------------------------------

/**
 * The seven shapes a thrown `RoutingError` (`../errors.js`) can carry, one
 * per `code`. Documented here as prose, not as exported interfaces: no value
 * ever satisfies one of these shapes on its own — `RoutingError` is a
 * single flat runtime class whose static factories populate only the
 * field(s) a given code declares, leaving the rest `undefined` — so a
 * per-code interface would describe a value that is never actually
 * produced or consumed anywhere in this package's own public surface
 * (DESIGN §3.3 lists no per-code error type).
 *
 * - `invalid-domain-key` — `value` (the offending key); `entry` set only
 *   when thrown by grammar serialize (FEATURE §3, Grammar Serialize, step
 *   1.1: "THROW an error naming this entry"), absent at every other throw
 *   site (observer creation, the back-projection helper, domain-key
 *   composition).
 * - `invalid-extension-token` — `value`; `entry` set only when thrown by
 *   grammar serialize, for the identical reason as above.
 * - `invalid-name` — `value`; thrown only by domain-key composition
 *   (FEATURE (navigation-substrate) §3, Domain-Key Composition, step 3).
 * - `duplicate-param-name` — `entry`; a grammar-serialize input entry
 *   carried two params of the identical name (FEATURE §3, Grammar
 *   Serialize, step 1.2).
 * - `duplicate-extension` — `entries`, a pair; a grammar-serialize input
 *   list carried two entries sharing the identical `domainKey` and
 *   `extension` (FEATURE §3, Grammar Serialize, step 1.3).
 * - `reordered-not-permutation` — `domainKey`, `reordered`; the URL
 *   back-projection helper's own `reordered` delta named a set of
 *   extension tokens that is not exactly the set of this domain key's own
 *   entries surviving the delta's other operations (added, removed,
 *   payload-changed, replaced) — a missing survivor, an extra token, or a
 *   duplicate. None of the other five codes names this case: it is neither
 *   a lexical failure (`invalid-*`) nor a serialize-input shape violation
 *   (`duplicate-*`), so it is its own code.
 * - `no-navigation-history-in-realm` — no fields set; `resolveNavigationHistory`
 *   (`../history/singleton.js`) was called with no adapter override in a
 *   realm carrying no `window` at all (an SSR render, most commonly) — the
 *   one code this package throws from resolving the realm-shared singleton
 *   itself, rather than from a grammar/back-projection/observer input.
 */

// ---------------------------------------------------------------------------
// Algorithm signatures — FEATURE (navigation-substrate) §3; FEATURE
// (route-ownership-signal) §3
//
// These type the *shape* of each algorithm's input/output per its own
// FEATURE section; the implementation itself lives alongside each function
// (`src/grammar/*.ts`, `src/signal/*.ts`), typed against the alias declared
// here.
// ---------------------------------------------------------------------------

/** `cpt-frontx-algo-routing-navigation-substrate-grammar-parse`. */
export type ParseGrammar = (
  input:
    | string
    | { readonly shellSubroute: string; readonly search: string; readonly hash?: string },
) => ParseResult;

/** `cpt-frontx-algo-routing-navigation-substrate-grammar-serialize`. */
export type SerializeGrammar = (input: SerializeInput) => string;

/** `cpt-frontx-algo-routing-navigation-substrate-name-validity`, Validity (a). */
export type ValidateName = (candidate: string) => boolean;

/** `cpt-frontx-algo-routing-navigation-substrate-name-validity`, Extension-token derivation (b).
 *
 * Returns `undefined` for "not routable" rather than a sentinel string: a
 * string like `'not-routable'` is itself a valid `name` an occupant could
 * legitimately register as its own route, so it would collide with a real
 * extension token instead of unambiguously marking the absent/invalid case.
 */
export type DeriveExtensionToken = (route: string | undefined) => ExtensionToken | undefined;

/** `cpt-frontx-algo-routing-navigation-substrate-name-validity`, Equality (c). */
export type NamesEqual = (a: string, b: string) => boolean;

/** `cpt-frontx-algo-routing-navigation-substrate-domain-key-compose`. */
export type ComposeDomainKey = (
  parentDomainKey: DomainKey,
  parentExtension: ExtensionToken,
  name: string,
) => DomainKey;

/** `cpt-frontx-algo-routing-route-ownership-signal-entry-resolution`. */
export type ResolveEntries = <TRouteOwner = unknown>(
  domainKey: DomainKey,
  entries: readonly Entry[],
  source: RegisteredExtensionsSource<TRouteOwner>,
) => readonly ResolvedEntry<TRouteOwner>[];

/** `cpt-frontx-algo-routing-route-ownership-signal-observe-change`. */
export type CreateObserver = <TRouteOwner = unknown>(
  domainKey: DomainKey,
  source: RegisteredExtensionsSource<TRouteOwner>,
  onTransition: (transition: Transition<TRouteOwner>) => void,
) => ObserverHandle;

/** `cpt-frontx-algo-routing-route-ownership-signal-url-back-projection`. */
export type BackProjectEntries = (
  domainKey: DomainKey,
  delta: BackProjectionDelta,
  verb: HistoryVerb,
) => void;
