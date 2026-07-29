/**
 * A DOM for Node, so the modules that build UI can be tested.
 *
 * Node has no `document` — it runs JavaScript without a page. happy-dom
 * implements the tree in pure JS so `document.createElement`, `querySelector`
 * and event dispatch behave as they do in a browser.
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const OVERLAY_HTML = readFileSync(
  new URL("../../overlay/overlay.html", import.meta.url),
  "utf8"
);
const OVERLAY_JS = readFileSync(
  new URL("../../overlay/overlay.js", import.meta.url),
  "utf8"
);

/**
 * Install a fresh document as the globals the source reads.
 *
 * A new Window per test means no leaked nodes between tests — which matters
 * here because updateAllButtons() scans the whole document, so a button left
 * behind by an earlier test would be picked up by a later one.
 */
export function installDom() {
  const window = new Window({ url: "https://localhost" });
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Event: globalThis.Event
  };

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Event = window.Event;

  document.body.innerHTML = "";

  return {
    window,
    document: window.document,
    restore() {
      Object.assign(globalThis, saved);
    }
  };
}

/**
 * Build a Combat Tracker stand-in and attach it to the document.
 *
 * `inner` is the tracker's markup; pass whichever container the test wants
 * injectOverrideButton to find (`.combat-controls`, `header`, or nothing).
 */
export function makeTracker(inner = "") {
  const root = document.createElement("div");
  root.classList.add("combat-tracker");
  root.innerHTML = inner;
  document.body.append(root);
  return root;
}

/**
 * Wrap a node the way older Foundry versions did, as a jQuery-ish object:
 * array-indexed, with the real element at [0].
 */
export function asJQuery(element) {
  return { 0: element, length: 1 };
}

/** Fire a real click event, as a user would. */
export function click(element) {
  element.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
}

/**
 * Load the real overlay page into a happy-dom window.
 *
 * The markup comes out of the shipped overlay.html rather than being restated
 * here, so a class the script looks for but the page stopped providing fails a
 * test instead of silently rendering an empty card on stream.
 *
 * overlay.js is a classic script — it has no exports to import — so it is
 * evaluated with `window` and `document` handed in as the page would supply
 * them.
 */
export function loadOverlayPage() {
  const dom = installDom();

  const body = OVERLAY_HTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1].replace(
    /<script[\s\S]*?<\/script>/gi,
    ""
  );
  dom.document.body.innerHTML = body;

  new Function("window", "document", OVERLAY_JS)(dom.window, dom.document);

  // The script self-mounts on DOMContentLoaded if the document is still
  // parsing; happy-dom's readyState varies, so nudge it when it has not run.
  if (!dom.window.OBSOverlay.instance) {
    dom.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  }

  return {
    ...dom,
    overlay: dom.window.OBSOverlay,
    instance: dom.window.OBSOverlay.instance,
    root: dom.document.getElementById("obs-overlay-root")
  };
}

/** Dispatch a payload the way obs-browser does: a CustomEvent on `window`. */
export function emitOverlayEvent(dom, eventName, detail) {
  dom.window.dispatchEvent(new dom.window.CustomEvent(eventName, { detail }));
}

/**
 * Count matching elements.
 *
 * Assert on this rather than on a node — `assert.equal(el, null)` puts a DOM
 * element into the failure's `actual`, and a happy-dom node is a deeply
 * circular object (parentNode <-> childNodes <-> ownerDocument). node:test
 * tries to serialise it for the diff and effectively hangs, so the test never
 * reports a usable failure. Comparing numbers keeps failures readable.
 */
export function count(root, selector) {
  return root.querySelectorAll(selector).length;
}
