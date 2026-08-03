/**
 * The chat and combat pages, as they ship.
 *
 * Both are driven through the real .html and the real .js, so a class the
 * script looks for but the page stopped providing fails here rather than
 * appearing as an empty panel on a live stream.
 *
 * The recurring theme is that payload data must land in text nodes. The module
 * flattens chat HTML before it sends it, but that is a second line of defence,
 * not the only one — if a page ever grew an `innerHTML` for payload data, these
 * are the tests that should stop it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { loadOverlayPage, emitOverlayEvent, count } from "./helpers/dom.js";

/* -------------------------------------------- */
/*  Chat page                                   */
/* -------------------------------------------- */

function chatPage(t) {
  const dom = loadOverlayPage("chat");
  t.after(() => dom.restore());
  return dom;
}

function chatPayload(lines) {
  return { v: 1, present: true, lines };
}

const LINE = {
  id: "m1",
  category: "ooc",
  alias: "Ana",
  img: null,
  text: "hello table",
  rolls: []
};

test("the chat page mounts itself and starts empty", (t) => {
  const dom = chatPage(t);

  assert.equal(dom.instance.eventName, "obsSceneSwitcherChat");
  assert.equal(dom.root.dataset.state, "empty");
});

test("a chat payload renders one node per message", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([LINE, { ...LINE, id: "m2", text: "second" }]));

  assert.equal(count(dom.root, ".chat-line"), 2);
  assert.equal(dom.root.dataset.state, "shown");
});

test("the alias and the text are rendered", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([LINE]));

  assert.equal(dom.root.querySelector(".chat-alias").textContent, "Ana");
  assert.equal(dom.root.querySelector(".chat-text").textContent, "hello table");
});

test("message text is never parsed as markup", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([{ ...LINE, text: "<img src=x onerror=alert(1)>" }]));

  assert.equal(count(dom.root, "img"), 0, "payload text became an element");
  assert.equal(
    dom.root.querySelector(".chat-text").textContent,
    "<img src=x onerror=alert(1)>"
  );
});

test("an alias is never parsed as markup either", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([{ ...LINE, alias: "<b>Ana</b>" }]));

  assert.equal(count(dom.root, ".chat-alias b"), 0);
});

test("a roll renders its formula and total", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(
    chatPayload([{ ...LINE, category: "roll", rolls: [{ formula: "1d20 + 2", total: 18 }] }])
  );

  assert.equal(dom.root.querySelector(".chat-roll-formula").textContent, "1d20 + 2");
  assert.equal(dom.root.querySelector(".chat-roll-total").textContent, "18");
});

test("a roll total of zero is rendered, not treated as absent", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(
    chatPayload([{ ...LINE, category: "roll", rolls: [{ formula: "1d20 - 5", total: 0 }] }])
  );

  assert.equal(dom.root.querySelector(".chat-roll-total").textContent, "0");
});

test("a roll with no total still shows its formula", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(
    chatPayload([{ ...LINE, category: "roll", rolls: [{ formula: "2d6", total: null }] }])
  );

  assert.equal(count(dom.root, ".chat-roll-formula"), 1);
  assert.equal(count(dom.root, ".chat-roll-total"), 0);
});

test("the category is exposed so OBS custom CSS can style it", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([{ ...LINE, category: "emote" }]));

  assert.equal(dom.root.querySelector(".chat-line").dataset.category, "emote");
});

test("a portrait is rendered when the URL is one we will load", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([{ ...LINE, img: "https://foundry.example/hero.webp" }]));

  assert.equal(count(dom.root, "img.chat-avatar"), 1);
});

test("a javascript: portrait URL is refused", (t) => {
  const dom = chatPage(t);

  dom.instance.apply(chatPayload([{ ...LINE, img: "javascript:alert(1)" }]));

  assert.equal(count(dom.root, "img.chat-avatar"), 0);
});

test("a cleared payload empties the feed rather than leaving it up", (t) => {
  const dom = chatPage(t);
  dom.instance.apply(chatPayload([LINE]));

  dom.instance.apply({ v: 1, present: false, lines: [] });

  assert.equal(count(dom.root, ".chat-line"), 0);
  assert.equal(dom.root.dataset.state, "empty");
});

test("a shrinking feed leaves no stale lines behind", (t) => {
  const dom = chatPage(t);
  dom.instance.apply(chatPayload([LINE, { ...LINE, id: "m2" }, { ...LINE, id: "m3" }]));

  dom.instance.apply(chatPayload([LINE]));

  assert.equal(count(dom.root, ".chat-line"), 1);
});

test("the chat page renders what arrives on its event", (t) => {
  const dom = chatPage(t);

  emitOverlayEvent(dom, "obsSceneSwitcherChat", chatPayload([LINE]));

  assert.equal(count(dom.root, ".chat-line"), 1);
});

test("the chat page ignores an event it was not mounted for", (t) => {
  const dom = chatPage(t);

  emitOverlayEvent(dom, "someoneElsesEvent", chatPayload([LINE]));

  assert.equal(count(dom.root, ".chat-line"), 0);
});

/* -------------------------------------------- */
/*  Combat page                                 */
/* -------------------------------------------- */

function combatPage(t) {
  const dom = loadOverlayPage("combat");
  t.after(() => dom.restore());
  return dom;
}

function combatPayload(combatants, extra = {}) {
  return { v: 1, present: true, round: 2, started: true, combatants, ...extra };
}

