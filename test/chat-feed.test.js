/**
 * The chat feed, and above all its gate.
 *
 * Chat is the one place in Foundry where the Gamemaster's private business and
 * the table's public business share a window, so most of what follows is about
 * what must *not* be sent. Those tests are the load-bearing ones: a bug that
 * drops a message is a dull evening, and a bug that broadcasts one is not.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SETTINGS,
  CHAT_CATEGORIES,
  DEFAULT_CHAT_EVENT,
  resolveChatCategories
} from "../scripts/constants.js";
import {
  stripHtml,
  truncate,
  categorise,
  isPrivate,
  mayShow,
  buildLine,
  recordMessage,
  forgetMessage,
  bufferedLines,
  buildChatPayload,
  chatEventName,
  pushChat,
  resetChatFeed,
  seedChatFeed,
  MAX_TEXT
} from "../scripts/chat-feed.js";
import { obs } from "../scripts/obs-client.js";
import { installDom } from "./helpers/dom.js";
import {
  installFoundry,
  makeMessage,
  makeUser,
  makeActor,
  stubObs,
  muteConsole,
  STYLES
} from "./helpers/foundry-mock.js";

const PLAYER = makeUser({ name: "Ana", isGM: false });
const GM = makeUser({ name: "Gamemaster", isGM: true });

/** Every category on, so a test about something else is not gated by accident. */
const ALL_CATEGORIES = {
  roll: true,
  ic: true,
  emote: true,
  ooc: true,
  other: true
};

function setUp(t, options = {}) {
  const dom = installDom();
  const foundry = installFoundry(options);
  const unmute = muteConsole();
  resetChatFeed();
  t.after(() => {
    resetChatFeed();
    unmute();
    foundry.restore();
    dom.restore();
  });
  return { dom, foundry };
}

/* -------------------------------------------- */
/*  Flattening message HTML                     */
/* -------------------------------------------- */

test("message markup is flattened to its text", (t) => {
  setUp(t);

  assert.equal(stripHtml("<p>Hello <b>there</b></p>"), "Hello there");
});

test("a script tag in a message contributes no text and no markup", (t) => {
  // The page renders whatever arrives into a text node, so this could not
  // execute either way — but nothing resembling markup should reach it at all.
  setUp(t);

  const text = stripHtml('<img src=x onerror="alert(1)"><script>alert(2)</script>ok');

  assert.equal(text.includes("<"), false);
  assert.equal(text.includes("onerror"), false);
  assert.equal(text.includes("alert"), false);
  assert.equal(text, "ok");
});

test("whitespace and newlines collapse to single spaces", (t) => {
  setUp(t);

  assert.equal(stripHtml("<div>a\n\n   b</div>"), "a b");
});

test("an empty or absent message body flattens to an empty string", (t) => {
  setUp(t);

  assert.equal(stripHtml(null), "");
  assert.equal(stripHtml(undefined), "");
  assert.equal(stripHtml(""), "");
});

test("long messages are truncated rather than pushing the panel off screen", (t) => {
  setUp(t);

  const text = truncate("word ".repeat(200));

  assert.equal(text.length <= MAX_TEXT + 1, true, "over the limit");
  assert.equal(text.endsWith("…"), true, "no ellipsis to show it was cut");
});

test("a message inside the limit is left exactly as it is", (t) => {
  setUp(t);

  assert.equal(truncate("short enough"), "short enough");
});

/* -------------------------------------------- */
/*  Classification                              */
/* -------------------------------------------- */

test("a message carrying dice is a roll, whatever style it was posted in", (t) => {
  setUp(t);

  const message = makeMessage({ style: STYLES.IC, rolls: [{ formula: "1d20", total: 18 }] });

  assert.equal(categorise(message), CHAT_CATEGORIES.roll);
});

test("styles map to their own categories", (t) => {
  setUp(t);

  assert.equal(categorise(makeMessage({ style: STYLES.IC })), CHAT_CATEGORIES.ic);
  assert.equal(categorise(makeMessage({ style: STYLES.EMOTE })), CHAT_CATEGORIES.emote);
  assert.equal(categorise(makeMessage({ style: STYLES.OOC })), CHAT_CATEGORIES.ooc);
  assert.equal(categorise(makeMessage({ style: STYLES.OTHER })), CHAT_CATEGORIES.other);
});

test("an unrecognised style is 'other' rather than a category of its own", (t) => {
  setUp(t);

  assert.equal(categorise(makeMessage({ style: 99 })), CHAT_CATEGORIES.other);
});

