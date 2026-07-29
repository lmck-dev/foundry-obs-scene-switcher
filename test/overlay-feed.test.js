/**
 * The overlay feed decides what — and whether — to put on stream. Most of these
 * tests are about the cases where the answer is "nothing", because a card that
 * fails to clear leaves a dead character on a live broadcast.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SETTINGS, OVERLAY_FIELDS, NPC_POLICY } from "../scripts/constants.js";
import { obs } from "../scripts/obs-client.js";
import {
  pushOverlay,
  buildOverlayPayload,
  resetOverlayCache,
  refreshIfCurrent,
  absoluteImageUrl,
  overlayEventName,
  isCardEnabled,
  startHeartbeat,
  stopHeartbeat,
  HEARTBEAT_MS
} from "../scripts/overlay-feed.js";
import {
  installFoundry,
  makeActor,
  makeToken,
  makeCombat,
  makeCombatant,
  stubObs,
  muteConsole
} from "./helpers/foundry-mock.js";

/** Install Foundry + a stubbed OBS for one test, and tear both down after. */
function setup(t, options = {}) {
  const foundry = installFoundry({ systemId: "dnd5e", ...options });
  const spy = stubObs(obs, { connected: options.connected ?? true });
  const unmute = muteConsole();

  resetOverlayCache();

  t.after(() => {
    stopHeartbeat();
    resetOverlayCache();
    unmute();
    spy.restore();
    foundry.restore();
  });

  return { foundry, spy };
}

const hero = () =>
  makeActor({
    id: "hero",
    name: "Thorin",
    system: { attributes: { hp: { value: 10, max: 10 }, ac: 16 } }
  });

const monster = () =>
  makeActor({ id: "beast", name: "Owlbear", hasPlayerOwner: false });

/* -------------------------------------------- */
/*  Who ends up on screen                       */
/* -------------------------------------------- */

test("the GM's selected token is who goes on stream", (t) => {
  const { spy } = setup(t, { controlled: [makeToken({ actor: hero() })] });

  return pushOverlay().then(() => {
    assert.equal(spy.emitted.length, 1);
    assert.equal(spy.lastPayload.present, true);
    assert.equal(spy.lastPayload.name, "Thorin");
  });
});

test("with nothing selected, the combatant whose turn it is goes on stream", async (t) => {
  const { spy } = setup(t, {
    combat: makeCombat({ combatant: makeCombatant({ actor: hero() }) })
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.name, "Thorin");
});

test("a selected token beats the current combatant", async (t) => {
  const other = makeActor({ id: "other", name: "Selected One" });
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: other })],
    combat: makeCombat({ combatant: makeCombatant({ actor: hero() }) })
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.name, "Selected One");
});

test("a selected token shows outside combat too", async (t) => {
  const { spy } = setup(t, { controlled: [makeToken({ actor: hero() })], combat: null });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, true);
});

