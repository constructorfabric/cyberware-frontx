// Substrate-owned per-entry position bookkeeping.
//
// FEATURE (navigation-substrate) §3, Position Tracking
// (`cpt-frontx-algo-routing-navigation-substrate-position-tracking`) — the
// human ruling behind this file (F8/D3, review round 16-re): the position
// of the current entry belongs to the navigation substrate, not to any one
// engine-provider port's own ad hoc counter, because only the substrate
// itself sits on both sides of every write *and* every externally observed
// traversal (`popstate`) — a provider-local counter can only ever see the
// writes and traversals its own `push`/`go`/`back`/`forward` calls
// initiated, drifting from reality the moment a second router, a real
// back/forward gesture, or a third-party `history.go` moves the shared
// history without going through it.
//
// This is substrate bookkeeping, not entry-carried state in the sense
// `cpt-frontx-constraint-routing-no-engine-leak` forbids (`../types/index.js`,
// `Location.position` doc comment; FEATURE §1.5, "Entry-carried state — not
// part of this contract"): the only value this substrate ever writes into
// the host's own per-entry state is its own position number, under its own
// namespaced key, merged with whatever the host already carries there
// rather than replacing it outright.
import type { HistoryAdapter } from './adapter.js';

/** @internal Namespaced key this package reserves inside the host's own
 * per-entry state object — never a bare `position` key, which could collide
 * with a state shape the host, or another library sharing the same entry,
 * already writes there. Exported only for this file's own tests. */
export const POSITION_STATE_KEY = '@gears-frontx/routing';

interface PositionState {
  readonly position: number;
}

function isPositionState(value: unknown): value is PositionState {
  return typeof value === 'object' && value !== null && typeof (value as { position?: unknown }).position === 'number';
}

/**
 * Reads this substrate's own recorded position back out of a raw state
 * value read from the host (`HistoryAdapter#getState`), or `undefined` when
 * the current entry carries none of this substrate's own state at all — a
 * cold mount (the page's very first entry, never written by this
 * substrate), or an entry a real browser back/forward step landed on that
 * this substrate never itself wrote a position onto (a "foreign" entry).
 * Both cases are indistinguishable to this function, and both are treated
 * identically by its own caller: as position `0`, recorded lazily on this
 * instance's own next `push`/`replace` rather than written here (this
 * function only reads).
 */
export function readPosition(rawState: unknown): number | undefined {
  if (typeof rawState !== 'object' || rawState === null) {
    return undefined;
  }
  const namespaced = (rawState as Record<string, unknown>)[POSITION_STATE_KEY];
  return isPositionState(namespaced) ? namespaced.position : undefined;
}

/**
 * Builds the state value to pass to `HistoryAdapter#pushState`/`replaceState`
 * for `position`, merging it into `rawState` under this substrate's own
 * namespaced key so every other key already on `rawState` survives the
 * write untouched — a host (or another library sharing the same entry) that
 * had already stored something in this entry's own state does not lose it
 * to this substrate's own write.
 */
export function writePosition(rawState: unknown, position: number): unknown {
  const base = typeof rawState === 'object' && rawState !== null ? (rawState as Record<string, unknown>) : {};
  return { ...base, [POSITION_STATE_KEY]: { position } satisfies PositionState };
}

/**
 * Reads `adapter`'s own current entry position at construction — the
 * cold-mount/foreign-entry default of `0` applies identically here, since
 * this is the same read `readPosition` performs, just named for its one
 * call site's own intent (`createNavigationHistory`'s own initial value).
 */
export function readInitialPosition(adapter: Pick<HistoryAdapter, 'getState'>): number {
  return readPosition(adapter.getState()) ?? 0;
}