/* -------------------------------------------- */
/*  What must never be sent                     */
/* -------------------------------------------- */

test("a whisper never reaches the stream, whatever the categories say", (t) => {
  setUp(t, { settings: { [SETTINGS.chatCategories]: ALL_CATEGORIES } });

  const message = makeMessage({ author: GM, whisper: ["user-id"], content: "psst" });

  assert.equal(isPrivate(message), true);
  assert.equal(mayShow(message), false);
});

test("a player's whisper is no more sendable than the Gamemaster's", (t) => {
  // The author check comes first in mayShow, so this is the ordering that
  // matters: "players are always on" must not outrank "whispers never are".
  setUp(t, { settings: { [SETTINGS.chatCategories]: ALL_CATEGORIES } });

  const message = makeMessage({ author: PLAYER, whisper: ["gm-id"], content: "psst" });

  assert.equal(mayShow(message), false);
});

test("a blind roll never reaches the stream", (t) => {
  setUp(t, { settings: { [SETTINGS.chatCategories]: ALL_CATEGORIES } });

  const message = makeMessage({
    author: GM,
    blind: true,
    rolls: [{ formula: "1d20", total: 3 }]
  });

  assert.equal(mayShow(message), false);
});

test("an empty whisper array is a public message, not a private one", (t) => {
  // Foundry stores `whisper: []` on ordinary messages; treating that as private
  // would silently empty the panel.
  setUp(t);

  assert.equal(isPrivate(makeMessage({ author: PLAYER, whisper: [] })), false);
});

/* -------------------------------------------- */
/*  Who gets through                            */
/* -------------------------------------------- */

test("a player's message is shown even with every category unticked", (t) => {
  setUp(t); // categories all default to false

  assert.equal(mayShow(makeMessage({ author: PLAYER, content: "hello" })), true);
});

test("a player's message of any category is shown", (t) => {
  setUp(t);

  for (const style of Object.values(STYLES)) {
    assert.equal(
      mayShow(makeMessage({ author: PLAYER, style })),
      true,
      `style ${style} was gated`
    );
  }
  assert.equal(
    mayShow(makeMessage({ author: PLAYER, rolls: [{ formula: "1d6", total: 4 }] })),
    true
  );
});

test("the Gamemaster's message is hidden until its category is ticked", (t) => {
  const { foundry } = setUp(t);
  const message = makeMessage({ author: GM, style: STYLES.IC, content: "The door opens." });

  assert.equal(mayShow(message), false);

  foundry.store.set(SETTINGS.chatCategories, { ...ALL_CATEGORIES, ic: true, roll: false });

  assert.equal(mayShow(message), true);
});

test("ticking one category does not let another through", (t) => {
  setUp(t, { settings: { [SETTINGS.chatCategories]: { roll: true } } });

  assert.equal(
    mayShow(makeMessage({ author: GM, rolls: [{ formula: "1d20", total: 11 }] })),
    true
  );
  assert.equal(mayShow(makeMessage({ author: GM, style: STYLES.OOC })), false);
});

test("a message with no identifiable author is gated, not waved through", (t) => {
  // An unknown author must not become a way past the gate — it falls to the
  // Gamemaster's rules, which default to nothing.
  setUp(t);

  const message = makeMessage({ content: "from nowhere" });
  delete message.author;

  assert.equal(mayShow(message), false);
});

test("a stored category value that is not `true` does not open it", (t) => {
  // This is what lets mayShow trust a plain `=== true`. A setting hand-edited
  // to a truthy string, or migrated from some other shape, has to normalise to
  // false here rather than being believed further down.
  setUp(t);

  const resolved = resolveChatCategories({ ooc: "yes", roll: 1, ic: true });

  assert.equal(resolved.ooc, false);
  assert.equal(resolved.roll, false);
  assert.equal(resolved.ic, true);
  for (const value of Object.values(resolved)) {
    assert.equal(typeof value, "boolean", "a category resolved to a non-boolean");
  }
});

test("every category the module can classify has a default", (t) => {
  // mayShow reads the resolved map by the name categorise() returns. A category
  // added to one and not the other would read as undefined — which falls shut
  // today, but only by luck, and silently.
  setUp(t);

  const defaults = resolveChatCategories({});
  for (const category of Object.values(CHAT_CATEGORIES)) {
    assert.equal(category in defaults, true, `no default for "${category}"`);
  }
});

