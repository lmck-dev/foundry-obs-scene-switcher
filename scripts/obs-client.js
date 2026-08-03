import { log, warn, error } from "./constants.js";

/**
 * Minimal client for the obs-websocket v5 protocol (OBS Studio 28+).
 *
 * Protocol reference: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 * Only the handful of opcodes/requests this module needs are implemented.
 */

// WebSocket message opcodes (the "op" field).
const OpCode = {
  Hello: 0,
  Identify: 1,
  Identified: 2,
  Reidentify: 3,
  Event: 5,
  Request: 6,
  RequestResponse: 7
};

/** RPC version this client speaks. obs-websocket v5 uses 1. */
const RPC_VERSION = 1;

/**
 * Human-readable messages for the obs-websocket WebSocketCloseCode values we're
 * likely to hit, so the DM sees "wrong password" instead of "code 4009".
 */
const CLOSE_CODE_MESSAGES = {
  4009: "authentication failed — the password does not match OBS's WebSocket Server Settings",
  4010: "OBS requires a newer RPC version than this module supports",
  4007: "not identified with OBS",
  1006: "could not reach OBS — is the WebSocket server enabled and the host/port correct?"
};

function describeClose(code) {
  return CLOSE_CODE_MESSAGES[code] ?? `connection closed (code ${code})`;
}

