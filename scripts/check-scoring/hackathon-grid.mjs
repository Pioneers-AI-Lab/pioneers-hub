// La grille d'un hackathon (decision du 17/11, docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §2) :
// criteres notes de 0 a 5, points sur 100, note absolue, Outstanding +20 seulement a 100,
// retard = 0, departage. Logique pure : functions/lib/shared/scoringRules.js.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { check } from "../lib/check.mjs";

const require = createRequire(import.meta.url);
const { scoreTeams, compareTeamPoints, scoringMaxTotal, scoringFrom } = require("../../functions/lib/shared/scoringRules.js");


const crit = (key, points) => ({ key, label: key, min: 0, max: 5, weight: points ?? 1 });
const item = (key, points, tieBreakOnly = false) => ({ label: key, mode: "criterion", sourceKey: key, ...(points ? { maxPoints: points } : {}), ...(tieBreakOnly ? { tieBreakOnly } : {}) });
const team = (id, juryMeans, extra = {}) => ({ id, metrics: {}, juryMeans, late: false, zeroedItemKeys: [], outstanding: false, ...extra });

// H1 : 35 / 25 / 20 / 20.
const h1Criteria = [crit("potentialCustomers", 35), crit("evidence", 25), crit("painSentence", 20), crit("agentUse", 20)];
const h1 = scoringFrom([item("potentialCustomers", 35), item("evidence", 25), item("painSentence", 20), item("agentUse", 20)]);
const all5 = { potentialCustomers: 5, evidence: 5, painSentence: 5, agentUse: 5 };

check("H1 : la grille fait 100", () => assert.equal(scoringMaxTotal(h1, h1Criteria), 100));

check("une note se lit note / 5 x points, sans ramener a la meilleure equipe", () => {
  const [a, b] = scoreTeams(h1, h1Criteria, [
    team("a", { potentialCustomers: 5, evidence: 4, painSentence: 3, agentUse: 5 }),
    team("b", { potentialCustomers: 2, evidence: 2, painSentence: 2, agentUse: 2 }),
  ]);
  assert.equal(a.total, 87); // 35 + 20 + 12 + 20
  assert.equal(a.normalized, 87);
  assert.equal(b.normalized, 40); // absolue : la meilleure equipe n'a pas 100
});

check("la moyenne des jures (calculee avant) peut etre decimale", () => {
  const [a] = scoreTeams(h1, h1Criteria, [team("a", { potentialCustomers: 4.5, evidence: 5, painSentence: 5, agentUse: 5 })]);
  assert.equal(a.normalized, 96.5);
});

check("Outstanding : +20 a une equipe a 100", () => {
  const [a] = scoreTeams(h1, h1Criteria, [team("a", all5, { outstanding: true })]);
  assert.equal(a.total, 120);
  assert.equal(a.normalized, 120);
  assert.equal(a.outstanding, true);
});

check("Outstanding : sans effet sous 100", () => {
  const [a] = scoreTeams(h1, h1Criteria, [team("a", { ...all5, agentUse: 4 }, { outstanding: true })]);
  assert.equal(a.normalized, 96);
  assert.equal(a.outstanding, false);
});

check("Outstanding : proposee seulement a une equipe au maximum, mention donnee ou non", () => {
  const [full, given, below] = scoreTeams(h1, h1Criteria, [team("a", all5), team("b", all5, { outstanding: true }), team("c", { ...all5, evidence: 4 })]);
  assert.equal(full.outstandingEligible, true);
  assert.equal(given.outstandingEligible, true);
  assert.equal(below.outstandingEligible, false);
});

check("une Submission en retard vaut 0", () => {
  const [a] = scoreTeams(h1, h1Criteria, [team("a", all5, { late: true, outstanding: true })]);
  assert.equal(a.normalized, 0);
  assert.equal(a.outstanding, false);
  assert.equal(a.outstandingEligible, false);
});

check("un critere sans note rapporte 0 (pas de jure)", () => {
  const [a] = scoreTeams(h1, h1Criteria, [team("a", { potentialCustomers: 5 })]);
  assert.equal(a.normalized, 35);
});

// H3 : un seul critere a 100 points, la qualite des leads ne fait que departager.
const h3Criteria = [crit("leadsCollected", 100), crit("leadQuality", 1)];
const h3 = scoringFrom([item("leadsCollected", 100), item("leadQuality", null, true)]);

check("H3 : un critere departage sans compter", () => {
  assert.equal(scoringMaxTotal(h3, h3Criteria), 100);
  const [a, b] = scoreTeams(h3, h3Criteria, [team("a", { leadsCollected: 4, leadQuality: 2 }), team("b", { leadsCollected: 4, leadQuality: 5 })]);
  assert.equal(a.normalized, 80);
  assert.equal(b.normalized, 80);
  assert.ok(compareTeamPoints(h3, a, b) > 0, "b passe devant a au departage");
});

// Ancien bareme sans maximum (points par unite) : la meilleure equipe = 100, jamais de mention.
const legacy = scoringFrom([{ label: "Meetings", mode: "per_unit", sourceKey: "meetingsBooked", pointsPerUnit: 40 }]);
check("ancien bareme par unite : ramene a la meilleure equipe", () => {
  assert.equal(scoringMaxTotal(legacy, []), null);
  const [a, b] = scoreTeams(legacy, [], [
    { ...team("a", {}), metrics: { meetingsBooked: 2 }, outstanding: true },
    { ...team("b", {}), metrics: { meetingsBooked: 1 } },
  ]);
  assert.equal(a.normalized, 100);
  assert.equal(b.normalized, 50);
  assert.equal(a.outstanding, false);
  assert.equal(a.outstandingEligible, false); // pas de bouton : le serveur ignorerait la mention
});
