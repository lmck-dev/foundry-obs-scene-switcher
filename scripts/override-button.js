import { MODULE_ID, SETTINGS, getSetting, setSetting } from "./constants.js";
import { obs, OBSStatus } from "./obs-client.js";
import { syncScene, resetSceneCache } from "./scene-sync.js";

const BUTTON_CLASS = "obs-scene-switcher-toggle";

/**
 * Inject (or refresh) the manual-override toggle button into the Combat Tracker.
 *
 * `renderCombatTracker` fires on every tracker re-render, so we guard against
 * duplicate injection. In Foundry v13+ the second hook argument is a raw
 * HTMLElement; older versions pass a jQuery object — handle both.
 */
export function injectOverrideButton(app, html) {
  if (!game.user?.isGM) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  // Guard against duplicate injection (class, not id — a popped-out tracker is
  // a second DOM tree and duplicate ids would be invalid).
  const existing = root.querySelector(`.${BUTTON_CLASS}`);
  if (existing) {
    updateButtonState(existing);
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add(BUTTON_CLASS);
  button.addEventListener("click", onToggleClick);

  updateButtonState(button);

  // Prefer the tracker's control row; fall back to prepending to the root.
  const header =
    root.querySelector(".combat-controls") ||
    root.querySelector(".combat-tracker-header") ||
    root.querySelector("nav.combat-controls") ||
    root.querySelector("header");

  if (header) header.prepend(button);
  else root.prepend(button);
}

/** Re-style every rendered toggle button (called on status changes). */
export function updateAllButtons() {
  for (const button of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
    updateButtonState(button);
  }
}

/**
 * Reflect both the manual-override setting AND the live OBS connection health:
 *  - override OFF        -> grey "Off" (user's choice, not an error)
 *  - ON + connected      -> green "On"
 *  - ON + connecting     -> amber "Connecting…"
 *  - ON + auth/error/etc -> flashing red with the failure reason as tooltip
 */
function updateButtonState(button) {
  const enabled = getSetting(SETTINGS.syncEnabled);
  const status = obs.status;

  button.classList.remove("active", "inactive", "connecting", "error");

  let cls;
  let icon;
  let label;
  let tooltip = game.i18n.localize(`${MODULE_ID}.button.tooltip`);

  if (!enabled) {
    cls = "inactive";
    icon = "fa-video-slash";
    label = game.i18n.localize(`${MODULE_ID}.button.off`);
  } else if (status === OBSStatus.Connected) {
    cls = "active";
    icon = "fa-video";
    label = game.i18n.localize(`${MODULE_ID}.button.on`);
  } else if (status === OBSStatus.Connecting) {
    cls = "connecting";
    icon = "fa-plug";
    label = game.i18n.localize(`${MODULE_ID}.button.connecting`);
  } else {
    // auth-failed, error, or disconnected while sync is on -> problem.
    cls = "error";
    icon = "fa-triangle-exclamation";
    label = game.i18n.localize(
      status === OBSStatus.AuthFailed
        ? `${MODULE_ID}.button.authFailed`
        : `${MODULE_ID}.button.offline`
    );
    if (obs.statusDetail) {
      tooltip = game.i18n.format(`${MODULE_ID}.button.problemTooltip`, {
        reason: obs.statusDetail
      });
    }
  }

  button.classList.add(cls);
  button.innerHTML = `<i class="fas ${icon}"></i> ${label}`;
  button.title = tooltip;
}

async function onToggleClick(event) {
  event.preventDefault();
  const next = !getSetting(SETTINGS.syncEnabled);
  await setSetting(SETTINGS.syncEnabled, next);
  updateAllButtons();

  // Turning sync back on should re-evaluate immediately.
  if (next) {
    resetSceneCache();
    syncScene();
  }
}
