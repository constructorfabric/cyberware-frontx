/**
 * Realm-global mount-context rendezvous and inbound-bridge linking.
 *
 * Internal registry plumbing for cross-nesting reachability (MFES-6). NOT
 * exported from the package's public barrel (`src/index.ts`) — every export
 * here is reachable only from other files inside this package.
 *
 * Two responsibilities:
 *
 * 1. Mounting-bridge rendezvous: while `DefaultMountManager.mountExtension`
 *    is synchronously invoking an extension's `lifecycle.mount(...)`, the
 *    `ChildMfeBridge` handed to that extension is recorded at a
 *    `globalThis`-anchored, version-namespaced rendezvous point — not an
 *    ES-module-scoped variable — because the mounting extension and a
 *    registry it constructs synchronously inside its own `mount()` body may
 *    each hold their own independently loaded copy of this package
 *    (`cpt-frontx-adr-mfe-load-isolation`), and only `globalThis` (and object
 *    references explicitly passed across the boundary) reliably cross that
 *    boundary. If the extension's own `mount()` body synchronously
 *    constructs a further `MfeRegistry`, that new registry's constructor —
 *    running in either copy — reads the same rendezvous point and, if a link
 *    was registered for the found bridge, automatically adopts it as its own
 *    inbound bridge, with no configuration or method call.
 *
 * 2. Inbound-bridge link: the `InboundBridgeLink` a parent registry mints for
 *    a specific child bridge (`registerInboundBridgeLink`) is attached
 *    directly to that bridge OBJECT — via a well-known symbol property, not
 *    a module-scoped `WeakMap` — because a `WeakMap` created by one copy of
 *    this module is invisible to code executing in a different, independently
 *    loaded copy, whereas a property on the shared bridge object itself
 *    (passed by reference across the boundary the same way the bridge is)
 *    is visible to both. The link is how a nested registry propagates
 *    admission advertisements upward, escalates unresolved dispatches
 *    upward, and retracts advertisements on disposal — all without any new
 *    public method on `ChildMfeBridge`, `ParentMfeBridge`, or `MfeRegistry`.
 *
 * @packageDocumentation
 * @internal
 */

import type { ChildMfeBridge } from '../handler/types';
import type { Action, ActionsChain } from '../types';

// ─── Realm-global mounting-bridge rendezvous ───────────────────────────────
// @cpt-algo:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2

/**
 * The rendezvous protocol version this copy of the package produces and
 * recognizes. Bumped to `2` to extend the rendezvous into a two-way handoff
 * within the same synchronous window: version 1 only carried the bridge
 * downward (mounting extension -> adopting registry); version 2 additionally
 * carries re-link callbacks back upward (adopting registry -> mount manager),
 * collected in `adopters` and returned by `popAmbientMountingBridge` so a
 * later mount of the SAME host extension can re-offer a fresh link to a
 * registry that was reused, not rebuilt. A stale v1 reader still finds the
 * entry and correctly degrades via the existing "unrecognized version"
 * diagnostic path, since only the entry's own version field changed — the
 * `RENDEZVOUS_KEY` is unchanged.
 */
const RENDEZVOUS_PROTOCOL_VERSION = 2 as const;

/** A callback through which a previously adopted `InboundBridgeLink` can be replaced (or cleared, with `null`) on a later mount of the same host extension. */
export type InboundBridgeRelink = (link: InboundBridgeLink | null) => void;

/**
 * A single rendezvous entry: the bridge currently being handed to an
 * in-progress synchronous `lifecycle.mount(...)` invocation, tagged with the
 * protocol version of the copy that pushed it. Any reader — regardless of
 * which independently loaded copy of this package it belongs to — that finds
 * a version it does not recognize treats the rendezvous as empty rather than
 * guessing at an incompatible shape.
 *
 * `adopters` collects the re-link callback of every registry that adopts
 * `bridge` during this window (ordinarily zero or one) — published by
 * `adoptAmbientInboundBridgeLink` and handed back to the caller by
 * `popAmbientMountingBridge`, which is the sole channel through which a later
 * mount of the same host extension can reach an already-constructed registry.
 * Nothing persists at the rendezvous itself once the entry is popped.
 */
interface RendezvousEntry {
  readonly v: number;
  readonly bridge: ChildMfeBridge;
  readonly adopters: InboundBridgeRelink[];
}

/**
 * `Symbol.for(...)` — not a module-scoped variable — so every independently
 * loaded copy of this package resolves to the exact same global symbol
 * registry key, and therefore the exact same backing array on `globalThis`,
 * regardless of which copy's module instance is executing. This mirrors the
 * existing `globalThis.__FRONTX_LAZY__` pattern (`lazy-loader-registry.ts`)
 * used for the identical reason.
 */
const RENDEZVOUS_KEY = Symbol.for('@gears-frontx/mfes:mount-context:1');

/**
 * Well-known symbol property key under which a parent registry attaches the
 * `InboundBridgeLink` it minted for a specific child bridge, directly on
 * that bridge object. Reading this property works identically from any
 * copy of this package, since it is a plain property access on a shared
 * object reference rather than a lookup into a per-copy data structure.
 */
