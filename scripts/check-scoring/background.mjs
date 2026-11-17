// La grille Background (lot 2, docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §2.13) : quatre criteres
// de 0 a 5 et leurs points (40 / 25 / 20 / 15), Outstanding +20 seulement a 100, une note du
// staff seule comptee. Logique pure : functions/lib/shared/background.js.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { check } from "../lib/check.mjs";

const require = createRequire(import.meta.url);
const {
  BACKGROUND_CRITERIA,
  backgroundBase,
  backgroundScore,
  canBeOutstanding,
  backgroundProblems,
  ratedBackgroundScore,
  isBackgroundRated,
  backgroundRatingWrite,
  backgroundProposalWrite,
} = require("../../functions/lib/shared/background.js");
const { OUTSTANDING_BONUS_POINTS } = require("../../functions/lib/shared/scoringRules.js");

const all5 = { execution: 5, founderSignal: 5, pedigree: 5, geography: 5 };

check("la grille fait 100 points : 40 / 25 / 20 / 15", () => {
  assert.deepEqual(BACKGROUND_CRITERIA.map((c) => [c.key, c.points]), [["execution", 40], ["founderSignal", 25], ["pedigree", 20], ["geography", 15]]);
  assert.equal(backgroundScore(all5, false), 100);
});

check("un critere rapporte note / 5 x ses points", () => {
  // 4/5 x 40 + 3/5 x 25 + 5/5 x 20 + 0/5 x 15 = 32 + 15 + 20 + 0
  assert.equal(backgroundScore({ execution: 4, founderSignal: 3, pedigree: 5, geography: 0 }, false), 67);
  assert.equal(backgroundScore({ execution: 0, founderSignal: 0, pedigree: 0, geography: 0 }, false), 0);
});

check("Outstanding : +20 a 100, la note monte a 120", () => {
  assert.equal(backgroundScore(all5, true), 120);
  assert.equal(canBeOutstanding(all5), true);
});

check("Outstanding : sans effet sous 100", () => {
  const below = { ...all5, geography: 4 };
  assert.equal(backgroundScore(below, true), 97);
  assert.equal(canBeOutstanding(below), false);
});

check("sans note, pas de poids : un critere absent est retire, aucun critere = null", () => {
  // Execution 5/5 et Pedigree 0/5 : 40 / (40 + 20) points.
  assert.equal(backgroundBase({ execution: 5, pedigree: 0, founderSignal: null }), 66.67);
  assert.equal(backgroundScore({}, true), null);
  assert.equal(ratedBackgroundScore(null), null);
});

check("une note hors 0-5 est ramenee dans la grille", () => {
  assert.equal(backgroundScore({ ...all5, execution: 9 }, false), 100);
  assert.equal(backgroundScore({ ...all5, execution: -3 }, false), 60);
});

check("enregistrer : quatre entiers de 0 a 5, Outstanding seulement a 100", () => {
  assert.deepEqual(backgroundProblems(all5, true), []);
  assert.deepEqual(backgroundProblems({ ...all5, pedigree: 4 }, false), []);
  assert.deepEqual(backgroundProblems({ ...all5, pedigree: 4 }, true), ["The Outstanding mention is only given at 100."]);
  assert.equal(backgroundProblems({ execution: 5, founderSignal: 5, pedigree: 5 }, false).length, 1);
  assert.equal(backgroundProblems({ ...all5, execution: 4.5 }, false).length, 1);
  assert.equal(backgroundProblems({ ...all5, execution: 6 }, false).length, 1);
});

check("seule la note du staff compte, pas la proposition de Claude", () => {
  const proposed = { scores: all5, outstanding: true, ratedDateISOString: "2026-11-18T10:00:00.000Z", reasoning: null };
  assert.equal(ratedBackgroundScore({ proposed }), null);
  assert.equal(ratedBackgroundScore({ scores: {}, outstanding: false, proposed }), null);
  assert.equal(isBackgroundRated({ proposed }), false);
  assert.equal(ratedBackgroundScore({ scores: { ...all5, geography: 3 }, outstanding: false, proposed }), 94);
  assert.equal(isBackgroundRated({ scores: all5 }), true);
});

check("l'ecriture du staff ne touche pas la proposition ; elle refuse un Outstanding sous 100", () => {
  const w = backgroundRatingWrite("f1", { scores: all5, outstanding: true }, "staff-1", "2026-11-18T10:00:00.000Z");
  assert.equal(w.op, "merge");
  assert.equal(w.path, "founders/f1/private/internal");
  assert.deepEqual(Object.keys(w.data.background).sort(), ["outstanding", "ratedByUid", "ratedDateISOString", "scores"]);
  assert.throws(() => backgroundRatingWrite("f1", { scores: { ...all5, geography: 4 }, outstanding: true }, "staff-1", "2026-11-18T10:00:00.000Z"), (e) => e.code === "invalid_background");
});

check("la proposition du script n'ecrit jamais `background.scores`", () => {
  const proposal = { scores: all5, outstanding: false, reasoning: "Built and sold a company." };
  const w = backgroundProposalWrite("f1", proposal, "2026-11-18T10:00:00.000Z");
  assert.equal(w.op, "merge");
  assert.deepEqual(Object.keys(w.data.background), ["proposed"]);
  assert.deepEqual(w.data.background.proposed, { ...proposal, ratedDateISOString: "2026-11-18T10:00:00.000Z" });
});

check("l'Outstanding de la grille suit la regle du bareme : +20 % du maximum", () => {
  assert.equal(backgroundScore(all5, true) - backgroundScore(all5, false), OUTSTANDING_BONUS_POINTS);
});
