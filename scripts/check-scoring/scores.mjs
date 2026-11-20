// Les scores sur 100 (decisions du 17/11 et du 18/11, docs/FONCTIONNALITES.md §3 et §4.1) :
// un cas par sous-score et par signal, « sans note, pas de poids », H5 x4, absence sans effet
// sur Execution, Likability (shortlists rapportees a la moitie du batch, ressenti du peer rating),
// Edge, poids de la Program Performance (10 / 50 / 30 / 10, Commitment et Background a 0 %), Outstanding au-dessus de 100,
// milestones avant et apres leur echeance, score startup, et les scores sur 10 de Spring 2026.
// Logique pure : functions/lib/shared/scoring.js, attendance.js, types/score.js. La grille
// Background elle-meme (points, Outstanding) : background.mjs ; ici, le sous-score qui la lit.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { check } from "../lib/check.mjs";

const require = createRequire(import.meta.url);
const {
  computeFounderScore,
  computeStartupScore,
  countsInFormsOnTime,
  dueMilestones,
  founderMilestones,
  hackathonsByFounder,
  hackathonWeightOf,
  peerRatingOn100,
  shortlistersOf,
  shortlistersOn100,
  withoutMissedHackathons,
} = require("../../functions/lib/shared/scoring.js");
const { mandatoryAttendance } = require("../../functions/lib/shared/attendance.js");
const { edgeProblems, edgeRatingWrite, edgeStatus } = require("../../functions/lib/shared/edge.js");
const { programPerformance, startupScore, scoreScaleOf } = require("../../functions/lib/shared/types/score.js");

const NOW = "2026-11-20T12:00:00.000Z";
/** Un fondateur sans aucune donnee, sauf un profil complet. */
const inputs = (extra = {}) => ({
  nowISOString: NOW,
  attendance: { attended: 0, total: 0 },
  formsOnTime: { onTime: 0, expected: 0 },
  profileCompleteness: 1,
  hackathons: [],
  peerReliability: [],
  milestones: [],
  shortlisters: 0,
  batchSize: 0,
  peerLikability: [],
  edge: null,
  hasExistingProject: null,
  hasExistingCoFounders: null,
  background: null,
  ...extra,
});
const sub = (extra) => computeFounderScore(inputs(extra)).subScores;
const signalsOf = (extra, pillar) => computeFounderScore(inputs(extra)).signals[pillar];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.051, `${actual} != ${expected}`);
const facts = (extra = {}) => ({ shortlistedCount: 0, reciprocalMetCount: 0, batchSize: 33, startupFounderCount: 0, problemValidated: null, weeklyGoal: null, ...extra });

// ---- Conversions -----------------------------------------------------------------------

check("peer rating sur 100 : (note - 1) x 25", () => {
  assert.equal(peerRatingOn100(1), 0);
  assert.equal(peerRatingOn100(3), 50);
  assert.equal(peerRatingOn100(5), 100);
});

// ---- Engagement --------------------------------------------------------------------------

check("Engagement : presence 50 %, formulaires a temps 30 %, profil 20 %", () => {
  // 0,5 x 80 + 0,3 x 75 + 0,2 x 50 = 72,5
  const s = sub({ attendance: { attended: 8, total: 10 }, formsOnTime: { onTime: 3, expected: 4 }, profileCompleteness: 0.5 });
  assert.equal(s.engagement, 72.5);
});

check("Engagement sans presence ni formulaire du : le profil seul (poids redistribue)", () => {
  assert.equal(sub({ profileCompleteness: 0.5 }).engagement, 50);
});

check("Engagement : un signal manquant, les autres gardent leurs proportions", () => {
  // presence 80 (50) et profil 50 (20) : (40 + 10) / 0,7
  near(sub({ attendance: { attended: 8, total: 10 }, profileCompleteness: 0.5 }).engagement, 71.4);
});

