/**
 * Turn a Foundry Actor into the flat, system-neutral shape the stream overlay
 * renders.
 *
 * Everything else in this module is deliberately system-agnostic — it only ever
 * touches an actor's id, name and image. This file is the one place that knows
 * about system data paths, so support for a new system means adding an adapter
 * here and nothing else.
 *
 * Adapters are pure: they take an actor-like object and return plain data. No
 * Foundry globals are read, which is what makes them testable in Node.
 */

/** Coerce to a finite number, or null. Foundry fields are frequently strings. */
function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Format an ability modifier the way a character sheet does: +4 / -1 / +0. */
export function formatMod(mod) {
  const n = toNum(mod);
  if (n === null) return null;
  return n >= 0 ? `+${n}` : String(n);
}

/**
 * Normalise a hit-point-ish object.
 * Returns null unless there is at least a current value, so the overlay can
 * hide the bar entirely rather than render "null/null".
 */
function normaliseHp(raw) {
  if (!raw || typeof raw !== "object") return null;
  const value = toNum(raw.value);
  if (value === null) return null;

  const max = toNum(raw.max);
  const temp = toNum(raw.temp) || 0;
  // A max of 0 would make the bar meaningless *and* divide by zero.
  const pct = max && max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : null;

  return { value, max, temp, pct };
}

/** Read a name off a field that may be a plain string or an embedded document. */
function nameOf(field) {
  if (!field) return null;
  if (typeof field === "string") return field.trim() || null;
  if (typeof field === "object" && typeof field.name === "string") {
    return field.name.trim() || null;
  }
  return null;
}

/** Foundry collections expose `.contents`; plain arrays are already iterable. */
function toArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  return [];
}

/**
 * Active conditions/effects, as name + icon.
 *
 * Field names moved in Foundry v11 (`label` → `name`, `icon` → `img`); both are
 * read so the overlay is not blank on the older of the two supported versions.
 * Suppressed effects (e.g. from an unequipped item) are real but not in force,
 * so they are excluded along with disabled ones.
 */
function readConditions(actor) {
  return toArray(actor?.effects)
    .filter((e) => e && !e.disabled && !e.isSuppressed)
    .map((e) => ({
      name: nameOf(e.name) ?? nameOf(e.label) ?? "",
      img: e.img ?? e.icon ?? null
    }))
    .filter((c) => c.name);
}

/**
 * Ability scores from a `{ str: { value, mod }, ... }`-shaped map, which dnd5e,
 * pf2e and several other systems all use.
 */
function readAbilities(abilities) {
  if (!abilities || typeof abilities !== "object") return [];
  return Object.entries(abilities)
    .map(([key, data]) => {
      const value = toNum(data?.value);
      const mod = formatMod(data?.mod);
      if (value === null && mod === null) return null;
      return { key, label: key.slice(0, 3).toUpperCase(), value, mod };
    })
    .filter(Boolean);
}

/* -------------------------------------------- */
/*  Adapters                                    */
/* -------------------------------------------- */

/**
 * dnd5e. Class levels live on the class items rather than the actor, so the
 * subtitle is assembled from those ("Fighter 5 / Rogue 2"), falling back to the
 * older flat `details.class` string.
 */
function dnd5eAdapter(actor) {
  const sys = actor?.system ?? {};
  const attrs = sys.attributes ?? {};

  const classes = toArray(actor?.items)
    .filter((i) => i?.type === "class")
    .map((i) => {
      const levels = toNum(i.system?.levels);
      return levels ? `${i.name} ${levels}` : i.name;
    })
    .filter(Boolean);

  const parts = [];
  if (classes.length) parts.push(classes.join(" / "));
  else if (nameOf(sys.details?.class)) parts.push(nameOf(sys.details.class));

  const race = nameOf(sys.details?.race);
  if (race) parts.push(race);

  const background = nameOf(sys.details?.background);
  if (background) parts.push(background);

  const walk = toNum(attrs.movement?.walk);
  const units = attrs.movement?.units || "ft";

  return {
    subtitle: parts.join(" · ") || null,
    hp: normaliseHp(attrs.hp),
    ac: toNum(attrs.ac?.value),
    speed: walk === null ? null : `${walk} ${units}`,
    passivePerception: toNum(sys.skills?.prc?.passive),
    abilities: readAbilities(sys.abilities),
    conditions: readConditions(actor)
  };
}

/**
 * Everything else. Reads only the shapes that are near-universal across
 * systems, so an unsupported system shows a portrait, a name and usually a
 * health bar rather than an error.
 */
function genericAdapter(actor) {
  const sys = actor?.system ?? {};
  const attrs = sys.attributes ?? {};

  // Common homes for hit points, most specific first.
  const hp = normaliseHp(attrs.hp) ?? normaliseHp(sys.hp) ?? normaliseHp(sys.health);

  // `ac` is sometimes an object with a value, sometimes the number itself.
  const ac = toNum(attrs.ac?.value) ?? toNum(attrs.ac) ?? toNum(sys.ac?.value);

  return {
    subtitle: nameOf(sys.details?.class) ?? nameOf(sys.details?.type) ?? null,
    hp,
    ac,
    speed: null,
    passivePerception: null,
    abilities: readAbilities(sys.abilities),
    conditions: readConditions(actor)
  };
}

/** systemId → adapter. Add an entry to support a new system. */
const ADAPTERS = {
  dnd5e: dnd5eAdapter
};

/** Which adapter would handle a system — exported so tests can assert routing. */
export function adapterFor(systemId) {
  return ADAPTERS[systemId] ?? genericAdapter;
}

/**
 * Build the overlay payload for one actor.
 *
 * `systemId` is passed in rather than read from `game.system.id` so this stays
 * a pure function. An adapter throwing must never take the overlay down with
 * it, so failures fall back to the generic reading of the same actor.
 */
export function buildCharacterData(actor, { systemId = "" } = {}) {
  if (!actor) return null;

  const adapter = adapterFor(systemId);
  let stats;
  try {
    stats = adapter(actor);
  } catch (err) {
    // A system whose data model moved must not blank the stream. Fall back to
    // the generic reading, and if even that fails, to a portrait and a name.
    try {
      stats = genericAdapter(actor);
    } catch {
      stats = { subtitle: null, hp: null, ac: null, speed: null, passivePerception: null, abilities: [], conditions: [] };
    }
    stats.adapterError = err.message;
  }

  return {
    actorId: actor.id ?? null,
    name: actor.name ?? "",
    img: actor.img ?? null,
    system: systemId in ADAPTERS ? systemId : "generic",
    ...stats
  };
}