test("a stored category the module does not know is ignored", (t) => {
  // A setting written by a future version must not turn into a category that
  // silently opens something this version cannot describe.
  setUp(t, { settings: { [SETTINGS.chatCategories]: { somethingNew: true } } });

  assert.equal(mayShow(makeMessage({ author: GM, style: STYLES.OOC })), false);
});

/* -------------------------------------------- */
/*  Building a line                             */
/* -------------------------------------------- */

test("a line carries the speaker's alias rather than the author's name", (t) => {
  // The Gamemaster rolls initiative for every monster; the alias is the name
  // the audience is meant to read.
  setUp(t);

  const line = buildLine(
    makeMessage({ author: GM, speaker: { alias: "Adult Gold Dragon" } })
  );

  assert.equal(line.alias, "Adult Gold Dragon");
});

test("a line falls back to the author's name when there is no alias", (t) => {
  setUp(t);

  assert.equal(buildLine(makeMessage({ author: PLAYER })).alias, "Ana");
});

test("a roll line carries its formula and total", (t) => {
  setUp(t);

  const line = buildLine(
    makeMessage({ author: PLAYER, rolls: [{ formula: "1d20 + 2", total: 18 }] })
  );

  assert.deepEqual(line.rolls, [{ formula: "1d20 + 2", total: 18 }]);
});

test("a roll prefers its flavour over the system's roll card markup", (t) => {
  setUp(t);

  const line = buildLine(
    makeMessage({
      author: GM,
      flavor: "Initiative",
      content: "<div class='dice-roll'><h4 class='dice-total'>18</h4></div>",
      rolls: [{ formula: "1d20", total: 18 }]
    })
  );

  assert.equal(line.text, "Initiative");
});

test("a roll with no flavour falls back to its content", (t) => {
  setUp(t);

  const line = buildLine(
    makeMessage({ author: PLAYER, content: "<p>rolled</p>", rolls: [{ formula: "1d4", total: 2 }] })
  );

  assert.equal(line.text, "rolled");
});

test("a line's text is never markup", (t) => {
  setUp(t);

  const line = buildLine(makeMessage({ author: PLAYER, content: "<b>bold</b> words" }));

  assert.equal(line.text, "bold words");
});

test("the speaker's portrait is resolved to an absolute URL", (t) => {
  // The page may be loaded from file://, where a relative path resolves against
  // the filesystem and 404s instead of finding the actor's art.
  const actor = makeActor({ id: "actor-7", img: "worlds/test/hero.webp" });
  setUp(t, { actors: [actor] });
  const saved = globalThis.location;
  globalThis.location = { href: "https://foundry.example:30000/game" };
  t.after(() => {
    globalThis.location = saved;
  });

  const line = buildLine(
    makeMessage({ author: PLAYER, speaker: { actor: "actor-7", alias: "Hero" } })
  );

  assert.equal(line.img, "https://foundry.example:30000/worlds/test/hero.webp");
});

test("a speaker with no actor leaves the portrait empty rather than guessing", (t) => {
  setUp(t);

  assert.equal(buildLine(makeMessage({ author: PLAYER })).img, null);
});

/* -------------------------------------------- */
/*  The buffer                                  */
/* -------------------------------------------- */

test("an allowed message joins the feed and a gated one does not", (t) => {
  setUp(t);

  assert.equal(recordMessage(makeMessage({ id: "a", author: PLAYER })), true);
  assert.equal(recordMessage(makeMessage({ id: "b", author: GM })), false);

  assert.deepEqual(bufferedLines().map((line) => line.id), ["a"]);
});

test("nothing is recorded while the feed is switched off", (t) => {
  setUp(t, { settings: { [SETTINGS.chatEnabled]: false } });

  assert.equal(recordMessage(makeMessage({ author: PLAYER })), false);
  assert.equal(bufferedLines().length, 0);
});

test("nothing is recorded while the override toggle is off", (t) => {
  // Sync off means "leave OBS alone", and that has to cover every panel.
  setUp(t, { settings: { [SETTINGS.syncEnabled]: false } });

  assert.equal(recordMessage(makeMessage({ author: PLAYER })), false);
});

test("the feed keeps only the configured number of messages, newest last", (t) => {
  setUp(t, { settings: { [SETTINGS.chatLines]: 3 } });

  for (const id of ["a", "b", "c", "d", "e"]) {
    recordMessage(makeMessage({ id, author: PLAYER }));
  }

  assert.deepEqual(bufferedLines().map((line) => line.id), ["c", "d", "e"]);
});