check("presence : un evenement optionnel ne compte pas, un absent a un evenement obligatoire si", () => {
  const founders = ["a", "b"].map((id) => ({ id, batchId: "x", status: "active", archivedDateISOString: null, isExternalFounder: false, startupId: null }));
  const event = (id, extra = {}) => ({ id, audience: "batch", guestFounderIds: [], startupIds: [], ...extra });
  const marks = new Map([
    ["mandatory", [{ founderId: "a", status: "absent" }]],
    ["drinks", [{ founderId: "b", status: "absent" }]],
  ]);
  const totals = mandatoryAttendance("x", [event("mandatory"), event("drinks", { attendanceOptional: true })], founders, marks);
  assert.deepEqual(totals.get("a"), { attended: 0, total: 1 });
  assert.deepEqual(totals.get("b"), { attended: 1, total: 1 });
});

check("formulaires a temps : jamais ceux d'un evenement optionnel, d'un brouillon, a echeance future", () => {
  const form = { archivedDateISOString: null, status: "open", deadlineDateISOString: "2026-11-19T18:00:00.000Z" };
  assert.equal(countsInFormsOnTime(form, null, NOW), true);
  assert.equal(countsInFormsOnTime(form, { attendanceOptional: false }, NOW), true);
  assert.equal(countsInFormsOnTime(form, { attendanceOptional: true }, NOW), false);
  assert.equal(countsInFormsOnTime({ ...form, status: "draft" }, null, NOW), false);
  assert.equal(countsInFormsOnTime({ ...form, deadlineDateISOString: "2026-11-21T00:00:00.000Z" }, null, NOW), false);
  assert.equal(countsInFormsOnTime({ ...form, deadlineDateISOString: null }, null, NOW), false);
});

// ---- Execution ---------------------------------------------------------------------------

check("Hackathons : moyenne ponderee, le H5 compte 4 fois", () => {
  // (80 x 1 + 60 x 4) / 5 = 64
  const hackathons = [
    { name: "H1", score: 80, weight: 1 },
    { name: "H5", score: 60, weight: 4 },
  ];
  assert.equal(sub({ hackathons }).execution, 64);
  const [signal] = signalsOf({ hackathons }, "execution");
  assert.equal(signal.label, "Hackathons (2)");
  assert.equal(signal.raw, "H1 80 · H5 60 (x4)");
});

check("poids d'un hackathon : `hackathonWeight` de l'evenement, 1 par defaut", () => {
  assert.equal(hackathonWeightOf({}), 1);
  assert.equal(hackathonWeightOf({ hackathonWeight: 4 }), 4);
  assert.equal(hackathonWeightOf({ hackathonWeight: 0 }), 1);
});

check("absence : un hackathon manque compte 0 dans Execution, avec son poids (20/11)", () => {
  const board = (name, normalized, absent = [], extra = {}) => ({
    rows: [{ memberIds: ["a", "b"].filter((id) => !absent.includes(id)), normalized }],
    event: { name, ...extra },
    absentIds: new Set(absent),
  });
  const byFounder = hackathonsByFounder([
    board("Hackathon 1: Pain Hunters", 80),
    board("Hackathon 2: Phone Agents", 20, ["a"]),
    board("Hackathon 5: Zero to first customer", 60, [], { hackathonWeight: 4 }),
  ]);
  assert.deepEqual(byFounder.get("a"), [
    { name: "H1", score: 80, weight: 1 },
    { name: "H2", score: 0, weight: 1, absent: true },
    { name: "H5", score: 60, weight: 4 },
  ]);
  assert.equal(sub({ hackathons: byFounder.get("a") }).execution, 53.3); // (80 + 0 + 240) / 6
  assert.equal(sub({ hackathons: byFounder.get("b") }).execution, 56.7); // (80 + 20 + 240) / 6
  assert.equal(signalsOf({ hackathons: byFounder.get("a") }, "execution")[0].raw, "H1 80 · H2 0 (absent) · H5 60 (x4)");
  // Presence optionnelle : l'absence ne compte pas.
  const optional = hackathonsByFounder([board("Hackathon 1", 80), board("Hackathon 2", 20, ["a"], { attendanceOptional: true })]);
  assert.deepEqual(optional.get("a"), [{ name: "H1", score: 80, weight: 1 }]);
});

