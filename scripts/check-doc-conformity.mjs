// ----------------------------
// Conformite au document produit : docs/FONCTIONNALITES.md (19/11) et SPECS v3.0
// ----------------------------
// Les tableaux du document sont ecrits ici en valeurs attendues, puis compares :
//   A. au CODE : modules partages compiles (functions/lib/shared), data/events.json, une constante du front ;
//      par les constantes quand elles existent, sinon par le comportement (fonctions pures sur de petits cas,
//      comme scripts/check-scoring) ;
//   B. a la PROD, en LECTURE SEULE (get / getAll, jamais d'ecriture) : evenements et formulaires a venir de
//      fa26, reglages du batch, scores. Les attendus restent ceux du document, jamais ce que le code produirait.
// Une ligne par verification : `OK`, `FAIL <attendu> vs <reel>`, ou `PENDING` (pas encore la, sans etre
// faux : modele Pitch pas encore applique, formulaires hebdomadaires pas encore crees...).
// Le modele du 19/11 (score startup sur les criteres de l'IC, grilles Pitch et Weekly startup, weekly sans
// evenement, fondateurs « out ») n'est verifie qu'une fois declare par le code (`shared/scoring.ts#SCORING_MODEL`
// >= "2026-11-19") : avant, ses lignes sont PENDING ; apres, elles sont strictes (OK ou FAIL).
// Sortie en erreur (1) s'il y a au moins un FAIL.
//
// npm run check:doc                                    (compile functions, puis code + prod)
// node scripts/check-doc-conformity.mjs [--code-only | --prod-only] [--batch fall-2026] [--now <ISO>]
// La prod lit les Application Default Credentials (projet pioneers-3627c).

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const require = createRequire(import.meta.url);
const lib = (path) => require(`../functions/lib/shared/${path}.js`);

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BATCH_ID = option("--batch", "fall-2026");
const NOW = option("--now", new Date().toISOString());

// ---- Le rapport -----------------------------------------------------------------------------

const counts = { OK: 0, FAIL: 0, PENDING: 0 };
let section = "";
const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));
const firstLine = (e) => e.message.split("\n")[0];
function report(status, name, detail = "") {
  counts[status]++;
  console.log(`${status.padEnd(7)} [${section}] ${name}${detail ? `: ${detail}` : ""}`);
}
/** OK si `actual` vaut `expected` (egalite profonde), FAIL avec les deux sinon. */
function expect(name, expected, actual) {
  if (isDeepStrictEqual(expected, actual)) report("OK", name);
  else report("FAIL", name, `${show(expected)} vs ${show(actual)}`);
}
const pending = (name, why) => report("PENDING", name, why);
/** Un cas de comportement : `fn` rend [attendu, reel] ; une exception est un FAIL. */
function behaves(name, fn) {
  try {
    const [expected, actual] = fn();
    expect(name, expected, actual);
  } catch (e) {
    report("FAIL", name, `threw ${firstLine(e)}`);
  }
}
const heading = (title) => {
  section = title;
  console.log(`\n== ${title}`);
};

// ---- Le code partage compile (npm --prefix functions run build) ---------------------------------

let m;
let eventsFile;
try {
  eventsFile = await import("./lib/eventsFile.mjs");
  m = {
    ev: lib("presets/eventTemplates"),
    ft: lib("presets/formTemplates"),
    offered: lib("presets/offered"),
    forms: lib("eventForms"),
    events: lib("events"),
    dates: lib("dates"),
    col: lib("collections"),
    types: lib("types/index"),
    pitch: lib("pitchGrid"),
    bg: lib("background"),
    rules: lib("scoringRules"),
    scoring: lib("scoring"),
    score: lib("types/score"),
    weekly: lib("weeklyReviews"),
    weeklyForms: lib("weeklyForms"),
    gen: lib("teamGenerator"),
    fields: lib("fieldRegistry"),
    attendance: lib("attendance"),
    formRules: lib("formRules"),
  };
} catch (e) {
  heading("A0 modules");
  report("FAIL", "load functions/lib/shared (npm --prefix functions run build)", firstLine(e));
  process.exit(1);
}
const { formOptions, parisISO: P, parisLabel } = eventsFile;
const { endAfter } = m.events;
const { roundTo } = m.types;

// ---- Le modele du 19/11 : strict une fois code, PENDING avant -----------------------------------

const MODEL_19_11 = (m.scoring.SCORING_MODEL ?? "") >= "2026-11-19";
const NOT_CODED = "doc 19/11 not coded yet (shared/scoring.ts SCORING_MODEL < 2026-11-19)";
/** `behaves` du modele du 19/11. */
const behaves19 = (name, fn) => (MODEL_19_11 ? behaves(name, fn) : pending(name, NOT_CODED));
/** `expect` du modele du 19/11 ; `actual` est une fonction (le code d'avant n'a pas forcement ce qu'elle lit). */
const expect19 = (name, expected, actual) => behaves19(name, () => [expected, actual()]);

// ---- Le document, en valeurs attendues ---------------------------------------------------------

const plusMinutes = (iso, minutes) => endAfter(iso, minutes);
const plusHours = (iso, hours) => endAfter(iso, hours * 60);
const at = (v) => (v ? parisLabel(v) : null);
const parisDayOf = (v) => (v ? m.dates.parisDay(new Date(v).toISOString()) : null);
const span = (x) => [x.opensDateISOString, x.deadlineDateISOString];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
/** Le debrief d'un hackathon : l'evenement « ... Debrief » qui commence a sa fin. */
const debriefAfter = (list, e) => list.find((x) => x.startDateISOString === e.endDateISOString && /debrief/i.test(x.name));

/**
 * Une question attendue : `type dbField`, et, s'ils sont donnes, le libelle (doc, en anglais), l'echelle
 * et le poids. Une valeur `undefined` n'est pas comparee.
 */
const Q = (type, dbField, label, extra = {}) => ({ type, dbField, label, ...extra });
const norm = (s) => s.replace(/\s+:/g, ":").replace(/\s+/g, " ").trim().toLowerCase();
const renderSpec = (s) =>
  [s.type, s.dbField ?? "-", s.scale ?? null, s.weight !== undefined ? `w${s.weight}` : null, s.label ? norm(s.label) : null].filter((x) => x !== null).join(" ");
/** Une question reelle sous la forme de sa spec : seuls les attributs que la spec compare. */
const asSpec = (q, s) => ({
  type: q.type,
  dbField: q.dbField,
  scale: s?.scale ? `${q.scale?.min}-${q.scale?.max}` : undefined,
  weight: s?.weight !== undefined ? q.weight : undefined,
  label: s?.label ? (q.label ?? "") : undefined,
});
/** Compare des questions a leur spec, dans l'ordre. */
const expectQuestions = (name, specs, questions) =>
  expect(
    name,
    specs.map(renderSpec),
    m.types.activeQuestions({ questions }).map((q, i) => renderSpec(asSpec(q, specs[i]))),
  );