test("a combat that has not started yet puts nobody on stream", async (t) => {
  const { spy } = setup(t, {
    combat: makeCombat({ started: false, combatant: makeCombatant({ actor: hero() }) })
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

test("nothing selected and no combat clears the card", async (t) => {
  const { spy } = setup(t);

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

/* -------------------------------------------- */
/*  Privacy                                     */
/* -------------------------------------------- */

test("a token hidden from the players never reaches the stream", async (t) => {
  const { spy } = setup(t, { controlled: [makeToken({ actor: hero(), hidden: true })] });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

test("a hidden combatant never reaches the stream", async (t) => {
  const { spy } = setup(t, {
    combat: makeCombat({ combatant: makeCombatant({ actor: hero(), hidden: true }) })
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

test("a combatant whose token is hidden never reaches the stream", async (t) => {
  const { spy } = setup(t, {
    combat: makeCombat({ combatant: makeCombatant({ actor: hero(), tokenHidden: true }) })
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

test("by default an NPC's stats stay off the stream, even with a scene mapping", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: { [SETTINGS.sceneMappings]: { beast: "Owlbear Cam" } }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

test("the most permissive policy lets any NPC on stream", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: { [SETTINGS.overlayNpcs]: NPC_POLICY.all }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.name, "Owlbear");
});

test("an NPC with a scene mapping is featured under the mapped policy", async (t) => {
  // Giving an NPC a scene is the opt-in: it is a character the GM is featuring.
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: {
      [SETTINGS.overlayNpcs]: NPC_POLICY.mapped,
      [SETTINGS.sceneMappings]: { beast: "Owlbear Cam" }
    }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.name, "Owlbear");
});

test("an unmapped NPC stays off under the mapped policy", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: {
      [SETTINGS.overlayNpcs]: NPC_POLICY.mapped,
      [SETTINGS.sceneMappings]: { someone_else: "Other Cam" }
    }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

test("a mapped NPC's mapping is matched by token id as well as actor id", async (t) => {
  // resolveScene() accepts either key shape, so the overlay must agree with it.
  const token = makeToken({ actor: monster() });
  token.id = "token-abc";
  const { spy } = setup(t, {
    controlled: [token],
    settings: {
      [SETTINGS.overlayNpcs]: NPC_POLICY.mapped,
      [SETTINGS.sceneMappings]: { "token-abc": "Owlbear Cam" }
    }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, true);
});

test("a mapped NPC is still refused while its token is hidden", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster(), hidden: true })],
    settings: {
      [SETTINGS.overlayNpcs]: NPC_POLICY.mapped,
      [SETTINGS.sceneMappings]: { beast: "Owlbear Cam" }
    }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

test("player characters appear under every policy, mapping or not", async (t) => {
  for (const policy of [NPC_POLICY.none, NPC_POLICY.mapped, NPC_POLICY.all]) {
    const foundry = installFoundry({
      systemId: "dnd5e",
      controlled: [makeToken({ actor: hero() })],
      settings: { [SETTINGS.overlayNpcs]: policy }
    });
    const unmute = muteConsole();
    const spy = stubObs(obs, {});
    resetOverlayCache();

    await pushOverlay();
    assert.equal(spy.lastPayload.present, true, `policy ${policy} hid a player character`);

    spy.restore();
    unmute();
    foundry.restore();
  }
});

test("an NPC ticked for a card appears even under the strictest policy", async (t) => {
  // The point of the per-actor tick: name a recurring NPC on stream without
  // spending a scene switch on them.
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: {
      [SETTINGS.overlayNpcs]: NPC_POLICY.none,
      [SETTINGS.overlayActors]: { beast: true }
    }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.name, "Owlbear");
});

test("a ticked NPC needs no scene mapping", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: {
      [SETTINGS.overlayNpcs]: NPC_POLICY.mapped,
      [SETTINGS.sceneMappings]: {},
      [SETTINGS.overlayActors]: { beast: true }
    }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, true);
});

test("ticking one NPC does not admit the others", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: { [SETTINGS.overlayActors]: { "some-other-actor": true } }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

test("an actor ticked and then unticked is refused again", async (t) => {
  // Stored as { id: true }, so a false or missing entry must not read as on.
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: { [SETTINGS.overlayActors]: { beast: false } }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

test("a ticked NPC is still refused while its token is hidden", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster(), hidden: true })],
    settings: { [SETTINGS.overlayActors]: { beast: true } }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

test("isCardEnabled copes with an empty or absent list", (t) => {
  setup(t, { settings: { [SETTINGS.overlayActors]: undefined } });

  assert.equal(isCardEnabled(makeActor({ id: "anyone" })), false);
  assert.equal(isCardEnabled(null), false);
  assert.equal(isCardEnabled({}), false);
});

test("an unrecognised stored policy is treated as the safe one", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: { [SETTINGS.overlayNpcs]: "something-a-future-version-wrote" }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

/* -------------------------------------------- */
/*  Gating                                      */
/* -------------------------------------------- */

test("a player client never talks to OBS", async (t) => {
  const { spy } = setup(t, { isGM: false, controlled: [makeToken({ actor: hero() })] });

  await pushOverlay();
  assert.equal(spy.emitted.length, 0);
});

test("nothing is sent while OBS is disconnected", async (t) => {
  const { spy } = setup(t, {
    connected: false,
    controlled: [makeToken({ actor: hero() })]
  });

  await pushOverlay();
  assert.equal(spy.emitted.length, 0);
});

test("disabling the overlay clears the card rather than freezing it", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: hero() })],
    settings: { [SETTINGS.overlayEnabled]: false }
  });

  await pushOverlay();
  assert.equal(spy.emitted.length, 1, "a clear must still be sent");
  assert.equal(spy.lastPayload.present, false);
});

test("turning sync off clears the card, so no stale character is left on stream", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: hero() })],
    settings: { [SETTINGS.syncEnabled]: false }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.present, false);
});

/* -------------------------------------------- */
/*  Delivery                                    */
/* -------------------------------------------- */

test("an unchanged payload is not re-sent", async (t) => {
  const { spy } = setup(t, { controlled: [makeToken({ actor: hero() })] });

  await pushOverlay();
  await pushOverlay();
  assert.equal(spy.emitted.length, 1);
});

test("force re-sends an unchanged payload — that is how a reloaded page refills", async (t) => {
  const { spy } = setup(t, { controlled: [makeToken({ actor: hero() })] });

  await pushOverlay();
  await pushOverlay({ force: true });
  assert.equal(spy.emitted.length, 2);
});

test("a changed stat is re-sent even though the character is the same", async (t) => {
  const actor = hero();
  const { spy } = setup(t, { controlled: [makeToken({ actor })] });

  await pushOverlay();
  actor.system.attributes.hp.value = 3;
  await pushOverlay();

  assert.equal(spy.emitted.length, 2);
  assert.equal(spy.lastPayload.hp.value, 3);
});

test("a failed send is retried on the next push rather than being swallowed by the cache", async (t) => {
  const foundry = installFoundry({
    systemId: "dnd5e",
    controlled: [makeToken({ actor: hero() })]
  });
  const unmute = muteConsole();
  let attempts = 0;
  const spy = stubObs(obs, {
    emit: () => {
      attempts++;
      if (attempts === 1) throw new Error("obs went away");
      return {};
    }
  });
  resetOverlayCache();
  t.after(() => {
    resetOverlayCache();
    unmute();
    spy.restore();
    foundry.restore();
  });

  await pushOverlay();
  await pushOverlay();

  assert.equal(attempts, 2, "the identical payload must be retried after a failure");
});

test("after a failure the next push goes out even if it matches the last success", async (t) => {
  // A failed send leaves OBS in an unknown state, so the payload cache cannot
  // be trusted afterwards — otherwise returning to the previous state is
  // silently skipped as a duplicate and the overlay stays wrong.
  const actor = hero();
  const foundry = installFoundry({
    systemId: "dnd5e",
    controlled: [makeToken({ actor })]
  });
  const unmute = muteConsole();
  let failing = false;
  const spy = stubObs(obs, {
    emit: () => {
      if (failing) throw new Error("obs blinked");
      return {};
    }
  });
  resetOverlayCache();
  t.after(() => {
    resetOverlayCache();
    unmute();
    spy.restore();
    foundry.restore();
  });

  await pushOverlay(); // full health: delivered

  failing = true;
  actor.system.attributes.hp.value = 3;
  await pushOverlay(); // wounded: attempted, fails

  failing = false;
  actor.system.attributes.hp.value = 10;
  await pushOverlay(); // healed back to the last delivered payload

  assert.equal(spy.emitted.length, 3);
});

test("the event name is the configured one", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: hero() })],
    settings: { [SETTINGS.overlayEventName]: "myOwnEvent" }
  });

  await pushOverlay();
  assert.equal(spy.emitted[0].eventName, "myOwnEvent");
});

