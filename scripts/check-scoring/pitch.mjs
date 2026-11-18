// La grille Pitch (lot 5, docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §2.11 et §3.1, SPECS §4.9) : neuf
// criteres de 0 a 5 et leurs points (25 / 15 | 20 / 20 | 6 / 5 / 4 / 3 / 2), trois familles (Team 40,
// Speed of execution 40, Market 20) sur 100, Outstanding +20 seulement a 100, anciennes cles de Spring
// 2026 sur 5, moyenne des jures puis des pitchs, score startup et Clear idea du Commitment ; le pack
// d'un pitch (Pitch deck 48 h avant, echeance la veille ; jury et questions d'apres la grille par etape).
// Logique pure : functions/lib/shared (pitchGrid, scoring, eventForms, events, presets).
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { check } from "../lib/check.mjs";

const require = createRequire(import.meta.url);
const {
  PITCH_CRITERIA,
  PITCH_RUBRIC,
  PITCH_SCORING,
  isPitchGrid,
  pitchJuryMeans,
  legacyPitchScores,
  pitchGrid,
  pitchMeans,
  pitchVerdicts,
} = require("../../functions/lib/shared/pitchGrid.js");
const { computeFounderScore, computeStartupScore } = require("../../functions/lib/shared/scoring.js");
const { startupScore } = require("../../functions/lib/shared/types/score.js");
const { scoreTeams, scoringMaxTotal } = require("../../functions/lib/shared/scoringRules.js");
const { eventFormsPlan } = require("../../functions/lib/shared/eventForms.js");
const { newEvent } = require("../../functions/lib/shared/events.js");
const { EVENT_TEMPLATES, criterionLabel } = require("../../functions/lib/shared/presets/eventTemplates.js");
const { isStartupForm, formNeedsStartup } = require("../../functions/lib/shared/formRules.js");

const near = (actual, expected) => assert.ok(actual !== null && Math.abs(actual - expected) < 0.011, `${actual} != ${expected}`);
const all = (note) => Object.fromEntries(PITCH_CRITERIA.map((c) => [c.key, note]));

// ---- La grille ------------------------------------------------------------------------------

check("neuf criteres de 0 a 5 : 25 + 15 | 20 + 20 | 6 + 5 + 4 + 3 + 2 = 100", () => {
  assert.deepEqual(
    PITCH_CRITERIA.map((c) => [c.key, c.points]),
    [["teamStrength", 25], ["founderMarketFit", 15], ["progress", 20], ["traction", 20], ["clearIdea", 6], ["market", 5], ["competition", 4], ["highPotential", 3], ["businessModel", 2]],
  );
  assert.ok(PITCH_RUBRIC.every((c) => c.min === 0 && c.max === 5));
  assert.equal(scoringMaxTotal(PITCH_SCORING, PITCH_RUBRIC), 100);
});

check("familles sur 100 d'apres les points de leurs criteres ; note de la grille = somme des points", () => {
  // Team : 4/5 x 25 + 2/5 x 15 = 26 sur 40 -> 65 ; Speed : 5/5 x 20 + 3/5 x 20 = 32 sur 40 -> 80 ;
  // Market : (6 + 5 + 4 + 3 + 2) x 1/5 = 4 sur 20 -> 20. Grille : 26 + 32 + 4 = 62.
  const g = pitchGrid({ teamStrength: 4, founderMarketFit: 2, progress: 5, traction: 3, clearIdea: 1, market: 1, competition: 1, highPotential: 1, businessModel: 1 }, false);
  near(g.families.team, 65);
  near(g.families.speed, 80);
  near(g.families.market, 20);
  near(g.total, 62);
  near(g.clearIdea, 20);
  assert.equal(g.outstanding, false);
});

check("la grille du jury et le bareme du leaderboard donnent la meme note", () => {
  const means = { teamStrength: 4, founderMarketFit: 2, progress: 5, traction: 3, clearIdea: 1, market: 1, competition: 1, highPotential: 1, businessModel: 1 };
  const [row] = scoreTeams(PITCH_SCORING, PITCH_RUBRIC, [{ id: "s", metrics: {}, juryMeans: means, late: false, zeroedItemKeys: [], outstanding: false }]);
  near(row.normalized, pitchGrid(means, false).total);
});

check("Outstanding : +20 seulement a 100, sur la grille et sur chaque famille (120)", () => {
  const top = pitchGrid(all(5), true);
  assert.equal(top.outstanding, true);
  assert.equal(top.total, 120);
  assert.deepEqual(top.families, { team: 120, speed: 120, market: 120 });
  // Clear idea est un critere : la mention ne le touche pas.
  assert.equal(top.clearIdea, 100);
  const below = pitchGrid({ ...all(5), businessModel: 4 }, true);
  assert.equal(below.outstanding, false);
  near(below.total, 99.6);
  assert.equal(below.families.team, 100);
  assert.equal(pitchGrid(all(5), false).total, 100);
});

