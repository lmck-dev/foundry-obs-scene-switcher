import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { OBSClient, OBSStatus, sha256Base64, computeAuth } from "../scripts/obs-client.js";
import {
  MockWebSocket,
  installMockWebSocket,
  hello,
  identified,
  requestResponse
} from "./helpers/mock-websocket.js";
import { muteConsole } from "./helpers/foundry-mock.js";

let restoreWs;
let restoreConsole;

beforeEach(() => {
  restoreWs = installMockWebSocket();
  restoreConsole = muteConsole();
});

afterEach(() => {
  restoreWs();
  restoreConsole();
});

/**
 * Drive a client to the Identified state and return it.
 * Timers are mocked by the caller so the 10s handshake guard never lingers.
 */
async function connected(client, opts = {}) {
  const p = client.connect(opts);
  await MockWebSocket.last.emitMessage(hello());
  await MockWebSocket.last.emitMessage(identified());
  await p;
  return MockWebSocket.last;
}

describe("crypto", () => {
  test("sha256Base64 matches the known digest of the empty string", async () => {
    assert.equal(
      await sha256Base64(""),
      "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
    );
  });

  test("computeAuth reproduces the obs-websocket spec's documented vector", async () => {
    // From the obs-websocket v5 protocol docs' worked example. If this fails,
    // the handshake is wrong and OBS will reject every connection.
    const auth = await computeAuth(
      "supersecretpassword",
      "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=",
      "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="
    );
    assert.equal(auth, "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=");
  });

  test("a different password yields a different auth string", async () => {
    const salt = "c2FsdA==";
    const challenge = "Y2hhbGxlbmdl";
    const a = await computeAuth("hunter2", salt, challenge);
    const b = await computeAuth("hunter3", salt, challenge);
    assert.notEqual(a, b);
  });

  test("computeAuth is deterministic for the same inputs", async () => {
    const args = ["pw", "c2FsdA==", "Y2hhbGxlbmdl"];
    assert.equal(await computeAuth(...args), await computeAuth(...args));
  });
});

describe("connect handshake", () => {
  test("builds the socket URL from host and port", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    await connected(client, { host: "10.0.0.5", port: 4466 });
    assert.equal(MockWebSocket.last.url, "ws://10.0.0.5:4466");
  });

  test("defaults to localhost:4455", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    await connected(client);
    assert.equal(MockWebSocket.last.url, "ws://localhost:4455");
  });

  test("an unauthenticated Hello produces an Identify with no auth field", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);
    const id = socket.lastIdentify;
    assert.equal(id.d.rpcVersion, 1);
    assert.equal(id.d.authentication, undefined);
  });

  test("an authenticated Hello produces an Identify carrying the spec vector", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const p = client.connect({ password: "supersecretpassword" });
    await MockWebSocket.last.emitMessage(
      hello({
        salt: "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=",
        challenge: "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="
      })
    );
    await MockWebSocket.last.emitMessage(identified());
    await p;

    assert.equal(
      MockWebSocket.last.lastIdentify.d.authentication,
      "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4="
    );
  });

  test("Identified resolves connect and marks the client connected", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    await connected(client);
    assert.equal(client.connected, true);
    assert.equal(client.status, OBSStatus.Connected);
  });

  test("OBS demanding a password with none configured fails without sending Identify", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const p = client.connect({ password: "" });
    await MockWebSocket.instances[0].emitMessage(
      hello({ salt: "c2FsdA==", challenge: "Y2hhbGxlbmdl" })
    );

    await assert.rejects(p, /requires a password but none is configured/);
    assert.equal(client.status, OBSStatus.AuthFailed);
    assert.equal(client.connected, false);
    assert.equal(
      MockWebSocket.instances[0].lastIdentify,
      null,
      "must not send credentials it does not have"
    );
  });

  test("a throwing WebSocket constructor rejects and reports error status", async () => {
    MockWebSocket.throwOnConstruct = new Error("boom");
    const client = new OBSClient();
    await assert.rejects(client.connect(), /boom/);
    assert.equal(client.status, OBSStatus.Error);
  });

  test("the handshake guard rejects after 10s of silence", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const p = client.connect();
    t.mock.timers.tick(10_000);
    await assert.rejects(p, /timed out/);
    assert.equal(client.status, OBSStatus.Error);
  });

  test("a malformed payload is ignored rather than throwing", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const p = client.connect();
    await MockWebSocket.last.emitRaw("<not json>");
    await MockWebSocket.last.emitMessage(hello());
    await MockWebSocket.last.emitMessage(identified());
    await p;
    assert.equal(client.connected, true);
  });
});

