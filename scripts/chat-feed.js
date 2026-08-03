/**
 * Pushes the tail of the chat log to the stream overlay.
 *
 * Same transport and the same self-healing heartbeat as the character card, but
 * with one extra problem of its own: chat is the one place in Foundry where the
 * GM's private business and the table's public business share a window. Two
 * rules keep them apart, and both are load-bearing:
 *
 * 1. **Whispers and blind rolls never leave this file.** There is no setting for
 *    it. A toggle that could put the GM's whispers on a live stream is a toggle
 *    that will eventually be left on by accident, and the content behind it is
 *    exactly the content the audience is not meant to have.
 * 2. **Markup never leaves this file either.** A chat message's content is
 *    author-supplied HTML. The overlay page renders text nodes only, so the text
 *    is flattened here, before it is sent — the page is never handed markup it
 *    would have to be trusted to escape.
 *
 * Beyond that, a player's own messages always go through and the GM's are opted
 * in per category, which is the split a GM actually wants: the players' rolls
 * and banter are the show, while the GM's side is monster attacks, module
 * notices, and half the world's narration.
 */
import {
  SETTINGS,
  CHAT_CATEGORIES,
  DEFAULT_CHAT_EVENT,
  getSetting,
  resolveChatCategories,
  resolveChatLines,
  log,
  warn
} from "./constants.js";
import { obs } from "./obs-client.js";
import { absoluteImageUrl } from "./overlay-feed.js";

/** Payload schema version, so a future page can detect an old module. */
export const PAYLOAD_VERSION = 1;

/** Longest message text sent. A wall of text would push the panel off screen. */
export const MAX_TEXT = 300;

/** The empty payload: tells the page to show nothing. */
const CLEARED = { v: PAYLOAD_VERSION, present: false, lines: [] };

/** The messages currently on screen, oldest first. */
let buffer = [];
let lastSent = null;

/** Drop everything the panel is showing — used on reconnect and by the tests. */
export function resetChatFeed() {
  buffer = [];
  lastSent = null;
}

/** The lines currently buffered, oldest first. Exported for the tests. */
export function bufferedLines() {
  return buffer.slice();
}

/* -------------------------------------------- */
/*  Classification                              */
/*  -------------------------------------------- */

/**
 * Flatten HTML to its text.
 *
 * `DOMParser` rather than an element's `innerHTML`: the parsed document is
 * inert, so a `<img src>` in a chat message does not kick off a fetch just
 * because we wanted to read the words around it.
 */
export function stripHtml(html) {
  if (html === null || html === undefined) return "";
  const source = String(html);
  if (!source) return "";

  let text = source;
  try {
    const doc = new DOMParser().parseFromString(source, "text/html");
    // `textContent` counts the *contents* of <script> and <style> as text, so a
    // message carrying either would put its source on the stream as words. They
    // are not speech under any reading, so they go before the text is read.
    for (const node of doc.querySelectorAll("script, style")) node.remove();
    text = doc.body?.textContent ?? "";
  } catch {
    // No DOMParser (or malformed input it refused): fall back to dropping tags.
    // Coarse, but this path only ever loses formatting, never leaks markup —
    // the page renders whatever comes out as a text node regardless.
    text = source
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " ");
  }

  return text.replace(/\s+/g, " ").trim();
}

/** Trim to length on a word boundary where there is one nearby. */
export function truncate(text, limit = MAX_TEXT) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Which bucket a message falls in.
 *
 * Foundry renamed the field in v13 (`type` → `style`, with the constants
 * following); both are read so this does not silently classify everything as
 * `other` on the older of the two supported versions.
 */
export function categorise(message) {
  if (message?.rolls?.length || message?.isRoll) return CHAT_CATEGORIES.roll;

  const styles =
    globalThis.CONST?.CHAT_MESSAGE_STYLES ?? globalThis.CONST?.CHAT_MESSAGE_TYPES ?? {};
  const style = message?.style ?? message?.type;

  if (style !== undefined && style !== null) {
    if (style === styles.IC) return CHAT_CATEGORIES.ic;
    if (style === styles.EMOTE) return CHAT_CATEGORIES.emote;
    if (style === styles.OOC) return CHAT_CATEGORIES.ooc;
  }
  return CHAT_CATEGORIES.other;
}

/**
 * Messages that must never reach a stream, whatever anything else says.
 *
 * A whisper is addressed to named users, and a blind roll is one the roller is
 * not meant to see the result of — putting either on the broadcast defeats the
 * only reason it was sent that way.
 */
export function isPrivate(message) {
  if (!message) return true;
  if (Array.isArray(message.whisper) && message.whisper.length > 0) return true;
  if (message.blind === true) return true;
  return false;
}

/** The User who wrote a message. Foundry renamed `user` to `author` in v13. */
function authorOf(message) {
  return message?.author ?? message?.user ?? null;
}