const ROW = {
  id: "c1",
  name: "Player Character",
  initiative: 18,
  active: false,
  defeated: false,
  img: null,
  hp: null
};

test("the combat page mounts itself and starts empty", (t) => {
  const dom = combatPage(t);

  assert.equal(dom.instance.eventName, "obsSceneSwitcherCombat");
  assert.equal(dom.root.dataset.state, "empty");
});

test("a combat payload renders one row per combatant", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([ROW, { ...ROW, id: "c2", name: "Dragon" }]));

  assert.equal(count(dom.root, ".combat-row"), 2);
  assert.equal(dom.root.dataset.state, "shown");
});

test("the active combatant's row is marked", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([ROW, { ...ROW, id: "c2", active: true }]));

  assert.equal(count(dom.root, ".combat-row.active"), 1);
});

test("a defeated combatant's row is marked", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, defeated: true }]));

  assert.equal(count(dom.root, ".combat-row.defeated"), 1);
});

test("names are never parsed as markup", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, name: "<b>Dragon</b>" }]));

  assert.equal(count(dom.root, ".combat-name b"), 0);
  assert.equal(dom.root.querySelector(".combat-name").textContent, "<b>Dragon</b>");
});

test("the round header reads the round number", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([ROW], { round: 4 }));

  assert.equal(dom.root.querySelector(".combat-round").textContent, "Round 4");
});

test("a combat that has not started shows no round header", (t) => {
  // Round 0 during initiative rolling is not a round yet.
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([ROW], { started: false, round: 0 }));

  assert.equal(dom.root.querySelector(".combat-round").hidden, true);
});

test("a row with hit points gets a bar sized to them", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, hp: { value: 5, max: 20, temp: 0, pct: 25 } }]));

  assert.equal(dom.root.querySelector(".combat-hp-fill").style.width, "25%");
  assert.equal(dom.root.querySelector(".combat-hp-text").textContent, "5 / 20");
});

test("a row with no hit points gets no bar at all", (t) => {
  // A gated NPC arrives with hp: null. A placeholder bar would imply a number
  // the audience is not meant to have.
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, hp: null }]));

  assert.equal(count(dom.root, ".combat-hp"), 0);
});

test("a low health bar is marked so it can be coloured", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, hp: { value: 2, max: 20, temp: 0, pct: 10 } }]));

  assert.equal(count(dom.root, ".combat-hp.low"), 1);
});

test("an unknown maximum shows the number without implying a full bar", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, hp: { value: 12, max: null, temp: 0, pct: null } }]));

  assert.equal(count(dom.root, ".combat-hp.unknown-max"), 1);
  assert.equal(dom.root.querySelector(".combat-hp-text").textContent, "12");
});

test("temporary hit points are shown alongside the total", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, hp: { value: 19, max: 19, temp: 5, pct: 100 } }]));

  assert.equal(dom.root.querySelector(".combat-hp-text").textContent, "19 / 19 (+5)");
});

test("an initiative of zero is rendered, not treated as absent", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, initiative: 0 }]));

  assert.equal(dom.root.querySelector(".combat-init").textContent, "0");
});

test("a combatant who has not rolled gets no initiative box", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, initiative: null }]));

  assert.equal(count(dom.root, ".combat-init"), 0);
});

test("a gated NPC's row carries no portrait", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, img: null }]));

  assert.equal(count(dom.root, "img.combat-portrait"), 0);
});

test("a javascript: portrait URL is refused", (t) => {
  const dom = combatPage(t);

  dom.instance.apply(combatPayload([{ ...ROW, img: "javascript:alert(1)" }]));

  assert.equal(count(dom.root, "img.combat-portrait"), 0);
});

test("combat ending empties the tracker rather than leaving it up", (t) => {
  const dom = combatPage(t);
  dom.instance.apply(combatPayload([ROW]));

  dom.instance.apply({ v: 1, present: false, combatants: [] });

  assert.equal(count(dom.root, ".combat-row"), 0);
  assert.equal(dom.root.dataset.state, "empty");
  assert.equal(dom.root.querySelector(".combat-round").hidden, true);
});

test("a shrinking turn order leaves no stale rows behind", (t) => {
  const dom = combatPage(t);
  dom.instance.apply(combatPayload([ROW, { ...ROW, id: "c2" }, { ...ROW, id: "c3" }]));

  dom.instance.apply(combatPayload([ROW]));

  assert.equal(count(dom.root, ".combat-row"), 1);
});

test("the combat page renders what arrives on its event", (t) => {
  const dom = combatPage(t);

  emitOverlayEvent(dom, "obsSceneSwitcherCombat", combatPayload([ROW]));

  assert.equal(count(dom.root, ".combat-row"), 1);
});

/* -------------------------------------------- */
/*  Shared options                              */
/* -------------------------------------------- */

test("each page defaults to its own event name", (t) => {
  const chat = chatPage(t);
  const combat = combatPage(t);

  assert.equal(chat.overlay.readOptions("").event, "obsSceneSwitcherChat");
  assert.equal(combat.overlay.readOptions("").event, "obsSceneSwitcherCombat");
});

test("the pages accept the same look-and-feel parameters as the card", (t) => {
  const dom = chatPage(t);

  const opts = dom.overlay.readOptions("?event=x&accent=%23ff0000&scale=1.5&anchor=top");

  assert.deepEqual(opts, { event: "x", accent: "#ff0000", scale: 1.5, anchor: "top" });
});
