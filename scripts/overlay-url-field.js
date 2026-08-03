/**
 * Where to point an OBS Browser Source, shown in the Settings window directly
 * under each panel's toggle — the moment you tick one on, that is the next
 * thing you need.
 *
 * They are **file paths, not URLs**. Foundry force-serves anything under the
 * user data directory that looks like HTML with `Content-Type: text/plain`
 * (`dist/server/express.mjs`), so that modules cannot host pages on Foundry's
 * own origin. A Browser Source pointed at the served page therefore displays
 * the markup as text instead of rendering it. OBS's own "Local file" option is
 * the supported route, and it is why the overlay scripts are classic scripts —
 * file:// blocks module imports.
 *
 * Each panel is a separate file rather than one page behind a `?panel=` switch
 * for the same reason: "Local file" hands the page no query string at all, so
 * anything relying on one would force every user onto a typed file:/// address.
 */
import { MODULE_ID, SETTINGS } from "./constants.js";

const GROUP_CLASS = "obs-overlay-url-group";

/**
 * The panels that ship a page, in the order their toggles appear in Settings.
 * `setting` is the toggle to hang the field under; `file` is the page itself.
 */
export const PANELS = [
  { key: "overlay", setting: SETTINGS.overlayEnabled, file: "overlay.html" },
  { key: "chat", setting: SETTINGS.chatEnabled, file: "chat.html" },
  { key: "combat", setting: SETTINGS.combatEnabled, file: "combat.html" }
];

/**
 * A page's location within the Foundry user data folder.
 *
 * Relative, because the client has no way to know the server's filesystem
 * root — Foundry does not expose it. The user data folder's location is shown
 * in Foundry's own Setup → Configuration screen, which the hint points at.
 */
export function panelFilePath(file) {
  return `Data/modules/${MODULE_ID}/overlay/${file}`;
}

/** The character card's page. Kept under its own name because it is the original. */
export function overlayFilePath() {
  return panelFilePath("overlay.html");
}

async function copyToClipboard(input) {
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    // Clipboard access can be refused (insecure origin, denied permission).
    // Selecting the text still leaves the user one keystroke from copying.
    input.select();
    return false;
  }
  return true;
}

/** Build one panel's field; afterwards it is only shown and hidden. */
function buildGroup(panel) {
  const group = document.createElement("div");
  group.className = `form-group ${GROUP_CLASS}`;
  group.dataset.panel = panel.key;

  const label = document.createElement("label");
  label.textContent = game.i18n.localize(`${MODULE_ID}.settings.${panel.setting}.url`);

  const fields = document.createElement("div");
  fields.className = "form-fields";

  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.className = "obs-overlay-url";
  input.value = panelFilePath(panel.file);
  input.addEventListener("focus", () => input.select());

  const button = document.createElement("button");
  // Not a submit button: inside the settings form, the default type would
  // save and close the window on click.
  button.type = "button";
  button.className = "obs-overlay-url-copy";
  button.innerHTML = `<i class="fas fa-copy"></i> ${game.i18n.localize(
    `${MODULE_ID}.settings.browserSource.copy`
  )}`;
  button.addEventListener("click", async () => {
    const copied = await copyToClipboard(input);
    if (copied) {
      ui.notifications?.info(
        game.i18n.localize(`${MODULE_ID}.settings.browserSource.copied`)
      );
    }
  });

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = game.i18n.localize(`${MODULE_ID}.settings.${panel.setting}.urlHint`);

  fields.append(input, button);
  group.append(label, fields, hint);
  return group;
}

/** Insert (or refresh) one panel's field beneath its own toggle. */
function refreshPanel(root, panel) {
  const toggle = root.querySelector(`input[name="${MODULE_ID}.${panel.setting}"]`);
  if (!toggle) return; // settings window not open, or not a GM

  const anchor = toggle.closest(".form-group") ?? toggle.parentElement;
  if (!anchor) return;

  // Scoped to this panel: all three fields share a parent, so an unscoped
  // lookup would find whichever was built first and never build the others.
  let group = anchor.parentElement?.querySelector(
    `.${GROUP_CLASS}[data-panel="${panel.key}"]`
  );
  if (!group) {
    group = buildGroup(panel);
    anchor.after(group);
    // Re-render on toggle rather than tracking state elsewhere.
    toggle.addEventListener("change", () => refreshPanel(root, panel));
  }

  group.hidden = !toggle.checked;
}

/**
 * Insert (or refresh) every panel's path field.
 *
 * Visibility follows each checkbox live rather than the saved setting, so a
 * field appears the moment its box is ticked — not after the window is saved
 * and reopened.
 */
export function refreshOverlayUrlField(root = document) {
  for (const panel of PANELS) refreshPanel(root, panel);
}
