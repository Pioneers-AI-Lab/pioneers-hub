// Lot 4 (docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §2.8, §2.9, §3.2) : la revue des Weekly updates
// et ce qu'elle donne aux scores, puis le plan des formulaires hebdomadaires.
//   - grille Weekly startup : Traction 60 / Progress 40 sur 100, Outstanding +20 seulement a 100 ;
//   - milestone Weekly goal : moyenne des semaines notees (objectif de la semaine d'avant juge
//     ambitieux ET atteint), due a partir de la semaine 3 ; Problem validated : oui des qu'une revue
//     le dit, due a son echeance ; Traction de la startup : moyenne des notes ;
//   - formulaires du jeudi : publies, ouverts a 18:45, echeance 24 h apres, ids stables, a partir du jour regle.
// Logique pure : functions/lib/shared/weeklyReviews.js, weeklyForms.js, scoring.js.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { check } from "../lib/check.mjs";

const require = createRequire(import.meta.url);
const {
  canStartupReviewBeOutstanding,
  founderReviewProblems,
  founderReviewWrite,
  problemValidatedOf,
  startupReviewNote,
  startupReviewProblems,
  startupReviewWrite,
  weeklyGoalScore,
  weeklyTractionOf,
} = require("../../functions/lib/shared/weeklyReviews.js");
const { shiftWeek } = require("../../functions/lib/shared/dates.js");
const { weeklyFormsOpening, weeklyFormsPlan } = require("../../functions/lib/shared/weeklyForms.js");
const { computeFounderScore, computeStartupScore, dueMilestones, founderMilestones } = require("../../functions/lib/shared/scoring.js");
const { formNeedsStartup, formAudience, formConcernsFounder } = require("../../functions/lib/shared/formRules.js");
const { FORM_TEMPLATES } = require("../../functions/lib/shared/presets/formTemplates.js");

// ---- Grille Weekly startup ----------------------------------------------------------------

check("Weekly startup : Traction 60 + Progress 40 (note ÷ 5 × points)", () => {
  assert.equal(startupReviewNote({ scores: { traction: 5, progress: 5 }, outstanding: false }), 100);
  assert.equal(startupReviewNote({ scores: { traction: 4, progress: 3 }, outstanding: false }), 72); // 48 + 24
  assert.equal(startupReviewNote({ scores: { traction: 0, progress: 5 }, outstanding: false }), 40);
});

check("Weekly startup : sans les deux criteres, pas de note", () => {
  assert.equal(startupReviewNote({ scores: { traction: 4 }, outstanding: false }), null);
  assert.equal(startupReviewNote({ scores: {}, outstanding: true }), null);
});

check("Weekly startup : Outstanding +20 seulement a 100 (100 -> 120, 95 -> refus)", () => {
  assert.equal(startupReviewNote({ scores: { traction: 5, progress: 5 }, outstanding: true }), 120);
  assert.equal(canStartupReviewBeOutstanding({ traction: 5, progress: 4 }), false);
  // Posee sous 100, la mention est ignoree par la note et refusee a l'enregistrement.
  assert.equal(startupReviewNote({ scores: { traction: 5, progress: 4 }, outstanding: true }), 92);
  assert.deepEqual(startupReviewProblems({ traction: 5, progress: 4 }, true), ["The Outstanding mention is only given at 100."]);
  assert.deepEqual(startupReviewProblems({ traction: 5, progress: 5 }, true), []);
});

check("Weekly startup : chaque critere un entier de 0 a 5", () => {
  assert.equal(startupReviewProblems({ traction: 6, progress: 3 }, false).length, 1);
  assert.equal(startupReviewProblems({ traction: 3.5, progress: 3 }, false).length, 1);
  assert.equal(startupReviewProblems({ progress: 3 }, false).length, 1);
  const base = { programId: "p", batchId: "b", startupId: "lumen", weekStartDayString: "2026-11-23", comment: "  " };
  assert.throws(() => startupReviewWrite({ ...base, scores: { traction: 5, progress: 4 }, outstanding: true }, "staff-1", "2026-11-27T10:00:00.000Z"));
  const w = startupReviewWrite({ ...base, scores: { traction: 5, progress: 4 }, outstanding: false }, "staff-1", "2026-11-27T10:00:00.000Z");
  assert.equal(w.path, "startupReviews/lumen_2026-11-23");
  assert.deepEqual(w.data.scores, { traction: 5, progress: 4 });
  assert.equal(w.data.comment, null);
});

check("Weekly founder : au moins une reponse, id fondateur + semaine", () => {
  assert.equal(founderReviewProblems({ goalAmbitious: null, goalReached: null, problemValidated: null }).length, 1);
  const w = founderReviewWrite(
    { programId: "p", batchId: "b", founderId: "ada", weekStartDayString: "2026-11-23", goalAmbitious: true, goalReached: null, problemValidated: null, comment: "ok" },
    "staff-1",
    "2026-11-27T10:00:00.000Z",
  );
  assert.equal(w.path, "founderReviews/ada_2026-11-23");
  assert.equal(w.data.reviewedByUid, "staff-1");
});

