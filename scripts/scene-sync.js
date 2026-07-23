import { SETTINGS, getSetting, log, warn } from "./constants.js";
import { obs } from "./obs-client.js";

/**
 * Look up a scene mapping for a document that has an associated Actor.
 * Mappings are keyed by Actor id (stable across scenes/encounters), with a
 * fallback to the token/document id in case a mapping was stored that way.
 */
function lookupMapping(mappings, doc) {
  if (!doc) return null;
  const actorId = doc.actor?.id ?? doc.actorId ?? null;
  if (actorId && mappings[actorId]) return mappings[actorId];
  if (doc.id && mappings[doc.id]) return mappings[doc.id];
  return null;
}

/**
 * Recompute the desired OBS scene from scratch on every relevant event.
 * Never patched incrementally — always derives the full state to avoid drift
 * from out-of-order Foundry hooks.
 *
 * Returns the scene name to switch to, or null to do nothing.
 */
export function resolveScene() {
  // 5. Manual override toggle OFF -> do nothing.
  if (!getSetting(SETTINGS.syncEnabled)) return null;

  const combat = game.combat;
  const combatActive = !!combat?.started;

  // 1. Combat inactive -> exploration/default scene.
  if (!combatActive) {
    return getSetting(SETTINGS.explorationScene) || null;
  }

  const mappings = getSetting(SETTINGS.sceneMappings) ?? {};

  // 2. Combat active + a token is focused (GM's selection).
  const controlled = canvas?.tokens?.controlled ?? [];
  if (controlled.length) {
    const scene = lookupMapping(mappings, controlled[0]);
    if (scene) return scene;
  }

  // 3. Combat active + nothing focused -> current turn's combatant.
  const combatant = combat.combatant;
  if (combatant) {
    const scene = lookupMapping(mappings, combatant);
    if (scene) return scene;
  }

  // 4. No mapping found -> Dungeon Master fallback scene.
  return getSetting(SETTINGS.dmFallbackScene) || null;
}

// Remember the last scene we pushed so we don't spam identical switches.
let lastScene = null;

/** Reset the debounce cache (e.g. after a reconnect) so the next sync always fires. */
export function resetSceneCache() {
  lastScene = null;
}

/**
 * Resolve the desired scene and, if it changed, push it to OBS.
 * Only the GM client drives OBS; player clients are no-ops.
 */
export async function syncScene() {
  if (!game.user?.isGM) return;

  const target = resolveScene();
  if (!target) return;                 // nothing to do (override off, or no scene)
  if (target === lastScene) return;    // already there

  if (!obs.connected) {
    // Not connected — remember intent so a later successful connect can apply it.
    lastScene = null;
    return;
  }

  try {
    await obs.setScene(target);
    lastScene = target;
    log(`Switched OBS scene -> "${target}"`);
  } catch (err) {
    warn(`Failed to switch OBS scene to "${target}":`, err.message);
    lastScene = null; // force a retry on the next event
  }
}
