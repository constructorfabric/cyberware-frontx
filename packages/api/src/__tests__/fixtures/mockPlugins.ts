/**
 * Local test fixtures: minimal mock plugins for exercising api-surface behavior.
 *
 * These are intentionally NOT the "real" RestMockPlugin/SseMockPlugin/MockEventSource
 * shipped to app authors — those are template-owned (in the consuming template's own
 * src/api/plugins and src/api/mocks) and out of scope for the ecosystem package. The tests
 * in this directory only need *some* plugin that can short-circuit a request/connection
 * to exercise RestProtocol/SseProtocol plugin-chain, retry, and endpoint-descriptor
 * behavior — so we keep a small local implementation built purely from @gears-frontx/api's
 * own public primitives (RestPluginWithConfig, SsePluginWithConfig, MOCK_PLUGIN, EventSourceLike).
 */

import {
  RestPluginWithConfig,
  SsePluginWithConfig,
  MOCK_PLUGIN,
  type RestRequestContext,
  type RestShortCircuitResponse,
  type SseConnectContext,
  type SseShortCircuitResponse,
  type EventSourceLike,
  type JsonValue,
  type JsonCompatible,
  type MockResponseFactory,
} from '../../types';

export interface LocalRestMockConfig {
  mockMap?: Readonly<Record<string, MockResponseFactory<JsonValue, JsonCompatible>>>;
  delay?: number;
}

/** Minimal REST short-circuit fixture — exact/`:param` match, optional delay, dynamic map updates. */
export class LocalRestMockPlugin extends RestPluginWithConfig<LocalRestMockConfig> {
  static readonly [MOCK_PLUGIN] = true;
  private currentMockMap?: Readonly<Record<string, MockResponseFactory<JsonValue, JsonCompatible>>>;

  constructor(config: LocalRestMockConfig = {}) {
    super(config);
    this.currentMockMap = config.mockMap;
  }

  setMockMap(mockMap: Readonly<Record<string, MockResponseFactory<JsonValue, JsonCompatible>>>): void {
    this.currentMockMap = mockMap;
  }

  async onRequest(
    context: RestRequestContext
  ): Promise<RestRequestContext | RestShortCircuitResponse> {
    const mockFactory = this.findMockFactory(context.method, context.url);
    if (!mockFactory) {
      return context;
    }

    if (this.config.delay && this.config.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delay));
    }

    const mockData = mockFactory(context.body as JsonValue);
    return {
      shortCircuit: {
        status: 200,
        headers: { 'x-frontx-short-circuit': 'true' },
        data: mockData,
      },
    };
  }

  private findMockFactory(
    method: string,
    url: string
  ): MockResponseFactory<unknown, unknown> | undefined {
    const mockKey = `${method.toUpperCase()} ${url}`;
    const mockMap = this.currentMockMap ?? {};

    const exactMatch = mockMap[mockKey];
    if (exactMatch) {
      return exactMatch as MockResponseFactory<unknown, unknown>;
    }

    for (const [key, factory] of Object.entries(mockMap)) {
      const [keyMethod, keyUrl] = key.split(' ', 2);
      if (keyMethod.toUpperCase() === method.toUpperCase() && this.matchUrlPattern(keyUrl, url)) {
        return factory as MockResponseFactory<unknown, unknown>;
      }
    }

    return undefined;
  }

  private matchUrlPattern(pattern: string, url: string): boolean {
    if (!pattern.includes(':')) {
      return pattern === url;
    }
    const regexPattern = pattern
      .split('/')
      .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment))
      .join('/');
    return new RegExp(`^${regexPattern}$`).test(url);
  }

  destroy(): void {
    // Nothing to cleanup
  }
}

export interface LocalSseMockEvent {
  event?: string;
  data: string;
}

export interface LocalSseMockConfig {
  mockStreams: Readonly<Record<string, readonly LocalSseMockEvent[]>>;
  delay?: number;
}

/** Minimal SSE short-circuit fixture — returns a LocalMockEventSource for matching URLs. */
export class LocalSseMockPlugin extends SsePluginWithConfig<LocalSseMockConfig> {
  static readonly [MOCK_PLUGIN] = true;
  private currentMockStreams: Readonly<Record<string, readonly LocalSseMockEvent[]>>;

  constructor(config: LocalSseMockConfig) {
    super(config);
    this.currentMockStreams = config.mockStreams;
  }

  setMockStreams(mockStreams: Readonly<Record<string, readonly LocalSseMockEvent[]>>): void {
    this.currentMockStreams = mockStreams;
  }

  async onConnect(
    context: SseConnectContext
  ): Promise<SseConnectContext | SseShortCircuitResponse> {
    const mockEvents = this.findMockEvents(context.url);
    if (!mockEvents) {
      return context;
    }
    return { shortCircuit: new LocalMockEventSource(mockEvents, this.config.delay ?? 50) };
  }

  private findMockEvents(url: string): readonly LocalSseMockEvent[] | undefined {
    const exactMatch = this.currentMockStreams[url];
    if (exactMatch) {
      return exactMatch;
    }
    for (const [pattern, events] of Object.entries(this.currentMockStreams)) {
      if (pattern.endsWith('*') ? url.startsWith(pattern.slice(0, -1)) : pattern === url) {
        return events;
      }
    }
    return undefined;
  }

  destroy(): void {
    // Nothing to cleanup
  }
}

/**
 * Minimal EventSourceLike fixture — emits configured events asynchronously so
 * SseProtocol short-circuit consumers can be exercised without a real EventSource.
 */
export class LocalMockEventSource implements EventSourceLike {
  public readyState = 0; // CONNECTING
  public onopen: ((this: EventSource, ev: Event) => void) | null = null;
  public onmessage: ((this: EventSource, ev: MessageEvent) => void) | null = null;
  public onerror: ((this: EventSource, ev: Event) => void) | null = null;

  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  private abortController: AbortController | null = null;
  private readonly events: readonly LocalSseMockEvent[];
  private readonly delay: number;

  constructor(events: readonly LocalSseMockEvent[], delay = 50) {
    this.events = events;
    this.delay = delay;
    this.startEmitting();
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    if (this.readyState === 2) return;
    this.readyState = 2; // CLOSED
    this.abortController?.abort();
  }

  private async startEmitting(): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Yield so onopen/addEventListener('open') can be attached before OPEN fires.
    await Promise.resolve();
    if (signal.aborted) return;

    this.readyState = 1; // OPEN
    this.emitEvent('open', new Event('open'));

    for (const mockEvent of this.events) {
      if (signal.aborted) return;
      await this.sleep(this.delay, signal);
      if (signal.aborted) return;

      const eventType = mockEvent.event || 'message';
      const messageEvent = new MessageEvent(eventType, { data: mockEvent.data });

      if (eventType === 'message' && this.onmessage) {
        this.onmessage.call(this as unknown as EventSource, messageEvent);
      }
      this.emitEvent(eventType, messageEvent);
    }

    this.readyState = 2; // CLOSED
  }

  private emitEvent(type: string, event: Event | MessageEvent): void {
    const listeners = this.listeners.get(type);
    listeners?.forEach((listener) => {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    });

    if (type === 'open' && this.onopen) {
      this.onopen.call(this as unknown as EventSource, event);
    } else if (type === 'error' && this.onerror) {
      this.onerror.call(this as unknown as EventSource, event);
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      signal.addEventListener('abort', onAbort);
    });
  }
}
