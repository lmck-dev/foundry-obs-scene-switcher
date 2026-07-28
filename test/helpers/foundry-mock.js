/**
 * The slice of Foundry's globals this module actually touches.
 *
 * The source reads `game`, `canvas` etc. at call time rather than at import
 * time, so installing these before invoking a function is enough — no module
 * re-import or loader hooks needed.
 */
import { SETTINGS } from "../../scripts/constants.js";

/**
 * A combatant / token stand-in.
 *
 * Mappings are keyed by Actor id, with a fallback to the document's own id.
 * `actor.id` and the flat `actorId` are both real shapes Foundry hands over
 * (embedded token documents expose the latter), so both are supported here.
 */
export function makeDoc({ id, actorId, flatActorId } = {}) {
  const doc = {};
  if (id !== undefined) doc.id = id;
  if (actorId !== undefined) doc.actor = { id: actorId };
  if (flatActorId !== undefined) doc.actorId = flatActorId;
  return doc;
}

/** A combat stand-in. `started` is what resolveScene keys off. */
export function makeCombat({ started = true, combatant = null } = {}) {
  return { started, combatant };
}

/**
 * Install globals for one test.
 *
 * `settings` is keyed by the SETTINGS values (e.g. "syncEnabled"), and
 * defaults to sync on with no scenes configured.
 */
export function installFoundry({
  settings = {},
  combat = null,
  controlled = [],
  isGM = true
} = {}) {
  const store = new Map(
    Object.entries({
      [SETTINGS.syncEnabled]: true,
      [SETTINGS.sceneMappings]: {},
      [SETTINGS.explorationScene]: "",
      [SETTINGS.dmFallbackScene]: "",
      ...settings
    })
  );

  const previous = { game: globalThis.game, canvas: globalThis.canvas };

  globalThis.game = {
    user: { isGM },
    combat,
    settings: {
      get: (_moduleId, key) => store.get(key),
      set: (_moduleId, key, value) => {
        store.set(key, value);
        return Promise.resolve(value);
      }
    }
  };

  globalThis.canvas = { tokens: { controlled } };

  return {
    store,
    restore() {
      globalThis.game = previous.game;
      globalThis.canvas = previous.canvas;
    }
  };
}

/**
 * Replace the obs singleton's connection surface with a spy.
 * Returns the spy plus a restore function.
 */
export function stubObs(obs, { connected = true, setScene } = {}) {
  const previous = { connected: obs.connected, setScene: obs.setScene };
  const calls = [];

  obs.connected = connected;
  obs.setScene = async (sceneName) => {
    calls.push(sceneName);
    if (setScene) return setScene(sceneName);
    return {};
  };

  return {
    calls,
    restore() {
      obs.connected = previous.connected;
      obs.setScene = previous.setScene;
    }
  };
}

/** Silence the module's console logging for the duration of a test. */
export function muteConsole() {
  const previous = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => Object.assign(console, previous);
}
