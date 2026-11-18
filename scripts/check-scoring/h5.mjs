// Le H5 (lot 3, docs/FONCTIONNALITES.md §2.6 et §4.2) : trois formulaires d'equipe
// (Plan, Snapshot, Final numbers) qui ecrivent la meme Submission ; seul Final numbers en retard la
// marque « en retard » (une information, sans effet sur les points) ; les startups du batch sont des equipes fixes du tirage.
// Logique pure : functions/lib/shared (eventForms, forms, fieldRegistry, teamGenerator) et le fichier
// data/events.json lu comme par scripts/sync-events.mjs.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { check } from "../lib/check.mjs";
import { formOptions, readEventsFile, toEvent } from "../lib/eventsFile.mjs";

const require = createRequire(import.meta.url);
const { eventFormsPlan } = require("../../functions/lib/shared/eventForms.js");
const { newForm } = require("../../functions/lib/shared/forms.js");
const { stampOf } = require("../../functions/lib/shared/fieldRegistry.js");
const { formSetsSubmissionLate, submissionLateDeadline } = require("../../functions/lib/shared/types/form.js");
const { GENERATOR_PRESETS, generateGroups, startupFixedGroups } = require("../../functions/lib/shared/teamGenerator.js");

const H5 = "fa26-hackathon-5-zero-to-first-customer";
const NOW = "2026-11-17T12:00:00.000Z";
const { data, selected } = readEventsFile("Week 2");
const entry = selected.find((e) => e.key === H5);
const event = toEvent(data, entry, NOW);
const plans = eventFormsPlan(H5, event, formOptions(entry), NOW);
const planOf = (key) => plans.find((p) => p.templateKey === key);
const fieldsOf = (key) => planOf(key).form.questions.map((q) => q.dbField);

// ---- Les formulaires du H5, construits depuis l'evenement ----

check("H5 : Plan, Snapshot, Final numbers, Peer rating et Jury ; plus de Submission unique", () => {
  assert.deepEqual(plans.map((p) => p.id).sort(), [
    `${H5}-h5_final`,
    `${H5}-h5_plan`,
    `${H5}-h5_snapshot`,
    `${H5}-jury`,
    `${H5}-peer_rating`,
  ]);
});

check("dates de Paris : Plan mercredi 12:00, Snapshot vendredi 17:00, Final numbers lundi 9:00", () => {
  const dates = (key) => [planOf(key).form.opensDateISOString, planOf(key).form.deadlineDateISOString];
  // Plan et Snapshot s'ouvrent au kickoff (debut du H5) ; Final numbers au build freeze.
  assert.deepEqual(dates("h5_plan"), ["2026-11-25T08:30:00.000Z", "2026-11-25T11:00:00.000Z"]);
  assert.deepEqual(dates("h5_snapshot"), ["2026-11-25T08:30:00.000Z", "2026-11-27T16:00:00.000Z"]);
  assert.deepEqual(dates("h5_final"), ["2026-11-27T16:00:00.000Z", "2026-11-30T08:00:00.000Z"]);
});

check("les trois sont d'equipe, depuis son compte, publies", () => {
  for (const key of ["h5_plan", "h5_snapshot", "h5_final"]) {
    const { form } = planOf(key);
    assert.equal(form.kind, "debrief", key);
    assert.equal(form.identityCheck, "account", key);
    assert.equal(form.status, "open", key);
    assert.ok(form.attachments.team, `${key} : formulaire d'equipe`);
  }
});

check("leurs champs : Plan -> notes + slideUrl, Snapshot -> productUrl + videoUrl + features, Final -> 4 metriques + Drive", () => {
  assert.deepEqual(fieldsOf("h5_plan"), ["submission.notes", "submission.slideUrl"]);
  assert.deepEqual(fieldsOf("h5_snapshot"), ["submission.productUrl", "submission.videoUrl", "submission.features"]);
  assert.deepEqual(fieldsOf("h5_final"), [
    "submission.metrics.amountPaid",
    "submission.metrics.closedWon",
    "submission.metrics.loisSigned",
    "submission.metrics.activeUsers",
    "submission.driveFolderUrl",
  ]);
});

check("la grille du jury H5 reste celle du fichier (100 points)", () => {
  const weights = planOf("jury").form.questions.filter((q) => q.weight !== undefined).map((q) => q.weight);
  assert.equal(weights.reduce((s, w) => s + w, 0), 100);
});

