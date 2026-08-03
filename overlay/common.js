/**
 * Helpers shared by the three overlay pages.
 *
 * Deliberately a classic script, like the pages that use it: a Browser Source
 * loads these from a local file, and `file://` blocks module imports, so
 * `type="module"` would leave every page silently dead. Each page pulls this in
 * with an ordinary `<script>` tag before its own, and reads it off
 * `window.OBSOverlayCommon`.
 *
 * The one rule every helper here exists to keep: **payload data becomes text
 * nodes, never markup**. The module flattens chat HTML before it sends it, and
 * nothing on this side ever puts a payload string anywhere but `textContent`.
 */
(function () {
  "use strict";

  /** Only these can appear in an <img src>. Keeps payload data out of URL schemes. */
  var SAFE_IMAGE = /^(https?:|data:image\/|file:|\/|[\w.-]+\/)/i;

  /** Remove every child of a node, ready to re-render into it. */
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

  /**
   * An <img> for a payload-supplied URL, or null if the URL is not one we are
   * willing to load. Callers treat null as "no picture", never as an error.
   */
  function image(src, className) {
    if (!src || !SAFE_IMAGE.test(src)) return null;
    var node = el("img", className);
    node.src = src;
    node.alt = "";
    return node;
  }

  /**
   * Look-and-feel options from the query string.
   *
   * Note that OBS's "Local file" tick gives no query string at all — a page that
   * needs one has to be addressed as a typed `file:///…` URL instead. That is
   * why the panels are separate files rather than `?panel=` on one file: the
   * easy path in OBS has to work without any of this.
   */
  function readOptions(search, defaultEvent) {
    var params = new URLSearchParams(search || "");
    return {
      event: params.get("event") || defaultEvent,
      accent: params.get("accent") || null,
      scale: parseFloat(params.get("scale")) || null,
      anchor: params.get("anchor") === "top" ? "top" : "bottom",
      // Proof of life is on unless explicitly suppressed for going live.
      idle: params.get("idle") === "hide" ? "hide" : "show"
    };
  }

  /** Apply the look-and-feel options to a page's root element. */
  function applyOptions(root, options) {
    if (options.accent) root.style.setProperty("--accent", options.accent);
    if (options.scale) root.style.setProperty("--scale", String(options.scale));
    root.dataset.anchor = options.anchor;
    root.dataset.idle = options.idle;
  }

  /**
   * Wire a root element to one event name and return a handle.
   *
   * Listening on `window` is where obs-browser dispatches its events. The handle
   * exposes `apply` so a test can drive the renderer directly, with no OBS and
   * no WebSocket in the loop.
   */
  function mount(root, render, defaultEvent, options) {
    var opts =
      options ||
      readOptions(typeof location !== "undefined" ? location.search : "", defaultEvent);
    applyOptions(root, opts);

    // Has anything at all arrived from Foundry? This is the distinction that
    // makes an empty panel readable: "nothing to show" and "not receiving" look
    // identical on screen otherwise, and telling them apart by eye cost a whole
    // debugging session. The pages render a different idle line for each.
    root.dataset.live = "no";
    render(root, null);

    // Every route a payload can arrive by goes through here, so "live" means
    // "something was delivered" rather than "an event listener fired" — the
    // handle's own apply() is a delivery too, and a test driving it is
    // exercising the same thing OBS does.
    var lastRendered = null;
    var deliver = function (payload) {
      root.dataset.live = "yes";

      // The module re-sends the current payload every few seconds, so that a
      // Browser Source which reloaded refills without needing a handshake. A
      // page that already holds exactly that content has nothing to do, and
      // rebuilding it restarts every entrance animation and CSS transition on
      // it — which reads on stream as the whole panel flashing on a timer.
      //
      // Comparing here rather than in the module is deliberate: the module
      // cannot know what any given page last managed to render, and the
      // heartbeat has to keep arriving for the reload case to work at all.
      var serialised;
      try {
        serialised = JSON.stringify(payload);
      } catch (err) {
        serialised = null; // unserialisable: always render, never skip
      }
      if (serialised !== null && serialised === lastRendered) return;
      lastRendered = serialised;

      render(root, payload);
    };

    var handler = function (event) {
      deliver(event.detail);
    };
    window.addEventListener(opts.event, handler);

    return {
      eventName: opts.event,
      apply: deliver,
      destroy: function () {
        window.removeEventListener(opts.event, handler);
      }
    };
  }

  /** Mount once the document has a body to mount into. */
  function autoMount(start) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }

  window.OBSOverlayCommon = {
    SAFE_IMAGE: SAFE_IMAGE,
    clear: clear,
    el: el,
    show: show,
    image: image,
    readOptions: readOptions,
    applyOptions: applyOptions,
    mount: mount,
    autoMount: autoMount
  };
})();