test("an unreadable line count falls back to the default rather than blanking", (t) => {
  setUp(t, { settings: { [SETTINGS.chatLines]: "not a number" } });

  for (const id of ["a", "b", "c"]) recordMessage(makeMessage({ id, author: PLAYER }));

  assert.equal(bufferedLines().length, 3);
});

test("a line count of zero is clamped up, so the panel is never silently empty", (t) => {
  setUp(t, { settings: { [SETTINGS.chatLines]: 0 } });

  recordMessage(makeMessage({ id: "a", author: PLAYER }));

  assert.equal(bufferedLines().length, 1);
});

test("deleting a message at the table retracts it from the feed", (t) => {
  setUp(t);
  recordMessage(makeMessage({ id: "a", author: PLAYER }));
  recordMessage(makeMessage({ id: "b", author: PLAYER }));

  assert.equal(forgetMessage("a"), true);

  assert.deepEqual(bufferedLines().map((line) => line.id), ["b"]);
});

test("deleting a message that was never on the feed changes nothing", (t) => {
  setUp(t);
  recordMessage(makeMessage({ id: "a", author: PLAYER }));

  assert.equal(forgetMessage("never-shown"), false);
  assert.equal(bufferedLines().length, 1);
});

/* -------------------------------------------- */
/*  Seeding from the existing log               */
/* -------------------------------------------- */

test("switching the feed on fills it from the log that already exists", (t) => {
  // Without this, ticking the box does nothing visible until somebody next
  // speaks — which looks exactly like the panel being broken, and was.
  setUp(t, {
    messages: [
      makeMessage({ id: "a", author: PLAYER, content: "first" }),
      makeMessage({ id: "b", author: PLAYER, content: "second" })
    ]
  });

  const seeded = seedChatFeed();

  assert.equal(seeded, 2);
  assert.deepEqual(bufferedLines().map((line) => line.text), ["first", "second"]);
});

test("seeding takes the newest messages, not the first in a long log", (t) => {
  setUp(t, {
    settings: { [SETTINGS.chatLines]: 2 },
    messages: ["a", "b", "c", "d"].map((id) =>
      makeMessage({ id, author: PLAYER, content: id })
    )
  });

  seedChatFeed();

  assert.deepEqual(bufferedLines().map((line) => line.text), ["c", "d"]);
});

test("seeding applies the same gate as a live message", (t) => {
  setUp(t, {
    messages: [
      makeMessage({ id: "a", author: PLAYER, content: "public" }),
      makeMessage({ id: "b", author: GM, whisper: ["someone"], content: "private" }),
      makeMessage({ id: "c", author: GM, content: "gm, category off" })
    ]
  });

  seedChatFeed();

  assert.deepEqual(bufferedLines().map((line) => line.text), ["public"]);
});

test("widening the categories reveals messages already in the log", (t) => {
  const { foundry } = setUp(t, {
    messages: [makeMessage({ id: "a", author: GM, rolls: [{ formula: "1d20", total: 7 }] })]
  });
  seedChatFeed();
  assert.equal(bufferedLines().length, 0);

  foundry.store.set(SETTINGS.chatCategories, { ...ALL_CATEGORIES });
  seedChatFeed();

  assert.equal(bufferedLines().length, 1);
});

test("narrowing the categories retracts what no longer qualifies", (t) => {
  const { foundry } = setUp(t, {
    settings: { [SETTINGS.chatCategories]: ALL_CATEGORIES },
    messages: [makeMessage({ id: "a", author: GM, content: "gm chatter" })]
  });
  seedChatFeed();
  assert.equal(bufferedLines().length, 1);

  foundry.store.set(SETTINGS.chatCategories, {});
  seedChatFeed();

  assert.equal(bufferedLines().length, 0);
});

test("seeding while the feed is off leaves it empty", (t) => {
  setUp(t, {
    settings: { [SETTINGS.chatEnabled]: false },
    messages: [makeMessage({ id: "a", author: PLAYER, content: "hello" })]
  });

  assert.equal(seedChatFeed(), 0);
  assert.equal(bufferedLines().length, 0);
});