// ---- Ce que les revues donnent aux scores -----------------------------------------------------

const W2 = "2026-11-23";
const W3 = shiftWeek(W2, 1);
const W4 = shiftWeek(W2, 2);
const review = (week, goalAmbitious, goalReached, problemValidated = null) => ({ weekStartDayString: week, goalAmbitious, goalReached, problemValidated });

check("semaines : le lundi d'avant et d'apres", () => {
  assert.equal(W3, "2026-11-30");
  assert.equal(shiftWeek("2026-11-30", -1), "2026-11-23");
  assert.equal(shiftWeek("2026-12-28", 1), "2027-01-04");
});

check("Weekly goal : une semaine vaut 100 si l'objectif d'avant etait ambitieux ET atteint", () => {
  // S2 : objectif ambitieux ; S3 : atteint -> 100. S3 : pas ambitieux ; S4 : atteint -> 0.
  assert.deepEqual(weeklyGoalScore([review(W2, true, null), review(W3, false, true), review(W4, true, true)]), 50);
  // Ambitieux mais pas atteint : 0.
  assert.deepEqual(weeklyGoalScore([review(W2, true, null), review(W3, null, false)]), 0);
});

check("Weekly goal : la premiere semaine revue ne se note pas (aucun objectif juge avant) : pas de poids", () => {
  assert.equal(weeklyGoalScore([review(W2, true, true)]), null);
  // Une semaine sautee : S4 n'a pas de revue de S3 avant elle.
  assert.equal(weeklyGoalScore([review(W2, true, null), review(W4, true, true)]), null);
  assert.equal(weeklyGoalScore([]), null);
});

check("Problem validated : oui des qu'une revue le dit, et le reste", () => {
  assert.equal(problemValidatedOf([review(W2, null, null, true), review(W3, null, null, false)]), true);
  assert.equal(problemValidatedOf([review(W2, null, null, false)]), false);
  assert.equal(problemValidatedOf([review(W2, true, null)]), null);
});

/** Les echeances de fa26, Weekly goal a partir de la semaine 3. */
const DUES = {
  shortlistDone: "2026-11-23T15:30:00.000Z",
  met: "2026-11-23T15:30:00.000Z",
  teamedUp: "2026-11-25T08:30:00.000Z",
  problemValidated: "2026-12-16T23:00:00.000Z",
  weeklyGoalFrom: "2026-12-03T17:45:00.000Z",
};
const facts = (extra) => ({ shortlistedCount: 3, reciprocalMetCount: 16, batchSize: 33, startupFounderCount: 2, problemValidated: null, weeklyGoal: null, ...extra });
const founder = (now, milestones) => ({
  nowISOString: now,
  attendance: { attended: 0, total: 0 },
  formsOnTime: { onTime: 0, expected: 0 },
  profileCompleteness: 1,
  hackathons: [],
  peerRatings: [],
  milestones,
  supporters: 0,
  batchMaxSupporters: 0,
  clearIdea: null,
  hasExistingProject: null,
  hasExistingCoFounders: null,
  background: null,
});

check("Weekly goal : due a partir de la semaine 3, compte pour sa note sur 100", () => {
  const list = founderMilestones(DUES, facts({ weeklyGoal: 50 }));
  assert.equal(dueMilestones(list, "2026-12-03T17:44:00.000Z").some((m) => m.key === "weekly_goal"), false);
  const due = dueMilestones(list, "2026-12-04T00:00:00.000Z");
  assert.deepEqual(due.find((m) => m.key === "weekly_goal").achieved, 50);
  // Shortlist done, Met, Teamed up a 100, Weekly goal a 50 : (100 x 3 + 50) / 4.
  const signal = computeFounderScore(founder("2026-12-04T00:00:00.000Z", list)).signals.execution.find((s) => s.label.startsWith("Milestones"));
  assert.equal(signal.score, 87.5);
  assert.equal(signal.label, "Milestones (3/4)");
  assert.match(signal.raw, /Weekly goal: 50/);
});

check("Problem validated : due au Selection Day seulement", () => {
  const list = founderMilestones(DUES, facts({ problemValidated: false }));
  assert.equal(dueMilestones(list, "2026-12-16T22:59:00.000Z").some((m) => m.key === "problem_validated"), false);
  assert.equal(dueMilestones(list, "2026-12-16T23:00:00.000Z").find((m) => m.key === "problem_validated").achieved, false);
});

check("Traction de la startup : moyenne des notes des Weekly updates (Outstanding jusqu'a 120)", () => {
  const traction = weeklyTractionOf([
    { scores: { traction: 5, progress: 5 }, outstanding: true },
    { scores: { traction: 4, progress: 3 }, outstanding: false },
    { scores: { traction: 4 }, outstanding: false }, // incomplete : ignoree
  ]);
  assert.equal(traction, 96); // (120 + 72) / 2
  assert.equal(weeklyTractionOf([]), null);
  const c = computeStartupScore({ founderBackgrounds: [], pitchTeam: null, founderExecutions: [], weeklyTraction: traction, pitchSpeed: null, pitchMarket: null });
  assert.equal(c.subScores.traction, 96);
});

