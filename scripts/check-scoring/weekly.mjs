// Lot 4 (docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §2.8, §2.9, §3.2) : la revue des Weekly updates
// et ce qu'elle donne aux scores, puis le plan des formulaires hebdomadaires.
//   - grille Weekly startup : Traction 60 / Progress 40 sur 100, Outstanding +20 seulement a 100 ;
//   - milestone Weekly goal : moyenne des semaines notees (objectif de la semaine d'avant juge
//     ambitieux ET atteint), due a l'echeance du deuxieme Weekly update ; Problem validated : oui des qu'une revue
//     le dit, due a son echeance ; Traction de la startup : moyenne des notes ;
//   - formulaires hebdomadaires (decision du 18/11) : accroches par la synchro de l'agenda a chaque entree
//     « Weekly Update Form » (template `weekly_update`), publies, ouverts a son debut, echeance 24 h apres,
//     ids `<evenement>-<modele>`, deplaces avec elle ; pour tout le batch (aucune presence) ; date Weekly goal
//     = echeance du deuxieme.
// Logique pure : functions/lib/shared/weeklyReviews.js, weeklyForms.js, calendarSync.js, eventForms.js, scoring.js.
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
const { weeklyFormsPlan, weeklyGoalFromOf } = require("../../functions/lib/shared/weeklyForms.js");
const { planCalendarSync } = require("../../functions/lib/shared/calendarSync.js");
const { eventFormsPlan, planEventMove } = require("../../functions/lib/shared/eventForms.js");
const { newEvent } = require("../../functions/lib/shared/events.js");
const { mandatoryAttendance } = require("../../functions/lib/shared/attendance.js");
const { computeFounderScore, computeStartupScore, countsInFormsOnTime, dueMilestones, founderMilestones } = require("../../functions/lib/shared/scoring.js");
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

/** Les echeances de fa26, Weekly goal a l'echeance du deuxieme Weekly update. */
const DUES = {
  shortlistDone: "2026-11-23T15:30:00.000Z",
  met: "2026-11-23T15:30:00.000Z",
  teamedUp: "2026-11-25T08:30:00.000Z",
  problemValidated: "2026-12-16T23:00:00.000Z",
  // L'echeance du deuxieme Weekly update (10/12 18:00 Paris + 24 h) : `weeklyGoalFromOf`, plus bas.
  weeklyGoalFrom: "2026-12-11T17:00:00.000Z",
};
const facts = (extra) => ({ shortlistedCount: 3, reciprocalMetCount: 16, batchSize: 33, startupFounderCount: 2, problemValidated: null, weeklyGoal: null, ...extra });
const founder = (now, milestones) => ({
  nowISOString: now,
  attendance: { attended: 0, total: 0 },
  formsOnTime: { onTime: 0, expected: 0 },
  profileCompleteness: 1,
  hackathons: [],
  peerReliability: [],
  milestones,
  supporters: 0,
  batchMaxSupporters: 0,
  clearIdea: null,
  hasExistingProject: null,
  hasExistingCoFounders: null,
  background: null,
});

check("Weekly goal : due a l'echeance du deuxieme Weekly update, compte pour sa note sur 100", () => {
  const list = founderMilestones(DUES, facts({ weeklyGoal: 50 }));
  assert.equal(dueMilestones(list, "2026-12-11T16:59:00.000Z").some((m) => m.key === "weekly_goal"), false);
  const due = dueMilestones(list, "2026-12-11T17:00:00.000Z");
  assert.deepEqual(due.find((m) => m.key === "weekly_goal").achieved, 50);
  // Shortlist done, Met, Teamed up a 100, Weekly goal a 50 : (100 x 3 + 50) / 4.
  const signal = computeFounderScore(founder("2026-12-12T00:00:00.000Z", list)).signals.execution.find((s) => s.label.startsWith("Milestones"));
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
  const c = computeStartupScore({ founderBackgrounds: [], founderExecutions: [], weeklyTraction: traction, pitches: [] });
  assert.equal(c.subScores.traction, 96);
});

// ---- Les formulaires hebdomadaires, sur les entrees « Weekly Update Form » de l'agenda -------------

