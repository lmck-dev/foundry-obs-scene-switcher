/**
 * The manifest, checked against the rules Foundry and its package registry
 * actually apply.
 *
 * Nothing else can catch a mistake here. Foundry validates the manifest when it
 * loads the module and the registry validates it on submission, and in both
 * cases a bad field means "your package does not appear" rather than an error
 * anyone sees. The rules below were read out of `common/packages/base-package.mjs`
 * in a real 14.365 install, not from the documentation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import { MODULE_ID } from "../scripts/constants.js";

const RAW = readFileSync(new URL("../module.json", import.meta.url), "utf8");
const MANIFEST = JSON.parse(RAW);

/** Paths the release workflow puts in the zip, from its explicit allowlist. */
const SHIPPED = ["module.json", "scripts", "applications", "templates", "styles", "lang", "overlay"];

/* -------------------------------------------- */
/*  Required fields                             */
/* -------------------------------------------- */

test("the manifest is valid JSON and has every required field", () => {
  // id, title, description and version are `required: true` in the schema.
  for (const field of ["id", "title", "description", "version"]) {
    assert.ok(MANIFEST[field], `missing required field: ${field}`);
    assert.notEqual(String(MANIFEST[field]).trim(), "", `${field} must not be blank`);
  }
});

test("the id matches the module id the code uses", () => {
  // The manifest id must also match the directory name Foundry installs into,
  // which is what MODULE_ID is used for in every settings call.
  assert.equal(MANIFEST.id, MODULE_ID);
});

test("the id passes Foundry's own validateId rules", () => {
  // /^[A-Za-z0-9-_]+$/, and not an OS-prohibited name.
  assert.match(MANIFEST.id, /^[A-Za-z0-9-_]+$/);
  assert.doesNotMatch(MANIFEST.id, /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i);
});

test("the version contains no character Foundry rejects", () => {
  // validateVersion throws on ' " < > &
  assert.doesNotMatch(String(MANIFEST.version), /['"<>&]/);
});

/* -------------------------------------------- */
/*  Compatibility                               */
/* -------------------------------------------- */

test("compatibility uses the modern object form", () => {
  // The flat minimumCoreVersion/compatibleCoreVersion fields were replaced in
  // v10; a manifest still using them is treated as having no compatibility.
  assert.equal(typeof MANIFEST.compatibility, "object");
  assert.ok(MANIFEST.compatibility.minimum, "no minimum core version");
  assert.ok(MANIFEST.compatibility.verified, "no verified core version");
  assert.equal("minimumCoreVersion" in MANIFEST, false, "uses a pre-v10 field");
  assert.equal("compatibleCoreVersion" in MANIFEST, false, "uses a pre-v10 field");
});

test("the verified version is not older than the minimum", () => {
  const parts = (v) => String(v).split(".").map(Number);
  const [min] = parts(MANIFEST.compatibility.minimum);
  const [verified] = parts(MANIFEST.compatibility.verified);

  assert.ok(verified >= min, "verified is older than minimum, which reads as untested");
});

/* -------------------------------------------- */
/*  Distribution                                */
/* -------------------------------------------- */

test("the manifest URL tracks latest and the download is pinned", () => {
  // The release workflow rewrites both. If manifest stopped tracking `latest`,
  // installed copies would never see an update; if download tracked `latest`,
  // installing an old version would silently fetch the newest zip.
  assert.match(MANIFEST.manifest, /\/releases\/latest\/download\/module\.json$/);
  assert.match(MANIFEST.download, /\/releases\/.*\/module\.zip$/);
});

test("every URL is absolute and https", () => {
  const urls = [
    MANIFEST.url,
    MANIFEST.manifest,
    MANIFEST.download,
    MANIFEST.readme,
    MANIFEST.bugs,
    MANIFEST.changelog,
    ...(MANIFEST.media ?? []).map((entry) => entry.url)
  ].filter(Boolean);

  for (const url of urls) {
    assert.match(url, /^https:\/\//, `${url} is not an absolute https URL`);
  }
});

/* -------------------------------------------- */
/*  Content the manifest points at              */
/* -------------------------------------------- */

test("every entry point the manifest declares actually exists", () => {
  const paths = [
    ...(MANIFEST.esmodules ?? []),
    ...(MANIFEST.scripts ?? []),
    ...(MANIFEST.styles ?? []).map((s) => (typeof s === "string" ? s : s.src)),
    ...(MANIFEST.languages ?? []).map((l) => l.path)
  ];

  assert.ok(paths.length > 0, "the manifest declares no content at all");
  for (const path of paths) {
    assert.ok(
      existsSync(new URL(`../${path}`, import.meta.url)),
      `manifest points at ${path}, which does not exist`
    );
  }
});

test("every declared entry point is inside a directory the release ships", () => {
  // The workflow zips an explicit allowlist, so a file in a new top-level
  // folder works perfectly in development and reaches nobody.
  const paths = [
    ...(MANIFEST.esmodules ?? []),
    ...(MANIFEST.styles ?? []).map((s) => (typeof s === "string" ? s : s.src)),
    ...(MANIFEST.languages ?? []).map((l) => l.path)
  ];

  for (const path of paths) {
    const top = path.split("/")[0];
    assert.ok(SHIPPED.includes(top), `${path} is not under a directory the release zip includes`);
  }
});

/* -------------------------------------------- */
/*  Registry listing                            */
/* -------------------------------------------- */

test("the media entries point at files committed to the repo", () => {
  // They are served from raw.githubusercontent at the branch, so a missing file
  // is a broken image on the package's listing page rather than a build error.
  for (const entry of MANIFEST.media ?? []) {
    const name = entry.url.split("/").pop();
    assert.ok(
      existsSync(new URL(`../media/${name}`, import.meta.url)),
      `media entry points at ${name}, which is not in media/`
    );
  }
});

test("there is exactly one cover image", () => {
  const covers = (MANIFEST.media ?? []).filter((entry) => entry.type === "cover");
  assert.equal(covers.length, 1, "the listing shows one cover; more than one is ambiguous");
});

test("the licence field and the LICENSE file agree", () => {
  const licence = readFileSync(new URL("../LICENSE", import.meta.url), "utf8");

  assert.ok(MANIFEST.license, "no licence declared");
  if (/^GPL-3/.test(MANIFEST.license)) {
    assert.match(licence, /GNU GENERAL PUBLIC LICENSE/, "LICENSE is not the GPL");
    assert.match(licence, /Version 3, 29 June 2007/, "LICENSE is not version 3");
  } else if (/^MIT/.test(MANIFEST.license)) {
    assert.match(licence, /MIT License/, "LICENSE is not MIT");
  }
});
