/**
 * Minimal Chrome DevTools Protocol client over Node's built-in WebSocket
 * (Node >= 22). Deliberately not a browser-automation framework: the runner
 * needs exactly navigate / emulate width / evaluate / screenshot / console
 * capture, and carrying a framework for that would put a heavyweight
 * dependency into every consumer project for no added capability.
 *
 * The WebSocket constructor is injectable so the protocol logic (request
 * correlation, console aggregation, error surfacing) is unit-testable
 * without a browser.
 */

export class CdpSession {
  /**
   * @param {string} wsUrl target's webSocketDebuggerUrl
   * @param {{WebSocketImpl?: typeof WebSocket, commandTimeoutMs?: number}} [options]
   */
  constructor(wsUrl, options = {}) {
    this.wsUrl = wsUrl;
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
    this.nextId = 1;
    /** @type {Map<number, {resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout>}>} */
    this.pending = new Map();
    /** @type {string[]} every console line seen on this session */
    this.consoleLines = [];
    this.ws = null;
  }

  async connect() {
    if (typeof this.WebSocketImpl !== 'function') {
      throw new Error('global WebSocket is unavailable - the runner needs Node >= 22');
    }
    this.ws = new this.WebSocketImpl(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error(`CDP WebSocket failed to open: ${this.wsUrl}`));
    });
    this.ws.onmessage = (event) => this.handleMessage(String(event.data));
    // A socket that dies mid-command must not leave navigate()/evaluate()/
    // screenshot() awaiting a reply that can never arrive.
    this.ws.onerror = () => this.rejectPending(new Error(`CDP WebSocket error: ${this.wsUrl}`));
    this.ws.onclose = () => this.rejectPending(new Error(`CDP WebSocket closed: ${this.wsUrl}`));
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Page.enable');
  }

  /** @param {string} data */
  handleMessage(data) {
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args ?? [])
        .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type)))
        .join(' ');
      this.consoleLines.push(`${msg.params.type}: ${text}`);
    } else if (msg.method === 'Log.entryAdded') {
      this.consoleLines.push(`log.${msg.params.entry.level}: ${msg.params.entry.text}`);
    }
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  /** Reject and drop every in-flight command. @param {Error} error */
  rejectPending(error) {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const { reject, timer } of entries) {
      clearTimeout(timer);
      reject(error);
    }
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      // A live but unresponsive socket fires neither onerror nor onclose, so
      // each command carries its own deadline. One stalled reply means the
      // session is wedged, so the deadline tears the whole session down
      // (rejecting every in-flight command) rather than skipping one reply.
      const timer = setTimeout(() => {
        this.close(new Error(`CDP command ${method} got no reply within ${this.commandTimeoutMs}ms`));
      }, this.commandTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /**
   * Evaluate an expression in the page. Returns `{value}` or `{error}` -
   * page-side exceptions are data for the report, never runner crashes.
   *
   * @param {string} expression
   * @param {{awaitPromise?: boolean}} [options]
   */
  async evaluate(expression, options = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: options.awaitPromise ?? false,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      return {
        error:
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      };
    }
    return { value: result.result?.value };
  }

  /** @param {string} url */
  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  /** @param {number} width @param {number} [height] */
  async setWidth(width, height = 900) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  /** @returns {Promise<string>} base64 PNG data */
  async screenshot() {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    return result.data;
  }

  /**
   * Wait until a console line matching `pattern` arrives (scanning from
   * `fromIndex`), or the timeout elapses. Bounded by contract: the
   * verify-interface skill forbids open-ended waits on console output.
   *
   * @param {RegExp} pattern
   * @param {number} fromIndex
   * @param {number} timeoutMs
   * @returns {Promise<string | undefined>} the matching line, if any
   */
  async waitForConsoleLine(pattern, fromIndex, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let index = fromIndex;
    for (;;) {
      for (; index < this.consoleLines.length; index += 1) {
        if (pattern.test(this.consoleLines[index])) return this.consoleLines[index];
      }
      if (Date.now() >= deadline) return undefined;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** @param {Error} [reason] why the session is going away */
  close(reason = new Error('CDP session closed')) {
    this.rejectPending(reason);
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Create a fresh about:blank target on a DevTools HTTP endpoint and return
 * its webSocketDebuggerUrl.
 *
 * @param {string} cdpHttpUrl e.g. http://127.0.0.1:9222
 * @param {typeof fetch} [fetchImpl]
 */
export async function newTarget(cdpHttpUrl, fetchImpl = fetch) {
  const base = cdpHttpUrl.replace(/\/$/, '');
  const response = await fetchImpl(`${base}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) {
    throw new Error(`CDP endpoint refused new target: HTTP ${response.status} from ${base}`);
  }
  const info = await response.json();
  if (!info.webSocketDebuggerUrl) {
    throw new Error(`CDP endpoint returned no webSocketDebuggerUrl: ${JSON.stringify(info)}`);
  }
  return info.webSocketDebuggerUrl;
}