const NOW = "2026-11-18T10:00:00.000Z";
const CAL = "cal@group.calendar.google.com";
const BATCH = {
  id: "fall-2026",
  programId: "accelerator",
  startDayString: "2026-11-16",
  endDayString: "2027-02-28",
  settings: { leaderboardVisibility: "visible", slackChannelId: null, weeklyForms: { enabled: true } },
};
/** Une entree de l'agenda Google (fa26 : jeudis 03/12 et 10/12, 18:00 Paris). */
const entry = (id, summary, start, end) => ({ id, summary, start: { dateTime: start }, end: { dateTime: end }, htmlLink: `https://calendar.google.com/event?eid=${id}` });
const W1 = entry("w1", "Weekly Update Form", "2026-12-03T18:00:00+01:00", "2026-12-03T18:30:00+01:00");
const W2E = entry("w2", "weekly  update form", "2026-12-10T18:00:00+01:00", "2026-12-10T18:30:00+01:00");
const sync = (changes, events = [], forms = [], batch = BATCH) => planCalendarSync({ batch, calendarId: CAL, changes, isFull: true, events, forms, nowISO: NOW });
/** Ce que la synchro ecrit, comme le service : les evenements crees (avec leur id), et les formulaires. */
const created = (plan) => plan.creates.map((c) => ({ ...c.data, id: c.id, createdDateISOString: NOW, updatedDateISOString: NOW }));
const createdForms = (plan) => plan.formCreates.map((p) => ({ ...p.form, id: p.id, createdDateISOString: NOW, updatedDateISOString: NOW }));

check("synchro : une entree « Weekly Update Form » recoit le template weekly_update et ses deux formulaires", () => {
  const plan = sync([W1, W2E, entry("x", "Weekly sync with mentors", "2026-12-03T10:00:00+01:00", "2026-12-03T11:00:00+01:00")]);
  const [w1, w2, other] = created(plan);
  assert.equal(w1.templateKey, "weekly_update");
  assert.equal(w1.kind, "session");
  assert.equal(w2.templateKey, "weekly_update"); // nom normalise : casse et espaces
  assert.equal(other.templateKey, null);
  assert.deepEqual(plan.formCreates.map((p) => p.id), [
    "fall-2026_gcal_w1-weekly_update_founder",
    "fall-2026_gcal_w1-weekly_update_startup",
    "fall-2026_gcal_w2-weekly_update_founder",
    "fall-2026_gcal_w2-weekly_update_startup",
  ]);
  for (const p of plan.formCreates.slice(0, 2)) {
    assert.equal(p.form.eventId, "fall-2026_gcal_w1");
    assert.equal(p.form.status, "open");
    assert.equal(p.form.version, 1);
    assert.equal(p.version.version, 1);
    assert.equal(p.form.identityCheck, "account");
    assert.equal(p.form.opensDateISOString, "2026-12-03T17:00:00.000Z");
    assert.equal(p.form.deadlineDateISOString, "2026-12-04T17:00:00.000Z");
    assert.equal(p.form.attachments.week.from, "submission_week");
  }
  assert.deepEqual(plan.formCreates.slice(0, 2).map((p) => p.form.title), ["Weekly update · 3 Dec", "Weekly update startup · 3 Dec"]);
  assert.equal(plan.formCreates[1].form.attachments.startup.from, "respondent_startup");
});

check("synchro : rejouee, elle ne cree rien de plus ; batch sans weeklyForms.enabled, ni template ni formulaire", () => {
  const first = sync([W1]);
  const again = sync([W1], created(first), createdForms(first));
  assert.equal(again.creates.length + again.updates.length + again.formCreates.length, 0);
  const off = sync([W1], [], [], { ...BATCH, settings: { ...BATCH.settings, weeklyForms: { enabled: false } } });
  assert.equal(off.creates[0].data.templateKey, null);
  assert.equal(off.formCreates.length, 0);
});

check("synchro : une entree deja en base sans template (prod, 16/11) le recoit a sa mise a jour, formulaires a sa nouvelle heure", () => {
  const before = created(sync([W1], [], [], { ...BATCH, settings: { ...BATCH.settings, weeklyForms: null } }));
  const moved = entry("w1", "Weekly Update Form", "2026-12-04T18:00:00+01:00", "2026-12-04T18:30:00+01:00");
  const plan = sync([moved], before);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].patch.templateKey, "weekly_update");
  assert.equal(plan.updates[0].patch.startDateISOString, "2026-12-04T17:00:00.000Z");
  assert.deepEqual(plan.formCreates.map((p) => p.form.opensDateISOString), ["2026-12-04T17:00:00.000Z", "2026-12-04T17:00:00.000Z"]);
  // Masquee par le staff : rien.
  assert.equal(sync([moved], [{ ...before[0], archivedDateISOString: NOW }]).formCreates.length, 0);
});