check("sans note, pas de poids : un critere non note sort de sa famille ; une famille sans note est absente", () => {
  const g = pitchGrid({ teamStrength: 5 }, false);
  assert.equal(g.families.team, 100);
  assert.equal(g.families.speed, null);
  assert.equal(g.families.market, null);
  assert.equal(g.clearIdea, null);
  assert.equal(pitchGrid({}, true).total, null);
});

check("moyenne des jures, critere par critere", () => {
  const means = pitchJuryMeans([{ scores: { teamStrength: 5, traction: 2 } }, { scores: { teamStrength: 3 } }, { scores: { teamQuality: 4 } }]);
  assert.deepEqual(means, { teamStrength: 4, traction: 2 });
});

check("anciennes cles de Spring 2026, sur 5 : chaque famille ramenee a 5 ; une famille sans note absente", () => {
  assert.deepEqual(legacyPitchScores({ teamStrength: 4, founderMarketFit: 2, progress: 5, traction: 3 }), { teamQuality: 3.25, speedOfExecution: 4 });
  assert.equal(isPitchGrid(["teamQuality", "speedOfExecution", "marketPotential"]), false);
  assert.equal(isPitchGrid(PITCH_CRITERIA.map((c) => c.key)), true);
  assert.equal(criterionLabel("teamQuality"), "Team quality");
});

check("questions d'apres la grille : moyennes, decisions comptees, « would invest » parmi les reponses", () => {
  const v = pitchVerdicts([
    { overallScore: 4, decision: "go", wouldInvest: true, betLikelihood: 3 },
    { overallScore: 3, decision: "maybe", wouldInvest: false, betLikelihood: null },
    { overallScore: null, decision: "go", wouldInvest: null, betLikelihood: 5 },
  ]);
  assert.deepEqual(v, { overall: 3.5, decisions: { go: 2, maybe: 1 }, wouldInvest: { yes: 1, answered: 2 }, betLikelihood: 4 });
});

// ---- Le score startup et le Commitment ---------------------------------------------------------

const pitch = (name, scores, mention = false) => ({ name, grid: pitchGrid(pitchJuryMeans(scores.map((s) => ({ scores: s }))), mention) });

check("familles d'une startup : moyenne de ses pitchs, chaque pitch = moyenne de ses jures", () => {
  // Pitch 1 : deux jures, Team (5, 3) -> 4 sur tous les criteres de Team -> 80. Pitch 2 : Team 5 -> 100.
  const p1 = pitch("Pitch Day #1", [{ teamStrength: 5, founderMarketFit: 5 }, { teamStrength: 3, founderMarketFit: 3 }]);
  const p2 = pitch("Selection Day", [{ ...all(5) }], true);
  const m = pitchMeans([p1, p2]);
  // (80 + 120) / 2 : la mention du Selection Day compte dans son pitch.
  assert.equal(m.team, 100);
  // Speed et Market : seulement le Selection Day (le pitch 1 n'y a pas de note).
  assert.equal(m.speed, 120);
  assert.equal(m.clearIdea, 100);
});

check("score startup : Team 50 % Background + 50 % pitch, Traction 50 % weekly + 50 % pitch, Market = pitch", () => {
  const p = pitch("Pitch Day #1", [{ teamStrength: 4, founderMarketFit: 4, progress: 3, traction: 3, clearIdea: 5, market: 5, competition: 5, highPotential: 5, businessModel: 5 }]);
  const c = computeStartupScore({ founderBackgrounds: [60], founderExecutions: [70], weeklyTraction: 40, pitches: [p] });
  // Team (60 + 80) / 2 = 70 ; Traction (40 + 60) / 2 = 50 ; Market 100 ; Execution 70.
  assert.deepEqual(c.subScores, { market: 100, team: 70, execution: 70, traction: 50 });
  assert.equal(c.signals.team[1].label, "Pitches (1): Team");
  assert.equal(c.signals.team[1].raw, "Pitch Day #1 80");
  // 70 x 0,4 + 70 x 0,2 + 50 x 0,2 + 100 x 0,2 = 72
  near(startupScore({ subScores: c.subScores, scale: 100 }), 72);
});

check("avant le premier pitch : Team = Background moyen, pas de Market", () => {
  const c = computeStartupScore({ founderBackgrounds: [60, 80], founderExecutions: [], weeklyTraction: null, pitches: [] });
  assert.deepEqual(c.subScores, { market: null, team: 70, execution: null, traction: null });
});

check("Commitment : Clear idea de sa startup (sur 100) a 50 %", () => {
  const clearIdea = pitchMeans([pitch("P", [{ clearIdea: 4 }]), pitch("Q", [{ clearIdea: 2 }])]).clearIdea;
  assert.equal(clearIdea, 60);
  const base = { nowISOString: "2026-12-05T12:00:00.000Z", attendance: { attended: 0, total: 0 }, formsOnTime: { onTime: 0, expected: 0 }, profileCompleteness: 1, hackathons: [], peerRatings: [], milestones: [], supporters: 0, batchMaxSupporters: 0, background: null };
  const s = computeFounderScore({ ...base, clearIdea, hasExistingProject: true, hasExistingCoFounders: "none" });
  // 60 x 0,5 + 100 x 0,25 + 0 x 0,25 = 55
  assert.equal(s.subScores.commitment, 55);
});

