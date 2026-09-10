// Test-only double for `HistoryAdapter` (packages/routing/src/history/adapter.ts).
//
// Simulates the *shape* of `window.history` + `popstate` this package's
// history construction depends on, without any DOM: an in-memory entry
// stack, `pushState`/`replaceState` that never fire a pop, and `go` /
// `simulateExternalPop` that fire registered pop listeners on a microtask —
// mirroring the FEATURE's own observation that "moving through history
// raises popstate only asynchronously" (navigation-substrate FEATURE §3,
// Fan-Out Subscription Dispatch, step 3).
import type { Location } from '../../types/index.js';

function splitPath(path: string): Location {
  const hashIndex = path.indexOf('#');
  const withoutHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex + 1);

  const searchIndex = withoutHash.indexOf('?');
  const pathname = searchIndex === -1 ? withoutHash : withoutHash.slice(0, searchIndex);
  const search = searchIndex === -1 ? '' : withoutHash.slice(searchIndex + 1);

  return { path: pathname, search, hash };
}

export class FakeHistoryAdapter {
  private entries: Location[];
  private index = 0;
  private popListeners = new Set<() => void>();

  /**
   * The raw string argument the most recent `pushState`/`replaceState` call
   * received — never re-split and re-joined through `getLocation()`, unlike
   * `Location`. A test asserting on what a write actually put in the
   * address bar (rather than on this adapter's own subsequent
   * re-interpretation of it) must read this field, not reconstruct a URL
   * from `getLocation()` — the latter can silently mask a defect in the
   * exact string written (e.g. a spurious trailing `#` that `getLocation`'s
   * own empty-hash normalization would otherwise absorb on the way back
   * out).
   */
  lastWrite: string | undefined;

  constructor(initialPath = '/') {
    this.entries = [splitPath(initialPath)];
  }

  getLocation(): Location {
    return this.entries[this.index];
  }

  pushState(path: string): void {
    this.lastWrite = path;
    // Real pushState truncates any forward entries a prior back step left
    // reachable, exactly like a real browser history stack.
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(splitPath(path));
    this.index += 1;
  }

  replaceState(path: string): void {
    this.lastWrite = path;
    this.entries[this.index] = splitPath(path);
  }

  go(delta: number): void {
    const nextIndex = this.index + delta;
    if (nextIndex < 0 || nextIndex >= this.entries.length) {
      return; // real `history.go` past either end is a silent no-op
    }
    this.index = nextIndex;
    this.firePopAsync();
  }

  onPop(listener: () => void): () => void {
    this.popListeners.add(listener);
    return () => {
      this.popListeners.delete(listener);
    };
  }

  /** Simulates a browser-observed navigation this adapter's own `go` did not
   * cause: a user's back/forward step, a third-party `history.go`, or a
   * fragment-only anchor activation that adds a new entry. */
  simulateExternalPop(path: string): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(splitPath(path));
    this.index += 1;
    this.firePopAsync();
  }

  private firePopAsync(): void {
    queueMicrotask(() => {
      for (const listener of this.popListeners) {
        listener();
      }
    });
  }
}