/** §2.1 */
const PEER_RATING = [
  Q("rating", "peerRating.likability", "How did you feel working with this person?", { scale: "1-5" }),
  Q("rating", "peerRating.reliability", "How reliable was this person in delivering on commitments?", { scale: "1-5" }),
  Q("text", "peerRating.comment", "Why? (optional)"),
];
const DRIVE = Q("link", "submission.driveFolderUrl", "Your team's Drive folder");
const PROBLEM = Q("single_choice", "submission.problemSource", "Problem");
const metric = (key, label) => Q("number", `submission.metrics.${key}`, label);
/** §2.2 a §2.5 : la Submission de chaque hackathon. */
const SUBMISSIONS = {
  1: [Q("text", "submission.painSentence", "Pain in one sentence"), metric("evidencePosts", "Number of evidence items"), metric("potentialCustomers", "Number of potential customers"), DRIVE],
  2: [
    PROBLEM,
    metric("callsMade", "Calls made"),
    metric("callsAnswered", "Pickups"),
    metric("conversationsDone", "Conversations of 60 s or more"),
    metric("meetingsBooked", "Meetings booked"),
    Q("long_text", "submission.learnings", "Three things you learned"),
    DRIVE,
  ],
  3: [PROBLEM, metric("leadsCollected", "Number of leads"), metric("reach", "Reach (views, impressions or visits, if known)"), DRIVE],
  4: [
    metric("amountPaid", "Money received from a real company, refunds excluded (EUR)"),
    metric("loisSigned", "Signed commitments"),
    metric("closedWon", "Paying customers"),
    DRIVE,
  ],
};
/** §2.6 */
const H5_FORMS = {
  h5_plan: [Q("long_text", "submission.notes", "Problem, customer, one-page plan"), Q("link", "submission.slideUrl")],
  h5_snapshot: [Q("link", "submission.productUrl", "Product URL"), Q("link", "submission.videoUrl", "2-minute demo"), Q("long_text", "submission.features", "Features shipped")],
  h5_final: [metric("amountPaid", "Revenue (EUR)"), metric("closedWon", "Paying customers"), metric("loisSigned", "Signed commitments"), metric("activeUsers", "Active users"), Q("link", "submission.driveFolderUrl")],
};
/** §2.0 et §2.6 : les dates des formulaires du H5 (Paris), et leurs questions. */
const H5_SCHEDULE = [
  ["h5_plan", "kickoff 25/11 9:30 -> Wednesday 12:00", ["2026-11-25", "09:30"], ["2026-11-25", "12:00"], H5_FORMS.h5_plan],
  ["h5_snapshot", "kickoff -> Friday 27/11 17:00", ["2026-11-25", "09:30"], ["2026-11-27", "17:00"], H5_FORMS.h5_snapshot],
  ["h5_final", "Friday 17:00 -> Monday 30/11 9:00", ["2026-11-27", "17:00"], ["2026-11-30", "09:00"], H5_FORMS.h5_final],
  ["peer_rating", "results 30/11 9:00 -> 01/12 9:00", ["2026-11-30", "09:00"], ["2026-12-01", "09:00"], PEER_RATING],
].map(([key, label, opens, deadline, questions]) => ({ key, label, opens: P(...opens), deadline: P(...deadline), questions }));
const HACKATHON_FORMS = ["debrief", "jury", "peer_rating"];
const H5_FORM_KEYS = [...Object.keys(H5_FORMS), "jury", "peer_rating"].sort();
/** Les grilles du jury (§2.2 a §2.6) : [cle, points] ; `null` = departage (0 point), dans l'ordre des departages. */
const GRIDS = {
  1: [["potentialCustomers", 35], ["evidence", 30], ["painSentence", 15], ["agentUse", 10], ["outputQuality", 10]],
  2: [["meetingsBooked", 35], ["conversationsDone", 35], ["scriptAndLearnings", 20], ["outputQuality", 10]],
  3: [["leadsCollected", 90], ["outputQuality", 10], ["leadQuality", null]],
  4: [["amountPaid", 90], ["outputQuality", 10], ["loisSigned", null], ["closedWon", null]],
  5: [["amountPaid", 20], ["closedWon", 10], ["loisSigned", 10], ["activeUsers", 5], ["productLive", 10], ["sellableAgent", 15], ["plan", 5], ["pace", 10], ["teamwork", 5], ["outputQuality", 10]],
};
/** Une note par critere d'une grille (le premier element est la cle : GRIDS comme PITCH_GRID). */
const notes = (grid, value) => Object.fromEntries(grid.map(([k]) => [k, value]));
/** Le formulaire de jury d'une grille : une note de 0 a 5 par critere (poids = points), puis le commentaire. */
const juryQuestions = (grid) => [
  ...grid.map(([key, points]) => Q("rating", `evaluation.scores.${key}`, undefined, { scale: "0-5", ...(points !== null ? { weight: points } : {}) })),
  Q("long_text", "evaluation.comment"),
];
/** Le bareme d'un evenement : les points de chaque critere, les departages dans l'ordre. */
const scoringView = (scoring) =>
  scoring
    ? {
        points: scoring.items.filter((i) => !i.tieBreakOnly).map((i) => [i.sourceKey, i.maxPoints ?? null]),
        tieBreaks: scoring.items.filter((i) => i.tieBreakOnly).map((i) => i.sourceKey),
        tieBreakOrder: scoring.tieBreaks ?? [],
      }
    : null;
const gridScoring = (grid) => {
  const tieBreaks = grid.filter(([, p]) => p === null).map(([k]) => k);
  return { points: grid.filter(([, p]) => p !== null), tieBreaks, tieBreakOrder: tieBreaks };
};
/** §2.7 : l'energie de 1 a 10, une note de 1 a 5 par seance, le « why », plus / moins. Aucun champ. */
const retroQuestions = (sessionCount) => [
  Q("rating", null, "Your energy this week", { scale: "1-10" }),
  ...Array.from({ length: sessionCount }, () => Q("rating", null, undefined, { scale: "1-5" })),
  Q("long_text", null),
  Q("long_text", null),
];
/** §2.8 et §2.9 : les deux formulaires hebdomadaires, par modele. */
const WEEKLY_FORMS = {
  weekly_update_founder: [
    Q("long_text", "founderWeek.achieved", "What did you achieve?"),
    Q("long_text", "founderWeek.goalForWeek", "Your goal for next week"),
    Q("single_choice", "founderWeek.commitmentStatus", "Where are you at?"),
    Q("number", "founderWeek.messagesSent", "Problem validation : messages sent"),
    Q("number", "founderWeek.conversationsDone", "Problem validation : conversations with potential users"),
    Q("long_text", "founderWeek.learnings", "Problem validation : what did you learn?"),
    Q("entity_picker", "founderWeek.workingWithFounderIds", "Cofounder matching : active discussions"),
    Q("single_choice", "founderWeek.matchResult", "Cofounder matching : result"),
  ],
  weekly_update_startup: [
    Q("long_text", "checkin.achievement", "What did you achieve this week?"),
    Q("long_text", "checkin.goals", "Goals for next week"),
    ...["messagesSent", "callsMade", "conversationsDone", "meetingsBooked", "demosDone", "proposalsSent", "closedWon", "amountPaid"].map((k) => Q("number", `checkin.${k}`)),
    Q("number", "checkin.contentPublished"),
    ...["totalAmountPaid", "mrr", "payingCustomers", "totalUsers", "activeUsers"].map((k) => Q("number", `checkin.${k}`)),
    Q("long_text", "checkin.obstacle", "Biggest obstacle"),
    Q("long_text", "checkin.learned", "What did you learn?"),
    Q("long_text", "checkin.helpNeeded", "How can the staff help?"),
  ],
};
const WEEKLY_KEYS = Object.keys(WEEKLY_FORMS);
/** §2.10 */
const LOCK_MY_TEAM = [
  Q("single_choice", "teamLock.locked", "Do you lock a team?"),
  Q("entity_picker", "teamLock.coFounderIds", "Your co-founders"),
  Q("text", "teamLock.startupName", "Startup name"),
];
/** §2.11 */
const PITCH_DECK = [
  Q("link", "startupProfile.pitchDeckUrl", "Pitch deck"),
  Q("text", "startup.ideaOneLine", "One-liner"),
  Q("long_text", "startupProfile.problem", "Problem"),
  Q("long_text", "startupProfile.icp", "Customer (ICP)"),
  Q("long_text", "startupProfile.solution", "Solution"),
  Q("long_text", "startupProfile.whyNow", "Why now?"),
];
/**
 * §2.11, grille Pitch (19/11) : [cle, famille, points]. Deux familles du score startup (cles SP26 gardees) ;
 * l'execution ne se note plus au pitch (grille Weekly startup). `teamStrength` = Team dynamic.
 */
const PITCH_GRID = [
  ["founderMarketFit", "teamQuality", 30],
  ["teamStrength", "teamQuality", 30],
  ["painIntensity", "marketPotential", 20],
  ["timing", "marketPotential", 20],
];
/** §2.9, grille Weekly startup (19/11) : [cle, famille, points]. Concrete output = `progress`, Real signals = `traction`. */
const WEEKLY_STARTUP_GRID = [
  ["progress", "speedOfExecution", 25],
  ["traction", "speedOfExecution", 25],
  ["learning", "speedOfExecution", 25],
  ["intensity", "teamQuality", 25],
];
/** §3.1 : le score startup, sur les criteres de l'IC. */
const STARTUP_FAMILIES = { teamQuality: 40, speedOfExecution: 40, marketPotential: 20 };
/** §2.0 : les weekly, chaque jeudi 19:00 Paris, echeance 24 h. */
const WEEKLY_TIME = "19:00";
const PITCH_POINTS = PITCH_GRID.map(([k, , p]) => [k, p]);
const PITCH_SCORING_VIEW = gridScoring(PITCH_POINTS);
/** §2.12 */
const PROGRAM_END = [
  Q("rating", null, "Would you recommend Pioneers?", { scale: "0-10" }),
  Q("long_text", null, "One thing to keep"),
  Q("long_text", null, "One thing to change"),
];
/** §4.1 : les champs obligatoires du profil (Nom = prenom + nom), dont les 4 rendus obligatoires le 17/11. */
const REQUIRED_PROFILE_FIELDS = [
  "person.firstName",
  "person.lastName",
  "founder.coverPhotoUrl",
  "person.whatsapp",
  "person.linkedinUrl",
  "founderDirectory.introduceYourself",
  "founderDirectory.edge",
  "founder.hardSkills",
  "founder.industries",
  "founder.rolesICouldTake",
  "founderDirectory.nationality",
  "founderDirectory.education",
  "founderDirectory.notableCompanies",
  "founderDirectory.trackRecord",
  "founderDirectory.interestedInWorkingOn",
  "founderProfile.enrolmentConfirmed",
];
const NEW_REQUIRED_PROFILE_FIELDS = ["founderDirectory.hasExistingProject", "founderDirectory.hasExistingCoFounders", "founderDirectory.yearsOfXP", "founderDirectory.repeatFounder"];
/** §1 : les entrees « Weekly Update Form » de l'agenda (jeudis, 19:00 Paris), un rappel sans formulaire depuis le 19/11. */
const WEEKLY_ENTRY_TIME = WEEKLY_TIME;
/** §3.2 : les echeances des milestones de fa26 (heure de Paris). Weekly goal : 2e entree (10/12 19:00) + 24 h. */
const MILESTONE_DUES = {
  teamedUp: P("2026-11-25", "09:30"),
  weeklyGoalFrom: P("2026-12-11", WEEKLY_ENTRY_TIME),
};
/** §2.0 : l'echeance d'une Submission, 15 min avant la fin du hackathon, sauf H2 : 15:55 (valide avec le staff). */
const SUBMISSION_DEADLINE_EXCEPTIONS = { 2: P("2026-11-19", "15:55") };
const submissionDeadline = (n, e) => SUBMISSION_DEADLINE_EXCEPTIONS[n] ?? plusMinutes(e.endDateISOString, -15);

