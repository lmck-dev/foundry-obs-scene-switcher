import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { SETTINGS } from "../scripts/constants.js";
import { obs } from "../scripts/obs-client.js";
import { resolveScene, syncScene, resetSceneCache } from "../scripts/scene-sync.js";
import { installFoundry, makeDoc, makeCombat, stubObs, muteConsole } from "./helpers/foundry-mock.js";

let foundry;
let restoreConsole;

beforeEach(() => {
  restoreConsole = muteConsole();
  // scene-sync keeps a module-level debounce cache; without this, one test's
  // last-pushed scene silently suppresses the next test's switch.
  resetSceneCache();
});

afterEach(() => {
  foundry?.restore();
  foundry = null;
  restoreConsole();
});

describe("resolveScene — branch 5: manual override", () => {
  test("returns null when sync is disabled, whatever else is true", () => {
    foundry = installFoundry({
      settings: {
        [SETTINGS.syncEnabled]: false,
        [SETTINGS.explorationScene]: "Exploration",
        [SETTINGS.dmFallbackScene]: "DM"
      },
      combat: makeCombat({ started: true })
    });
    assert.equal(resolveScene(), null);
  });
});

describe("resolveScene — branch 1: combat inactive", () => {
  test("no combat at all yields the exploration scene", () => {
    foundry = installFoundry({
      settings: { [SETTINGS.explorationScene]: "Exploration" },
      combat: null
    });
    assert.equal(resolveScene(), "Exploration");
  });

  test("a combat that has not started yields the exploration scene", () => {
    foundry = installFoundry({
      settings: { [SETTINGS.explorationScene]: "Exploration" },
      combat: makeCombat({ started: false })
    });
    assert.equal(resolveScene(), "Exploration");
  });

  test("no exploration scene configured yields null rather than an empty string", () => {
    foundry = installFoundry({
      settings: { [SETTINGS.explorationScene]: "" },
      combat: null
    });
    assert.equal(resolveScene(), null);
  });
});

describe("resolveScene — branch 2: focused token", () => {
  test("a controlled token mapped by actor id wins", () => {
    foundry = installFoundry({
      settings: { [SETTINGS.sceneMappings]: { "actor-1": "Hero Cam" } },
      combat: makeCombat({ started: true }),
      controlled: [makeDoc({ id: "token-1", actorId: "actor-1" })]
    });
    assert.equal(resolveScene(), "Hero Cam");
  });

  test("a controlled token falls back to a mapping stored against its own id", () => {
    foundry = installFoundry({
      settings: { [SETTINGS.sceneMappings]: { "token-9": "Token Cam" } },
      combat: makeCombat({ started: true }),
      controlled: [makeDoc({ id: "token-9" })]
    });
    assert.equal(resolveScene(), "Token Cam");
  });

  test("only the first controlled token is considered", () => {
    foundry = installFoundry({
      settings: {
        [SETTINGS.sceneMappings]: { "actor-1": "First Cam", "actor-2": "Second Cam" }
      },
      combat: makeCombat({ started: true }),
      controlled: [
        makeDoc({ id: "t1", actorId: "actor-1" }),
        makeDoc({ id: "t2", actorId: "actor-2" })
      ]
    });
    assert.equal(resolveScene(), "First Cam");
  });

  test("an unmapped controlled token falls through to the current combatant", () => {
    foundry = installFoundry({
      settings: { [SETTINGS.sceneMappings]: { "actor-turn": "Turn Cam" } },
      combat: makeCombat({
        started: true,
        combatant: makeDoc({ id: "c1", actorId: "actor-turn" })
      }),
      controlled: [makeDoc({ id: "t-unmapped", actorId: "actor-unmapped" })]
    });
    assert.equal(resolveScene(), "Turn Cam");
  });
});

describe("resolveScene — branch 3: current combatant", () => {
  test("with nothing selected, the turn's combatant decides", () => {
    foundry = installFoundry({
      settings: { [SETTINGS.sceneMappings]: { "actor-turn": "Turn Cam" } },
      combat: makeCombat({
        started: true,
        combatant: makeDoc({ id: "c1", actorId: "actor-turn" })
      }),
      controlled: []
    });
    assert.equal(resolveScene(), "Turn Cam");
  });

  test("a combatant exposing a flat actorId is resolved too", () => {
    foundry = installFoundry({
      settings: { [SETTINGS.sceneMappings]: { "actor-flat": "Flat Cam" } },
      combat: makeCombat({
        started: true,
        combatant: makeDoc({ id: "c1", flatActorId: "actor-flat" })
      })
    });
    assert.equal(resolveScene(), "Flat Cam");
  });
});