describe("close codes", () => {
  const cases = [
    [4009, OBSStatus.AuthFailed, /password does not match/],
    [4010, OBSStatus.Error, /newer RPC version/],
    [4007, OBSStatus.Error, /not identified/],
    [1006, OBSStatus.Error, /could not reach OBS/],
    [4999, OBSStatus.Error, /connection closed \(code 4999\)/]
  ];

  for (const [code, expectedStatus, messagePattern] of cases) {
    test(`close ${code} maps to ${expectedStatus} with a readable reason`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const client = new OBSClient();
      const p = client.connect();
      p.catch(() => {}); // rejection asserted below
      await MockWebSocket.last.emitClose(code);

      await assert.rejects(p, messagePattern);
      assert.equal(client.status, expectedStatus);
      assert.match(client.statusDetail, messagePattern);
      assert.equal(client.connected, false);
    });
  }
});

describe("status notifications", () => {
  test("transitions are reported to the listener in order", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const seen = [];
    client.onStatusChange = (status) => seen.push(status);
    await connected(client);
    assert.deepEqual(seen, [OBSStatus.Connecting, OBSStatus.Connected]);
  });

  test("an unchanged status does not re-notify", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    await connected(client);

    let calls = 0;
    client.onStatusChange = () => calls++;
    client._setStatus(OBSStatus.Connected);
    assert.equal(calls, 0);
  });

  test("a listener that throws does not break the transition", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    client.onStatusChange = () => {
      throw new Error("listener exploded");
    };
    await connected(client);
    assert.equal(client.status, OBSStatus.Connected);
  });
});

describe("requests", () => {
  test("a request before connecting is rejected", async () => {
    const client = new OBSClient();
    await assert.rejects(client.request("GetVersion"), /Not connected to OBS/);
  });

  test("a successful response resolves with responseData", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);

    const p = client.request("GetVersion");
    const { requestId } = socket.requests.at(-1).d;
    await socket.emitMessage(requestResponse(requestId, { responseData: { obsVersion: "30.0.0" } }));

    assert.deepEqual(await p, { obsVersion: "30.0.0" });
  });

  test("a response with no data resolves to an empty object", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);

    const p = client.request("SetCurrentProgramScene");
    const { requestId } = socket.requests.at(-1).d;
    await socket.emitMessage(requestResponse(requestId));

    assert.deepEqual(await p, {});
  });

  test("a failed response rejects with OBS's comment", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);

    const p = client.request("SetCurrentProgramScene");
    const { requestId } = socket.requests.at(-1).d;
    await socket.emitMessage(
      requestResponse(requestId, { ok: false, comment: "No scene named 'Nope'" })
    );

    await assert.rejects(p, /No scene named 'Nope'/);
  });

  test("a failed response with no comment falls back to the status code", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);

    const p = client.request("SetCurrentProgramScene");
    const { requestId } = socket.requests.at(-1).d;
    await socket.emitMessage(requestResponse(requestId, { ok: false, code: 604 }));

    await assert.rejects(p, /OBS request failed \(604\)/);
  });

  test("a response for an unknown requestId is ignored", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);
    await socket.emitMessage(requestResponse("req-does-not-exist"));
    assert.equal(client.connected, true);
  });

  test("requests get distinct ids", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);

    const a = client.request("GetVersion");
    const b = client.request("GetVersion");
    const ids = socket.requests.map((r) => r.d.requestId);
    assert.equal(new Set(ids).size, 2);

    for (const id of ids) await socket.emitMessage(requestResponse(id));
    await Promise.all([a, b]);
  });

  test("an unanswered request times out after 8s", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    await connected(client);

    const p = client.request("GetVersion");
    t.mock.timers.tick(8_000);
    await assert.rejects(p, /'GetVersion' timed out/);
  });

  test("closing the socket fails every in-flight request", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);

    const a = client.request("GetVersion");
    const b = client.request("GetSceneList");
    await socket.emitClose(1006);

    await assert.rejects(a, /connection closed/);
    await assert.rejects(b, /connection closed/);
  });
});

