/**
 * Pushes the turn order to the stream overlay.
 *
 * Privacy here reuses the character card's gate rather than inventing a second
 * one — `mayAppear()` and `visibleFields()` from `overlay-feed.js` — so a GM who
 * has decided which NPCs are stream-safe has decided it once. What differs is
 * the consequence of failing that gate: the card shows nothing at all, while the
 * tracker still has to list the combatant, or the turn order stops being a turn
 * order. So a gated NPC keeps its name and its initiative and loses everything
 * else — its portrait and its hit points.
 *
 * That is a smaller concession than it looks. A combatant's name and initiative
 * are already in every player's own tracker; a hidden combatant is in nobody's,
 * and is dropped here outright.
 */
import {
  SETTINGS,
  DEFAULT_COMBAT_EVENT,
  getSetting,
  log,
  warn
} from "./constants.js";
import { obs } from "./obs-client.js";
import { absoluteImageUrl, mayAppear, visibleFields } from "./overlay-feed.js";
import { buildCharacterData } from "./character-data.js";

/** Payload schema version, so a future page can detect an old module. */
export const PAYLOAD_VERSION = 1;

/** The empty payload: tells the page to hide the tracker. */
const CLEARED = { v: PAYLOAD_VERSION, present: false, combatants: [] };

let lastSent = null;

/** Forget what was last sent, so the next push always emits. */
export function resetCombatCache() {
  lastSent = null;
}

/** Whether a combatant is concealed from the players, by its own flag or its token's. */
export function isHidden(combatant) {
  return Boolean(combatant?.hidden || combatant?.token?.hidden);
}

/**
 * One row of the tracker.
 *
 * `featured` is what the privacy gate decides: player characters always are,
 * NPCs are only when the GM has opted them in. An unfeatured row is a name and
 * a number, which is what the players already see.
 */
export function buildRow(combatant, { activeId = null, systemId = "" } = {}) {
  const actor = combatant?.actor ?? null;
  const featured = actor ? Boolean(actor.hasPlayerOwner) || mayAppear(actor, combatant) : false;

  const initiative = Number(combatant?.initiative);
  const row = {
    id: combatant?.id ?? null,
    name: String(combatant?.name ?? actor?.name ?? "").trim(),
    initiative: Number.isFinite(initiative) ? initiative : null,
    active: Boolean(activeId && combatant?.id === activeId),
    defeated: Boolean(combatant?.isDefeated),
    img: null,
    hp: null
  };

  if (!featured || !actor) return row;

  const fields = visibleFields(actor);
  if (fields.portrait) row.img = absoluteImageUrl(combatant?.img ?? actor.img ?? null);
  if (fields.hp) {
    // Reuse the card's system adapters rather than reading hit points a second
    // way here — a system supported for the card is supported for the tracker.
    row.hp = buildCharacterData(actor, { systemId })?.hp ?? null;
  }

  return row;
}

/**
 * Build the payload for the current combat.
 *
 * Returns the cleared payload rather than null whenever nothing should be on
 * screen, so that combat ending actively hides the tracker instead of leaving
 * the last round's turn order up.
 */
export function buildCombatPayload() {
  if (!getSetting(SETTINGS.combatEnabled)) return CLEARED;
  if (!getSetting(SETTINGS.syncEnabled)) return CLEARED;

  const combat = globalThis.game?.combat;
  if (!combat) return CLEARED;

  // `turns` is the sorted order Foundry itself renders; `combatants` is not
  // sorted, so it is only a fallback for a shape that lacks turns entirely.
  const all = combat.turns ?? combat.combatants ?? [];
  const list = Array.isArray(all) ? all : Array.from(all.contents ?? all);

  const activeId = combat.combatant?.id ?? null;
  const systemId = globalThis.game?.system?.id ?? "";

  const combatants = list
    .filter((combatant) => combatant && !isHidden(combatant))
    .map((combatant) => buildRow(combatant, { activeId, systemId }));

  if (!combatants.length) return CLEARED;

  const round = Number(combat.round);
  return {
    v: PAYLOAD_VERSION,
    present: true,
    round: Number.isFinite(round) ? round : null,
    started: Boolean(combat.started),
    combatants
  };
}

/**
 * Re-push only when the changed actor is actually in the fight.
 *
 * Actor updates fire constantly in a busy world and each one costs an OBS round
 * trip, but unlike the character card the tracker cares about *every*
 * combatant's hit points, not just the one on screen.
 */
export function refreshIfInCombat(actorId) {
  if (!actorId) return;
  const combat = globalThis.game?.combat;
  if (!combat) return;

  const all = combat.turns ?? combat.combatants ?? [];
  const list = Array.isArray(all) ? all : Array.from(all.contents ?? all);
  if (list.some((combatant) => combatant?.actor?.id === actorId)) pushCombat();
}

/** The event name the combat page listens for. */
export function combatEventName() {
  const configured = getSetting(SETTINGS.combatEventName);
  return (typeof configured === "string" && configured.trim()) || DEFAULT_COMBAT_EVENT;
}

/**
 * Send the current turn order to OBS.
 *
 * `force` bypasses the identical-payload check; the heartbeat uses it, because
 * its whole job is to repeat what a freshly loaded page missed.
 */
export async function pushCombat({ force = false } = {}) {
  if (!globalThis.game?.user?.isGM) return;
  if (!obs.connected) {
    lastSent = null; // reconnecting must re-send
    return;
  }

  let payload;
  try {
    payload = buildCombatPayload();
  } catch (err) {
    warn("Could not build the combat payload:", err.message);
    return;
  }

  const serialised = JSON.stringify(payload);
  if (!force && serialised === lastSent) return;

  try {
    await obs.emitBrowserEvent(combatEventName(), payload);
    lastSent = serialised;
    if (!force) {
      log(payload.present ? `Tracker -> ${payload.combatants.length} combatant(s)` : "Tracker cleared");
    }
  } catch (err) {
    warn("Could not send the combat update to OBS:", err.message);
    lastSent = null; // retry on the next event
  }
}
