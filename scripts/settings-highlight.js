import { MODULE_ID } from "./constants.js";
import { obs, OBSStatus } from "./obs-client.js";

const PASSWORD_INPUT = `input[name="${MODULE_ID}.${"obsPassword"}"]`;
const WARNING_CLASS = "obs-auth-warning";

/**
 * When OBS authentication has failed, draw attention to the password field in
 * the Settings window: outline it red and insert an inline warning note.
 * Removes the highlight again once auth is no longer failing.
 *
 * Works whether called from the renderSettingsConfig hook or live on a status
 * change, by querying the live DOM rather than tracking the app instance.
 */
export function refreshSettingsHighlight(root = document) {
  const input = root.querySelector(PASSWORD_INPUT);
  if (!input) return; // settings window not open, or field not rendered

  const group = input.closest(".form-group") ?? input.parentElement;
  const authFailed = obs.status === OBSStatus.AuthFailed;

  input.classList.toggle("obs-auth-error", authFailed);

  const existing = group?.querySelector(`.${WARNING_CLASS}`);
  if (authFailed) {
    if (!existing && group) {
      const note = document.createElement("p");
      note.className = `notification error ${WARNING_CLASS}`;
      note.textContent = game.i18n.format(`${MODULE_ID}.settings.password.authWarning`, {
        reason: obs.statusDetail || game.i18n.localize(`${MODULE_ID}.settings.password.authWarningGeneric`)
      });
      group.appendChild(note);
    }
  } else if (existing) {
    existing.remove();
  }
}