/** base64( SHA-256( str ) ) using the browser's built-in SubtleCrypto. */
export async function sha256Base64(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let binary = "";
  const view = new Uint8Array(digest);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

/**
 * Compute the obs-websocket auth string.
 *   secret = base64(sha256(password + salt))
 *   auth   = base64(sha256(secret  + challenge))
 */
export async function computeAuth(password, salt, challenge) {
  const secret = await sha256Base64(password + salt);
  return sha256Base64(secret + challenge);
}

/**
 * Coarse connection health, surfaced to the UI. One of:
 *   "disconnected" | "connecting" | "connected" | "auth-failed" | "error"
 */
export const OBSStatus = {
  Disconnected: "disconnected",
  Connecting: "connecting",
  Connected: "connected",
  AuthFailed: "auth-failed",
  Error: "error"
};

export class OBSClient {
  constructor() {
    this.ws = null;
    this.connected = false;      // socket open AND identified
    this.status = OBSStatus.Disconnected;
    this.statusDetail = "";      // human-readable reason for the current status
    this.onStatusChange = null;  // optional (status, detail) => void callback
    this._identifyResolve = null;
    this._identifyReject = null;
    this._pending = new Map();   // requestId -> { resolve, reject }
    this._reqCounter = 0;
    this._config = null;
  }

  /** Update status and notify any listener. No-op if unchanged. */
  _setStatus(status, detail = "") {
    if (this.status === status && this.statusDetail === detail) return;
    this.status = status;
    this.statusDetail = detail;
    try {
      this.onStatusChange?.(status, detail);
    } catch (err) {
      warn("status listener threw", err);
    }
  }

  /**
   * Open a connection and complete the Identify handshake.
   * Resolves once identified, rejects on failure/timeout.
   */
  connect({ host = "localhost", port = 4455, password = "" } = {}) {
    // Tear down any existing connection first.
    this.disconnect();
    this._config = { host, port, password };

    const url = `ws://${host}:${port}`;
    log(`Connecting to OBS at ${url}`);
    this._setStatus(OBSStatus.Connecting);

    return new Promise((resolve, reject) => {
      let settled = false;
      this._identifyResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this._identifyReject = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      let socket;
      try {
        socket = new WebSocket(url);
      } catch (err) {
        this._setStatus(OBSStatus.Error, err.message);
        this._identifyReject(err);
        return;
      }
      this.ws = socket;

      // Guard against a hung handshake.
      const timeout = setTimeout(() => {
        this._setStatus(OBSStatus.Error, "connection timed out");
        this._identifyReject(new Error("OBS connection timed out"));
        this.disconnect();
      }, 10000);

      socket.addEventListener("open", () => log("WebSocket open, awaiting Hello"));

      socket.addEventListener("message", async (event) => {
        if (this.ws !== socket) return; // stale socket
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (err) {
          warn("Ignoring non-JSON message from OBS", event.data);
          return;
        }
        await this._onMessage(msg, timeout);
      });

      socket.addEventListener("error", (event) => {
        // A stale socket we've already replaced — ignore.
        if (this.ws !== socket) return;
        error("WebSocket error", event);
        this._identifyReject(new Error("OBS WebSocket error"));
      });

      socket.addEventListener("close", (event) => {
        // Ignore closes from a socket that a newer connect() already replaced,
        // so a torn-down old connection can't clobber the current status.
        if (this.ws !== socket) return;

        clearTimeout(timeout);
        const wasConnected = this.connected;
        this.connected = false;
        const detail = describeClose(event.code);

        // 4009 == AuthenticationFailed; everything else is a plain error/drop.
        if (event.code === 4009) this._setStatus(OBSStatus.AuthFailed, detail);
        else this._setStatus(OBSStatus.Error, detail);

        this._identifyReject(new Error(detail));
        // Fail any in-flight requests.
        for (const { reject } of this._pending.values()) {
          reject(new Error("OBS connection closed"));
        }
        this._pending.clear();
        if (wasConnected) log("Disconnected from OBS");
      });
    });
  }

  disconnect() {
    if (this.ws) {
      // Detach handlers we no longer care about, then close.
      try {
        this.ws.close();
      } catch (_e) { /* already closing */ }
      this.ws = null;
    }
    this.connected = false;
  }

  async _onMessage(msg, connectTimeout) {
    switch (msg.op) {
      case OpCode.Hello: {
        const identify = {
          op: OpCode.Identify,
          d: { rpcVersion: RPC_VERSION }
        };
        const auth = msg.d?.authentication;
        if (auth) {
          const password = this._config?.password ?? "";
          if (!password) {
            clearTimeout(connectTimeout);
            this._setStatus(
              OBSStatus.AuthFailed,
              "OBS requires a password but none is configured"
            );
            this._identifyReject(
              new Error("OBS requires a password but none is configured")
            );
            this.disconnect();
            return;
          }
          identify.d.authentication = await computeAuth(
            password,
            auth.salt,
            auth.challenge
          );
        }
        this._send(identify);
        break;
      }

      case OpCode.Identified: {
        clearTimeout(connectTimeout);
        this.connected = true;
        this._setStatus(OBSStatus.Connected);
        log("Identified with OBS");
        this._identifyResolve();
        break;
      }

      case OpCode.RequestResponse: {
        const { requestId, requestStatus, responseData } = msg.d ?? {};
        const pending = this._pending.get(requestId);
        if (!pending) return;
        this._pending.delete(requestId);
        if (requestStatus?.result) {
          pending.resolve(responseData ?? {});
        } else {
          pending.reject(
            new Error(requestStatus?.comment || `OBS request failed (${requestStatus?.code})`)
          );
        }
        break;
      }

      // Events (op 5) are ignored — this module only pushes state to OBS.
      default:
        break;
    }
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("OBS socket is not open");
    }
    this.ws.send(JSON.stringify(obj));
  }

  /** Send a Request (op 6) and await its RequestResponse (op 7). */
  request(requestType, requestData = {}) {
    if (!this.connected) {
      return Promise.reject(new Error("Not connected to OBS"));
    }
    const requestId = `req-${++this._reqCounter}`;
    return new Promise((resolve, reject) => {
      this._pending.set(requestId, { resolve, reject });
      try {
        this._send({
          op: OpCode.Request,
          d: { requestType, requestId, requestData }
        });
      } catch (err) {
        this._pending.delete(requestId);
        reject(err);
      }
      // Per-request timeout.
      setTimeout(() => {
        if (this._pending.has(requestId)) {
          this._pending.delete(requestId);
          reject(new Error(`OBS request '${requestType}' timed out`));
        }
      }, 8000);
    });
  }

  /** Switch the active (Program) scene. */
  async setScene(sceneName) {
    return this.request("SetCurrentProgramScene", { sceneName });
  }

  /**
   * Emit a CustomEvent into every Browser Source running in OBS.
   *
   * obs-browser registers itself with obs-websocket as the `obs-browser`
   * vendor; its `emit_event` request dispatches `event_name` verbatim on the
   * page's `window`, with `event_data` arriving as `event.detail`. That is the
   * only channel from here into a Browser Source — the page cannot call back.
   */
  async emitBrowserEvent(eventName, eventData = {}) {
    return this.request("CallVendorRequest", {
      vendorName: "obs-browser",
      requestType: "emit_event",
      requestData: { event_name: eventName, event_data: eventData }
    });
  }

  /** Fetch the list of scene names, ordered as OBS returns them. */
  async getSceneList() {
    const data = await this.request("GetSceneList");
    // scenes is newest-first in OBS; reverse for a natural top-to-bottom order.
    return (data.scenes ?? [])
      .map((s) => s.sceneName)
      .reverse();
  }
}

/** Singleton used across the module. */
export const obs = new OBSClient();
