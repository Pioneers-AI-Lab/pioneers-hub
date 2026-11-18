// Qui voit les scores et chaque sous-score (Admin > Batch settings, 18/11) : `scoresVisibility` decide
// du bloc (premier interrupteur), `subScoreVisibility` de chaque sous-score dedans (absent : comme
// les scores). Logique pure : functions/lib/shared/access.js.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { check } from "../lib/check.mjs";

const require = createRequire(import.meta.url);
const { canSeeSubScore, canonicalSubScores, fullSubScores, withSubScoreAudience } = require("../../functions/lib/shared/access.js");

const settings = {
  scoresVisibility: "founders",
  subScoreVisibility: { founder: { commitment: "staff", background: "none" }, startup: { market: "staff" } },
};

check("un sous-score sans reglage suit les scores", () => {
  assert.equal(canSeeSubScore("founder", settings, "founder", "edge"), true);
  assert.equal(canSeeSubScore("founder", {}, "founder", "edge"), false); // scores absents : staff
  assert.equal(canSeeSubScore("staff", {}, "founder", "edge"), true);
});

check("un sous-score reserve au staff : le staff et les investors le voient, pas les fondateurs", () => {
  assert.equal(canSeeSubScore("founder", settings, "founder", "commitment"), false);
  assert.equal(canSeeSubScore("staff", settings, "founder", "commitment"), true);
  assert.equal(canSeeSubScore("investor_portfolio", settings, "startup", "market"), true);
  assert.equal(canSeeSubScore("founder", settings, "startup", "market"), false);
});

check("none : personne, staff compris", () => {
  assert.equal(canSeeSubScore("staff", settings, "founder", "background"), false);
});

check("jamais plus large que le bloc des scores", () => {
  const narrow = { scoresVisibility: "staff", subScoreVisibility: { founder: { edge: "founders" } } };
  assert.equal(canSeeSubScore("founder", narrow, "founder", "edge"), false);
  assert.equal(canSeeSubScore("staff", narrow, "founder", "edge"), true);
});

check("un choix explicite reste, meme egal aux scores ; null revient au reglage des scores", () => {
  let v = withSubScoreAudience({}, "founder", "edge", "staff");
  assert.deepEqual(v, { founder: { edge: "staff" } });
  v = withSubScoreAudience(v, "founder", "edge", null);
  assert.deepEqual(v, {}); // sans liste vide : la page ne se croit pas modifiee
});

check("forme canonique : cles triees, sans liste vide", () => {
  assert.equal(
    JSON.stringify(canonicalSubScores({ startup: { team: "staff", market: "none" }, founder: {} })),
    JSON.stringify({ startup: { market: "none", team: "staff" } }),
  );
});

check("ecrit en entier : chaque sous-score, null pour suivre les scores (une ecriture en merge retire bien un reglage)", () => {
  const full = fullSubScores({ founder: { edge: "staff" } });
  assert.equal(full.founder.edge, "staff");
  assert.equal(full.founder.commitment, null);
  assert.deepEqual(Object.keys(full.startup).sort(), ["execution", "market", "team", "traction"]);
  assert.equal(canSeeSubScore("founder", { scoresVisibility: "founders", subScoreVisibility: full }, "founder", "commitment"), true); // null : suit les scores
  assert.deepEqual(canonicalSubScores(full), { founder: { edge: "staff" } });
});