const LINK_PROPERTY_KEY = Symbol.for('@gears-frontx/mfes:inbound-bridge-link:1');

interface RendezvousGlobal {
  [RENDEZVOUS_KEY]?: RendezvousEntry[];
}

function getRendezvousStack(): RendezvousEntry[] {
  const host = globalThis as unknown as RendezvousGlobal;
  let stack = host[RENDEZVOUS_KEY];
  if (!stack) {
    stack = [];
    host[RENDEZVOUS_KEY] = stack;
  }
  return stack;
}

/**
 * @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-track-mounting-bridge
 * Called by `DefaultMountManager.mountExtension` immediately before invoking
 * `lifecycle.mount(...)`. Must be paired with `popAmbientMountingBridge()`
 * once the synchronous portion of that invocation returns (i.e. right after
 * the call expression, not after the awaited promise settles) so the
 * rendezvous window scopes exactly to the synchronous invocation, per spec.
 * A stack (not a single slot) so nested synchronous mounts — however
 * unlikely — cannot clobber each other's entry.
 */
export function pushAmbientMountingBridge(bridge: ChildMfeBridge): void {
  getRendezvousStack().push({ v: RENDEZVOUS_PROTOCOL_VERSION, bridge, adopters: [] });
}

/**
 * Called immediately after the synchronous portion of `lifecycle.mount(...)`
 * returns (a value or a pending Promise), ending the rendezvous window.
 *
 * Returns the popped entry's `adopters` array — the re-link callback of every
 * registry that adopted `bridge` during this window (empty for the ordinary
 * case where nothing adopted, e.g. no registry was constructed, or the
 * extension is not itself a host). Nothing is retained at the rendezvous
 * after this call; the caller (`DefaultMountManager`) is solely responsible
 * for retaining `adopters` against the host extension for as long as it may
 * mount again.
 */
export function popAmbientMountingBridge(): readonly InboundBridgeRelink[] {
  return getRendezvousStack().pop()?.adopters ?? [];
}
// @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-track-mounting-bridge

// ─── Inbound bridge link ────────────────────────────────────────────────────

/**
 * A registry's link to its immediate parent registry, through the bridge its
 * own host extension received at mount time (the "inbound bridge").
 *
 * This is registry-internal plumbing only (`cpt-frontx-constraint-mfes-cross-nesting-reachability`,
 * MFES-6): it is never handed to child code and never surfaces as a method on
 * `ChildMfeBridge`, `ParentMfeBridge`, or `MfeRegistry`.
 */
export interface InboundBridgeLink {
  /**
   * Identity token for loop containment: the same `ChildMfeBridge` instance
   * used both as this registry's inbound bridge and, from the parent's side,
   * as the key recorded alongside any forwarding entry created for a target
   * this registry (or one of its descendants) advertised. Compared by
   * reference, never invoked directly.
   */
  readonly edge: ChildMfeBridge;

  /**
   * Propagate a forwarding advertisement to the immediate parent registry.
   * Returns `true` if the parent accepted (recorded) it, `false` if the
   * parent's collision guard rejected it. Realizes `inst-propagate-upward`,
   * `inst-collision-check`, `inst-collision-reject`,
   * `inst-record-forwarding-entry`, and `inst-repropagate-upward`.
   */
  propagateAdvertisement(targetId: string, actionTypeIds: readonly string[]): boolean;

  /**
   * Retract a previously propagated advertisement from the immediate parent
   * registry, rejecting any in-flight action the parent had forwarded down
   * to this target. Realizes `inst-retract-advertisements` and
   * `inst-reject-inflight-retracted`.
   */
  retractAdvertisement(targetId: string): void;

  /**
   * Forward an unresolved chain to the immediate parent registry's mediator
   * for resolution. Minted by the parent at link time (`inst-mint-escalation-on-link`);
   * the parent's own implementation tags the chain with this link's `edge`
   * as its arrival edge before forwarding, so the parent's own
   * forwarding-entry resolution never re-selects it as the chain's next hop.
   * Realizes `inst-escalation-lookup` and `inst-tag-arrival-edge`.
   */
  escalate(chain: ActionsChain): Promise<void>;
}

interface LinkCarryingBridge {
  [LINK_PROPERTY_KEY]?: InboundBridgeLink;
}

/**
 * Called by the parent registry (via `DefaultMountManager.mountExtension`)
 * right before invoking `lifecycle.mount(...)`, attaching the link a nested
 * registry constructed during that call should adopt directly onto the
 * bridge the extension is about to receive. Attaching it to the bridge
 * object itself — rather than a side `WeakMap` keyed by the bridge — is what
 * lets a reader in a different, independently loaded copy of this package
 * find it, since only the bridge object crosses that boundary reliably.
 */
export function registerInboundBridgeLink(bridge: ChildMfeBridge, link: InboundBridgeLink): void {
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-mint-escalation-on-link
  (bridge as unknown as LinkCarryingBridge)[LINK_PROPERTY_KEY] = link;
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-mint-escalation-on-link
}

