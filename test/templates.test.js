/**
 * Static checks on the Handlebars templates and the strings they reach for.
 *
 * Neither is exercised anywhere else: the templates only ever render inside
 * Foundry, and a mistake there fails at render time in a way that is easy to
 * miss — an unregistered helper makes the whole application reject, so the
 * settings window simply never opens, with the error buried in the console.
 * That is exactly what `{{selected}}` did (Foundry registers `checked` and
 * `disabled`, but no `selected`), so these run in CI instead.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { MODULE_ID, NPC_POLICY, OVERLAY_FIELDS } from "../scripts/constants.js";

const TEMPLATE_DIR = new URL("../templates/", import.meta.url);

const TRANSLATIONS = JSON.parse(
  readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")
);

/**
 * Helpers Foundry registers, from `client/applications/handlebars.mjs`
 * (verified against Foundry 14.365). Note the absentee: there is no `selected`.
 */
const FOUNDRY_HELPERS = new Set([
  "checked", "disabled", "concat", "editor", "formInput", "formGroup",
  "formField", "filePicker", "ifThen", "localize", "numberFormat",
  "numberInput", "object", "radioBoxes", "rangePicker", "selectOptions",
  "timeSince", "eq", "ne", "lt", "gt", "lte", "gte", "not", "and", "or"
]);

/** Handlebars' own block helpers. */
const BUILTIN_HELPERS = new Set(["if", "unless", "each", "with", "log", "lookup", "else"]);

const templates = readdirSync(TEMPLATE_DIR)
  .filter((name) => name.endsWith(".hbs"))
  .map((name) => ({ name, source: readFileSync(new URL(name, TEMPLATE_DIR), "utf8") }));

/**
 * Every helper invocation in a template.
 *
 * A mustache is a helper call only when the first token is followed by
 * arguments — `{{browserSourceUrl}}` is a context lookup, `{{localize "x"}}`
 * is a call.
 */
function helperCalls(source) {
  const found = new Set();
  for (const [, body] of source.matchAll(/\{\{\{?([^{}]+)\}?\}\}/g)) {
    const expression = body.trim();
    if (/^[!>/]/.test(expression)) continue; // comment, partial, closing tag

    const tokens = expression.replace(/^[#^]/, "").trim().split(/\s+/);
    if (tokens.length < 2) continue; // no arguments: a lookup, not a call

    found.add(tokens[0]);
  }
  return found;
}

/** Literal keys passed to {{localize "..."}} — dynamic ones cannot be checked. */
function localizedKeys(source) {
  const found = new Set();
  for (const [, key] of source.matchAll(/\{\{\s*localize\s+["']([^"']+)["']/g)) {
    found.add(key);
  }
  for (const [, key] of source.matchAll(/localize\s+["']([^"']+)["']\s*\}\}/g)) {
    found.add(key);
  }
  return found;
}

test("the templates exist and are being checked", () => {
  assert.ok(templates.length >= 2, "expected to find the .hbs templates");
});

for (const { name, source } of templates) {
  test(`${name} only calls helpers that Foundry registers`, () => {
    for (const helper of helperCalls(source)) {
      assert.ok(
        FOUNDRY_HELPERS.has(helper) || BUILTIN_HELPERS.has(helper),
        `${name} calls {{${helper}}}, which Foundry does not register — the ` +
          `application will fail to render and the window will not open`
      );
    }
  });

  test(`${name} only localizes keys that exist`, () => {
    for (const key of localizedKeys(source)) {
      assert.ok(
        key in TRANSLATIONS,
        `${name} localizes "${key}", which is missing from lang/en.json`
      );
    }
  });
}

test("every NPC policy has a label", () => {
  // These keys are built by string interpolation in overlay-config.js, so a
  // renamed policy would otherwise render a raw key in the dropdown.
  for (const value of Object.values(NPC_POLICY)) {
    const key = `${MODULE_ID}.overlay.npcs.${value}`;
    assert.ok(key in TRANSLATIONS, `missing translation: ${key}`);
  }
});

test("every overlay field has a label", () => {
  for (const field of Object.keys(OVERLAY_FIELDS)) {
    const key = `${MODULE_ID}.overlay.field.${field}`;
    assert.ok(key in TRANSLATIONS, `missing translation: ${key}`);
  }
});

test("no translation key is defined twice", () => {
  // JSON silently keeps the last duplicate, so a stale copy can quietly win.
  const raw = readFileSync(new URL("../lang/en.json", import.meta.url), "utf8");
  const keys = [...raw.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]);
  const seen = new Set();
  const duplicates = keys.filter((key) => (seen.has(key) ? true : (seen.add(key), false)));

  assert.deepEqual(duplicates, []);
});