// ---- Le pack d'un pitch --------------------------------------------------------------------------

const NOW = "2026-12-01T09:00:00.000Z";
const pitchEvent = (templateKey) =>
  newEvent({ programId: "p", batchId: "b", templateKey, name: "Pitch Day #1", startDateISOString: "2026-12-04T13:00:00.000Z", status: "scheduled" });
const planOf = (templateKey) => eventFormsPlan("pitch-1", pitchEvent(templateKey), {}, NOW);
const juryIds = (templateKey) => planOf(templateKey).find((p) => p.templateKey === "jury").form.questions.map((q) => q.id);

check("un pitch : Pitch deck et jury, et le bareme de la grille sur l'evenement", () => {
  for (const key of ["pitch_day", "friday_pitch", "demo_day", "selection_day", "pre_ic", "ic"]) {
    assert.deepEqual(EVENT_TEMPLATES[key].forms, ["pitch_deck", "jury"], key);
    assert.equal(EVENT_TEMPLATES[key].criteria, PITCH_RUBRIC, key);
  }
  assert.deepEqual(pitchEvent("pitch_day").scoring, PITCH_SCORING);
  // Un hackathon : sa grille par defaut (17/11), des criteres de 0 a 5 dont les points font 100.
  const hackathon = pitchEvent("hackathon");
  assert.deepEqual(hackathon.scoring.items.map((i) => [i.sourceKey, i.mode, i.maxPoints]), [["result", "criterion", 90], ["outputQuality", "criterion", 10]]);
  assert.deepEqual(EVENT_TEMPLATES.hackathon.criteria.map((c) => [c.key, c.min, c.max, c.weight]), [["result", 0, 5, 90], ["outputQuality", 0, 5, 10]]);
  assert.deepEqual(planOf("pitch_day").map((p) => p.id).sort(), ["pitch-1-jury", "pitch-1-pitch_deck"]);
});

check("Pitch deck : 48 h avant le pitch, echeance la veille ; une reponse pour toute la startup", () => {
  const deck = planOf("pitch_day").find((p) => p.templateKey === "pitch_deck").form;
  assert.equal(deck.opensDateISOString, "2026-12-02T13:00:00.000Z");
  assert.equal(deck.deadlineDateISOString, "2026-12-03T13:00:00.000Z");
  assert.equal(deck.identityCheck, "account");
  assert.deepEqual(deck.questions.map((q) => q.dbField), [
    "startupProfile.pitchDeckUrl",
    "startup.ideaOneLine",
    "startupProfile.problem",
    "startupProfile.icp",
    "startupProfile.solution",
    "startupProfile.whyNow",
  ]);
  assert.equal(isStartupForm(deck.questions), true);
  assert.equal(formNeedsStartup(deck), true);
});

check("jury d'un pitch : les neuf criteres, puis Overall, Decision (etapes), Would invest et How likely (avant l'IC)", () => {
  const criteria = PITCH_CRITERIA.map((c) => `criterion_${c.key}`);
  assert.deepEqual(juryIds("pitch_day"), [...criteria, "overall", "wouldInvest", "betLikelihood", "comment"]);
  assert.deepEqual(juryIds("selection_day"), [...criteria, "overall", "decision", "wouldInvest", "betLikelihood", "comment"]);
  assert.deepEqual(juryIds("pre_ic"), [...criteria, "overall", "decision", "wouldInvest", "betLikelihood", "comment"]);
  assert.deepEqual(juryIds("ic"), [...criteria, "overall", "decision", "comment"]);
  const jury = planOf("selection_day").find((p) => p.templateKey === "jury").form;
  const byId = new Map(jury.questions.map((q) => [q.id, q]));
  assert.deepEqual(byId.get("criterion_teamStrength").scale, { min: 0, max: 5 });
  assert.equal(byId.get("criterion_teamStrength").weight, 25);
  assert.deepEqual(byId.get("overall").scale, { min: 0, max: 5 });
  assert.equal(byId.get("overall").dbField, "evaluation.overallScore");
  assert.deepEqual(byId.get("decision").options, ["go", "no_go", "maybe"]);
  assert.deepEqual(byId.get("wouldInvest").options, ["Yes", "No"]);
  assert.ok(jury.questions.every((q) => q.scope === "each_target"));
  assert.match(jury.description, /pitch deck/);
});

check("un hackathon garde son jury : ni questions d'apres la grille, ni description du pitch", () => {
  const jury = eventFormsPlan("h", { ...pitchEvent("hackathon") }, {}, NOW).find((p) => p.templateKey === "jury").form;
  assert.ok(!jury.questions.some((q) => q.id === "overall"));
  assert.match(jury.description, /Drive folder/);
});
