/**
 * Pushes the current character to the stream overlay.
 *
 * The transport is obs-browser's `emit_event` vendor request, which dispatches a
 * CustomEvent into every Browser Source running in OBS. It is one-way: the page
 * cannot ask us for state, and an event sent before the page loaded is simply
 * lost. A Browser Source can (re)load at any time — OBS restarts it whenever its
 * scene becomes visible, if "Shutdown source when not visible" is set — so a
 * heartbeat re-sends the current payload periodically. That, rather than any
 * handshake, is what makes the overlay self-healing.
 */
import {
  SETTINGS,
  DEFAULT_OVERLAY_EVENT,
  NPC_POLICY,
  OVERLAY_FIELDS,
  OVERLAY_NPC_FIELDS,
  getSetting,
  resolveOverlayFields,
  log,
  warn
} from "./constants.js";
import { obs } from "./obs-client.js";
import { resolveSubject, hasSceneMapping } from "./scene-sync.js";
import { buildCharacterData } from "./character-data.js";

/** How often to re-send the current payload so late-loading pages catch up. */
export const HEARTBEAT_MS = 5000;

/** Payload schema version, so a future overlay page can detect an old module. */
export const PAYLOAD_VERSION = 1;

/** The empty payload: tells the page to hide the card. */
const CLEARED = { v: PAYLOAD_VERSION, present: false };

let lastSent = null;
let heartbeat = null;

/** Forget what was last sent, so the next push always emits. */
export function resetOverlayCache() {
  lastSent = null;
}

/**
 * Resolve an actor image to something a Browser Source can actually load.
 *
 * The page may be loaded from a file:// path rather than from Foundry, in which
 * case a relative path like "worlds/x/hero.webp" resolves against the local
 * filesystem and 404s. Absolute URLs survive either way.
 */
export function absoluteImageUrl(img) {
  if (!img) return null;
  if (/^(https?:|data:|file:)/i.test(img)) return img;

  // getRoute applies Foundry's route prefix when the server runs under one.
  const routed = globalThis.foundry?.utils?.getRoute?.(img) ?? img;
  const base = globalThis.location?.href;
  if (!base) return routed;

  try {
    return new URL(routed, base).href;
  } catch {
    return routed;
  }
}

/** The actor behind a Token or Combatant, plus whether it is hidden from players. */
function subjectInfo(subject) {
  if (!subject) return null;
  const actor = subject.actor ?? null;
  if (!actor) return null;

  // Token placeables carry it on .document, combatants on .token or themselves.
  const hidden = [
    subject.document?.hidden,
    subject.token?.hidden,
    subject.hidden
  ].some(Boolean);

  return { actor, hidden };
}

/** Whether this actor has been ticked for a card of its own. */
export function isCardEnabled(actor) {
  if (!actor?.id) return false;
  const enabled = getSetting(SETTINGS.overlayActors);
  return Boolean(enabled && enabled[actor.id]);
}

/**
 * Whether this character is allowed on the stream.
 *
 * Player characters always are — they are the players' own, and already on
 * screen. NPCs are gated, because otherwise clicking a boss's token puts its
 * hit points and armour class in front of the table.
 */
export function mayAppear(actor, subject) {
  if (actor.hasPlayerOwner) return true;

  // An individual tick stands on its own, whatever the blanket rule is. A card
  // is a lighter thing to grant than a scene, so an NPC can be named on stream
  // without spending a scene switch on them.
  if (isCardEnabled(actor)) return true;

  switch (getSetting(SETTINGS.overlayNpcs)) {
    case NPC_POLICY.all:
      return true;
    case NPC_POLICY.mapped:
      return hasSceneMapping(subject);
    default:
      return false;
  }
}

/**
 * Build the payload for the current subject.
 *
 * Returns the cleared payload rather than null whenever nothing should be on
 * screen, so that "nothing to show" actively hides a stale card instead of
 * leaving the last character up.
 */
export function buildOverlayPayload() {
  if (!getSetting(SETTINGS.overlayEnabled)) return CLEARED;
  if (!getSetting(SETTINGS.syncEnabled)) return CLEARED;

  const subject = resolveSubject();
  const info = subjectInfo(subject);
  if (!info) return CLEARED;

  // A token the players cannot see must not be announced on stream — this
  // holds however permissive the NPC policy is.
  if (info.hidden) return CLEARED;

  if (!mayAppear(info.actor, subject)) return CLEARED;

  const data = buildCharacterData(info.actor, {
    systemId: globalThis.game?.system?.id ?? ""
  });
  if (!data) return CLEARED;

  return {
    v: PAYLOAD_VERSION,
    present: true,
    ...data,
    img: absoluteImageUrl(data.img),
    show: visibleFields(info.actor)
  };
}

/**
 * Which rows this character gets.
 *
 * NPCs have their own set: an NPC often earns a portrait and a name on stream
 * while its hit points and armour class stay at the table.
 */
export function visibleFields(actor) {
  return actor.hasPlayerOwner
    ? resolveOverlayFields(getSetting(SETTINGS.overlayFields), OVERLAY_FIELDS)
    : resolveOverlayFields(getSetting(SETTINGS.overlayNpcFields), OVERLAY_NPC_FIELDS);
}

/** The event name the overlay page listens for. */
export function overlayEventName() {
  const configured = getSetting(SETTINGS.overlayEventName);
  return (typeof configured === "string" && configured.trim()) || DEFAULT_OVERLAY_EVENT;
}

/**
 * Send the current payload to OBS.
 *
 * `force` bypasses the identical-payload check; the heartbeat uses it, because
 * its whole job is to repeat what a freshly loaded page missed.
 */
export async function pushOverlay({ force = false } = {}) {
  if (!game.user?.isGM) return;
  if (!obs.connected) {
    // Nothing can be delivered — drop the cache so reconnecting re-sends.
    lastSent = null;
    return;
  }

  let payload;
  try {
    payload = buildOverlayPayload();
  } catch (err) {
    warn("Could not build the overlay payload:", err.message);
    return;
  }

  const serialised = JSON.stringify(payload);
  if (!force && serialised === lastSent) return;

  try {
    await obs.emitBrowserEvent(overlayEventName(), payload);
    lastSent = serialised;
    if (!force) {
      log(payload.present ? `Overlay -> ${payload.name}` : "Overlay cleared");
    }
  } catch (err) {
    warn("Could not send the overlay update to OBS:", err.message);
    lastSent = null; // retry on the next event
  }
}

/**
 * Re-send periodically so a Browser Source that loads later still fills in.
 *
 * Takes the feeds to repeat rather than knowing them, because the chat and
 * combat feeds import from this file — reaching back for them here would be a
 * cycle. They share one timer so the panels refill together.
 */
export function startHeartbeat(feeds = [pushOverlay]) {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    for (const push of feeds) push({ force: true });
  }, HEARTBEAT_MS);
}

export function stopHeartbeat() {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

/**
 * Re-push only when the changed document is the one on screen — actor updates
 * fire constantly in a busy world and each one costs an OBS round trip.
 */
export function refreshIfCurrent(actorId) {
  if (!actorId) return;
  const info = subjectInfo(resolveSubject());
  if (info?.actor?.id === actorId) pushOverlay();
}