check("score startup : le fondateur sans ses hackathons manques (20/11)", () => {
  const hackathons = [
    { name: "H1", score: 80, weight: 1 },
    { name: "H2", score: 0, weight: 1, absent: true },
  ];
  assert.equal(sub({ hackathons }).execution, 40);
  assert.equal(sub(withoutMissedHackathons({ hackathons })).execution, 80);
});

check("une ligne de classement sans note n'est pas comptee", () => {
  const byFounder = hackathonsByFounder([{ rows: [{ memberIds: ["a"] }], event: { name: "H1" }, absentIds: new Set() }]);
  assert.equal(byFounder.get("a"), undefined);
});

check("Peer ratings recus : la moyenne, (note - 1) x 25", () => {
  // moyenne 4 -> 75
  assert.equal(sub({ peerReliability: [5, 3, 4] }).execution, 75);
  assert.equal(signalsOf({ peerReliability: [5, 3, 4] }, "execution")[0].label, "Peer reliability (3)");
});

check("Execution : trois signaux a poids egal", () => {
  const milestones = [
    { key: "shortlist_done", dueDateISOString: "2026-11-19T00:00:00.000Z", achieved: true },
    { key: "met", dueDateISOString: "2026-11-19T00:00:00.000Z", achieved: false },
  ];
  // (64 + 75 + 50) / 3 = 63
  const s = sub({ hackathons: [{ name: "H1", score: 80, weight: 1 }, { name: "H5", score: 60, weight: 4 }], peerReliability: [5, 3, 4], milestones });
  assert.equal(s.execution, 63);
});

check("Execution sans hackathon, avis ni milestone due : pas de poids (null)", () => {
  assert.equal(sub({}).execution, null);
});

// ---- Milestones ---------------------------------------------------------------------------

/** Les echeances de fa26 (`batches/fall-2026.settings.scoreMilestoneDueDates`, scripts/set-milestone-dates.mjs). */
const FA26_DUES = {
  shortlistDone: "2026-11-23T15:30:00.000Z",
  met: "2026-11-23T15:30:00.000Z",
  teamedUp: "2026-11-25T08:30:00.000Z",
  problemValidated: "2026-12-16T23:00:00.000Z",
};

check("milestones avant leur echeance : aucune ne compte", () => {
  const list = founderMilestones(FA26_DUES, facts({ shortlistedCount: 5, reciprocalMetCount: 20, startupFounderCount: 2 }));
  assert.deepEqual(dueMilestones(list, "2026-11-23T15:29:00.000Z"), []);
  assert.equal(sub({ nowISOString: "2026-11-23T15:29:00.000Z", milestones: list }).execution, null);
});

check("apres le debrief du H4 : Shortlist done et Met comptent, pas encore Teamed up", () => {
  const list = founderMilestones(FA26_DUES, facts({ shortlistedCount: 3, reciprocalMetCount: 15, startupFounderCount: 2 }));
  const due = dueMilestones(list, "2026-11-24T00:00:00.000Z");
  assert.deepEqual(due.map((m) => [m.key, m.achieved]), [["shortlist_done", true], ["met", false]]);
  assert.equal(sub({ nowISOString: "2026-11-24T00:00:00.000Z", milestones: list }).execution, 50);
});

check("apres le kickoff du H5 : Teamed up compte aussi", () => {
  const list = founderMilestones(FA26_DUES, facts({ shortlistedCount: 3, reciprocalMetCount: 16, startupFounderCount: 2 }));
  const due = dueMilestones(list, "2026-11-25T08:30:00.000Z");
  assert.deepEqual(due.map((m) => m.key).sort(), ["met", "shortlist_done", "teamed_up"]);
  assert.equal(sub({ nowISOString: "2026-11-25T08:30:00.000Z", milestones: list }).execution, 100);
});

