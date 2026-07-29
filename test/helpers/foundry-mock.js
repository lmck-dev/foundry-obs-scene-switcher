/**
 * The slice of Foundry's globals this module actually touches.
 *
 * The source reads `game`, `canvas` etc. at call time rather than at import
 * time, so installing these before invoking a function is enough — no module
 * re-import or loader hooks needed.
 */
import { readFileSync } from "node:fs";
import {
  SETTINGS,
  OVERLAY_FIELDS,
  OVERLAY_NPC_FIELDS,
  DEFAULT_OVERLAY_EVENT,
  NPC_POLICY
} from "../../scripts/constants.js";

/**
 * The module's real translations, so tests assert the strings a user actually
 * sees. Loading the shipped file (rather than inventing strings) means a
 * missing or misspelled key fails a test instead of silently rendering raw
 * "module.button.on" text in the UI.
 */
const TRANSLATIONS = JSON.parse(
  readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8")
);

/** Foundry's i18n surface: localize looks up, format interpolates {tokens}. */
const i18n = {
  localize: (key) => TRANSLATIONS[key] ?? key,
  format: (key, data = {}) =>
    (TRANSLATIONS[key] ?? key).replace(/\{(\w+)\}/g, (match, token) =>
      token in data ? String(data[token]) : match
    )
};

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
 * An Actor stand-in for the overlay tests.
 *
 * `system` is the raw system data an adapter reads; `items` and `effects` are
 * the embedded collections it walks for class levels and conditions.
 */
export function makeActor({
  id = "actor-1",
  name = "Test Character",
  img = "worlds/test/hero.webp",
  hasPlayerOwner = true,
  system = {},
  items = [],
  effects = []
} = {}) {
  return { id, name, img, hasPlayerOwner, system, items, effects };
}

/** A Token placeable: the actor hangs off it, but `hidden` lives on .document. */
export function makeToken({ actor = null, hidden = false } = {}) {
  return { actor, document: { hidden } };
}

/** A Combatant: carries its own hidden flag as well as its token's. */
export function makeCombatant({ actor = null, hidden = false, tokenHidden = false } = {}) {
  return { actor, hidden, token: { hidden: tokenHidden } };
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
  isGM = true,
  systemId = ""
} = {}) {
  const store = new Map(
    Object.entries({
      [SETTINGS.syncEnabled]: true,
      [SETTINGS.sceneMappings]: {},
      [SETTINGS.explorationScene]: "",
      [SETTINGS.dmFallbackScene]: "",
      [SETTINGS.overlayEnabled]: true,
      [SETTINGS.overlayFields]: { ...OVERLAY_FIELDS },
      [SETTINGS.overlayNpcFields]: { ...OVERLAY_NPC_FIELDS },
      [SETTINGS.overlayNpcs]: NPC_POLICY.none,
      [SETTINGS.overlayEventName]: DEFAULT_OVERLAY_EVENT,
      ...settings
    })
  );

  const previous = { game: globalThis.game, canvas: globalThis.canvas };

  globalThis.game = {
    user: { isGM },
    combat,
    i18n,
    system: { id: systemId },
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
export function stubObs(obs, { connected = true, setScene, emit } = {}) {
  const previous = {
    connected: obs.connected,
    setScene: obs.setScene,
    emitBrowserEvent: obs.emitBrowserEvent
  };
  const calls = [];
  const emitted = [];

  obs.connected = connected;
  obs.setScene = async (sceneName) => {
    calls.push(sceneName);
    if (setScene) return setScene(sceneName);
    return {};
  };
  obs.emitBrowserEvent = async (eventName, eventData) => {
    emitted.push({ eventName, eventData });
    if (emit) return emit(eventName, eventData);
    return {};
  };

  return {
    calls,
    /** Every overlay push, in order: { eventName, eventData }. */
    emitted,
    /** The payload of the most recent push. */
    get lastPayload() {
      return emitted.length ? emitted[emitted.length - 1].eventData : null;
    },
    restore() {
      obs.connected = previous.connected;
      obs.setScene = previous.setScene;
      obs.emitBrowserEvent = previous.emitBrowserEvent;
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