test("one unreadable message in the log does not stop the rest seeding", (t) => {
  const broken = makeMessage({ id: "bad", author: PLAYER });
  Object.defineProperty(broken, "whisper", {
    get() {
      throw new Error("corrupt");
    }
  });
  setUp(t, {
    messages: [
      broken,
      makeMessage({ id: "ok", author: PLAYER, content: "still here" })
    ]
  });

  seedChatFeed();

  assert.deepEqual(bufferedLines().map((line) => line.text), ["still here"]);
});

test("seeding an empty log clears rather than throwing", (t) => {
  setUp(t, { messages: [] });

  assert.equal(seedChatFeed(), 0);
});

/* -------------------------------------------- */
/*  The payload                                 */
/* -------------------------------------------- */

test("an empty feed sends the cleared payload rather than nothing", (t) => {
  setUp(t);

  const payload = buildChatPayload();

  assert.equal(payload.present, false);
  assert.deepEqual(payload.lines, []);
});

test("switching the feed off clears it even while messages are buffered", (t) => {
  const { foundry } = setUp(t);
  recordMessage(makeMessage({ author: PLAYER, content: "hello" }));

  foundry.store.set(SETTINGS.chatEnabled, false);

  assert.equal(buildChatPayload().present, false);
});

test("the payload carries the buffered lines oldest first", (t) => {
  setUp(t);
  recordMessage(makeMessage({ id: "a", author: PLAYER, content: "first" }));
  recordMessage(makeMessage({ id: "b", author: PLAYER, content: "second" }));

  const payload = buildChatPayload();

  assert.equal(payload.present, true);
  assert.deepEqual(payload.lines.map((line) => line.text), ["first", "second"]);
});

/* -------------------------------------------- */
/*  Pushing to OBS                              */
/* -------------------------------------------- */

test("the feed is sent under the configured event name", async (t) => {
  setUp(t, { settings: { [SETTINGS.chatEventName]: "myChatEvent" } });
  const spy = stubObs(obs);
  t.after(() => spy.restore());
  recordMessage(makeMessage({ author: PLAYER, content: "hi" }));

  await pushChat();

  assert.equal(spy.emitted.at(-1).eventName, "myChatEvent");
});

test("a blank event name falls back to the default", (t) => {
  setUp(t, { settings: { [SETTINGS.chatEventName]: "   " } });

  assert.equal(chatEventName(), DEFAULT_CHAT_EVENT);
});

test("an identical feed is not re-sent", async (t) => {
  setUp(t);
  const spy = stubObs(obs);
  t.after(() => spy.restore());
  recordMessage(makeMessage({ author: PLAYER, content: "hi" }));

  await pushChat();
  await pushChat();

  assert.equal(spy.emitted.length, 1);
});

test("the heartbeat re-sends an identical feed, which is its whole job", async (t) => {
  // A Browser Source that reloaded missed everything sent while it was down.
  setUp(t);
  const spy = stubObs(obs);
  t.after(() => spy.restore());
  recordMessage(makeMessage({ author: PLAYER, content: "hi" }));

  await pushChat();
  await pushChat({ force: true });

  assert.equal(spy.emitted.length, 2);
});

test("a player client sends nothing", async (t) => {
  setUp(t, { isGM: false });
  const spy = stubObs(obs);
  t.after(() => spy.restore());

  await pushChat({ force: true });

  assert.equal(spy.emitted.length, 0);
});

test("a failed send is not cached as delivered", async (t) => {
  // The dedupe cache is what makes this subtle. A send that threw must clear
  // it, or a feed that later returns to the last *successfully* sent state is
  // judged identical to it and never re-sent — leaving the panel showing
  // something the table has moved on from.
  setUp(t);
  let fail = false;
  const spy = stubObs(obs, {
    emit: () => {
      if (fail) throw new Error("socket closed");
      return {};
    }
  });
  t.after(() => spy.restore());

  recordMessage(makeMessage({ id: "a", author: PLAYER, content: "first" }));
  await pushChat(); // delivered, and cached as such

  fail = true;
  recordMessage(makeMessage({ id: "b", author: PLAYER, content: "second" }));
  await pushChat(); // attempted, threw

  fail = false;
  forgetMessage("b"); // the feed is back to exactly what was last delivered
  await pushChat();

  assert.equal(spy.emitted.length, 3, "the state after a failed send was not re-sent");
});

test("nothing is sent while OBS is disconnected", async (t) => {
  setUp(t);
  const spy = stubObs(obs, { connected: false });
  t.after(() => spy.restore());
  recordMessage(makeMessage({ author: PLAYER, content: "hi" }));

  await pushChat();

  assert.equal(spy.emitted.length, 0);
});