check("seuils : Shortlist done a 3, Met a 50 % des autres, Teamed up a 2 fondateurs", () => {
  const after = "2026-11-26T00:00:00.000Z";
  const achieved = (f) => Object.fromEntries(dueMilestones(founderMilestones(FA26_DUES, facts(f)), after).map((m) => [m.key, m.achieved]));
  assert.deepEqual(achieved({ shortlistedCount: 2, reciprocalMetCount: 15, startupFounderCount: 1 }), { teamed_up: false, shortlist_done: false, met: false });
  assert.deepEqual(achieved({ shortlistedCount: 3, reciprocalMetCount: 16, startupFounderCount: 2 }), { teamed_up: true, shortlist_done: true, met: true });
});

check("Problem validated et Weekly goal sans donnee (lot 4) : pas de poids, meme dus", () => {
  const list = founderMilestones(FA26_DUES, facts());
  const due = dueMilestones(list, "2027-01-01T00:00:00.000Z");
  assert.equal(due.some((m) => m.key === "problem_validated" || m.key === "weekly_goal"), false);
  const validated = founderMilestones(FA26_DUES, facts({ problemValidated: true }));
  assert.equal(dueMilestones(validated, "2027-01-01T00:00:00.000Z").find((m) => m.key === "problem_validated").achieved, true);
});

check("un batch sans echeances n'a pas de milestones", () => {
  assert.deepEqual(founderMilestones(undefined, facts({ shortlistedCount: 9 })), []);
  assert.deepEqual(founderMilestones({ met: null }, facts({ shortlistedCount: 9 })), []);
});

// ---- Likability ---------------------------------------------------------------------------

check("Likability, shortlists : rapportees a la moitie du batch, plafonnees a 100", () => {
  // Batch de 32 : 16 fondateurs qui l'ont shortliste = 100.
  assert.equal(shortlistersOn100(8, 32), 50);
  assert.equal(shortlistersOn100(16, 32), 100);
  assert.equal(shortlistersOn100(20, 32), 100);
  assert.equal(sub({ shortlisters: 4, batchSize: 32 }).likability, 25);
  assert.equal(signalsOf({ shortlisters: 4, batchSize: 32 }, "likability")[0].raw, "4 founders, 16 for 100");
});

check("Likability : shortlists 50 %, ressenti du peer rating 50 % ((note - 1) x 25)", () => {
  // Shortlists 8/16 = 50 ; ressenti moyen 4 = 75 -> 62,5
  assert.equal(sub({ shortlisters: 8, batchSize: 32, peerLikability: [5, 3] }).likability, 62.5);
  // Sans batch (aucun participant) : le ressenti seul.
  assert.equal(sub({ peerLikability: [5] }).likability, 100);
  assert.equal(sub({}).likability, null);
});

check("Likability : une meme personne compte une fois ; jamais soi-meme ; un 5 au peer rating n'est pas une shortlist", () => {
  const shortlisters = shortlistersOf(
    new Map([
      ["b", new Set(["a"])], // historique et liste actuelle : un ensemble
      ["a", new Set(["a"])], // jamais soi-meme
      ["c", new Set(["a", "b"])],
    ]),
  );
  assert.deepEqual([...shortlisters.get("a")].sort(), ["b", "c"]);
  assert.deepEqual([...shortlisters.get("b")], ["c"]);
});

// ---- Edge ---------------------------------------------------------------------------------

check("Edge : la note du staff de 0 a 5, sur 100 ; sans note, pas de poids", () => {
  const edge = { score: 4, ratedText: "Ships fast", ratedByUid: "staff", ratedDateISOString: NOW };
  assert.equal(sub({ edge }).edge, 80);
  assert.equal(signalsOf({ edge }, "edge")[0].raw, "4/5");
  assert.equal(sub({}).edge, null);
});

