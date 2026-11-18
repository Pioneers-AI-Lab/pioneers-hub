// Ce que lit un jure (18/11, docs/FONCTIONNALITES.md §4.3) : la place d'une cible sur un chiffre
// declare (plus = mieux, ex aequo a la meme place, 1, 2, 2, 4), sur `of` cibles qui l'ont declare,
// et la meilleure valeur. Logique pure : functions/lib/shared/juryBrief.js.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { check } from "../lib/check.mjs";

const require = createRequire(import.meta.url);
const { briefMetricRanks, isBlankAnswer, metricRanks, ordinal, rankLabel } = require("../../functions/lib/shared/juryBrief.js");

check("place : du plus grand au plus petit, ex aequo a la meme place (1, 2, 2, 4)", () => {
  const r = metricRanks(new Map([["a", 66], ["b", 80], ["c", 66], ["d", 10]]));
  assert.deepEqual(["b", "a", "c", "d"].map((id) => r.get(id).rank), [1, 2, 2, 4]);
  assert.deepEqual(r.get("a"), { value: 66, rank: 2, of: 4, best: 80, tied: true });
  assert.equal(r.get("b").tied, false);
});

check("seules les cibles qui ont declare le chiffre sont classees (un 0 declare compte)", () => {
  const brief = { submissions: { a: { metrics: { leads: 0 } }, b: { metrics: { leads: 12 } }, c: { metrics: {} } } };
  const r = briefMetricRanks(brief, ["a", "b", "c", "d"], "leads");
  assert.deepEqual([...r.keys()].sort(), ["a", "b"]);
  assert.deepEqual(r.get("a"), { value: 0, rank: 2, of: 2, best: 12, tied: false });
});

check("libelles : 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st ; « 2nd of 8 (tied) »", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  assert.equal(rankLabel({ value: 5, rank: 2, of: 8, best: 9, tied: true }), "2nd of 8 (tied)");
  assert.equal(rankLabel({ value: 9, rank: 1, of: 8, best: 9, tied: false }), "1st of 8");
  assert.equal(isBlankAnswer({ label: "x", text: null, urls: [] }), true);
  assert.equal(isBlankAnswer({ label: "x", text: "0", urls: [] }), false);
});

// Les blocs et le lien critere -> chiffre (shared/forms.ts) : ordre d'ouverture, formulaires archives
// exclus, dossier Drive a part, seulement les documents de la cible, un critere de jury seulement.
const { asksDriveFolder, juryBlockForms, juryCriterionMetrics } = require("../../functions/lib/shared/forms.js");
const q = (id, dbField, extra = {}) => ({ id, type: "short_text", label: id, dbField, ...extra });
const form = (title, opens, questions, archived = null) => ({ title, opensDateISOString: opens, archivedDateISOString: archived, questions });

check("blocs : un par formulaire vivant, dans l'ordre d'ouverture, sans le Drive ; une startup lit aussi sa fiche", () => {
  const forms = [
    form("Final numbers", "2026-11-27T16:00:00Z", [q("amount", "submission.metrics.amountPaid"), q("drive", "submission.driveFolderUrl")]),
    form("Plan", "2026-11-25T08:30:00Z", [q("notes", "submission.notes")]),
    form("Old debrief", "2026-11-25T08:00:00Z", [q("x", "submission.notes")], "2026-11-17T00:00:00Z"),
    form("Peer rating", "2026-11-25T08:00:00Z", [q("p", "peerRating.likability")]),
    form("Pitch deck", "2026-12-02T13:00:00Z", [q("deck", "startupProfile.pitchDeckUrl")]),
  ];
  assert.deepEqual(juryBlockForms(forms, "team").map((b) => [b.title, b.questions.map((x) => x.id)]), [["Plan", ["notes"]], ["Final numbers", ["amount"]]]);
  assert.deepEqual(juryBlockForms(forms, "startup").map((b) => b.title), ["Plan", "Final numbers", "Pitch deck"]);
  assert.equal(asksDriveFolder(forms), true);
  assert.equal(asksDriveFolder([forms[1]]), false);
});

check("critere -> chiffre : meme cle, une question de note du jury seulement", () => {
  const jury = form("Jury", null, [
    q("criterion_potentialCustomers", "evaluation.scores.potentialCustomers", { type: "rating", scale: { min: 0, max: 5 }, weight: 35 }),
    q("criterion_evidence", "evaluation.scores.evidence", { type: "rating", scale: { min: 0, max: 5 }, weight: 30 }),
  ]);
  assert.deepEqual(juryCriterionMetrics([jury], new Set(["potentialCustomers", "evidencePosts"])), { criterion_potentialCustomers: "potentialCustomers" });
});
