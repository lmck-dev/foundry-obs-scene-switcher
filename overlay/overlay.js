/**
 * The stream overlay, as run inside an OBS Browser Source.
 *
 * Deliberately a classic script rather than an ES module: a Browser Source can
 * be pointed at a local file, and `file://` blocks module imports, so `<script
 * type="module">` would leave the page silently dead for anyone using OBS's
 * "Local file" option.
 *
 * The module in Foundry pushes state here as a CustomEvent (obs-browser's
 * `emit_event` vendor request). Nothing is ever sent back — this page is a
 * renderer and holds no state beyond what it was last handed.
 */
(function () {
  "use strict";

  var DEFAULT_EVENT = "obsSceneSwitcherCharacter";

  /** Only these can appear in an <img src>. Keeps payload data out of URL schemes. */
  var SAFE_IMAGE = /^(https?:|data:image\/|file:|\/|[\w.-]+\/)/i;

  function readOptions(search) {
    var params = new URLSearchParams(search || "");
    return {
      event: params.get("event") || DEFAULT_EVENT,
      accent: params.get("accent") || null,
      scale: parseFloat(params.get("scale")) || null,
      anchor: params.get("anchor") === "top" ? "top" : "bottom"
    };
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** An element with text — used everywhere so payload data is never parsed as HTML. */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function show(node, visible) {
    node.hidden = !visible;
  }

  function chip(label, value) {
    var node = el("div", "chip");
    node.appendChild(el("span", "chip-label", label));
    node.appendChild(el("span", "chip-value", value));
    return node;
  }

  /**
   * Render a payload into the card.
   *
   * Exported (via window.OBSOverlay) so it can be driven directly from a test
   * without an OBS or a WebSocket in the loop.
   */
  function render(root, payload) {
    if (!payload || payload.present !== true) {
      root.dataset.state = "empty";
      return;
    }

    var flags = payload.show || {};
    var visible = function (key) {
      return flags[key] !== false;
    };

    var portrait = root.querySelector(".portrait");
    var hasPortrait = Boolean(visible("portrait") && payload.img && SAFE_IMAGE.test(payload.img));
    if (hasPortrait) portrait.src = payload.img;
    else portrait.removeAttribute("src");
    show(portrait, hasPortrait);

    root.querySelector(".name").textContent = payload.name || "";

    var subtitle = root.querySelector(".subtitle");
    subtitle.textContent = payload.subtitle || "";
    show(subtitle, Boolean(visible("subtitle") && payload.subtitle));

    renderHp(root, payload, visible("hp"));
    renderChips(root, payload, visible);
    renderAbilities(root, payload, visible("abilities"));
    renderConditions(root, payload, visible("conditions"));

    // Restart the entrance animation only when the character actually changes,
    // so a damage tick refreshes the numbers without re-animating the card.
    if (root.dataset.actor !== String(payload.actorId)) {
      root.dataset.actor = String(payload.actorId);
      root.classList.remove("swap");
      void root.offsetWidth; // reflow: without this the class re-add is coalesced
      root.classList.add("swap");
    }

    root.dataset.state = "shown";
  }

  function renderHp(root, payload, enabled) {
    var wrap = root.querySelector(".hp");
    var hp = payload.hp;
    if (!enabled || !hp) {
      show(wrap, false);
      return;
    }

    var fill = wrap.querySelector(".hp-fill");
    // A null pct means the system gave no maximum — show the number, not a bar.
    var known = typeof hp.pct === "number";
    fill.style.width = known ? hp.pct + "%" : "0%";
    wrap.classList.toggle("unknown-max", !known);
    wrap.classList.toggle("low", known && hp.pct <= 25);
    wrap.classList.toggle("mid", known && hp.pct > 25 && hp.pct <= 50);

    var text = hp.max === null || hp.max === undefined ? String(hp.value) : hp.value + " / " + hp.max;
    if (hp.temp) text += " (+" + hp.temp + ")";
    wrap.querySelector(".hp-text").textContent = text;

    show(wrap, true);
  }

  function renderChips(root, payload, visible) {
    var wrap = root.querySelector(".chips");
    clear(wrap);

    if (visible("ac") && payload.ac !== null && payload.ac !== undefined) {
      wrap.appendChild(chip("AC", payload.ac));
    }
    if (visible("speed") && payload.speed) {
      wrap.appendChild(chip("SPD", payload.speed));
    }
    if (visible("passivePerception") && payload.passivePerception !== null && payload.passivePerception !== undefined) {
      wrap.appendChild(chip("PP", payload.passivePerception));
    }

    show(wrap, wrap.childNodes.length > 0);
  }

  function renderAbilities(root, payload, enabled) {
    var wrap = root.querySelector(".abilities");
    clear(wrap);

    var abilities = enabled && Array.isArray(payload.abilities) ? payload.abilities : [];
    abilities.forEach(function (ability) {
      var node = el("div", "ability");
      node.appendChild(el("span", "ability-label", ability.label || ability.key));
      // Prefer the modifier — it is what gets rolled — and fall back to the score.
      node.appendChild(el("span", "ability-value", ability.mod !== null && ability.mod !== undefined ? ability.mod : ability.value));
      wrap.appendChild(node);
    });

    show(wrap, abilities.length > 0);
  }

  function renderConditions(root, payload, enabled) {
    var wrap = root.querySelector(".conditions");
    clear(wrap);

    var conditions = enabled && Array.isArray(payload.conditions) ? payload.conditions : [];
    conditions.forEach(function (condition) {
      var node = el("div", "condition");
      if (condition.img && SAFE_IMAGE.test(condition.img)) {
        var icon = el("img", "condition-icon");
        icon.src = condition.img;
        icon.alt = "";
        node.appendChild(icon);
      }
      node.appendChild(el("span", "condition-name", condition.name));
      wrap.appendChild(node);
    });

    show(wrap, conditions.length > 0);
  }

  /** Apply the look-and-feel query parameters to the page. */
  function applyOptions(root, options) {
    if (options.accent) root.style.setProperty("--accent", options.accent);
    if (options.scale) root.style.setProperty("--scale", String(options.scale));
    root.dataset.anchor = options.anchor;
  }

  /**
   * Wire a root element to the event stream and return a handle.
   * Listening on `window` is where obs-browser dispatches its events.
   */
  function mount(root, options) {
    var opts = options || readOptions(typeof location !== "undefined" ? location.search : "");
    applyOptions(root, opts);
    render(root, null);

    var handler = function (event) {
      render(root, event.detail);
    };
    window.addEventListener(opts.event, handler);

    return {
      eventName: opts.event,
      apply: function (payload) {
        render(root, payload);
      },
      destroy: function () {
        window.removeEventListener(opts.event, handler);
      }
    };
  }

  window.OBSOverlay = {
    DEFAULT_EVENT: DEFAULT_EVENT,
    readOptions: readOptions,
    render: render,
    mount: mount
  };

  function autoMount() {
    var root = document.getElementById("obs-overlay-root");
    if (root) window.OBSOverlay.instance = mount(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