describe("scene requests", () => {
  test("setScene sends SetCurrentProgramScene with the scene name", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);

    const p = client.setScene("Battle Map");
    const req = socket.requests.at(-1);
    assert.equal(req.d.requestType, "SetCurrentProgramScene");
    assert.deepEqual(req.d.requestData, { sceneName: "Battle Map" });

    await socket.emitMessage(requestResponse(req.d.requestId));
    await p;
  });

  test("getSceneList reverses OBS's newest-first ordering", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);

    const p = client.getSceneList();
    const { requestId } = socket.requests.at(-1).d;
    await socket.emitMessage(
      requestResponse(requestId, {
        responseData: {
          scenes: [{ sceneName: "Third" }, { sceneName: "Second" }, { sceneName: "First" }]
        }
      })
    );

    assert.deepEqual(await p, ["First", "Second", "Third"]);
  });

  test("getSceneList tolerates a response with no scenes", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const socket = await connected(client);

    const p = client.getSceneList();
    const { requestId } = socket.requests.at(-1).d;
    await socket.emitMessage(requestResponse(requestId, { responseData: {} }));

    assert.deepEqual(await p, []);
  });
});

describe("stale socket guards", () => {
  test("a close from a replaced socket does not clobber the live status", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    const first = MockWebSocket;

    const p1 = client.connect();
    p1.catch(() => {});
    const oldSocket = first.last;

    // A second connect() tears the first down and replaces it.
    const p2 = client.connect();
    await MockWebSocket.last.emitMessage(hello());
    await MockWebSocket.last.emitMessage(identified());
    await p2;
    assert.equal(client.status, OBSStatus.Connected);

    // The abandoned socket now reports a failure. It must be ignored.
    await oldSocket.emitClose(1006);
    assert.equal(client.status, OBSStatus.Connected);
    assert.equal(client.connected, true);
  });

  test("a message from a replaced socket is ignored", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();

    const p1 = client.connect();
    p1.catch(() => {});
    const oldSocket = MockWebSocket.last;

    const p2 = client.connect();
    const newSocket = MockWebSocket.last;
    await newSocket.emitMessage(hello());

    // The abandoned socket now delivers its own Hello. Note the client always
    // writes through `this.ws`, so an unguarded stale message would push a
    // SECOND Identify down the *live* socket — asserting on the old socket
    // would prove nothing. Count Identify frames on the new socket instead.
    const identifiesBefore = newSocket.sent.filter((m) => m.op === 1).length;
    await oldSocket.emitMessage(hello());
    const identifiesAfter = newSocket.sent.filter((m) => m.op === 1).length;

    assert.equal(identifiesBefore, 1);
    assert.equal(
      identifiesAfter,
      1,
      "a Hello from a replaced socket must not re-identify the live connection"
    );

    await newSocket.emitMessage(identified());
    await p2;
  });

  test("disconnect clears connected state", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const client = new OBSClient();
    await connected(client);
    client.disconnect();
    assert.equal(client.connected, false);
    assert.equal(client.ws, null);
  });
});