test("a blank configured event name falls back to the default", (t) => {
  setup(t, { settings: { [SETTINGS.overlayEventName]: "   " } });
  assert.equal(overlayEventName(), "obsSceneSwitcherCharacter");
});

test("the payload carries the field visibility flags", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: hero() })],
    settings: { [SETTINGS.overlayFields]: { abilities: true } }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.show.abilities, true);
  assert.equal(
    spy.lastPayload.show.hp,
    OVERLAY_FIELDS.hp,
    "fields missing from a stored setting should fall back to the defaults"
  );
});

test("NPCs are shown with their own set of rows, not the players'", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: {
      [SETTINGS.overlayNpcs]: NPC_POLICY.all,
      [SETTINGS.overlayFields]: { hp: true, ac: true },
      [SETTINGS.overlayNpcFields]: { hp: false, ac: false, portrait: true }
    }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.show.hp, false);
  assert.equal(spy.lastPayload.show.ac, false);
  assert.equal(spy.lastPayload.show.portrait, true);
});

test("player characters keep their own set when the NPC set differs", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: hero() })],
    settings: {
      [SETTINGS.overlayFields]: { hp: true, ac: true },
      [SETTINGS.overlayNpcFields]: { hp: false, ac: false }
    }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.show.hp, true);
  assert.equal(spy.lastPayload.show.ac, true);
});