/**
 * Whether a message may appear on the stream.
 *
 * The author check comes first because it is the broader permission: a player's
 * message goes through whatever its category, which is what "player messages
 * are always on" means. Anything whose author cannot be established is treated
 * as the GM's and so needs its category ticked — an unknown author must not be
 * a way past the gate.
 */
export function mayShow(message) {
  if (isPrivate(message)) return false;

  const author = authorOf(message);
  if (author && author.isGM === false) return true;

  const categories = resolveChatCategories(getSetting(SETTINGS.chatCategories));
  return categories[categorise(message)] === true;
}

/* -------------------------------------------- */
/*  Rendering a message down to data            */
/* -------------------------------------------- */

/** The portrait to show beside a line: the speaking actor's, else the author's. */
function portraitFor(message) {
  const actorId = message?.speaker?.actor;
  const actor = actorId ? globalThis.game?.actors?.get?.(actorId) : null;
  const img = actor?.img ?? authorOf(message)?.avatar ?? null;
  return img ? absoluteImageUrl(img) : null;
}

/** `[{ formula, total }]` for a roll message; empty for everything else. */
function rollsOf(message) {
  const rolls = Array.isArray(message?.rolls) ? message.rolls : [];
  return rolls
    .map((roll) => ({
      formula: String(roll?.formula ?? roll?._formula ?? "").trim(),
      total: Number.isFinite(Number(roll?.total)) ? Number(roll.total) : null
    }))
    .filter((roll) => roll.formula || roll.total !== null);
}

/**
 * Flatten a message to the shape the page renders.
 *
 * A roll's flavour is preferred over its content because the content is the
 * system's whole roll card — stripped of its markup that reads as a run-on of
 * every number on it, where the flavour is the one line a human wrote.
 */
export function buildLine(message) {
  const category = categorise(message);
  const flavour = stripHtml(message?.flavor);
  const content = stripHtml(message?.content);
  const text =
    category === CHAT_CATEGORIES.roll ? flavour || content : content || flavour;

  return {
    id: message?.id ?? null,
    category,
    alias: String(message?.speaker?.alias ?? authorOf(message)?.name ?? "").trim(),
    img: portraitFor(message),
    text: truncate(text),
    rolls: rollsOf(message)
  };
}

/* -------------------------------------------- */
/*  The feed                                    */
/* -------------------------------------------- */

/** Whether the panel is switched on and allowed to be sending anything. */
function feedEnabled() {
  return Boolean(getSetting(SETTINGS.chatEnabled) && getSetting(SETTINGS.syncEnabled));
}

/** Trim the buffer to the configured length, keeping the newest. */
function trim() {
  const limit = resolveChatLines(getSetting(SETTINGS.chatLines));
  if (buffer.length > limit) buffer = buffer.slice(buffer.length - limit);
}

/** The payload for whatever is buffered right now. */
export function buildChatPayload() {
  if (!feedEnabled()) return CLEARED;
  trim();
  if (!buffer.length) return CLEARED;
  return { v: PAYLOAD_VERSION, present: true, lines: buffer.slice() };
}

/** Add a message to the feed, if it is allowed on screen. */
export function recordMessage(message) {
  if (!feedEnabled()) return false;

  let allowed;
  try {
    allowed = mayShow(message);
  } catch (err) {
    // A message shape this code did not expect must not become a way past the
    // gate, so a thrown check counts as "no".
    warn("Could not classify a chat message; leaving it off the stream:", err.message);
    return false;
  }
  if (!allowed) return false;

  buffer.push(buildLine(message));
  trim();
  return true;
}

/** Drop a deleted message, so retracting something at the table retracts it on stream. */
export function forgetMessage(messageId) {
  if (!messageId) return false;
  const before = buffer.length;
  buffer = buffer.filter((line) => line.id !== messageId);
  return buffer.length !== before;
}

/** The event name the chat page listens for. */
export function chatEventName() {
  const configured = getSetting(SETTINGS.chatEventName);
  return (typeof configured === "string" && configured.trim()) || DEFAULT_CHAT_EVENT;
}

/**
 * Send the current feed to OBS.
 *
 * `force` bypasses the identical-payload check; the heartbeat uses it, because
 * its whole job is to repeat what a freshly loaded page missed.
 */
export async function pushChat({ force = false } = {}) {
  if (!globalThis.game?.user?.isGM) return;
  if (!obs.connected) {
    lastSent = null; // reconnecting must re-send
    return;
  }

  let payload;
  try {
    payload = buildChatPayload();
  } catch (err) {
    warn("Could not build the chat payload:", err.message);
    return;
  }

  const serialised = JSON.stringify(payload);
  if (!force && serialised === lastSent) return;

  try {
    await obs.emitBrowserEvent(chatEventName(), payload);
    lastSent = serialised;
    if (!force) log(`Chat -> ${payload.lines.length} line(s)`);
  } catch (err) {
    warn("Could not send the chat update to OBS:", err.message);
    lastSent = null; // retry on the next message
  }
}
