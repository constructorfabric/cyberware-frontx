/**
 * useApiStream - Declarative SSE streaming hook
 *
 * Accepts a StreamDescriptor from @gears-frontx/api and returns the latest
 * event, accumulated events, connection status, and a manual disconnect
 * function.
 *
 * @example
 * ```tsx
 * const { data, events, status, error } = useApiStream(
 *   service.messageStream,
 *   { mode: 'latest' }   // default — data holds last event
 * );
 *
 * // Accumulate all events
 * const { events, status } = useApiStream(service.messageStream, { mode: 'accumulate' });
 * ```
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { StreamDescriptor, StreamStatus } from '@gears-frontx/framework';
import { useLatest } from './useLatest';

/** Configuration options for useApiStream. */
export interface ApiStreamOptions {
  /**
   * `'latest'` (default) — `data` holds the most recent event.
   * `'accumulate'` — `events` holds all received events in order.
   */
  mode?: 'latest' | 'accumulate';
  /** When false the connection is deferred (no connect on mount). Default true. */
  enabled?: boolean;
}

/** Return type of useApiStream. */
export interface ApiStreamResult<TEvent> {
  /** Latest event payload, set in both modes — `undefined` until the first event and after each connect attempt resets it. */
  data: TEvent | undefined;
  /** All received events when `mode: 'accumulate'`; empty array in `'latest'` mode. */
  events: TEvent[];
  /** Connection lifecycle status. */
  status: StreamStatus;
  /** Last connect error — set when a connect attempt rejects, cleared when the next attempt starts. */
  error: Error | null;
  /** Manually close the connection. */
  disconnect: () => void;
}

/**
 * Manages the status lifecycle for a single SSE stream connection.
 *
 * **Status values**
 * - `'idle'` — no connection is being attempted. This is the status whenever
 *   `enabled` is `false`, including on mount: a hook that mounts disabled
 *   never reports anything but `'idle'` until `enabled` flips to `true`. A
 *   hook that mounts enabled skips `'idle'` entirely — the status is set
 *   during render, so its very first render already reports `'connecting'`.
 *   Consumers must not assume `'idle'` means "never
 *   connected" — a stream that is disabled after having connected returns to
 *   `'idle'` too, and `data`/`events` from the earlier connection are not
 *   cleared by that transition alone (they are cleared by mode/key changes,
 *   see below).
 * - `'connecting'` — a connection attempt is committed to but has not settled.
 *   It is published during the render that turns the stream on, which is
 *   before `descriptor.connect()` runs: the call is made from an effect after
 *   that render commits. So `'connecting'` means "this stream is being
 *   opened", not "the connect promise is pending" — for one render the two
 *   differ, and a consumer that reads the status as proof a request is already
 *   in flight is reading it too strongly.
 * - `'connected'` — set both when `connect()` resolves (unless a disconnect
 *   was requested while it was pending) and, independently, whenever the
 *   `onEvent` callback delivers a new event. Because every event re-asserts
 *   `'connected'`, this status also serves as "still receiving events."
 * - `'disconnected'` — reached via any of: the descriptor's `onComplete`
 *   callback firing (the stream ended normally), `connect()` rejecting while
 *   a disconnect was requested concurrently, or the manual `disconnect()`
 *   function being called. `disconnect()` has no `enabled` guard, but calling
 *   it while the stream is disabled is not observable: the stored status moves
 *   to `'disconnected'` while the published one stays `'idle'`, and flipping
 *   `enabled` back to `true` sets `'connecting'` during that render, so the
 *   stored `'disconnected'` is overwritten before it is ever returned.
 * - `'error'` — `connect()` rejected and no disconnect was requested while it
 *   was pending. `error` holds the rejection, coerced to an `Error` if it
 *   wasn't one already.
 *
 * **Transitions**
 * - Mounting enabled, `enabled` becoming `true`, or `descriptor.key` / `mode`
 *   changing while `enabled` is `true`: `data`, `events`, and `error` are reset
 *   and status is set to `'connecting'` synchronously during render (not from
 *   an effect); `connect()` is then called from an effect that runs after that
 *   render commits.
 * - `descriptor.key` or `mode` changing while `enabled` is `false`: `data`,
 *   `events`, and `error` are reset all the same, since that reset is not gated
 *   on `enabled`, but the status write is - so no `'connecting'` is written and
 *   the published status stays `'idle'`; `connect()` is not called. The skipped
 *   `'connecting'` is not owed later either: the change counts as handled when
 *   it happens, so what publishes `'connecting'` is the subsequent flip of
 *   `enabled` to `true`, once, for whichever key and mode are in force by then.
 * - `enabled` becomes `false` (or starts `false`): the published status is
 *   `'idle'` for as long as `enabled` stays `false` — it is derived from
 *   `enabled` rather than written, so nothing a prior connection stored can
 *   surface through it — and `connect()` is never called; no other field is
 *   reset by this transition alone.
 * - Unmount, `descriptor.key` change, `mode` change, or `enabled` flipping to
 *   `false` while connected or connecting: the previous connection is torn
 *   down via `descriptor.disconnect()` once its `connect()` promise settles
 *   (or immediately skipped if it rejected). All four share the same cleanup
 *   path: the effect's cleanup runs on every dependency change and on unmount.
 * - Calling `disconnect()`: if a connection id is already resolved, it is
 *   disconnected immediately and status becomes `'disconnected'`. If
 *   `connect()` is still pending, the request is recorded and honored when
 *   the promise settles — the newly resolved connection is torn down instead
 *   of being adopted, and status is `'disconnected'`. One caveat:
 *   `disconnect()` does not cancel the event callback, so a buffered or
 *   in-flight event landing after the call re-asserts `'connected'` — and in
 *   the pending-connect case the settle handler tears the connection down
 *   without touching status, so that stray `'connected'` persists.
 * - Stream completion while `connect()` is still pending: the current
 *   implementation lets `onComplete` set `'disconnected'`, then the settle
 *   handler adopts the connection id and re-asserts `'connected'` anyway.
 *   This is known current behavior, not a durable guarantee: a pending
 *   upstream derived-status rewrite is expected to remove this transition.
 *
 * `enabled` (default `true`) is the only way to defer connecting past mount;
 * flipping it back to `true` re-runs the same connect sequence as a fresh
 * mount would.
 */