// ============================================================================================
// A. Le code
// ============================================================================================

function codeChecks() {
  const { EVENT_TEMPLATES } = m.ev;
  const { FORM_TEMPLATES, templateQuestions } = m.ft;
  const events = JSON.parse(readFileSync(new URL("../data/events.json", import.meta.url), "utf8")).events;
  const fileEvent = (key) => events.find((e) => e.key === key);
  const HACKATHON_KEYS = {
    1: "fa26-hackathon-1-pain-hunters",
    2: "fa26-hackathon-2-phone-agents",
    3: "fa26-hackathon-3-distribution-machine",
    4: "fa26-hackathon-4-agent-agency",
    5: "fa26-hackathon-5-zero-to-first-customer",
  };
  const ctxOf = (e) => {
    const o = formOptions(e);
    return { eventKind: e.kind, metrics: o.metrics ?? [], criteria: o.criteria ?? [], submissionFields: o.submissionFields, sessions: o.sessions, stage: e.stage ?? null };
  };
  const times = (e) => ({ startDateISOString: e.startDateISOString, endDateISOString: e.endDateISOString });
  const datesOf = (templateKey, e) => span(m.forms.eventFormDates(templateKey, times(e), formOptions(e).formDates[templateKey] ?? {})).map(at);
  const formsOf = (key) => [...(EVENT_TEMPLATES[key]?.forms ?? [])].sort();
  const isOffered = m.offered.isOfferedTemplate;

  // ---- A1. Les packs d'evenements (§1, §4.6) ----
  heading("A1 event packs");
  expect("hackathon pack: Submission, Peer rating, jury", HACKATHON_FORMS, formsOf("hackathon"));
  expect("hackathon draw: teams of 2 to 3", { mode: "challenge", size: { min: 2, max: 3 } }, EVENT_TEMPLATES.hackathon.matching);
  for (const key of ["pitch_day", "friday_pitch", "demo_day", "selection_day", "pre_ic", "ic"]) {
    expect(`${key} pack: Pitch deck + jury`, ["jury", "pitch_deck"], formsOf(key));
    expect19(`${key} jury grid = the Pitch grid (19/11)`, PITCH_POINTS.map(([k, p]) => [k, 0, 5, p]), () => (EVENT_TEMPLATES[key]?.criteria ?? []).map((c) => [c.key, c.min, c.max, c.weight]));
  }
  expect("Pitch stages: Go / No Go at Selection Day, Pre-IC, IC", ["selection_day", "pre_ic", "ic", null], ["selection_day", "pre_ic", "ic", "pitch_day"].map((k) => EVENT_TEMPLATES[k].stage));
  expect("speed_dating pack: no form (no picks)", [], formsOf("speed_dating"));
  const sessionPacks = Object.entries(EVENT_TEMPLATES).filter(([, t]) => t.kind === "session" && isOffered(t) && !t.forms.some((f) => WEEKLY_KEYS.includes(f)));
  expect("session packs: no form (sessions rated at the retro)", sessionPacks.map(([k]) => [k, []]), sessionPacks.map(([k, t]) => [k, t.forms]));
  expect("founder_introductions event template retired", true, EVENT_TEMPLATES.founder_introductions?.retired === true);
  const picksPacks = Object.entries(EVENT_TEMPLATES).filter(([, t]) => isOffered(t) && t.forms.some((f) => f === "picks" || f === "founder_introductions"));
  expect("no offered event pack creates Picks / Founder introductions", [], picksPacks.map(([k]) => k));
  expect("lunch roulette: tables of 3 to 4", { mode: "matching", size: { min: 3, max: 4 } }, EVENT_TEMPLATES.lunch_roulette.matching);
  expect19("no offered event pack creates the weekly forms (no event since 19/11, §2.0)", [], () =>
    Object.entries(EVENT_TEMPLATES)
      .filter(([, t]) => isOffered(t) && t.forms.some((f) => WEEKLY_KEYS.includes(f)))
      .map(([k]) => k),
  );

  // ---- A2. Les modeles de formulaires (§2) ----
  heading("A2 form templates");
  const tq = (key, ctx = { eventKind: "team_challenge", metrics: [], criteria: [] }) => templateQuestions(FORM_TEMPLATES[key], ctx);
  const identity = (key) => FORM_TEMPLATES[key]?.identityCheck;
  expectQuestions("peer_rating questions (§2.1)", PEER_RATING, tq("peer_rating"));
  for (const n of [1, 2, 3, 4]) {
    expectQuestions(`Submission H${n} questions (§2.${n + 1}, events.json)`, SUBMISSIONS[n], tq("debrief", ctxOf(fileEvent(HACKATHON_KEYS[n]))));
  }
  const h5 = fileEvent(HACKATHON_KEYS[5]);
  for (const key of Object.keys(H5_FORMS)) expectQuestions(`${key} questions (§2.6)`, H5_FORMS[key], tq(key, ctxOf(h5)));
  expect("H5: only Final numbers marks the Submission late (setsSubmissionLate)", { h5_plan: false, h5_snapshot: false, h5_final: true, debrief: true }, Object.fromEntries(["h5_plan", "h5_snapshot", "h5_final", "debrief"].map((k) => [k, FORM_TEMPLATES[k].setsSubmissionLate])));
  const retro = fileEvent("fa26-week-1-retro");
  expectQuestions("week_retro questions (§2.7)", retroQuestions(retro.sessions.length), tq("week_retro", ctxOf(retro)));
  expectQuestions("weekly_update_founder questions (§2.8)", WEEKLY_FORMS.weekly_update_founder, tq("weekly_update_founder"));
  if (MODEL_19_11) expectQuestions("weekly_update_startup questions, Content published included (§2.9)", WEEKLY_FORMS.weekly_update_startup, tq("weekly_update_startup"));
  else pending("weekly_update_startup questions, Content published included (§2.9)", NOT_CODED);
  expect19("weekly forms: batch forms, not tied to an event (§2.0)", WEEKLY_KEYS.map((k) => [k, false]), () => WEEKLY_KEYS.map((k) => [k, FORM_TEMPLATES[k].needsEvent]));
  const options = (key, id) => tq(key, { eventKind: "team_challenge", metrics: [], criteria: [], submissionFields: ["problemSource"] }).find((q) => q.id === id)?.options ?? [];
  const { COMMITMENT_STATUS_LABELS, MATCH_RESULT_LABELS, PROBLEM_SOURCE_LABELS } = m.types;
  expect(
    "Where are you at? options (§2.8)",
    ["Committed to a startup", "On a project, not committed", "Testing relationships", "What am I doing here?"],
    options("weekly_update_founder", "commitmentStatus").map((o) => COMMITMENT_STATUS_LABELS[o]),
  );
  expect("Cofounder matching result options (§2.8)", ["match", "no match", "still looking"], options("weekly_update_founder", "matchResult").map((o) => MATCH_RESULT_LABELS[o].toLowerCase()));
  expect("Problem options: pain library / own idea (§2.3)", [true, true], options("debrief", "problemSource").map((o, i) => [/pain library/i, /own idea/i][i]?.test(PROBLEM_SOURCE_LABELS[o]) ?? false));
  expectQuestions("lock_my_team questions (§2.10)", LOCK_MY_TEAM, tq("lock_my_team"));
  const [locked, coFounders] = tq("lock_my_team");
  expect("Lock my team: yes / no, answerable without a team", [["Yes", "No"], true, false], [locked.options, locked.required, coFounders.required]);
  expect("Lock my team: batch form, not tied to an event (§2.10)", false, FORM_TEMPLATES.lock_my_team.needsEvent);
  expectQuestions("pitch_deck questions (§2.11)", PITCH_DECK, tq("pitch_deck"));
  expect19("pitch_deck: help under Problem asks how often and how urgent (§2.11)", true, () => {
    const help = tq("pitch_deck").find((q) => q.dbField === "startupProfile.problem")?.description ?? "";
    return /how often/i.test(help) && /how urgent/i.test(help);
  });
  expectQuestions("program_end questions (§2.12)", PROGRAM_END, tq("program_end"));
  const docForms = ["peer_rating", "debrief", "h5_plan", "h5_snapshot", "h5_final", "week_retro", ...WEEKLY_KEYS, "lock_my_team", "pitch_deck", "program_end"];
  expect("§2 founder forms: filled from one's account", docForms.map((k) => [k, "account"]), docForms.map((k) => [k, identity(k)]));
  expect("jury: shared link (outside jurors without account, §4.3)", "jury_link", identity("jury"));
  const pitchJury = (stage) => tq("jury", { eventKind: "pitch", metrics: [], criteria: m.pitch.PITCH_RUBRIC, stage });
  const verdictIds = (stage) => pitchJury(stage).map((q) => q.id).filter((id) => !id.startsWith("criterion_"));
  expect("Pitch jury, Selection Day: Overall, Decision, Would you invest?, How likely, comment", ["overall", "decision", "wouldInvest", "betLikelihood", "comment"], verdictIds("selection_day"));
  expect("Pitch jury, IC: Overall, Decision, comment (no 'before the IC' questions)", ["overall", "decision", "comment"], verdictIds("ic"));
  expect("Pitch jury, Pitch day: no Decision", false, verdictIds(null).includes("decision"));
  expect(
    "Pitch jury: Overall and How likely from 0 to 5",
    ["0-5", "0-5"],
    pitchJury("selection_day")
      .filter((q) => q.id === "overall" || q.id === "betLikelihood")
      .map((q) => `${q.scale?.min}-${q.scale?.max}`),
  );

  // ---- A3. Retraits (§4.6) et regles communes (§2.0) ----
  heading("A3 retired + common form rules");
  for (const key of ["picks", "founder_introductions"]) expect(`form template ${key} retired`, true, FORM_TEMPLATES[key]?.retired === true);
  const offeredForms = Object.entries(FORM_TEMPLATES).filter(([, t]) => isOffered(t));
  const docAndJury = [...docForms, "jury"];
  expect("doc §2 forms are all offered", docAndJury.map((k) => [k, true]), docAndJury.map((k) => [k, Boolean(FORM_TEMPLATES[k]) && isOffered(FORM_TEMPLATES[k])]));
  expect("no offered template is anonymous (retro identity retired)", [], offeredForms.filter(([, t]) => m.offered.RETIRED_IDENTITY_CHECKS.has(t.identityCheck)).map(([k]) => k));
  expect(
    "no offered template writes picks",
    [],
    offeredForms.filter(([k, t]) => t.kind === "picks" || tq(k).some((q) => q.dbField === "picks.pickedFounderIds")).map(([k]) => k),
  );
  expect(
    "offered founder templates: always from one's account (§2.0, SPECS 2.8)",
    [],
    offeredForms.filter(([, t]) => t.identityCheck !== "account" && t.identityCheck !== "jury_link").map(([k, t]) => `${k}:${t.identityCheck}`),
  );
  const ev = { startDateISOString: "2026-11-18T09:00:00.000Z", endDateISOString: "2026-11-18T10:00:00.000Z" };
  behaves("default form: opens 15 min before the end, due 24 h after", () => [["2026-11-18T09:45:00.000Z", "2026-11-19T09:45:00.000Z"], span(m.forms.eventFormDates(null, ev))]);
  behaves("pitch_deck: opens 48 h before the pitch, due 24 h before", () => {
    const pitch = { startDateISOString: P("2026-12-04", "09:00"), endDateISOString: P("2026-12-04", "11:30") };
    return [[P("2026-12-02", "09:00"), P("2026-12-03", "09:00")], span(m.forms.eventFormDates("pitch_deck", pitch))];
  });
  behaves("jury: opens at the start, no deadline (locked by closing)", () => [[ev.startDateISOString, null], span(m.forms.eventFormDates("jury", ev))]);
  // Contrat du rythme (19/11) : `weeklyForms.weeklyFormSlots({ firstDayString, untilDayString, skippedDayStrings })`
  // rend une semaine par jeudi, `{ opensDateISOString, deadlineDateISOString }`.
  behaves19("weekly forms: every Thursday 19:00 Paris -> 24 h, skipped weeks left out (§2.0)", () => {
    const slots = m.weeklyForms.weeklyFormSlots({ firstDayString: "2026-12-03", untilDayString: "2026-12-24", skippedDayStrings: ["2026-12-17"] });
    const week = (day, next) => [P(day, WEEKLY_TIME), P(next, WEEKLY_TIME)];
    return [[week("2026-12-03", "2026-12-04"), week("2026-12-10", "2026-12-11"), week("2026-12-24", "2026-12-25")], slots.map(span)];
  });
  behaves19("weekly audience: founder form to founders without a startup, startup form to founders of one (§2.0)", () => {
    const founders = [
      { id: "solo", startupId: null },
      { id: "member", startupId: "s1" },
    ].map((f) => ({ ...f, batchId: BATCH_ID, status: "active", archivedDateISOString: null, isExternalFounder: false }));
    const of = (key) =>
      m.formRules.formAudience({ form: { identityCheck: "account", kind: FORM_TEMPLATES[key].kind, questions: tq(key) }, batchId: BATCH_ID, founders, event: null, attendance: [], teams: [] }).founderIds;
    return [[["solo"], ["member"]], [of("weekly_update_founder"), of("weekly_update_startup")]];
  });

  // ---- A4. Les dates des formulaires de fa26 dans data/events.json (§2.0) ----
  heading("A4 events.json form dates");
  for (const n of [1, 2, 3, 4]) {
    const e = fileEvent(HACKATHON_KEYS[n]);
    expect(`H${n} Submission: start -> ${SUBMISSION_DEADLINE_EXCEPTIONS[n] ? "15:55 (exception)" : "15 min before the end"}`, [at(e.startDateISOString), at(submissionDeadline(n, e))], datesOf("debrief", e));
    const debrief = debriefAfter(events, e);
    if (!debrief) report("FAIL", `H${n} Peer rating`, "no debrief right after the hackathon in events.json");
    else expect(`H${n} Peer rating: debrief start -> 24 h after`, [at(debrief.startDateISOString), at(plusHours(debrief.startDateISOString, 24))], datesOf("peer_rating", e));
    expect(`H${n} forms`, HACKATHON_FORMS, [...formOptions(e).forms].sort());
  }
  expect("H5 forms: Plan, Snapshot, Final numbers, Peer rating, jury (no Submission)", H5_FORM_KEYS, [...formOptions(h5).forms].sort());
  for (const s of H5_SCHEDULE) expect(`H5 ${s.key}: ${s.label}`, [at(s.opens), at(s.deadline)], datesOf(s.key, h5));
  expect("Week retro: retro start -> 24 h after", [at(retro.startDateISOString), at(plusHours(retro.startDateISOString, 24))], datesOf("week_retro", retro));
  behaves("Peer rating added to a hackathon opens at its debrief (addedFormDates)", () => {
    const e = { id: "h1", ...times(fileEvent(HACKATHON_KEYS[1])) };
    const d = debriefAfter(events, fileEvent(HACKATHON_KEYS[1]));
    return [[d.startDateISOString, plusHours(d.startDateISOString, 24)], span(m.forms.addedFormDates("peer_rating", e, [e, { id: "d", ...times(d) }]))];
  });

  // ---- A5. Les grilles du jury (§2.2 a §2.6, data/events.json) ----
  heading("A5 hackathon jury grids");
  for (const n of [1, 2, 3, 4, 5]) {
    const e = fileEvent(HACKATHON_KEYS[n]);
    expect(`H${n} criteria 0-5`, GRIDS[n].map(([k]) => [k, 0, 5]), (e.criteria ?? []).map((c) => [c.key, c.min, c.max]));
    expect(`H${n} points (scoring)`, gridScoring(GRIDS[n]), scoringView(e.scoring));
    expectQuestions(`H${n} jury form questions (weights = points)`, juryQuestions(GRIDS[n]), tq("jury", ctxOf(e)));
  }
  expect("H5 counts 4 times in Execution (events.json hackathonWeight)", [4, 1], [m.scoring.hackathonWeightOf(h5), m.scoring.hackathonWeightOf(fileEvent(HACKATHON_KEYS[1]))]);
  expect("H5 draw: Lock my team startups kept as teams (§4.2)", true, h5.matching?.lockedTeamsFromStartups === true);
  const h1 = fileEvent(HACKATHON_KEYS[1]);
  const team = (id, juryMeans, extra = {}) => ({ id, metrics: {}, juryMeans, zeroedItemKeys: [], outstanding: false, ...extra });
  const scoreH1 = (...teams) => m.rules.scoreTeams(h1.scoring, h1.criteria, teams);
  behaves("grid: 4/5 on a 30-point criterion gives 24 (§2.0)", () => [24, scoreH1(team("a", { evidence: 4 }))[0].points.evidence]);
  behaves("grid: absolute note, not brought back to the best team", () => [50, scoreH1(team("a", notes(GRIDS[1], 2.5)))[0].normalized]);
  behaves("Outstanding: +20 at 100 only -> 120", () => {
    const [top, below] = scoreH1(team("a", notes(GRIDS[1], 5), { outstanding: true }), team("b", { ...notes(GRIDS[1], 5), evidence: 4.9 }, { outstanding: true }));
    return [[120, false], [top.normalized, below.outstanding]];
  });
  expect("Outstanding bonus constant", 20, m.rules.OUTSTANDING_BONUS_POINTS);
  behaves("several jurors: mean criterion by criterion", () => [{ evidence: 3 }, m.rules.juryMeansOf([{ scores: { evidence: 4 } }, { scores: { evidence: 2 } }], ["evidence"])]);
  behaves("late Submission counts (0 rule removed 18/11)", () => [scoreH1(team("a", notes(GRIDS[1], 5)))[0].total, scoreH1(m.rules.scoredTeamOf("a", { metrics: {}, late: true, zeroedItemKeys: [] }, [{ scores: notes(GRIDS[1], 5) }], Object.keys(notes(GRIDS[1], 5))))[0].total]);
  behaves("tie-break criterion gives 0 point but breaks ties (H4)", () => {
    const e = fileEvent(HACKATHON_KEYS[4]);
    const [a, b] = m.rules.scoreTeams(e.scoring, e.criteria, [team("a", { ...notes(GRIDS[4], 5), closedWon: 0 }), team("b", { ...notes(GRIDS[4], 5), loisSigned: 3 })]);
    return [[100, 100, true], [a.total, b.total, m.rules.compareTeamPoints(e.scoring, a, b) < 0]];
  });

  // ---- A6. La grille Pitch (§2.11) ----
  heading("A6 pitch grid");
  expect19("4 criteria of the IC: key, family, points", PITCH_GRID, () => m.pitch.PITCH_CRITERIA.map((c) => [c.key, c.family, c.points]));
  expect19("grid points: Team Quality 60 / Market Potential 40 (no execution at the pitch)", { teamQuality: 60, marketPotential: 40 }, () =>
    m.pitch.PITCH_CRITERIA.reduce((acc, c) => ({ ...acc, [c.family]: (acc[c.family] ?? 0) + c.points }), {}),
  );
  expect19("Pitch scoring points", PITCH_SCORING_VIEW, () => scoringView(m.pitch.PITCH_SCORING));
  behaves19("Pitch: Outstanding at 100 -> 120, on the grid and each family", () => {
    const g = m.pitch.pitchGrid(notes(PITCH_GRID, 5), true);
    return [[120, 120, 120], [g.total, g.families.teamQuality, g.families.marketPotential]];
  });

  // ---- A7. Background, Weekly grids (§2.8, §2.9, §2.13) ----
  heading("A7 Background + weekly grids");
  expect("Background grid 40 / 25 / 20 / 15", [["execution", 40], ["founderSignal", 25], ["pedigree", 20], ["geography", 15]], m.bg.BACKGROUND_CRITERIA.map((c) => [c.key, c.points]));
  behaves("Background: Outstanding at 100 only", () => {
    const five = { execution: 5, founderSignal: 5, pedigree: 5, geography: 5 };
    return [[120, 92], [m.bg.backgroundScore(five, true), m.bg.backgroundScore({ ...five, execution: 4 }, true)]];
  });
  expect19("Weekly startup grid: Concrete output, Real signals, Learning velocity, Intensity, 25 each, two families", WEEKLY_STARTUP_GRID, () =>
    m.weekly.STARTUP_REVIEW_CRITERIA.map((c) => [c.key, c.family, c.points]),
  );
  behaves19("Weekly startup: Outstanding at 100 -> 120", () => {
    const five = notes(WEEKLY_STARTUP_GRID, 5);
    return [[120, 95], [m.weekly.startupReviewNote({ scores: five, outstanding: true }), m.weekly.startupReviewNote({ scores: { ...five, intensity: 4 }, outstanding: true })]];
  });
  expect("Weekly founder grid: 3 yes / no, no Outstanding", ["goalAmbitious", "goalReached", "problemValidated"], m.weekly.FOUNDER_REVIEW_QUESTIONS.map((q) => q.key));
  const twoWeeks = (ambitious) => [
    { weekStartDayString: "2026-11-30", goalAmbitious: ambitious, goalReached: null },
    { weekStartDayString: "2026-12-07", goalAmbitious: null, goalReached: true },
  ];
  behaves("Weekly goal: a week is 100 if last week's goal was ambitious AND reached", () => [[100, 0], [m.weekly.weeklyGoalScore(twoWeeks(true)), m.weekly.weeklyGoalScore(twoWeeks(false))]]);
  behaves("Problem validated: once reached, stays reached", () => [true, m.weekly.problemValidatedOf([{ problemValidated: true }, { problemValidated: false }])]);

  // ---- A8. Les scores (§3.1, §3.3) ----
  heading("A8 scores");
  const S = m.scoring;
  const inputs = (extra = {}) => ({
    nowISOString: "2026-11-20T12:00:00.000Z",
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
  const founder = (extra) => S.computeFounderScore(inputs(extra));
  /** Le poids de chaque signal, en % de son sous-score. */
  const shares = (signals = []) => signals.map((s) => roundTo((s.weight / sum(signals.map((x) => x.weight))) * 100, 1));
  behaves("peer rating on 100: (n - 1) x 25", () => [[0, 50, 100], [1, 3, 5].map(S.peerRatingOn100)]);
  expect("Program Performance: 6 sub-scores", ["engagement", "execution", "likability", "edge", "commitment", "background"], [...m.score.SCALE_RULES[100].pillars]);
  expect(
    "Program Performance weights: Engagement 10 / Execution 50 / Likability 30 / Edge 10 / Commitment 0 / Background 0",
    { engagement: 10, execution: 50, likability: 30, edge: 10, commitment: 0, background: 0 },
    m.score.SCALE_RULES[100].pillarWeights,
  );
  behaves("Program Performance: weighted mean (Commitment and Background not counted)", () => [
    [10, 50, 30, 10],
    ["engagement", "execution", "likability", "edge"].map((k) =>
      m.score.programPerformance({ scale: 100, subScores: { engagement: 0, execution: 0, likability: 0, edge: 0, commitment: 100, background: 100, [k]: 100 } }),
    ),
  ]);
  const full = founder({
    attendance: { attended: 1, total: 1 },
    formsOnTime: { onTime: 1, expected: 1 },
    hackathons: [{ name: "H1", score: 80, weight: 1 }],
    peerReliability: [4],
    milestones: [{ key: "met", dueDateISOString: "2026-11-01T00:00:00.000Z", achieved: true }],
    shortlisters: 1,
    batchSize: 2,
    peerLikability: [4],
    edge: { score: 4, ratedText: "x", ratedByUid: "staff", ratedDateISOString: "2026-11-18T12:00:00.000Z" },
    hasExistingProject: true,
    hasExistingCoFounders: "none",
    background: { scores: { execution: 5, founderSignal: 5, pedigree: 5, geography: 5 }, outstanding: false },
  });
  expect("Engagement: attendance 50 / forms on time 30 / profile 20", [50, 30, 20], shares(full.signals.engagement));
  expect("Execution: hackathons, peer ratings, milestones 1/3 each", [33.3, 33.3, 33.3], shares(full.signals.execution));
  expect("Likability: shortlists 50 / peer feeling 50", [50, 50], shares(full.signals.likability));
  expect("Edge: the staff rating, 100 %, 0-5 on 100", [[100], 80], [shares(full.signals.edge), full.subScores.edge]);
  expect("Commitment: existing project 50 / co-founders 50", [50, 50], shares(full.signals.commitment));
  expect("Background sub-score: the Background note, 100 %", [[100], 100], [shares(full.signals.background), full.subScores.background]);
  behaves("Existing co-founders: in batch 100, outside 50, none 0", () => [[100, 50, 0], ["in_batch", "outside_batch", "none"].map((v) => founder({ hasExistingCoFounders: v }).subScores.commitment)]);
  behaves("Existing project: 100 or 0", () => [[100, 0], [true, false].map((v) => founder({ hasExistingProject: v }).subScores.commitment)]);
  behaves("Likability: shortlisters out of half the batch, capped at 100", () => [[50, 100, 100], [8, 16, 20].map((n) => founder({ shortlisters: n, batchSize: 32 }).subScores.likability)]);
  behaves("Likability: peer feeling (n - 1) x 25, mean", () => [75, founder({ peerLikability: [5, 3] }).subScores.likability]);
  behaves("Likability: a shortlister counts once, never oneself; a peer 5 is not a shortlist", () => {
    const out = S.shortlistersOf(new Map([["b", new Set(["a"])], ["a", new Set(["a"])], ["c", new Set(["a"])]]));
    return [["b", "c"], [...(out.get("a") ?? [])].sort()];
  });
  behaves("Hackathons: H5 counts 4 times", () => [64, founder({ hackathons: [{ name: "H1", score: 80, weight: 1 }, { name: "H5", score: 60, weight: 4 }] }).subScores.execution]);
  behaves("no data, no weight: Execution null without data", () => [null, founder({}).subScores.execution]);
  behaves("Commitment without Clear idea (removed 18/11)", () => [[null, false], [founder({}).subScores.commitment, "clearIdea" in m.pitch.pitchMeans([])]]);
  expect19("startup score: Team Quality 40 / Speed of Execution 40 / Market Potential 20 (§3.1)", STARTUP_FAMILIES, () =>
    Object.fromEntries(m.score.STARTUP_WEIGHTING_100.map((c) => [c.parts.join("+"), c.weight])),
  );
  // Contrat des entrees (19/11) : PP de chaque fondateur, weekly notees (semaine, notes, Outstanding), pitchs dates.
  const weekly = (weekStartDayString, note) => ({ weekStartDayString, scores: notes(WEEKLY_STARTUP_GRID, note), outstanding: false });
  const pitch = (name, dateISOString, note) => ({ name, dateISOString, grid: m.pitch.pitchGrid(notes(PITCH_GRID, note), false) });
  const startupOf = (extra) => S.computeStartupScore({ founderBackgrounds: [], founderPerformances: [], weeklyReviews: [], pitches: [], ...extra });
  const FAMILIES = Object.keys(STARTUP_FAMILIES);
  behaves19("startup signals: Team Quality 25 x 4 (+ Background at 0), Speed of Execution 1/3 x 3, Market Potential 50/50", () => {
    const s = startupOf({ founderBackgrounds: [80], founderPerformances: [60], weeklyReviews: [weekly("2026-12-07", 4)], pitches: [pitch("P1", "2026-12-04T09:00:00.000Z", 4)] });
    return [{ teamQuality: [25, 25, 25, 25, 0], speedOfExecution: [33.3, 33.3, 33.3], marketPotential: [50, 50] }, Object.fromEntries(FAMILIES.map((k) => [k, shares(s.signals[k])]))];
  });
  behaves19("startup: the last pitch only, not the mean of the pitches", () => {
    const s = startupOf({ pitches: [pitch("P2", "2026-12-17T09:00:00.000Z", 4), pitch("P1", "2026-12-04T09:00:00.000Z", 2)] });
    return [[80, 80], [s.subScores.teamQuality, s.subScores.marketPotential]];
  });
  behaves19("startup: Speed of Execution = mean of its 4 last graded weeklies", () => {
    const weeks = [["2026-11-30", 1], ["2026-12-07", 5], ["2026-12-14", 5], ["2026-12-28", 5], ["2027-01-04", 5]];
    return [100, startupOf({ weeklyReviews: weeks.map(([d, n]) => weekly(d, n)) }).subScores.speedOfExecution];
  });
  behaves19("startup: Program Performance of its founders, their mean, in Team Quality", () => [70, startupOf({ founderPerformances: [60, 80] }).subScores.teamQuality]);
  behaves("forms on time: never optional events, drafts, future deadlines (§4.1)", () => {
    const f = { archivedDateISOString: null, status: "open", deadlineDateISOString: "2026-11-19T18:00:00.000Z" };
    const now = "2026-11-20T12:00:00.000Z";
    return [
      [true, false, false, false],
      [S.countsInFormsOnTime(f, null, now), S.countsInFormsOnTime(f, { attendanceOptional: true }, now), S.countsInFormsOnTime({ ...f, status: "draft" }, null, now), S.countsInFormsOnTime({ ...f, deadlineDateISOString: "2026-11-21T00:00:00.000Z" }, null, now)],
    ];
  });
  expect("attendance mandatory by default (§1)", false, m.attendance.isAttendanceOptional({}));
  // Source lue telle quelle : le planning n'est exporte par aucun module partage.
  const index = readFileSync(new URL("../functions/src/index.ts", import.meta.url), "utf8");
  expect("scores recomputed nightly at 2:00 Paris (§4.1)", true, /nightlyScores\s*=\s*onSchedule\(\{\s*schedule:\s*"0 2 \* \* \*",\s*timeZone:\s*"Europe\/Paris"/.test(index));

  // ---- A9. Les milestones (§3.2) ----
  heading("A9 milestones");
  expect("milestones list", ["met", "problem_validated", "shortlist_done", "teamed_up", "weekly_goal"], [...S.MILESTONES].sort());
  behaves("due dates come from batch.settings.scoreMilestoneDueDates, one field per milestone", () => {
    const fields = { weeklyGoalFrom: "weekly_goal", teamedUp: "teamed_up", problemValidated: "problem_validated", shortlistDone: "shortlist_done", met: "met" };
    const facts = { shortlistedCount: 0, reciprocalMetCount: 0, batchSize: 33, startupFounderCount: 0, problemValidated: null, weeklyGoal: null };
    return [Object.values(fields), Object.keys(fields).map((f) => S.founderMilestones({ [f]: "2026-12-01T00:00:00.000Z" }, facts).map((x) => x.key).join(","))];
  });
  behaves("Shortlist done >= 3, Met >= 50 % reciprocal, Teamed up = startup with a co-founder", () => {
    const due = { shortlistDone: "2026-11-01T00:00:00.000Z", met: "2026-11-01T00:00:00.000Z", teamedUp: "2026-11-01T00:00:00.000Z" };
    const of = (facts) => Object.fromEntries(S.founderMilestones(due, { batchSize: 33, problemValidated: null, weeklyGoal: null, ...facts }).map((x) => [x.key, x.achieved]));
    return [
      [{ teamed_up: true, shortlist_done: true, met: true }, { teamed_up: false, shortlist_done: false, met: false }],
      [of({ shortlistedCount: 3, reciprocalMetCount: 16, startupFounderCount: 2 }), of({ shortlistedCount: 2, reciprocalMetCount: 15, startupFounderCount: 1 })],
    ];
  });
  behaves("Met counts reciprocal marks only", () => [1, S.reciprocalMetCount("a", new Map([["a", new Set(["b", "c"])], ["b", new Set(["a"])], ["c", new Set()]]))]);
  behaves("milestones count once due, equal weight", () => {
    const ms = [
      { key: "met", dueDateISOString: "2026-11-01T00:00:00.000Z", achieved: true },
      { key: "shortlist_done", dueDateISOString: "2026-11-01T00:00:00.000Z", achieved: false },
      { key: "teamed_up", dueDateISOString: "2026-12-01T00:00:00.000Z", achieved: false },
    ];
    return [50, founder({ milestones: ms }).subScores.execution];
  });
  if (typeof m.weeklyForms.weeklyGoalFromOf !== "function") pending("Weekly goal due = deadline of the 2nd Weekly Update Form (11/12 19:00)", "weeklyGoalFromOf not in functions/lib yet");
  else
    behaves("Weekly goal due = deadline of the 2nd Weekly Update Form (11/12 19:00)", () => {
      const entry = (day) => ({ name: "Weekly Update Form", templateKey: null, archivedDateISOString: null, startDateISOString: P(day, WEEKLY_ENTRY_TIME), endDateISOString: plusMinutes(P(day, WEEKLY_ENTRY_TIME), 30) });
      return [MILESTONE_DUES.weeklyGoalFrom, m.weeklyForms.weeklyGoalFromOf([entry("2026-12-10"), entry("2026-12-03")])];
    });

  // ---- A10. Profil, leaderboard, tirages (§4.1, §4.2, §4.5) ----
  heading("A10 profile, leaderboard, draws");
  // Les champs que le produit dit manquants sur un profil vide : la regle du To do et de « Profile incomplete ».
  const requiredOnce = m.fields
    .listMissingFields({ owner: "founder", docs: {}, weeks: [], events: [] })
    .filter((f) => f.priority === "required" && f.weekStartDayString === null && f.eventId === null)
    .map((f) => f.dbField)
    .sort();
  expect("the 4 fields made required on 17/11", NEW_REQUIRED_PROFILE_FIELDS.map((k) => [k, true]), NEW_REQUIRED_PROFILE_FIELDS.map((k) => [k, requiredOnce.includes(k)]));
  expect("required profile fields = doc §4.1 list", [...REQUIRED_PROFILE_FIELDS, ...NEW_REQUIRED_PROFILE_FIELDS].sort(), requiredOnce);
  // Constante du front, lue dans sa source : aucun module partage ne l'exporte.
  const leaderboard = readFileSync(new URL("../src/app/(app)/programs/[programId]/batches/[batchId]/leaderboard/page.tsx", import.meta.url), "utf8");
  expect("founders see the top 3 of each hackathon (front PUBLIC_TOP)", "3", leaderboard.match(/const PUBLIC_TOP = (\d+)/)?.[1] ?? null);
  const { challenge, matching } = m.gen.GENERATOR_PRESETS;
  const strictlyOrdered = (ws) => ws.every((w, i) => i === 0 || ws[i - 1] > w) && ws.at(-1) > 0;
  const ch = ["challengeRepeatWeight", "noTechPenalty", "mutualShortlistBonus", "oneWayShortlistBonus", "matchingRepeatWeight"];
  expect("hackathon draw order: repeat pair > tech > mutual shortlist > one-way > lunch pair", true, strictlyOrdered(ch.map((k) => challenge.rules[k])));
  expect(
    "hackathon draw rule 5: lunch pairs AND teams without a business profile, below rule 4",
    [true, true],
    [challenge.rules.noBusinessPenalty > 0, challenge.rules.noBusinessPenalty < challenge.rules.oneWayShortlistBonus],
  );
  const mt = ["matchingRepeatWeight", "reciprocalMetWeight", "challengeRepeatWeight"];
  expect("lunch draw order: repeat table pair > reciprocal Met > hackathon teammates", true, strictlyOrdered(mt.map((k) => matching.rules[k])));
  expect("lunch draw: no other rule", [0, 0, 0, 0], ["noTechPenalty", "noBusinessPenalty", "mutualShortlistBonus", "oneWayShortlistBonus"].map((k) => matching.rules[k]));
  const leftFounder = { batchId: BATCH_ID, status: "left", archivedDateISOString: null, isExternalFounder: false };
  behaves("out founder (Left the program): no draw, no form (§4.9)", () => [[false, false], [m.types.isPickable(leftFounder, BATCH_ID), m.types.isBatchParticipant(leftFounder, BATCH_ID)]]);
  // Sources lues telles quelles : un type et une constante du front, qu'aucun module ne rend a l'execution.
  const founderTypes = readFileSync(new URL("../functions/src/shared/types/founder.ts", import.meta.url), "utf8");
  expect19("out reason No team (§4.9)", true, () => /LeftProgramReason\s*=[^;]*"no_team"/.test(founderTypes));
  const card = readFileSync(new URL("../src/components/founder/FounderCard.tsx", import.meta.url), "utf8");
  expect19("out founder card: « Community » (§4.9)", "Community", () => card.match(/\bleft: "([^"]+)"/)?.[1] ?? null);
  behaves("H5: locked startups kept as they are, the others drawn", () => {
    const r = m.gen.startupFixedGroups([{ id: "s1", name: "S1", memberIds: ["a", "b"] }, { id: "s2", name: "S2", memberIds: ["c"] }], new Set(["a", "b", "c", "d"]));
    return [[["a", "b"]], r.groups.map((g) => g.memberIds)];
  });
}

// ============================================================================================
// B. La prod (lecture seule)
// ============================================================================================

async function prodChecks() {
  heading("B0 prod access");
  let db;
  try {
    const { initializeApp, applicationDefault } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    initializeApp({ projectId: "pioneers-3627c", credential: applicationDefault() });
    db = getFirestore();
  } catch (e) {
    return report("FAIL", "firebase-admin with Application Default Credentials", firstLine(e));
  }
  const { COL, docPaths } = m.col;
  // Lecture seule : uniquement des get() et getAll(), en parallele.
  const byBatch = (col) => db.collection(col).where("batchId", "==", BATCH_ID).get();
  const [batchSnap, eventsSnap, formsSnap, scoresSnap] = await Promise.all([db.doc(docPaths.batch(BATCH_ID)).get(), byBatch(COL.events), byBatch(COL.forms), byBatch(COL.scores)]);
  if (!batchSnap.exists) return report("FAIL", `batch ${BATCH_ID}`, "not found");
  report("OK", `read ${BATCH_ID} (read-only)`);
  const batch = batchSnap.data();
  const live = (x) => !x.archivedDateISOString;
  const events = eventsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(live)
    .sort((a, b) => (a.startDateISOString ?? "").localeCompare(b.startDateISOString ?? ""));
  const future = events.filter((e) => m.events.isUpcomingEvent(e, NOW));
  const activeForms = formsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(live);
  // Les questions publiees de chaque formulaire (sa version figee), en un seul aller-retour.
  const published = activeForms.filter((f) => f.publishedVersion);
  const versionSnaps = published.length ? await db.getAll(...published.map((f) => db.doc(docPaths.formVersion(f.id, f.publishedVersion)))) : [];
  const versions = new Map(published.map((f, i) => [f.id, versionSnaps[i].get("questions")]));
  const questionsOf = (f) => versions.get(f.id) ?? f.questions ?? [];
  /** Le modele d'un formulaire d'evenement : son id `<evenement>-<modele>` (shared/eventForms.ts). */
  const templateOf = (f) => (f.eventId && f.id.startsWith(`${f.eventId}-`) ? f.id.slice(f.eventId.length + 1) : null);
  const formsOfEvent = (e) => activeForms.filter((f) => f.eventId === e.id);
  const find = (re) => events.find((e) => re.test(e.name ?? ""));
  const dates = (f) => span(f).map(at);
  const weightOf = m.scoring.hackathonWeightOf;
  const isWeeklyEntry = m.weeklyForms.isWeeklyUpdateEvent ?? ((e) => /^weekly update form$/i.test((e.name ?? "").trim()));

  /** Un formulaire d'evenement attendu : present, publie, identite, dates, questions. */
  function checkForm(label, e, templateKey, { identity, opens, deadline, questions }) {
    const f = formsOfEvent(e).find((x) => templateOf(x) === templateKey);
    if (!f) return report("FAIL", `${label}: ${templateKey} form`, `present vs absent`);
    expect(`${label}: ${templateKey} published, ${identity}`, ["open", identity], [f.status, f.identityCheck]);
    expect(`${label}: ${templateKey} dates (Paris)`, [at(opens), at(deadline)], dates(f));
    if (questions) expectQuestions(`${label}: ${templateKey} questions`, questions, questionsOf(f));
  }

  // ---- B1. Les hackathons (§2.0 a §2.6) ----
  heading("B1 hackathons");
  const HACKATHON_DAYS = { 1: "2026-11-18", 2: "2026-11-19", 3: "2026-11-20", 4: "2026-11-23", 5: "2026-11-25" };
  const h4Debrief = find(/^Hackathon 4 Debrief/);
  const h5Kickoff = find(/^Hackathon 5 Kickoff/);
  let h5 = null;
  for (const n of [1, 2, 3, 4, 5]) {
    const e = events.find((x) => x.templateKey === "hackathon" && new RegExp(`^Hackathon ${n}\\b`).test(x.name));
    const label = `H${n}`;
    if (!e) {
      report("FAIL", `${label} event`, "present vs absent");
      continue;
    }
    if (n === 5) h5 = e;
    if (!m.events.isUpcomingEvent(e, NOW)) {
      pending(`${label}`, `past (${at(e.endDateISOString)}): not re-checked`);
      continue;
    }
    expect(`${label} day (§1)`, HACKATHON_DAYS[n], parisDayOf(e.startDateISOString));
    expect(`${label} points (scoring)`, gridScoring(GRIDS[n]), scoringView(m.types.scoringOf(e)));
    expect(`${label} weight in Execution`, n === 5 ? 4 : 1, weightOf(e));
    // Doc §1 : H1 tire en equipes de 3 a 4 par le staff (17/11, 9 equipes) ; les autres en 2 a 3.
    const size = n === 1 ? { min: 3, max: 4 } : { min: 2, max: 3 };
    expect(`${label} draw: teams of ${size.min} to ${size.max}${n === 5 ? ", Lock my team startups kept" : ""}`, { mode: "challenge", size, ...(n === 5 ? { lockedTeamsFromStartups: true } : {}) }, m.events.matchingOf(e));
    expect(`${label} active forms`, n === 5 ? H5_FORM_KEYS : HACKATHON_FORMS, formsOfEvent(e).map(templateOf).sort());
    checkForm(label, e, "jury", { identity: "jury_link", opens: e.startDateISOString, deadline: null, questions: juryQuestions(GRIDS[n]) });
    if (n < 5) {
      checkForm(label, e, "debrief", { identity: "account", opens: e.startDateISOString, deadline: submissionDeadline(n, e), questions: SUBMISSIONS[n] });
      const debrief = debriefAfter(events, e);
      if (!debrief) report("FAIL", `${label}: debrief right after the hackathon`, "present vs absent");
      else checkForm(label, e, "peer_rating", { identity: "account", opens: debrief.startDateISOString, deadline: plusHours(debrief.startDateISOString, 24), questions: PEER_RATING });
    } else {
      expect("H5 kickoff 25/11 9:30 (§2.0)", "2026-11-25 09:30", at(h5Kickoff?.startDateISOString));
      for (const s of H5_SCHEDULE) checkForm(label, e, s.key, { identity: "account", opens: s.opens, deadline: s.deadline, questions: s.questions });
    }
  }

  // ---- B2. Retro, Lock my team (§2.7, §2.10) ----
  heading("B2 retro + Lock my team");
  const retro = find(/^Week 1 Retro/);
  if (!retro) report("FAIL", "Week 1 Retro event", "present vs absent");
  else if (!m.events.isUpcomingEvent(retro, NOW)) pending("Week retro", "past");
  else {
    expect("Week retro day (§1)", "2026-11-20", parisDayOf(retro.startDateISOString));
    const f = formsOfEvent(retro).find((x) => templateOf(x) === "week_retro");
    const sessions = f ? questionsOf(f).filter((q) => q.id.startsWith("session_")).length : 0;
    checkForm("Week retro", retro, "week_retro", { identity: "account", opens: retro.startDateISOString, deadline: plusHours(retro.startDateISOString, 24), questions: retroQuestions(sessions) });
  }
  // L'id fixe de scripts/create-batch-form.mjs.
  const lock = activeForms.find((f) => f.id === `${BATCH_ID}-lock-my-team`);
  if (!lock) report("FAIL", "Lock my team form", "present vs absent");
  else {
    expect("Lock my team: published, from one's account, not tied to an event", ["open", "account", null], [lock.status, lock.identityCheck, lock.eventId ?? null]);
    expect("Lock my team: H4 debrief (23/11) -> H5 kickoff (25/11 9:30)", [at(h4Debrief?.startDateISOString), "2026-11-25 09:30"], dates(lock));
    expect("Lock my team closes at the H5 kickoff event", at(h5Kickoff?.startDateISOString), at(lock.deadlineDateISOString));
    expectQuestions("Lock my team questions", LOCK_MY_TEAM, questionsOf(lock));
  }

  // ---- B3. Formulaires hebdomadaires, sans evenement (§1, §2.0, 19/11) ----
  heading("B3 weekly forms");
  const weeklyEntries = future.filter(isWeeklyEntry);
  expect("Weekly Update Form entries: Thursdays 03/12 and 10/12 (§1, a reminder)", ["2026-12-03", "2026-12-10"], weeklyEntries.map((e) => parisDayOf(e.startDateISOString)).slice(0, 2));
  const isWeeklyForm = (f) => WEEKLY_KEYS.includes(templateOf(f)) || f.id.includes("-weekly-");
  const weeklyForms = activeForms.filter(isWeeklyForm);
  expect("no Weekly update on 26/11 (§2.0)", [], weeklyForms.filter((f) => parisDayOf(f.opensDateISOString) === "2026-11-26").map((f) => f.id));
  if (!MODEL_19_11) pending("weekly forms: the batch rhythm, no event (§2.0)", `${NOT_CODED}; prod: ${weeklyForms.filter((f) => f.eventId).length} weekly forms on agenda entries`);
  else {
    expect("weekly forms: none on an agenda entry", [], weeklyForms.filter((f) => f.eventId).map((f) => f.id));
    /** Le modele d'un formulaire hebdomadaire, lu dans ses questions. */
    const weeklyKeyOf = (f) => (questionsOf(f).some((q) => q.dbField === "founderWeek.achieved") ? "weekly_update_founder" : "weekly_update_startup");
    const days = [...new Set(weeklyForms.map((f) => parisDayOf(f.opensDateISOString)))].sort();
    expect("weekly forms: first weeks 03/12 and 10/12", ["2026-12-03", "2026-12-10"], days.slice(0, 2));
    expect("weekly forms: both forms every week", days.map((d) => [d, WEEKLY_KEYS]), days.map((d) => [d, weeklyForms.filter((f) => parisDayOf(f.opensDateISOString) === d).map(weeklyKeyOf).sort()]));
    for (const f of weeklyForms.filter((x) => !x.deadlineDateISOString || x.deadlineDateISOString >= NOW)) {
      const day = parisDayOf(f.opensDateISOString);
      const key = weeklyKeyOf(f);
      expect(`${f.id}: published, from one's account`, ["open", "account"], [f.status, f.identityCheck]);
      expect(`${f.id}: Thursday ${WEEKLY_TIME} -> 24 h (Paris)`, [`${day} ${WEEKLY_TIME}`, at(plusHours(f.opensDateISOString, 24))], dates(f));
      expect(`${f.id}: opens on a Thursday`, 4, new Date(`${day}T12:00:00Z`).getUTCDay());
      expectQuestions(`${f.id}: ${key} questions`, WEEKLY_FORMS[key], questionsOf(f));
    }
  }
  if (batch.settings?.weeklyForms?.enabled !== true) pending("batch settings: weekly forms enabled", "off until the weekly forms are created");
  else report("OK", "batch settings: weekly forms enabled");

  // ---- B4. Pitchs (§2.11, §4.7) ----
  heading("B4 pitches");
  for (const [label, re, day, stage] of [
    ["Pitch Day #1", /^Pitch Day #1/i, "2026-12-04", null],
    ["Selection Day", /^Selection Day/i, "2026-12-17", "selection_day"],
    ["Investment Committee", /^Investment Committee/i, "2027-02-25", "ic"],
  ]) {
    const e = find(re);
    if (!e) {
      report("FAIL", `${label} event`, "present vs absent");
      continue;
    }
    expect(`${label} day (§1)`, day, parisDayOf(e.startDateISOString));
    const forms = formsOfEvent(e);
    const jury = forms.find((f) => templateOf(f) === "jury");
    if (!jury && !forms.some((f) => templateOf(f) === "pitch_deck")) {
      pending(`${label}: Pitch deck + jury (Pitch grid)`, `template not applied yet (templateKey ${e.templateKey ?? "none"})`);
      continue;
    }
    checkForm(label, e, "pitch_deck", { identity: "account", opens: plusHours(e.startDateISOString, -48), deadline: plusHours(e.startDateISOString, -24), questions: PITCH_DECK });
    if (!jury) report("FAIL", `${label}: jury form`, "present vs absent");
    else {
      const qs = questionsOf(jury);
      expect19(`${label}: jury = Pitch grid points (19/11)`, PITCH_POINTS.map(([k, p]) => [`evaluation.scores.${k}`, p]), () => qs.filter((q) => q.id.startsWith("criterion_")).map((q) => [q.dbField, q.weight]));
      expect(`${label}: Decision question ${stage ? "present" : "absent"}`, Boolean(stage), qs.some((q) => q.id === "decision"));
    }
    expect19(`${label}: Pitch scoring (19/11)`, PITCH_SCORING_VIEW, () => scoringView(m.types.scoringOf(e)));
  }

  // ---- B5. Retraits, identites (§4.6, §2.0) ----
  heading("B5 retired forms + identities");
  expect("no active Picks form", [], activeForms.filter((f) => f.kind === "picks" || templateOf(f) === "picks").map((f) => f.id));
  expect("Founder introductions form archived", [], activeForms.filter((f) => templateOf(f) === "founder_introductions" || /founder introductions/i.test(f.title ?? "")).map((f) => f.id));
  expect("no active anonymous form", [], activeForms.filter((f) => m.offered.RETIRED_IDENTITY_CHECKS.has(f.identityCheck)).map((f) => f.id));
  expect(
    "active forms: from one's account (jury: shared link)",
    [],
    activeForms.filter((f) => !(f.identityCheck === "account" || (f.identityCheck === "jury_link" && f.kind === "jury"))).map((f) => `${f.id}:${f.identityCheck}`),
  );
  expect("no active question writes picks", [], activeForms.filter((f) => questionsOf(f).some((q) => q.dbField === "picks.pickedFounderIds" && !q.archived)).map((f) => f.id));
  expect("no H5 Submission (replaced by Plan, Snapshot, Final numbers)", [], h5 ? formsOfEvent(h5).filter((f) => templateOf(f) === "debrief").map((f) => f.id) : []);

  // ---- B6. Reglages du batch et scores (§3.2, §3.3) ----
  heading("B6 batch settings + scores");
  const dues = batch.settings?.scoreMilestoneDueDates ?? {};
  for (const key of ["shortlistDone", "met"]) {
    const v = dues[key] ? new Date(dues[key]).toISOString() : null;
    const window = `within ${at(h4Debrief?.startDateISOString)} - ${at(h4Debrief?.endDateISOString)}`;
    const inDebrief = h4Debrief && v && v >= h4Debrief.startDateISOString && v <= h4Debrief.endDateISOString;
    expect(`${key} due at the H4 debrief (23/11)`, window, inDebrief ? window : at(v));
  }
  expect("teamedUp due at the H5 kickoff (25/11 9:30)", at(MILESTONE_DUES.teamedUp), at(dues.teamedUp));
  expect("problemValidated due on Selection Day (17/12)", "2026-12-17", parisDayOf(dues.problemValidated));
  expect(`weeklyGoalFrom due 11/12 ${WEEKLY_ENTRY_TIME} (§3.2)`, at(MILESTONE_DUES.weeklyGoalFrom), at(dues.weeklyGoalFrom));
  if (typeof m.weeklyForms.weeklyGoalFromOf === "function") {
    expect("weeklyGoalFrom = deadline of the 2nd Weekly Update Form of the agenda", at(m.weeklyForms.weeklyGoalFromOf(events)), at(dues.weeklyGoalFrom));
  }
  const scores = scoresSnap.docs;
  if (scores.length === 0) pending("fa26 scores on 100", "no score yet");
  else {
    // Le moteur ne recalcule que les fondateurs et startups actifs : un score d'archive garde son echelle d'avant.
    const pathOf = (d) => `${d.get("targetType") === "startup" ? COL.startups : COL.founders}/${d.get("targetId")}`;
    const paths = [...new Set(scores.map(pathOf))];
    const targets = await db.getAll(...paths.map((p) => db.doc(p)));
    const archived = new Set(paths.filter((_, i) => !targets[i].exists || targets[i].get("archivedDateISOString")));
    const notOn100 = (list) => list.filter((d) => d.get("scale") !== 100).map((d) => `${d.id}:${d.get("scale") ?? "none"}`);
    const [ofArchived, ofActive] = [scores.filter((d) => archived.has(pathOf(d))), scores.filter((d) => !archived.has(pathOf(d)))];
    expect(`fa26 scores on 100, active founders and startups (${ofActive.length} docs)`, [], notOn100(ofActive));
    // Un score d'un fondateur archive : sur 100, ou archive lui aussi (rien n'est supprime).
    expect(`fa26 scores on 100 or archived, archived targets (${ofArchived.length} docs)`, [], notOn100(ofArchived.filter((d) => !d.get("archivedDateISOString"))));
  }

  // ---- B7. L'agenda (§1) ----
  heading("B7 agenda");
  const AGENDA = [
    ["Week 2 Mission Brief", /^Week 2 Mission Brief/i, ["2026-11-23"]],
    ["Week 3 mission brief & Hackathon 5 results", /^Week 3 mission brief/i, ["2026-11-30"]],
    ["Week 4 Sprint mode mission brief", /^Week 4.*mission brief/i, ["2026-12-07"]],
    ["Family Photo", /^Family Photo/i, ["2026-11-30"]],
    ["Hackathon 5 Check-in #1, #2", /^Hackathon 5 Check-in/i, ["2026-11-25", "2026-11-26"]],
    ["Hackathon 5 Build Freeze", /^Hackathon 5 Build Freeze/i, ["2026-11-27"]],
    ["Customer Day: Kickoff, Out in the Field, Show & Tell", /^Customer Day/i, ["2026-12-01", "2026-12-01", "2026-12-01"]],
    ["Drinks", /^Drinks/i, ["2026-11-19", "2026-11-23"]],
    ["Lunch roulette, every noon to 24/11", /^Lunch roulette/i, ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"]],
    ["Group Office Hours 2", /^Group Office Hours 2/i, ["2026-12-11"]],
  ];
  const today = parisDayOf(NOW);
  for (const [label, re, days] of AGENDA) {
    const want = days.filter((d) => d > today);
    if (want.length === 0) continue;
    const got = events
      .filter((e) => re.test(e.name ?? ""))
      .map((e) => parisDayOf(e.startDateISOString))
      .filter((d) => d > today && d <= want.at(-1));
    expect(`${label} (${want.length} after today)`, want, got);
  }
  const lunches = future.filter((e) => e.templateKey === "lunch_roulette");
  expect("lunch roulettes: tables of 3 to 4", lunches.map(() => "matching 3-4"), lunches.map((e) => m.events.matchingOf(e)).map((x) => `${x?.mode} ${x?.size?.min}-${x?.size?.max}`));
}

// ---- Lancement -------------------------------------------------------------------------------

console.log(`Doc conformity · docs/FONCTIONNALITES.md · batch ${BATCH_ID} · now ${NOW}`);
if (!args.includes("--prod-only")) codeChecks();
if (!args.includes("--code-only")) await prodChecks();
console.log(`\n${counts.OK} OK · ${counts.FAIL} FAIL · ${counts.PENDING} PENDING`);
process.exit(counts.FAIL > 0 ? 1 : 0);