// ---- Les formulaires du jeudi ---------------------------------------------------------------

const batch = (weeklyForms, extra = {}) => ({
  id: "fall-2026",
  programId: "accelerator",
  status: "active",
  archivedDateISOString: null,
  endDayString: "2027-02-28",
  settings: { leaderboardVisibility: "visible", slackChannelId: null, weeklyForms },
  ...extra,
});
const THURSDAY = weeklyFormsOpening("2026-11-26");

check("ouverture : le jeudi a 18:45 a Paris", () => {
  assert.equal(THURSDAY, "2026-11-26T17:45:00.000Z");
});

check("plan : les deux formulaires, publies, ouverts maintenant, echeance 24 h apres", () => {
  const plan = weeklyFormsPlan(batch({ enabled: true, startDayString: "2026-11-26" }), THURSDAY);
  assert.equal(plan.skip, null);
  assert.deepEqual(plan.plans.map((p) => p.id), ["fall-2026-weekly-founder-2026-11-26", "fall-2026-weekly-startup-2026-11-26"]);
  for (const p of plan.plans) {
    assert.equal(p.form.status, "open");
    assert.equal(p.form.version, 1);
    assert.equal(p.version.version, 1);
    assert.equal(p.form.eventId, null);
    assert.equal(p.form.identityCheck, "account");
    assert.equal(p.form.opensDateISOString, THURSDAY);
    assert.equal(p.form.deadlineDateISOString, "2026-11-27T17:45:00.000Z");
    assert.equal(p.form.attachments.week.from, "submission_week");
  }
  assert.equal(plan.plans[0].form.title, "Weekly update · 26 Nov");
  assert.equal(plan.plans[1].form.attachments.startup.from, "respondent_startup");
});

check("plan : rien avant le jour regle, sans reglage, ni pour un batch termine", () => {
  assert.equal(weeklyFormsPlan(batch({ enabled: true, startDayString: "2026-11-26" }), weeklyFormsOpening("2026-11-19")).plans.length, 0);
  assert.equal(weeklyFormsPlan(batch(undefined), THURSDAY).plans.length, 0);
  assert.equal(weeklyFormsPlan(batch({ enabled: false, startDayString: "2026-11-26" }), THURSDAY).plans.length, 0);
  assert.equal(weeklyFormsPlan(batch({ enabled: true, startDayString: "2026-11-26" }, { status: "completed" }), THURSDAY).plans.length, 0);
  assert.equal(weeklyFormsPlan(batch({ enabled: true, startDayString: "2026-11-26" }, { endDayString: "2026-11-20" }), THURSDAY).plans.length, 0);
});

// ---- Le Weekly update startup : une reponse par startup ----------------------------------------

check("Weekly update startup : seuls les fondateurs d'une startup sont attendus", () => {
  const plan = weeklyFormsPlan(batch({ enabled: true, startDayString: "2026-11-26" }), THURSDAY);
  const [founderForm, startupForm] = plan.plans.map((p) => p.form);
  assert.equal(formNeedsStartup(startupForm), true);
  assert.equal(formNeedsStartup(founderForm), false);
  const f = (id, startupId) => ({ id, batchId: "fall-2026", status: "active", archivedDateISOString: null, isExternalFounder: false, startupId });
  const founders = [f("ada", "lumen"), f("ben", null)];
  const audience = (form) =>
    formAudience({ form, batchId: "fall-2026", founders, event: null, attendance: [], teamMemberIds: [] });
  assert.deepEqual(audience(startupForm).founderIds, ["ada"]);
  assert.deepEqual(audience(founderForm).founderIds, ["ada", "ben"]);
  assert.equal(formConcernsFounder(startupForm, founders[1], null, false), false);
  assert.equal(formConcernsFounder(startupForm, founders[0], null, false), true);
});

check("modeles : Program end depuis son compte, sans champ ; Exit form retire", () => {
  const t = FORM_TEMPLATES.program_end;
  assert.equal(t.identityCheck, "account");
  assert.deepEqual(t.questions.map((q) => [q.id, q.dbField]), [["recommend", null], ["keep", null], ["change", null]]);
  assert.deepEqual(t.questions[0].scale, { min: 0, max: 10 });
  assert.equal(FORM_TEMPLATES.exit.retired, true);
  assert.deepEqual(
    FORM_TEMPLATES.weekly_update_founder.questions.map((q) => q.dbField),
    [
      "founderWeek.achieved",
      "founderWeek.goalForWeek",
      "founderWeek.commitmentStatus",
      "founderWeek.messagesSent",
      "founderWeek.conversationsDone",
      "founderWeek.learnings",
      "founderWeek.workingWithFounderIds",
      "founderWeek.matchResult",
    ],
  );
});