export function useApiStream<TEvent>(
  descriptor: StreamDescriptor<TEvent>,
  options?: ApiStreamOptions,
): ApiStreamResult<TEvent> {
  const mode = options?.mode ?? 'latest';
  const enabled = options?.enabled ?? true;

  const [data, setData] = useState<TEvent | undefined>(undefined);
  const [events, setEvents] = useState<TEvent[]>([]);
  // Lazy initializer mirrors what the "connecting" render-adjustment below would set on
  // a later (descriptorKey, mode, enabled) change — the adjustment's before/after
  // comparison can't itself detect "this is the very first render", since its own
  // `prevConnectKey` state is seeded from the same initial connectKey.
  const [status, setStatus] = useState<StreamStatus>(() => (enabled ? 'connecting' : 'idle'));
  const [error, setError] = useState<Error | null>(null);

  // Tracks the in-flight connect() promise so cleanup can await it.
  const connectPromiseRef = useRef<Promise<string> | null>(null);
  // Tracks the resolved connectionId for the manual disconnect() callback.
  const connectionIdRef = useRef<string | null>(null);
  /** When true, connect's promise resolution must tear down the new id instead of adopting it. */
  const disconnectRequestedRef = useRef(false);
  // Latest descriptor for connect/disconnect without tying effect or callbacks to object identity.
  const descriptorRef = useLatest(descriptor);

  // Stable identity derived from descriptor key — used as effect dependency.
  // JSON.stringify avoids join('/') collisions when a segment contains '/'.
  const descriptorKey = useMemo(() => JSON.stringify(descriptor.key), [descriptor.key]);

  // Resets stream state when the descriptor or mode changes, using the "adjusting state
  // during render" pattern (react.dev) instead of an effect: this clears stale data
  // before paint in the same render pass rather than committing once with old data and
  // scheduling a second render from an effect.
  const resetKey = `${descriptorKey}:${mode}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setData(undefined);
    setEvents([]);
    setError(null);
  }

  // Same pattern, scoped to when the connect effect below is about to (re)start a
  // connection: also flips `status` to 'connecting' up front, exactly once per
  // (descriptorKey, mode, enabled) combination — matching the effect's dependency list
  // — instead of the effect setting it synchronously on every run.
  const connectKey = `${resetKey}:${enabled}`;
  const [prevConnectKey, setPrevConnectKey] = useState(connectKey);
  if (connectKey !== prevConnectKey) {
    setPrevConnectKey(connectKey);
    if (enabled) {
      setData(undefined);
      setEvents([]);
      setStatus('connecting');
      setError(null);
    }
  }

  const disconnect = useCallback(() => {
    disconnectRequestedRef.current = true;
    if (connectionIdRef.current) {
      descriptorRef.current.disconnect(connectionIdRef.current);
      connectionIdRef.current = null;
      disconnectRequestedRef.current = false;
    }
    setStatus('disconnected');
    // descriptorRef's identity never changes (useLatest returns a stable ref
    // object) — listing it here satisfies exhaustive-deps without altering
    // when this callback is recreated.
  }, [descriptorRef]);

  useEffect(() => {
    // Disabled: no connection attempt. `status` is displayed as 'idle' via the
    // derived value below instead of writing it here — the stored `status` from a
    // prior connection is left untouched so a later re-enable has nothing stale to
    // clean up, and no synchronous setState is needed in this effect.
    if (!enabled) {
      return;
    }

    let cancelled = false;

    disconnectRequestedRef.current = false;

    const d = descriptorRef.current;
    // data/events/status/error were already reset to the 'connecting' state above,
    // during render, for this exact (descriptorKey, mode, enabled) combination.

    const connectPromise = d.connect(
      (event) => {
        if (cancelled) return;
        setData(event);
        setStatus('connected');
        if (mode === 'accumulate') {
          setEvents((prev) => [...prev, event]);
        }
      },
      () => {
        if (cancelled) return;
        setStatus('disconnected');
        connectionIdRef.current = null;
      },
    );

    connectPromiseRef.current = connectPromise;

    connectPromise
      .then((id) => {
        if (cancelled) return;
        if (disconnectRequestedRef.current) {
          d.disconnect(id);
          disconnectRequestedRef.current = false;
          return;
        }
        connectionIdRef.current = id;
        setStatus('connected');
      })
      .catch((err) => {
        if (cancelled) return;
        if (disconnectRequestedRef.current) {
          disconnectRequestedRef.current = false;
          setStatus('disconnected');
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      });

    return () => {
      cancelled = true;
      connectPromise.then(
        (id) => d.disconnect(id),
        () => { /* connect failed — nothing to disconnect */ },
      );
      connectPromiseRef.current = null;
      connectionIdRef.current = null;
    };
    // descriptorRef's identity never changes (useLatest returns a stable ref
    // object) — listing it here satisfies exhaustive-deps without causing
    // this effect to re-run on every render.
  }, [descriptorKey, enabled, mode, descriptorRef]);

  // Derived: while disabled the connection is deliberately not attempted, so the
  // publicly visible status is always 'idle' regardless of what a prior connection
  // left in `status` state.
  return { data, events, status: enabled ? status : 'idle', error, disconnect };
}