describe("resolveScene — branch 4: DM fallback", () => {
  test("an unmapped combatant falls back to the DM scene", () => {
    foundry = installFoundry({
      settings: {
        [SETTINGS.sceneMappings]: {},
        [SETTINGS.dmFallbackScene]: "DM Overview"
      },
      combat: makeCombat({
        started: true,
        combatant: makeDoc({ id: "c1", actorId: "nobody" })
      })
    });
    assert.equal(resolveScene(), "DM Overview");
  });

  test("combat with no combatant at all falls back to the DM scene", () => {
    foundry = installFoundry({
      settings: { [SETTINGS.dmFallbackScene]: "DM Overview" },
      combat: makeCombat({ started: true, combatant: null })
    });
    assert.equal(resolveScene(), "DM Overview");
  });

  test("no fallback configured yields null", () => {
    foundry = installFoundry({
      settings: { [SETTINGS.dmFallbackScene]: "" },
      combat: makeCombat({ started: true, combatant: null })
    });
    assert.equal(resolveScene(), null);
  });

  test("an undefined mappings setting does not throw", () => {
    foundry = installFoundry({
      settings: {
        [SETTINGS.sceneMappings]: undefined,
        [SETTINGS.dmFallbackScene]: "DM Overview"
      },
      combat: makeCombat({
        started: true,
        combatant: makeDoc({ id: "c1", actorId: "a1" })
      })
    });
    assert.equal(resolveScene(), "DM Overview");
  });
});

describe("syncScene", () => {
  let stub;

  afterEach(() => {
    stub?.restore();
    stub = null;
  });

  test("a player client never drives OBS", async () => {
    foundry = installFoundry({
      settings: { [SETTINGS.explorationScene]: "Exploration" },
      isGM: false
    });
    stub = stubObs(obs);
    await syncScene();
    assert.deepEqual(stub.calls, []);
  });

  test("the GM client pushes the resolved scene", async () => {
    foundry = installFoundry({ settings: { [SETTINGS.explorationScene]: "Exploration" } });
    stub = stubObs(obs);
    await syncScene();
    assert.deepEqual(stub.calls, ["Exploration"]);
  });

  test("an identical scene is not pushed twice", async () => {
    foundry = installFoundry({ settings: { [SETTINGS.explorationScene]: "Exploration" } });
    stub = stubObs(obs);
    await syncScene();
    await syncScene();
    assert.deepEqual(stub.calls, ["Exploration"]);
  });

  test("a changed scene is pushed again", async () => {
    foundry = installFoundry({ settings: { [SETTINGS.explorationScene]: "Exploration" } });
    stub = stubObs(obs);
    await syncScene();
    foundry.store.set(SETTINGS.explorationScene, "Town");
    await syncScene();
    assert.deepEqual(stub.calls, ["Exploration", "Town"]);
  });

  test("resolving to nothing pushes nothing", async () => {
    foundry = installFoundry({ settings: { [SETTINGS.syncEnabled]: false } });
    stub = stubObs(obs);
    await syncScene();
    assert.deepEqual(stub.calls, []);
  });

  test("while disconnected nothing is pushed, and the next sync still fires", async () => {
    foundry = installFoundry({ settings: { [SETTINGS.explorationScene]: "Exploration" } });
    stub = stubObs(obs, { connected: false });
    await syncScene();
    assert.deepEqual(stub.calls, []);

    // Reconnecting must not be suppressed by a stale debounce entry.
    obs.connected = true;
    await syncScene();
    assert.deepEqual(stub.calls, ["Exploration"]);
  });

  test("a failed switch is retried on the next event", async () => {
    foundry = installFoundry({ settings: { [SETTINGS.explorationScene]: "Exploration" } });
    let failNext = true;
    stub = stubObs(obs, {
      setScene: async () => {
        if (failNext) {
          failNext = false;
          throw new Error("OBS said no");
        }
        return {};
      }
    });

    await syncScene();
    await syncScene();
    assert.deepEqual(
      stub.calls,
      ["Exploration", "Exploration"],
      "a failure must clear the debounce cache so the switch is reattempted"
    );
  });

  test("after a failed switch, reverting to the previous scene is re-pushed", async () => {
    // The subtle one. Sequence: A succeeds, B fails, then we resolve back to A.
    // Because the failure clears the debounce cache, A is pushed again rather
    // than skipped as "already there" — OBS's actual state is unknown after a
    // failed switch, so re-asserting it is the safe move. Without the cache
    // clear in syncScene's catch block, this final push is silently dropped.
    foundry = installFoundry({ settings: { [SETTINGS.explorationScene]: "A" } });
    let shouldFail = false;
    stub = stubObs(obs, {
      setScene: async () => {
        if (shouldFail) throw new Error("OBS said no");
        return {};
      }
    });

    await syncScene();                                    // -> A (ok)

    shouldFail = true;
    foundry.store.set(SETTINGS.explorationScene, "B");
    await syncScene();                                    // -> B (fails)

    shouldFail = false;
    foundry.store.set(SETTINGS.explorationScene, "A");
    await syncScene();                                    // -> A again

    assert.deepEqual(stub.calls, ["A", "B", "A"]);
  });

  test("resetSceneCache forces the same scene to be pushed again", async () => {
    foundry = installFoundry({ settings: { [SETTINGS.explorationScene]: "Exploration" } });
    stub = stubObs(obs);
    await syncScene();
    resetSceneCache();
    await syncScene();
    assert.deepEqual(stub.calls, ["Exploration", "Exploration"]);
  });
});
