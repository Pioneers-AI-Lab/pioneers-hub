// batchStats (accueil, card « Profile distribution ») : fondateurs par competence, secteur et role
// (19/11 : Industries | Skills | Roles). Une valeur vide ne compte pas.
// Logique pure : functions/lib/shared/batchStats.js.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { check } from "../lib/check.mjs";

const require = createRequire(import.meta.url);
const { computeBatchStats } = require("../../functions/lib/shared/batchStats.js");

const founder = (hardSkills, industries, rolesICouldTake) => ({
  founder: { profileCategory: "technical", hardSkills, industries, rolesICouldTake, startupId: null },
  directory: null,
});

check("competences, secteurs et roles comptes par valeur", () => {
  const s = computeBatchStats(
    "accelerator",
    [
      founder(["Machine Learning"], ["Finance & Insurance", "Real Estate"], ["Vision & Strategy"]),
      founder(["Machine Learning", "Sales & GTM"], ["Finance & Insurance"], ["Vision & Strategy", "Sales & Revenue"]),
    ],
    "2026-11-19T00:00:00.000Z",
  );
  assert.deepEqual(s.skillsDistribution, { "Machine Learning": 2, "Sales & GTM": 1 });
  assert.deepEqual(s.industriesDistribution, { "Finance & Insurance": 2, "Real Estate": 1 });
  assert.deepEqual(s.rolesDistribution, { "Vision & Strategy": 2, "Sales & Revenue": 1 });
});

check("profils sans tags : repartitions vides", () => {
  const s = computeBatchStats("accelerator", [founder([], [], [])], "2026-11-19T00:00:00.000Z");
  assert.deepEqual(s.industriesDistribution, {});
  assert.deepEqual(s.rolesDistribution, {});
});
