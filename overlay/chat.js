/**
 * The chat feed, as run inside an OBS Browser Source.
 *
 * A classic script for the same reason as the character card: a Browser Source
 * loads this from a local file, and `file://` blocks module imports.
 *
 * Everything this page receives has already been through the module's gate —
 * whispers and blind rolls never arrive, and message text arrives flattened to
 * plain text rather than as Foundry's markup. This side keeps the second half of
 * that bargain by only ever writing payload data into text nodes.
 */
(function () {
  "use strict";

  var C = window.OBSOverlayCommon;
  var DEFAULT_EVENT = "obsSceneSwitcherChat";
  var ROOT_ID = "obs-chat-root";

  /** Ids rendered last time, so only genuinely new lines animate in. */
  var previousIds = Object.create(null);

  /**
   * Render a payload into the feed.
   *
   * The whole list is rebuilt from each payload rather than diffed. The feed is
   * a handful of lines and arrives whole, so there is no state here to get out
   * of step with the module's.
   *
   * The entrance animation is the one thing that cannot be rebuilt blindly: a
   * fresh node always replays it, so a single new message would re-animate
   * every line above it. Only ids that were not on screen last time get the
   * class that animates.
   */
  function render(root, payload) {
    var lines = payload && payload.present === true && Array.isArray(payload.lines)
      ? payload.lines
      : [];

    var seen = Object.create(null);
    var list = root.querySelector(".chat-lines");
    C.clear(list);
    lines.forEach(function (line) {
      var id = String(line.id);
      list.appendChild(renderLine(line, !previousIds[id]));
      seen[id] = true;
    });
    previousIds = seen;

    root.dataset.state = lines.length ? "shown" : "empty";
  }

  function renderLine(line, isNew) {
    var node = C.el("div", "chat-line");
    if (isNew) node.classList.add("is-new");
    if (line.category) node.dataset.category = String(line.category);

    var avatar = C.image(line.img, "chat-avatar");
    if (avatar) node.appendChild(avatar);

    var body = C.el("div", "chat-body");

    var alias = C.el("div", "chat-alias", line.alias || "");
    C.show(alias, Boolean(line.alias));
    body.appendChild(alias);

    var text = C.el("div", "chat-text", line.text || "");
    C.show(text, Boolean(line.text));
    body.appendChild(text);

    var rolls = Array.isArray(line.rolls) ? line.rolls : [];
    if (rolls.length) body.appendChild(renderRolls(rolls));

    node.appendChild(body);
    return node;
  }

  function renderRolls(rolls) {
    var wrap = C.el("div", "chat-rolls");
    rolls.forEach(function (roll) {
      var node = C.el("div", "chat-roll");
      if (roll.formula) node.appendChild(C.el("span", "chat-roll-formula", roll.formula));
      // A roll with no total is still worth showing as a formula — a system can
      // post one before it resolves — so the total is the optional half.
      if (roll.total !== null && roll.total !== undefined) {
        node.appendChild(C.el("span", "chat-roll-total", roll.total));
      }
      wrap.appendChild(node);
    });
    return wrap;
  }

  function mount(root, options) {
    return C.mount(root, render, DEFAULT_EVENT, options);
  }

  window.OBSChatOverlay = {
    DEFAULT_EVENT: DEFAULT_EVENT,
    ROOT_ID: ROOT_ID,
    readOptions: function (search) {
      return C.readOptions(search, DEFAULT_EVENT);
    },
    render: render,
    mount: mount
  };

  C.autoMount(function () {
    var root = document.getElementById(ROOT_ID);
    if (root) window.OBSChatOverlay.instance = mount(root);
  });
})();