/**
 * Detaches the `InboundBridgeLink` previously attached to `bridge` by
 * `registerInboundBridgeLink`, once the parent registry has finished
 * retracting that link (`DefaultMfeRegistry.retractInboundBridgeLinkFor`).
 *
 * The link's `propagateAdvertisement`/`retractAdvertisement`/`escalate`
 * closures all capture the parent registry's own `this`; leaving the
 * property in place after retraction would keep the bridge object — which
 * may outlive the link (e.g. an author-held reference, or a reused nested
 * registry per `inst-nested-registry-lifetime-scope`) — holding a strong
 * reference back into the ancestor registry for no further purpose. Safe to
 * call even if no link is attached (e.g. a root extension with no nested
 * registry ever adopted it).
 */
export function unregisterInboundBridgeLink(bridge: ChildMfeBridge): void {
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-retract-advertisements
  delete (bridge as unknown as LinkCarryingBridge)[LINK_PROPERTY_KEY];
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-retract-advertisements
}

/**
 * Called from `DefaultMfeRegistry`'s constructor. Returns the link prepared
 * for the ambient mounting bridge, if one is currently at the top of the
 * rendezvous stack, tagged with a protocol version this copy recognizes, and
 * has a link registered for it — this is the entire "automatic adoption"
 * mechanism: no configuration, no method call, no author action.
 *
 * Only logs a diagnostic when the rendezvous holds an entry this copy cannot
 * use (unrecognized version, or a bridge with no link attached) — not on the
 * ordinary case of an empty rendezvous (most registries, including the
 * shell, are constructed with no mount synchronously in progress at all).
 *
 * @param relink Callback the caller (`DefaultMfeRegistry`) supplies to replace
 * (or, with `null`, clear) whichever link it adopts here. Published onto the
 * rendezvous entry's `adopters` array — never invoked from this function
 * itself — so `popAmbientMountingBridge` can hand it back to the mount
 * manager, which retains it against the host extension as the sole channel
 * through which a later mount of that same extension can reach this
 * already-constructed registry (`inst-publish-relink-callback`).
 */
export function adoptAmbientInboundBridgeLink(
  relink: InboundBridgeRelink
): InboundBridgeLink | undefined {
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-adopt-ambient-bridge
  const stack = getRendezvousStack();
  const entry = stack[stack.length - 1];
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-no-ambient-bridge
  if (!entry) {
    // Ordinary root/shell case: no mount synchronously in progress. Not
    // worth a diagnostic — this is the common path for every top-level
    // registry construction.
    return undefined;
  }

  if (entry.v !== RENDEZVOUS_PROTOCOL_VERSION) {
    console.debug(
      '[DefaultMfeRegistry] Mount-context rendezvous entry carries an unrecognized ' +
      `protocol version (found ${entry.v}, this copy recognizes ${RENDEZVOUS_PROTOCOL_VERSION}). ` +
      'Treating this registry as a root registry rather than misattributing another ' +
      'extension\'s bridge.'
    );
    return undefined;
  }
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-no-ambient-bridge

  const link = (entry.bridge as unknown as LinkCarryingBridge)[LINK_PROPERTY_KEY];
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-registry-is-root
  if (!link) {
    console.debug(
      '[DefaultMfeRegistry] A mount is synchronously in progress but no inbound-bridge ' +
      'link was found on its bridge. Treating this registry as a root registry.'
    );
    return undefined;
  }
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-registry-is-root
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-publish-relink-callback
  entry.adopters.push(relink);
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-publish-relink-callback
  // @cpt-begin:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-inbound-bridge-auto-adopt
  return link;
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-inbound-bridge-auto-adopt
  // @cpt-end:cpt-frontx-algo-mfe-host-communication-registration-propagation:p2:inst-adopt-ambient-bridge
}

// ─── Arrival-edge tagging (loop containment) ───────────────────────────────

/**
 * Tags the actual `Action` object instance carried by an escalating chain
 * with the bridge it is escalating through, so that when the parent registry
 * resolves a handler for it, forwarding-entry resolution can exclude the
 * entry pointing back through that same bridge (`inst-tag-arrival-edge`).
 * Keyed by object identity — never serialized, never crosses a real process
 * boundary (nesting is always in-process). Both the write (from the
 * parent-minted `InboundBridgeLink.escalate`, in `DefaultMfeRegistry`'s
 * `buildInboundBridgeLinkFor`) and the read (from `resolveHandler` in the
 * SAME parent registry's own mediator) execute inside the parent's own copy
 * of this module, so a module-scoped `WeakMap` here is correct — unlike the
 * mounting-bridge rendezvous above, this state never needs to be read from a
 * different copy than the one that wrote it.
 */
const arrivalEdgeByAction = new WeakMap<Action, ChildMfeBridge>();

/** @cpt-begin:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-tag-arrival-edge */
export function tagArrivalEdge(action: Action, edge: ChildMfeBridge): void {
  arrivalEdgeByAction.set(action, edge);
}

export function getArrivalEdge(action: Action): ChildMfeBridge | undefined {
  return arrivalEdgeByAction.get(action);
}
/** @cpt-end:cpt-frontx-algo-mfe-host-communication-mediator-dispatch:p1:inst-tag-arrival-edge */
