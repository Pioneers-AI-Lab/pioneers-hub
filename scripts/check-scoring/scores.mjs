// Les scores sur 100 (decision du 17/11, docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §3 et §4.1) :
// un cas par sous-score et par signal, « sans note, pas de poids », H5 x4, absence sans effet
// sur Execution, Likability (une personne compte une fois), Outstanding au-dessus de 100,
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
  supportersOf,
} = require("../../functions/lib/shared/scoring.js");
const { mandatoryAttendance } = require("../../functions/lib/shared/attendance.js");
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
  supporters: 0,
  batchMaxSupporters: 0,
  clearIdea: null,
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

check("absence : un hackathon manque n'est ni classe ni compte dans Execution", () => {
  const board = (name, normalized, absent = [], hackathonWeight) => ({
    rows: [{ memberIds: ["a", "b"], normalized }],
    event: { name, ...(hackathonWeight ? { hackathonWeight } : {}) },
    absentIds: new Set(absent),
  });
  const byFounder = hackathonsByFounder([board("Hackathon 1: Pain Hunters", 80), board("Hackathon 2: Phone Agents", 20, ["a"]), board("Hackathon 5: Zero to first customer", 60, [], 4)]);
  assert.deepEqual(byFounder.get("a"), [
    { name: "H1", score: 80, weight: 1 },
    { name: "H5", score: 60, weight: 4 },
  ]);
  assert.equal(byFounder.get("b").length, 3);
  // Le meme fondateur, absent au H2 : sa note ne baisse pas.
  assert.equal(sub({ hackathons: byFounder.get("a") }).execution, 64);
  assert.equal(sub({ hackathons: byFounder.get("b") }).execution, 56.7); // (80 + 20 + 240) / 6
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

check("Likability : rapportee au meilleur du batch (= 100)", () => {
  assert.equal(sub({ supporters: 3, batchMaxSupporters: 6 }).likability, 50);
  assert.equal(sub({ supporters: 6, batchMaxSupporters: 6 }).likability, 100);
});

check("Likability sans aucun soutien dans le batch : pas de poids (null)", () => {
  assert.equal(sub({ supporters: 0, batchMaxSupporters: 0 }).likability, null);
  assert.equal(sub({ supporters: 0, batchMaxSupporters: 4 }).likability, 0);
});

check("Likability : une meme personne compte une fois (shortlist et note de 5)", () => {
  const ids = new Set(["a", "b", "c", "d"]);
  const supporters = supportersOf(
    ids,
    new Map([
      ["b", new Set(["a"])], // historique et liste actuelle : un ensemble
      ["a", new Set(["a"])], // jamais soi-meme
      ["x", new Set(["a"])], // hors du batch
    ]),
    [
      { raterFounderId: "b", rateeFounderId: "a", likability: 5 }, // deja compte
      { raterFounderId: "c", rateeFounderId: "a", likability: 4 },
      { raterFounderId: "d", rateeFounderId: "a", likability: 3 }, // 3 ne compte pas
    ],
  );
  assert.deepEqual([...supporters.get("a")].sort(), ["b", "c"]);
});

// ---- Commitment ---------------------------------------------------------------------------

check("Commitment : projet existant 25 %, cofondateurs 25 % (hors du batch = 70)", () => {
  // Clear idea absente : (100 x 25 + 70 x 25) / 50 = 85
  assert.equal(sub({ hasExistingProject: true, hasExistingCoFounders: "outside_batch" }).commitment, 85);
  assert.equal(sub({ hasExistingProject: false, hasExistingCoFounders: "in_batch" }).commitment, 50);
});

check("Commitment avec Clear idea (50 %) ; le statut d'engagement n'y est plus", () => {
  // (40 x 50 + 100 x 25 + 70 x 25) / 100 = 62,5
  const extra = { clearIdea: 40, hasExistingProject: true, hasExistingCoFounders: "outside_batch" };
  assert.equal(sub(extra).commitment, 62.5);
  assert.deepEqual(signalsOf(extra, "commitment").map((s) => s.label), ["Clear idea", "Existing project", "Existing co-founders"]);
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

check("Program Performance : moyenne des sous-scores disponibles (20 % chacun)", () => {
  const s = sub({ profileCompleteness: 0.8, supporters: 1, batchMaxSupporters: 2, hasExistingProject: true });
  // engagement 80, likability 50, commitment 100 ; execution et background retires
  assert.equal(s.execution, null);
  assert.equal(programPerformance({ subScores: s, scale: 100 }), (80 + 50 + 100) / 3);
});

check("Outstanding : un sous-score et la Program Performance depassent 100", () => {
  const all5 = { execution: 5, founderSignal: 5, pedigree: 5, geography: 5 };
  const s = sub({ hackathons: [{ name: "H1", score: 120, weight: 1 }], background: { scores: all5, outstanding: true } });
  // Ni signal, ni sous-score, ni Program Performance plafonnes.
  assert.equal(s.execution, 120);
  assert.equal(s.background, 120);
  assert.ok(programPerformance({ subScores: s, scale: 100 }) > 100);
});

// ---- Score startup ---------------------------------------------------------------------------

check("startup : Team = Background moyen, Execution = celle de ses fondateurs, le reste sans donnee", () => {
  const c = computeStartupScore({ founderBackgrounds: [78, 62], founderExecutions: [64, 80], weeklyTraction: null, pitches: [] });
  assert.deepEqual(c.subScores, { market: null, team: 70, execution: 72, traction: null });
  assert.equal(c.dataCompleteness, 0.5);
  // Team 40, Execution 20 (Traction et Market retires) : (70 x 40 + 72 x 20) / 60
  near(startupScore({ subScores: c.subScores, scale: 100 }), 70.67);
});

check("startup : Team 50 % Background, 50 % pitch ; Traction 50 / 50 ; Team 40, les autres 20", () => {
  // Un pitch dont les familles valent 60 / 80 / 90 (le calcul des familles : pitch.mjs).
  const grid = { total: null, outstanding: false, families: { team: 60, speed: 80, market: 90 }, clearIdea: null };
  const c = computeStartupScore({ founderBackgrounds: [80], founderExecutions: [50], weeklyTraction: 40, pitches: [{ name: "Pitch Day #1", grid }] });
  assert.deepEqual(c.subScores, { market: 90, team: 70, execution: 50, traction: 60 });
  // 70 x 0,4 + 50 x 0,2 + 60 x 0,2 + 90 x 0,2 = 68
  near(startupScore({ subScores: c.subScores, scale: 100 }), 68);
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