check("Edge : a noter tant que le texte n'est pas note, ou s'il a change depuis la note", () => {
  const rating = { score: 4, ratedText: "Ships fast", ratedByUid: "staff", ratedDateISOString: NOW };
  assert.equal(edgeStatus(null, null), "missing");
  assert.equal(edgeStatus("  ", rating), "missing");
  assert.equal(edgeStatus("Ships fast", null), "to_rate");
  assert.equal(edgeStatus("Ships fast\n", rating), "rated");
  assert.equal(edgeStatus("Ships fast, never gives up", rating), "to_rate");
  assert.deepEqual(edgeProblems(5), []);
  assert.equal(edgeProblems(6).length, 1);
  assert.equal(edgeProblems(2.5).length, 1);
  assert.throws(() => edgeRatingWrite("a", { score: 7, ratedText: "x" }, "staff", NOW));
  assert.throws(() => edgeRatingWrite("a", { score: 3, ratedText: "  " }, "staff", NOW), /edge|written/i);
  assert.equal(edgeRatingWrite("a", { score: 3, ratedText: " Ships fast \n" }, "staff", NOW).data.edge.ratedText, "Ships fast");
});

// ---- Commitment ---------------------------------------------------------------------------

check("Commitment (suivi, 0 %) : projet existant 50 %, cofondateurs 50 % (hors du batch = 50) ; ni Clear idea ni statut", () => {
  // (100 + 50) / 2 = 75
  const extra = { hasExistingProject: true, hasExistingCoFounders: "outside_batch" };
  assert.equal(sub(extra).commitment, 75);
  assert.equal(sub({ hasExistingProject: false, hasExistingCoFounders: "in_batch" }).commitment, 50);
  assert.deepEqual(signalsOf(extra, "commitment").map((s) => s.label), ["Existing project", "Existing co-founders"]);
});

check("Commitment sans donnee : pas de poids (null)", () => {
  assert.equal(sub({}).commitment, null);
});

// ---- Background ---------------------------------------------------------------------------

check("Background : la note validee du staff (40 / 25 / 20 / 15)", () => {
  // 40 + 20 + 12 + 6 = 78
  const background = { scores: { execution: 5, founderSignal: 4, pedigree: 3, geography: 2 } };
  assert.equal(sub({ background }).background, 78);
  assert.equal(signalsOf({ background }, "background")[0].raw, "Execution 5/5 · Founder signal 4/5 · Pedigree 3/5 · Geography 2/5");
});

check("Background : Outstanding +20, seulement a 100", () => {
  const all5 = { execution: 5, founderSignal: 5, pedigree: 5, geography: 5 };
  assert.equal(sub({ background: { scores: all5, outstanding: true } }).background, 120);
  assert.equal(sub({ background: { scores: { ...all5, geography: 4 }, outstanding: true } }).background, 97);
});

check("Background sans note du staff (proposition seule, ou rien) : pas de poids", () => {
  const proposed = { scores: { execution: 5, founderSignal: 5, pedigree: 5, geography: 5 }, outstanding: false, ratedByUid: "script:background-draft", ratedDateISOString: NOW, reasoning: null };
  assert.equal(sub({ background: { scores: {}, outstanding: false, proposed } }).background, null);
  assert.equal(sub({}).background, null);
});

// ---- Program Performance ----------------------------------------------------------------------