// ---- Le retard : seul Final numbers le decide ----

check("Final numbers decide du retard, Plan et Snapshot non ; un formulaire d'avant (sans champ) oui", () => {
  assert.equal(formSetsSubmissionLate(planOf("h5_final").form), true);
  assert.equal(formSetsSubmissionLate(planOf("h5_plan").form), false);
  assert.equal(formSetsSubmissionLate(planOf("h5_snapshot").form), false);
  const debrief = newForm({ programId: "p", batchId: "b", templateKey: "debrief", eventId: "h1" });
  assert.equal(formSetsSubmissionLate(debrief), true);
  assert.equal(formSetsSubmissionLate({}), true);
});

/** Ce que pose un envoi par formulaire sur la soumission, comme `services/forms.ts`. */
const stampFor = (form, now) => stampOf("submission", { now, uid: "u1", asForm: true, formDeadline: submissionLateDeadline(form) });
const AFTER_ALL = "2026-12-01T10:00:00.000Z";

check("Plan ou Snapshot apres l'echeance : `late` n'est pas touche", () => {
  for (const key of ["h5_plan", "h5_snapshot"]) {
    const stamp = stampFor(planOf(key).form, AFTER_ALL);
    assert.equal("late" in stamp, false, key);
    assert.equal(stamp.recordedSource, "self_reported");
  }
});

check("Final numbers : a temps -> late false ; apres lundi 9:00 -> late true", () => {
  const final = planOf("h5_final").form;
  assert.equal(stampFor(final, "2026-11-30T07:59:00.000Z").late, false);
  assert.equal(stampFor(final, "2026-11-30T08:01:00.000Z").late, true);
});

check("Submission H1-H4 (debrief) : en retard comme avant ; sans echeance, jamais", () => {
  const debrief = { ...newForm({ programId: "p", batchId: "b", templateKey: "debrief", eventId: "h1" }), deadlineDateISOString: "2026-11-18T16:45:00.000Z" };
  assert.equal(stampFor(debrief, "2026-11-18T17:00:00.000Z").late, true);
  assert.equal(stampFor({ ...debrief, deadlineDateISOString: null }, "2026-11-18T17:00:00.000Z").late, false);
  // Le staff qui corrige ne touche pas au retard.
  assert.equal("late" in stampOf("submission", { now: AFTER_ALL, uid: "s", asForm: false }), false);
});

// ---- Le tirage : les startups sont des equipes fixes ----

check("le matching du H5 demande les startups en equipes fixes", () => {
  assert.equal(event.matching.lockedTeamsFromStartups, true);
});

const startups = [
  { id: "s-lumen", name: "Lumen", memberIds: ["ada", "ben", "chloe"] },
  { id: "s-solo", name: "Solo", memberIds: ["dan", "eve"] }, // eve absente : une seule presente
  { id: "s-twice", name: "Twice", memberIds: ["ben", "fay", "gus"] }, // ben deja dans Lumen
];
const present = new Set(["ada", "ben", "chloe", "dan", "fay", "gus", "hal", "ivy", "jo", "kim", "lea"]);
const fixedGroups = startupFixedGroups(startups, present);

check("startups a deux fondateurs presents ou plus : equipes fixes ; un fondateur dans une seule", () => {
  const { groups, skipped } = fixedGroups;
  assert.deepEqual(
    groups.map((g) => [g.key, g.name, g.memberIds]),
    [
      ["s-lumen", "Lumen", ["ada", "ben", "chloe"]],
      ["s-twice", "Twice", ["fay", "gus"]],
    ],
  );
  assert.deepEqual(skipped.map((s) => s.id), ["s-solo"]);
});

check("le tirage place les autres fondateurs, sans toucher aux startups", () => {
  const fixed = new Set(fixedGroups.groups.flatMap((g) => g.memberIds));
  const participants = [...present].map((id) => ({ id, category: null }));
  const { groups } = generateGroups({
    participants,
    groupSize: 3,
    history: { challenge: new Map(), matching: new Map() },
    rules: GENERATOR_PRESETS.challenge.rules,
    keepApart: [],
    keepTogether: [],
    fixedGroups: fixedGroups.groups,
    random: () => 0.42,
  });
  const drawn = groups.flat();
  assert.deepEqual([...drawn].sort(), [...present].filter((id) => !fixed.has(id)).sort());
  assert.ok(groups.every((g) => g.length >= 2 && g.length <= 3));
});
