// Test-only double for `@gears-frontx/routing`'s own `HistoryAdapter`.
// Copied from that package's own `src/__tests__/history/fake-history-adapter.ts`
// pattern. `AdapterLocation` is imported straight from that sibling
// package's own `./adapter.ts` (N2, review round 16-re3) rather than
// through `@gears-frontx/routing`'s public entry point: neither
// `AdapterLocation` nor `HistoryAdapter` is re-exported there any more (see
// `packages/routing/src/history/index.ts`'s own comment for why), exactly
// as that package's module comment already directs a test to do.
import type { AdapterLocation } from '../../../../routing/src/history/adapter.js';

function splitPath(path: string): AdapterLocation {
  const hashIndex = path.indexOf('#');
  const withoutHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex + 1);

  const searchIndex = withoutHash.indexOf('?');
  const pathname = searchIndex === -1 ? withoutHash : withoutHash.slice(0, searchIndex);
  const search = searchIndex === -1 ? '' : withoutHash.slice(searchIndex + 1);

  return { path: pathname, search, hash };
}

export class FakeHistoryAdapter {
  private entries: AdapterLocation[];
  // Mirrors `window.history.state` per entry, exactly as the core
  // package's own `FakeHistoryAdapter` does (see that copy's own comment) —
  // needed now that position (F8/D3, review round 16-re) is restored from
  // this per-entry state on an external pop.
  private entryStates: unknown[];
  private index = 0;
  private popListeners = new Set<() => void>();

  /** The raw string argument the most recent `pushState`/`replaceState`
   * call received — the seam a test asserts the single write's exact URL
   * against, rather than reconstructing one from `getLocation()`. */
  lastWrite: string | undefined;

  constructor(initialPath = '/') {
    this.entries = [splitPath(initialPath)];
    this.entryStates = [undefined];
  }

  getLocation(): AdapterLocation {
    return this.entries[this.index];
  }

  getState(): unknown {
    return this.entryStates[this.index];
  }

  pushState(path: string, state?: unknown): void {
    this.lastWrite = path;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entryStates = this.entryStates.slice(0, this.index + 1);
    this.entries.push(splitPath(path));
    this.entryStates.push(state);
    this.index += 1;
  }

  replaceState(path: string, state?: unknown): void {
    this.lastWrite = path;
    this.entries[this.index] = splitPath(path);
    this.entryStates[this.index] = state;
  }

  go(delta: number): void {
    const nextIndex = this.index + delta;
    if (nextIndex < 0 || nextIndex >= this.entries.length) {
      return;
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
   * cause: a back/forward step, a third-party `history.go`, or a
   * fragment-only anchor activation. */
  simulateExternalPop(path: string): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entryStates = this.entryStates.slice(0, this.index + 1);
    this.entries.push(splitPath(path));
    this.entryStates.push(undefined);
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