check("Program Performance : Engagement 10, Execution 50, Likability 30, Edge 10 ; Commitment et Background a 0 %", () => {
  const edge = { score: 3, ratedText: "x", ratedByUid: "staff", ratedDateISOString: NOW };
  const s = sub({ profileCompleteness: 0.8, hackathons: [{ name: "H1", score: 70, weight: 1 }], shortlisters: 8, batchSize: 32, edge, hasExistingProject: true });
  // engagement 80, execution 70, likability 50, edge 60, commitment 100 (pas compte)
  assert.deepEqual([s.engagement, s.execution, s.likability, s.edge, s.commitment], [80, 70, 50, 60, 100]);
  // (80 x 10 + 70 x 50 + 50 x 30 + 60 x 10) / 100 = 64
  near(programPerformance({ subScores: s, scale: 100 }), 64);
  // Sans donnee, un sous-score est retire : sans Execution ni Edge, (80 x 10 + 50 x 30) / 40.
  const t = sub({ profileCompleteness: 0.8, shortlisters: 8, batchSize: 32, hasExistingProject: true });
  near(programPerformance({ subScores: t, scale: 100 }), 57.5);
  // Seulement des sous-scores a 0 % : pas de Program Performance.
  assert.equal(programPerformance({ subScores: { commitment: 100, background: 90 }, scale: 100 }), null);
});

check("Outstanding : un sous-score et la Program Performance depassent 100", () => {
  const all5 = { execution: 5, founderSignal: 5, pedigree: 5, geography: 5 };
  const s = sub({ hackathons: [{ name: "H1", score: 120, weight: 1 }], background: { scores: all5, outstanding: true } });
  // Ni signal, ni sous-score, ni Program Performance plafonnes (Background suivi : 120, pas compte).
  assert.equal(s.execution, 120);
  assert.equal(s.background, 120);
  // (100 x 10 + 120 x 50) / 60
  near(programPerformance({ subScores: s, scale: 100 }), 116.67);
});

// ---- Score startup ---------------------------------------------------------------------------

check("startup avant tout pitch : Execution = celle de ses fondateurs ; le Background moyen est suivi, pas compte", () => {
  const c = computeStartupScore({ founderBackgrounds: [78, 62], founderExecutions: [64, 80], weeklyTraction: null, pitches: [] });
  assert.deepEqual(c.subScores, { market: null, team: null, execution: 72, traction: null });
  assert.deepEqual(c.signals.team.map((s) => [s.score, s.weight]), [[70, 0]]);
  assert.equal(c.dataCompleteness, 0.25);
  near(startupScore({ subScores: c.subScores, scale: 100 }), 72);
});

check("startup : Team = famille Team du pitch ; Traction 50 / 50 ; Team 40, les autres 20", () => {
  // Un pitch dont les familles valent 60 / 80 / 90 (le calcul des familles : pitch.mjs).
  const grid = { total: null, outstanding: false, families: { team: 60, speed: 80, market: 90 } };
  const c = computeStartupScore({ founderBackgrounds: [80], founderExecutions: [50], weeklyTraction: 40, pitches: [{ name: "Pitch Day #1", grid }] });
  assert.deepEqual(c.subScores, { market: 90, team: 60, execution: 50, traction: 60 });
  // 60 x 0,4 + 50 x 0,2 + 60 x 0,2 + 90 x 0,2 = 64
  near(startupScore({ subScores: c.subScores, scale: 100 }), 64);
});

check("startup sans aucune donnee : null", () => {
  const c = computeStartupScore({ founderBackgrounds: [], founderExecutions: [], weeklyTraction: null, pitches: [] });
  assert.equal(startupScore({ subScores: c.subScores, scale: 100 }), null);
});

// ---- Spring 2026 : scores importes, sur 10, lus comme avant ----------------------------------

check("un score sans `scale` est sur 10 (Spring 2026, importe)", () => {
  assert.equal(scoreScaleOf({}), 10);
  assert.equal(scoreScaleOf({ scale: 100 }), 100);
});

check("Program Performance sur 10 : les anciens piliers (Achievements compris)", () => {
  assert.equal(programPerformance({ subScores: { engagement: 8, execution: 6, likability: null, commitment: 7, achievements: 5 } }), 6.5);
});

check("score startup sur 10 : ponderation imbriquee d'avant (Speed of execution 40)", () => {
  // Team 6 x 40 + moyenne(Execution 8, Traction absente) x 40 + Market 5 x 20 = 6,6
  near(startupScore({ subScores: { team: 6, execution: 8, traction: null, market: 5 } }), 6.6);
});