check("deplacee dans l'agenda, l'entree emmene ses formulaires (planEventMove) ; un template pose a la main est garde", () => {
  const first = sync([W1]);
  const [event] = created(first);
  const forms = createdForms(first);
  const next = { startDateISOString: "2026-12-04T17:00:00.000Z", endDateISOString: "2026-12-04T17:30:00.000Z" };
  const { moves } = planEventMove({ event, next, events: [event], forms, moveLinked: false, nowISO: NOW });
  assert.deepEqual(moves.map((m) => [m.opensDateISOString, m.deadlineDateISOString]), [
    ["2026-12-04T17:00:00.000Z", "2026-12-05T17:00:00.000Z"],
    ["2026-12-04T17:00:00.000Z", "2026-12-05T17:00:00.000Z"],
  ]);
  // Un autre template choisi par le staff sur l'entree : la synchro ne le change pas et n'ajoute rien.
  const masterclass = { ...event, templateKey: "masterclass" };
  const plan = sync([entry("w1", "Weekly Update Form", "2026-12-03T18:00:00+01:00", "2026-12-03T18:45:00+01:00")], [masterclass]);
  assert.equal(plan.updates[0].patch.templateKey, undefined);
  assert.equal(plan.formCreates.length, 0);
});

check("le template a la main, sur tout evenement : le meme plan (weeklyFormsPlan, eventFormsPlan)", () => {
  const event = { ...newEvent({ programId: "accelerator", batchId: "fall-2026", templateKey: "weekly_update", name: "Thursday check-in", startDateISOString: "2026-12-17T17:00:00.000Z", endDateISOString: null, status: "scheduled" }), id: "thu" };
  assert.deepEqual(eventFormsPlan("thu", event, {}, NOW).map((p) => p.id), ["thu-weekly_update_founder", "thu-weekly_update_startup"]);
  assert.equal(weeklyFormsPlan(BATCH, event, [], NOW).forms.length, 2);
  // Deja la (meme id) : rien.
  assert.equal(weeklyFormsPlan(BATCH, event, [{ id: "thu-weekly_update_founder", kind: "motivation", archivedDateISOString: null }, { id: "thu-weekly_update_startup", kind: "weekly_update", archivedDateISOString: null }], NOW).forms.length, 0);
});

check("Weekly goal : l'echeance du DEUXIEME Weekly update (10/12 18:00 + 24 h)", () => {
  const events = created(sync([W2E, W1]));
  assert.equal(weeklyGoalFromOf(events), "2026-12-11T17:00:00.000Z");
  assert.equal(weeklyGoalFromOf(events.slice(0, 1)), null);
  // Une entree pas encore accrochee (templateKey null) compte par son nom ; une masquee ne compte pas.
  const raw = created(sync([W1, W2E], [], [], { ...BATCH, settings: { ...BATCH.settings, weeklyForms: null } }));
  assert.equal(weeklyGoalFromOf(raw), "2026-12-11T17:00:00.000Z");
  assert.equal(weeklyGoalFromOf([raw[0], { ...raw[1], archivedDateISOString: NOW }]), null);
});

// ---- Pour tout le batch : aucune presence, le Weekly update startup pour les fondateurs d'une startup ----

check("Weekly update : tout le batch meme marque absent, startup pour les fondateurs d'une startup, compte dans Forms on time", () => {
  const plan = sync([W1]);
  const [event] = created(plan);
  const [founderForm, startupForm] = plan.formCreates.map((p) => p.form);
  assert.equal(formNeedsStartup(startupForm), true);
  assert.equal(formNeedsStartup(founderForm), false);
  const f = (id, startupId) => ({ id, batchId: "fall-2026", status: "active", archivedDateISOString: null, isExternalFounder: false, startupId });
  const founders = [f("ada", "lumen"), f("ben", null)];
  const attendance = [{ founderId: "ada", status: "absent" }];
  const audience = (form) => formAudience({ form, batchId: "fall-2026", founders, event, attendance, teamMemberIds: [] });
  assert.deepEqual(audience(startupForm), { kind: "founders", basis: "batch", founderIds: ["ada"] });
  assert.deepEqual(audience(founderForm).founderIds, ["ada", "ben"]);
  assert.equal(formConcernsFounder(startupForm, founders[1], event, false), false);
  assert.equal(formConcernsFounder(startupForm, founders[0], event, false, attendance[0]), true);
  // Pas une reunion : hors de la presence d'Engagement ; ses formulaires comptent a temps.
  assert.deepEqual(mandatoryAttendance("fall-2026", [event], founders, new Map([[event.id, attendance]])).get("ada"), { attended: 0, total: 0 });
  assert.equal(countsInFormsOnTime(founderForm, event, "2026-12-05T00:00:00.000Z"), true);
  // Un evenement ordinaire garde sa regle : l'absent ne recoit pas le formulaire.
  const masterclass = { ...event, templateKey: "masterclass" };
  assert.deepEqual(formAudience({ form: founderForm, batchId: "fall-2026", founders, event: masterclass, attendance, teamMemberIds: [] }).founderIds, ["ben"]);
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
