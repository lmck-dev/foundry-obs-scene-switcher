/**
 * A scriptable stand-in for the browser WebSocket, so the obs-websocket
 * handshake can be driven step by step from a test.
 *
 * Deliberately does NOT emit a close event from close(): a real WebSocket
 * closes asynchronously, which is what lets OBSClient null out `this.ws`
 * before the close handler runs and hit its stale-socket guard. Emitting
 * synchronously here would hide that behaviour. Tests call emitClose()
 * explicitly when they want a close.
 */
export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  /** Every socket constructed since the last reset, in creation order. */
  static instances = [];

  /** Set to an Error to make the next construction throw. */
  static throwOnConstruct = null;

  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.throwOnConstruct = null;
  }

  /** The most recently constructed socket. */
  static get last() {
    return MockWebSocket.instances.at(-1);
  }

  constructor(url) {
    if (MockWebSocket.throwOnConstruct) {
      const err = MockWebSocket.throwOnConstruct;
      MockWebSocket.throwOnConstruct = null;
      throw err;
    }
    this.url = url;
    // Open immediately; OBSClient only ever checks readyState === OPEN.
    this.readyState = MockWebSocket.OPEN;
    this.closed = false;
    /** Parsed JSON of everything the client sent. */
    this.sent = [];
    this._listeners = new Map();
    MockWebSocket.instances.push(this);
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
  }

  // ---- test drivers -------------------------------------------------------

  /** Fire listeners for `type`, awaiting any async handlers. */
  async emit(type, event) {
    const fns = this._listeners.get(type) ?? [];
    await Promise.all(fns.map((fn) => fn(event)));
  }

  /** Deliver a protocol message as OBS would (JSON in event.data). */
  emitMessage(obj) {
    return this.emit("message", { data: JSON.stringify(obj) });
  }

  /** Deliver a raw (possibly malformed) payload. */
  emitRaw(data) {
    return this.emit("message", { data });
  }

  emitClose(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    return this.emit("close", { code });
  }

  emitError(event = {}) {
    return this.emit("error", event);
  }

  /** The last Identify (op 1) frame the client sent, if any. */
  get lastIdentify() {
    return [...this.sent].reverse().find((m) => m.op === 1) ?? null;
  }

  /** All Request (op 6) frames the client sent. */
  get requests() {
    return this.sent.filter((m) => m.op === 6);
  }
}

/** OBS's Hello (op 0), optionally demanding authentication. */
export function hello({ salt, challenge } = {}) {
  const d = { rpcVersion: 1 };
  if (salt !== undefined) d.authentication = { salt, challenge };
  return { op: 0, d };
}

/** OBS's Identified (op 2). */
export function identified() {
  return { op: 2, d: { negotiatedRpcVersion: 1 } };
}

/** OBS's RequestResponse (op 7). */
export function requestResponse(requestId, { ok = true, responseData, comment, code } = {}) {
  return {
    op: 7,
    d: {
      requestId,
      requestStatus: { result: ok, code, comment },
      responseData
    }
  };
}

/** Install the mock as the global WebSocket; returns a restore function. */
export function installMockWebSocket() {
  const original = globalThis.WebSocket;
  MockWebSocket.reset();
  globalThis.WebSocket = MockWebSocket;
  return () => {
    globalThis.WebSocket = original;
    MockWebSocket.reset();
  };
}