test("out of the box an NPC gets a portrait and a name, not a stat block", async (t) => {
  // The default that matters: an NPC on stream should be an introduction, not
  // a reveal of everything the players are still trying to work out.
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: { [SETTINGS.overlayNpcs]: NPC_POLICY.all }
  });

  await pushOverlay();
  const show = spy.lastPayload.show;

  assert.equal(show.portrait, true);
  for (const field of ["hp", "ac", "abilities", "speed", "passivePerception", "conditions"]) {
    assert.equal(show[field], false, `${field} should be off for NPCs by default`);
  }
});

test("a partial NPC set falls back to the NPC defaults, not the player ones", async (t) => {
  const { spy } = setup(t, {
    controlled: [makeToken({ actor: monster() })],
    settings: {
      [SETTINGS.overlayNpcs]: NPC_POLICY.all,
      [SETTINGS.overlayNpcFields]: { subtitle: true }
    }
  });

  await pushOverlay();
  assert.equal(spy.lastPayload.show.subtitle, true);
  assert.equal(
    spy.lastPayload.show.hp,
    false,
    "an unspecified row must default to the NPC default (off), not the player default (on)"
  );
});

/* -------------------------------------------- */
/*  Image URLs                                  */
/* -------------------------------------------- */

test("relative portraits become absolute, so a file:// overlay can load them", (t) => {
  const saved = globalThis.location;
  globalThis.location = { href: "https://foundry.example:30000/game" };
  t.after(() => {
    globalThis.location = saved;
  });

  assert.equal(
    absoluteImageUrl("worlds/test/hero.webp"),
    "https://foundry.example:30000/worlds/test/hero.webp"
  );
});

test("portraits that are already absolute are left alone", () => {
  assert.equal(absoluteImageUrl("https://cdn.example/x.png"), "https://cdn.example/x.png");
  assert.equal(absoluteImageUrl("data:image/png;base64,AAA"), "data:image/png;base64,AAA");
  assert.equal(absoluteImageUrl(null), null);
});

/* -------------------------------------------- */
/*  Reacting to changes                         */
/* -------------------------------------------- */

test("refreshIfCurrent pushes when the changed actor is the one on screen", async (t) => {
  const { spy } = setup(t, { controlled: [makeToken({ actor: hero() })] });

  await refreshIfCurrent("hero");
  assert.equal(spy.emitted.length, 1);
});

test("refreshIfCurrent ignores actors that are not on screen", async (t) => {
  const { spy } = setup(t, { controlled: [makeToken({ actor: hero() })] });

  await refreshIfCurrent("someone-else");
  await refreshIfCurrent(undefined);
  assert.equal(spy.emitted.length, 0);
});

/* -------------------------------------------- */
/*  Heartbeat                                   */
/* -------------------------------------------- */

test("the heartbeat re-sends the current payload so a reloaded Browser Source refills", (t) => {
  const { spy } = setup(t, { controlled: [makeToken({ actor: hero() })] });
  t.mock.timers.enable({ apis: ["setInterval"] });

  startHeartbeat();
  t.mock.timers.tick(HEARTBEAT_MS);
  t.mock.timers.tick(HEARTBEAT_MS);

  assert.equal(spy.emitted.length, 2);
});

test("stopping the heartbeat stops the traffic", (t) => {
  const { spy } = setup(t, { controlled: [makeToken({ actor: hero() })] });
  t.mock.timers.enable({ apis: ["setInterval"] });

  startHeartbeat();
  t.mock.timers.tick(HEARTBEAT_MS);
  stopHeartbeat();
  t.mock.timers.tick(HEARTBEAT_MS * 3);

  assert.equal(spy.emitted.length, 1);
});

test("starting the heartbeat twice does not double the traffic", (t) => {
  const { spy } = setup(t, { controlled: [makeToken({ actor: hero() })] });
  t.mock.timers.enable({ apis: ["setInterval"] });

  startHeartbeat();
  startHeartbeat();
  t.mock.timers.tick(HEARTBEAT_MS);

  assert.equal(spy.emitted.length, 1);
});

/* -------------------------------------------- */
/*  Payload shape                               */
/* -------------------------------------------- */

test("the cleared payload is minimal — the page needs no character data to hide", (t) => {
  setup(t, { settings: { [SETTINGS.overlayEnabled]: false } });
  const payload = buildOverlayPayload();

  assert.equal(payload.present, false);
  assert.equal(payload.name, undefined);
  assert.equal(payload.hp, undefined);
});

test("a present payload is versioned, so a future page can spot an old module", (t) => {
  setup(t, { controlled: [makeToken({ actor: hero() })] });
  assert.equal(buildOverlayPayload().v, 1);
});
