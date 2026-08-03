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

  /**
   * Render a payload into the feed.
   *
   * Lines are matched to the nodes already on screen **by message id** rather
   * than the list being rebuilt. This is the one page where that matters: its
   * rows have an entrance animation, and a fresh node always replays it, so any
   * rebuild — including the module's periodic re-send of unchanged state — puts
   * the whole feed through its animation again. The character card and the
   * tracker get away with rebuilding because nothing on them animates on
   * insertion; chat cannot, so it does not rebuild.
   *
   * A node already showing exactly its line is left completely untouched: not
   * re-created, not re-ordered, not even re-filled. That makes the panel
   * immune to a repeated payload rather than merely defended against one.
   */
  function render(root, payload) {
    var lines = payload && payload.present === true && Array.isArray(payload.lines)
      ? payload.lines
      : [];

    var list = root.querySelector(".chat-lines");

    // What is on screen right now, by id.
    var existing = Object.create(null);
    Array.prototype.forEach.call(list.children, function (node) {
      if (node.dataset.id) existing[node.dataset.id] = node;
    });

    var wanted = Object.create(null);
    lines.forEach(function (line, index) {
      var id = String(line.id);
      wanted[id] = true;

      var node = existing[id];
      if (node) {
        // It has been on screen since the last render, so its entrance has
        // already played. Dropping the class keeps it from replaying should the
        // node ever have to move.
        node.classList.remove("is-new");
        fillLine(node, line, false);
      } else {
        node = renderLine(line, true);
      }

      // Only touch the DOM when this node is not already in the right place.
      // Re-inserting a node restarts its animation, so "already correct" has
      // to mean "leave it entirely alone".
      if (list.children[index] !== node) {
        list.insertBefore(node, list.children[index] || null);
      }
    });

    // Anything left over has scrolled off the feed or was deleted.
    Array.prototype.slice.call(list.children).forEach(function (node) {
      if (!wanted[node.dataset.id]) list.removeChild(node);
    });

    root.dataset.state = lines.length ? "shown" : "empty";
  }

  function renderLine(line, isNew) {
    var node = C.el("div", "chat-line");
    node.dataset.id = String(line.id);
    if (isNew) node.classList.add("is-new");
    fillLine(node, line, true);
    return node;
  }

  /**
   * Fill a line node's contents, skipping the work entirely when it already
   * holds exactly this line. The signature is what makes a repeated payload
   * free rather than merely harmless.
   */
  function fillLine(node, line, force) {
    var signature = JSON.stringify(line);
    if (!force && node.dataset.sig === signature) return;
    node.dataset.sig = signature;
    C.clear(node);
    buildLineContents(node, line);
  }

  function buildLineContents(node, line) {
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
