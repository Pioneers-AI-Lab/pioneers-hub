// ----------------------------
// Import du batch Spring 2026 (dashboard spring2026.thepioneer.vc)
// ----------------------------
// node scripts/import-sp26.mjs <bundle.json> --prod        projet reel pioneers-3627c
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/import-sp26.mjs <bundle.json>   emulateurs
//
// Le paquet (`bundle.json`) est extrait du dashboard Spring 2026 (flux RSC des
// pages, lues avec le lien d'acces admin) : il contient des DONNEES
// PERSONNELLES et ne va jamais dans le depot. Il regroupe :
//   details        fiche complete de chaque fondateur (FounderDetail du dashboard)
//   summaries      resumes de la page d'accueil (scores, statistiques)
//   startupPages   par startup : updates hebdomadaires, pitchs, analyse de marche
//   startupScores  sous-scores des startups (market, team, execution, traction)
//   images         URL Airtable -> vignette JPEG 128 px en data URL (les URL
//                  Airtable expirent ; pas de Storage sur le projet pour l'instant)
//
// Rejouable : les ids des documents sont les ids Airtable (ou derives d'eux),
// chaque ecriture remplace le document du meme id.
//
// Correspondance avec le modele : SPECS §6.1 et functions/src/shared/types.
// Les dates des epreuves (Edge drill, Discovery, Vibethon, Hackathon) ne sont
// pas dans les donnees du dashboard : elles sont placees dans les deux
// premieres semaines du batch, a corriger si besoin.

import { readFileSync } from "node:fs";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const [bundlePath, ...flags] = process.argv.slice(2);
if (!bundlePath) throw new Error("usage: node scripts/import-sp26.mjs <bundle.json> [--prod]");
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!onEmulator && !flags.includes("--prod")) throw new Error("projet reel : ajouter --prod (ou FIRESTORE_EMULATOR_HOST pour les emulateurs)");

initializeApp(
  onEmulator ? { projectId: "demo-pioneers-hub" } : { projectId: "pioneers-3627c", credential: applicationDefault() },
);
const db = getFirestore();
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const { details, summaries, startupPages, startupScores, images } = bundle;

const PROGRAM_ID = "accelerator";
const BATCH_ID = "spring-2026";
const scoped = { programId: PROGRAM_ID, batchId: BATCH_ID };
const now = new Date().toISOString();
const stamps = { createdDateISOString: now, updatedDateISOString: now, archivedDateISOString: null };
const IMPORT_UID = "import-sp26";

const founders = Object.values(details);
const founderById = new Map(founders.map((f) => [f.id, f]));
const summaryById = new Map(summaries.map((s) => [s.id, s]));
const image = (url) => (url ? (images[url] ?? null) : null);
const lower = (v) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null);
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : []);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const mean = (xs) => {
  const v = xs.filter((x) => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const round1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
// Le flux RSC remplace une valeur deja envoyee ailleurs dans la page par une
// reference (`$5:props:...`) : on garde la premiere vraie valeur.
const firstList = (candidates) => (candidates ?? []).find((c) => Array.isArray(c)) ?? [];
const weeksOf = (startupId) => firstList(startupPages[startupId]?.weeks);

// ---- Rattachements existants : un reimport ne les efface jamais ----------------------
const claimed = new Map();
for (const d of (await db.collection("founders").where("batchId", "==", BATCH_ID).get()).docs) {
  const { uid, claimedDateISOString } = d.data();
  if (uid) claimed.set(d.id, { uid, claimedDateISOString });
}
const personUid = new Map();
for (const id of founders.map((f) => `person-${f.id}`)) {
  const uid = (await db.doc(`people/${id}`).get()).data()?.uid;
  if (uid) personUid.set(id, uid);
}

// ---- Ecriture par lots ----------------------------------------------------------
const writer = db.bulkWriter();
let writes = 0;
const set = (path, data) => {
  writes++;
  writer.set(db.doc(path), data);
};

// ---- Batch -------------------------------------------------------------------------
set(`batches/${BATCH_ID}`, {
  ...stamps,
  programId: PROGRAM_ID,
  name: "Spring 2026",
  startDayString: "2026-02-16",
  endDayString: "2026-05-22",
  status: "completed",
  milestones: [
    { key: "kickoff", label: "Kick-off", dayString: "2026-02-16" },
    { key: "selection_day", label: "Selection Day", dayString: null },
    { key: "pre_ic", label: "Pre-IC", dayString: null },
    { key: "ic", label: "Investment Committee", dayString: null },
    { key: "demo_day", label: "Demo Day", dayString: null },
  ],
  settings: { leaderboardVisibility: "visible", slackChannelId: null, slackTeamId: null },
});

// ---- Startups ----------------------------------------------------------------------
const startupProfiles = new Map();
for (const f of founders) for (const sp of f.startupProfiles ?? []) if (!startupProfiles.has(sp.id)) startupProfiles.set(sp.id, sp);

const founderStartupId = (f) => {
  const profiles = f.startupProfiles ?? [];
  const primary = profiles.find((p) => p.startupName === f.primaryStartupName);
  return (primary ?? profiles[0])?.id ?? null;
};

const range = (low, mid, high, scale = 1) => ({
  low: num(low) === null ? null : low * scale,
  mid: num(mid) === null ? null : mid * scale,
  high: num(high) === null ? null : high * scale,
});

/** Premiere semaine d'updates : la date ou l'equipe existe au plus tard. */
const firstWeekOf = (startupId) => {
  return weeksOf(startupId).map((w) => w.weekStart).sort()[0] ?? "2026-03-02";
};

for (const sp of startupProfiles.values()) {
  const memberIds = (sp.coFounderIds ?? []).filter((id) => founderById.has(id));
  const titleOf = (id) => {
    const name = founderById.get(id)?.name;
    if (name && sp.ceoName && name === sp.ceoName) return "CEO";
    if (name && sp.ctoName && name === sp.ctoName) return "CTO";
    return null;
  };
  set(`startups/${sp.id}`, {
    ...stamps,
    ...scoped,
    name: sp.startupName,
    logoUrl: image(sp.logoUrl),
    websiteUrl: text(sp.websiteUrl),
    ideaOneLine: text(sp.ideaOneLine),
    vertical: text(sp.vertical),
    // « Go » du Selection Day : un No Go est une startup ecartee.
    status: sp.go === false ? "selection_day_no_go" : "active",
    members: memberIds.map((id) => ({ founderId: id, title: titleOf(id) })),
    memberIds,
    stats: null,
  });
  const hasMarket = num(sp.tamMid) !== null;
  set(`startups/${sp.id}/private/profile`, {
    icp: text(sp.icp),
    problem: text(sp.problem),
    solution: text(sp.aiSummarySolution) ?? text(sp.solutionOneLiner),
    whyNow: text(sp.whyNow),
    currentStatus: text(sp.currentStatus),
    anythingElse: text(sp.anythingElse),
    pitchDeckUrl: text(sp.pitchDeckUrl),
    driveFolderUrl: null,
    product: null,
    technology: null,
    usersGoal: null,
    revenueGoal: null,
    plannedMilestones: null,
    teamFormedDayString: null,
    marketAnalysis: hasMarket
      ? {
          aiSummaryProblem: text(sp.aiSummaryProblem),
          aiSummarySolution: text(sp.aiSummarySolution),
          aiSummaryTiming: text(sp.aiSummaryTiming),
          icpOneLiner: text(sp.icpOneLiner),
          problemOneLiner: text(sp.problemOneLiner),
          solutionOneLiner: text(sp.solutionOneLiner),
          whyNowOneLiner: text(sp.whyNowOneLiner),
          // Dashboard : TAM / SAM / SOM en milliards de dollars, CAGR en %.
          tam: { ...range(sp.tamLow, sp.tamMid, sp.tamHigh, 1e9), reasoning: text(sp.tamReasoning) },
          sam: { ...range(sp.samLow, sp.samMid, sp.samHigh, 1e9), reasoning: text(sp.samReasoning) },
          som: { ...range(sp.somLow, sp.somMid, sp.somHigh, 1e9), reasoning: text(sp.somReasoning) },
          cagr: range(sp.cagrLow, sp.cagrMid, sp.cagrHigh, 0.01),
          competitors: (sp.marketCompetitors ?? []).map((c) => ({
            name: c.name,
            description: text(c.description),
            domain: text(c.domain),
            stage: text(c.stage),
            raised: text(c.raised),
          })),
          sources: (sp.marketSources ?? []).map((s) => s.url).filter(Boolean),
          promptVersion: null,
          generatedDateISOString: now,
        }
      : null,
  });
  set(`startups/${sp.id}/private/internal`, {
    go: typeof sp.go === "boolean" ? sp.go : null,
    clearIdea: typeof sp.clearIdea === "boolean" ? sp.clearIdea : null,
    highPotential: typeof sp.highPotential === "boolean" ? sp.highPotential : null,
    slideQuality: num(sp.slideQuality),
    achievements: text(sp.achievements),
    achievementsScore: num(sp.achievementsScore),
    risks: text(sp.risks),
    notes: text(sp.notes),
    tractionNotes: text(sp.tractionNotes),
  });

  // Appartenance datee a la startup.
  const start = firstWeekOf(sp.id);
  for (const id of memberIds) {
    set(`memberships/${sp.id}_${id}_${start}`, {
      ...scoped,
      founderId: id,
      kind: "startup",
      teamId: sp.id,
      eventId: null,
      role: titleOf(id),
      startDayString: start,
      endDayString: null,
      endReason: null,
    });
  }

  // Updates du jeudi (un par semaine et par startup dans le dashboard : rattache au premier membre).
  const weeks = weeksOf(sp.id);
  const owner = memberIds[0];
  const series = {};
  for (const w of weeks) {
    if (!owner) break;
    set(`checkins/${sp.id}_${w.weekStart}_${owner}`, {
      ...scoped,
      startupId: sp.id,
      memberIds,
      founderId: owner,
      weekStartDayString: w.weekStart,
      interviews: num(w.interviews),
      activeUsers: num(w.activeUsers),
      totalUsers: num(w.totalUsers),
      revenue: num(w.revenue),
      totalRevenue: num(w.totalRevenue),
      outbound: null,
      featuresShipped: null,
      moral: num(w.moral),
      goalOutreach: null,
      goalInterviews: null,
      goalNewUsers: null,
      goalRevenue: null,
      goals: text(w.goals),
      obstacle: text(w.obstacle),
      learned: text(w.learned),
      achievement: text(w.achievement),
      helpNeeded: null,
      attachmentUrls: [],
      updatedDateISOString: now,
    });
    for (const key of ["interviews", "activeUsers", "totalUsers", "revenue", "totalRevenue", "moral"]) {
      if (num(w[key]) === null) continue;
      (series[key] ??= []).push({ weekStartDayString: w.weekStart, value: w[key] });
    }
  }
  if (owner) {
    for (const points of Object.values(series)) points.sort((a, b) => a.weekStartDayString.localeCompare(b.weekStartDayString));
    set(`kpiSeries/${sp.id}`, { ...scoped, startupId: sp.id, memberIds, series, computedDateISOString: now });
  }

  // Sous-scores du dashboard (sur 10). Les ponderations s'appliquent a l'affichage.
  const s = startupScores[sp.id];
  if (s) {
    const subScores = { market: num(s.market), team: num(s.team), execution: num(s.execution), traction: num(s.traction) };
    set(`scores/startup_${sp.id}`, {
      ...scoped,
      targetType: "startup",
      targetId: sp.id,
      subScores,
      dataCompleteness: Object.values(subScores).filter((v) => v !== null).length / 4,
      computedDateISOString: now,
    });
  }
}

// ---- Personnes et fondateurs ---------------------------------------------------------
const CATEGORY = { Tech: "technical", Business: "business", Hybrid: "hybrid" };
const yesNo = (v) => (v === "Yes" ? true : v === "No" ? false : typeof v === "string" && v.startsWith("Why not") ? true : null);
const coFounders = (v) => (v === "Yes" ? "in_batch" : v === "No" ? "none" : v === "Outside the batch" ? "outside_batch" : null);
const COMMITMENT = {
  "Committed to a startup": "committed",
  "On a project but not committed": "on_a_project",
  "Testing relationships": "testing_relationships",
  "What am I doing here?": "what_am_i_doing_here",
};
const relationIds = (f, type) => (f.relationships ?? []).filter((r) => r.relations.includes(type)).map((r) => r.id);

for (const f of founders) {
  const [firstName, ...rest] = (f.name ?? "").trim().split(/\s+/);
  const photo = image(f.photoUrl);
  const personId = `person-${f.id}`;
  set(`people/${personId}`, {
    ...stamps,
    firstName: firstName ?? "",
    lastName: rest.join(" "),
    displayName: f.name,
    email: lower(f.email) ?? "",
    altEmails: [],
    phone: null,
    whatsapp: null,
    linkedinUrl: text(f.linkedin),
    photoUrl: photo,
    slackUserId: null,
    uid: personUid.get(personId) ?? null,
    founderIds: [f.id],
    mentorId: null,
    investorId: null,
  });
  set(`founders/${f.id}`, {
    ...stamps,
    ...scoped,
    personId,
    uid: claimed.get(f.id)?.uid ?? null,
    claimedDateISOString: claimed.get(f.id)?.claimedDateISOString ?? null,
    name: f.name,
    photoUrl: photo,
    profileCategory: CATEGORY[f.profileCategory] ?? null,
    hardSkills: list(f.hardSkills),
    industries: list(f.industries),
    rolesICouldTake: list(f.roles),
    trackRecordOneLiner: text(f.trackRecordOneLiner),
    startupId: founderStartupId(f),
    status: "alumni",
    leftProgramReason: null,
    isExternalFounder: f.isExternalFounder === true,
    publicProfileConsent: false,
    stats: null,
  });
  set(`founders/${f.id}/private/directory`, {
    email: lower(f.email) ?? "",
    whatsapp: null,
    linkedinUrl: text(f.linkedin),
    phone: null,
    slackUserId: null,
    gender: text(f.gender),
    nationality: list(f.nationalities).join(", ") || text(f.nationality),
    country: null,
    introduceYourself: text(f.introduceYourself),
    education: list(f.education).join(" · ") || null,
    degree: text(f.degree),
    fieldOfStudy: text(f.fieldOfStudy),
    yearsOfXP: num(f.yearsOfXP),
    notableCompanies: list(f.notableCompanies),
    trackRecord: text(f.trackRecord),
    trackRecord3Liners: (text(f.trackRecord3Liners) ?? "")
      .split("\n")
      .map((l) => l.replace(/^\s*[-•]\s*/, "").trim())
      .filter(Boolean),
    interestedInWorkingOn: null,
    hasExistingProject: yesNo(f.hasExistingProject),
    projectExplanation: text(f.projectExplanation),
    hasExistingCoFounders: coFounders(f.hasExistingCoFounders),
    openToJoinAnotherProject: yesNo(f.openToJoinAnotherProject),
    mainStartup2025: null,
    lookingForCoFounder: null,
    coFounderTypeWanted: null,
    coFounderSkillsWanted: [],
    industriesToExplore: [],
  });
  set(`founders/${f.id}/private/profile`, {
    age: num(f.age),
    birthDayString: null,
    housingSupport: null,
    tShirtSize: null,
    enrolmentConfirmed: null,
  });
  set(`founders/${f.id}/private/internal`, { eloScore: num(f.eloScore), eloMatchesCount: 0 });

  // Statistiques (presence, reseau) et scores du dashboard.
  const att = f.attendanceStats ?? {};
  const attended = (att.present ?? 0) + (att.inOffice ?? 0);
  set(`founderStats/${f.id}`, {
    ...scoped,
    attendance: { attended, total: att.total ?? 0, rate: att.total ? attended / att.total : null },
    interestIncoming: relationIds(f, "interest_incoming"),
    interestOutgoing: relationIds(f, "interest_outgoing"),
    interestMutual: relationIds(f, "interest_incoming").filter((id) => relationIds(f, "interest_outgoing").includes(id)),
    workingWithIncoming: relationIds(f, "working_incoming"),
    workingWithOutgoing: relationIds(f, "working_outgoing"),
    workingWithMutual: relationIds(f, "working_incoming").filter((id) => relationIds(f, "working_outgoing").includes(id)),
    uniqueTeammates: f.networkStats?.uniqueTeammates ?? 0,
    peerRating: { average: null, count: 0 },
    computedDateISOString: now,
  });
  const score = [f.investmentScore, summaryById.get(f.id)?.investmentScore].find((v) => v && typeof v === "object");
  if (score) {
    const subScores = {
      engagement: num(score.engagement),
      execution: num(score.execution),
      likability: num(score.likability),
      commitment: num(score.commitment),
      achievements: num(score.achievements),
    };
    set(`scores/founder_${f.id}`, {
      ...scoped,
      targetType: "founder",
      targetId: f.id,
      subScores,
      baseline: { execution: null, founderSignal: null, pedigree: null, geography: null },
      baselineComputedDateISOString: null,
      dataCompleteness: (score.dataCompleteness ?? 0) / 100,
      computedDateISOString: now,
    });
    const signals = {};
    for (const [pillar, items] of Object.entries(score.signals ?? {})) {
      signals[pillar] = (items ?? []).map((s) => ({ label: s.label, raw: s.raw, score: s.score, weight: s.weight ?? 1 }));
    }
    set(`scoreSignals/founder_${f.id}`, { ...scoped, targetType: "founder", targetId: f.id, signals, computedDateISOString: now });
  }

  // Formulaires de motivation et d'objectifs -> une semaine par lundi.
  const weeks = new Map();
  const monday = (iso) => {
    const d = new Date(iso);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  };
  const weekOf = (iso) => {
    const key = monday(iso);
    if (!weeks.has(key)) {
      weeks.set(key, {
        ...scoped,
        founderId: f.id,
        weekStartDayString: key,
        programWeek: null,
        learnings: null,
        interestedInFounderIds: [],
        goalForWeek: null,
        commitmentStatus: null,
        projectName: null,
        workingWithFounderIds: [],
        priorityForWeek: null,
        feelingForWeek: null,
        anythingSpecific: null,
        updatedDateISOString: now,
      });
    }
    return weeks.get(key);
  };
  for (const m of f.motivations ?? []) {
    if (!m.createdAt) continue;
    const w = weekOf(m.createdAt);
    w.learnings = text(m.learnings);
    w.interestedInFounderIds = (m.interestedInIds ?? []).filter((id) => founderById.has(id));
    w.goalForWeek = text(m.goalForWeek);
  }
  for (const g of f.goalForms ?? []) {
    if (!g.createdAt) continue;
    const w = weekOf(g.createdAt);
    w.commitmentStatus = COMMITMENT[g.status] ?? null;
    w.projectName = text(g.projectName);
    w.workingWithFounderIds = (g.workingWithIds ?? []).filter((id) => founderById.has(id));
    w.priorityForWeek = text(g.priorityForWeek);
    w.feelingForWeek = text(g.feelingForWeek);
    w.anythingSpecific = text(g.anythingSpecific);
  }
  for (const [key, w] of weeks) set(`founderWeeks/${f.id}_${key}`, w);
}

// ---- Evenements ------------------------------------------------------------------------
const event = (id, data) =>
  set(`events/${id}`, {
    ...stamps,
    ...scoped,
    templateKey: null,
    stage: null,
    topic: null,
    endDateISOString: null,
    location: "Station F",
    programWeek: null,
    isMilestone: false,
    audience: "batch",
    guests: [],
    guestFounderIds: [],
    mentorIds: [],
    startupIds: [],
    signUpUrl: null,
    resourceUrl: null,
    status: "completed",
    criteria: [],
    metrics: [],
    evaluationTargetType: null,
    teamSize: null,
    leaderboardRevealDateISOString: null,
    ...data,
  });
const criterion = (key, label, max = 5) => ({ key, label, min: 0, max, weight: 1 });
const at = (day, hour = 9) => `${day}T${String(hour - 1).padStart(2, "0")}:00:00.000Z`; // heure de Paris (UTC+1)

/** Equipe, appartenances datees, evaluation de l'equipe ; rend la ligne du leaderboard. */
function team(eventId, day, t) {
  const memberIds = t.memberIds.filter((id) => founderById.has(id));
  set(`events/${eventId}/teams/${t.id}`, {
    name: t.name,
    memberIds,
    roles: t.roles ?? {},
    locked: true,
    publishedDateISOString: now,
    startupId: null,
  });
  for (const id of memberIds) {
    set(`memberships/${t.id}_${id}_${day}`, {
      ...scoped,
      founderId: id,
      kind: "event_team",
      teamId: t.id,
      eventId,
      role: (t.roles?.[id] ?? [])[0] ?? null,
      startDayString: day,
      endDayString: day,
      endReason: null,
    });
  }
  set(`events/${eventId}/evaluations/${IMPORT_UID}_${t.id}`, {
    evaluatorKind: "staff",
    evaluatorId: IMPORT_UID,
    evaluatorName: "Spring 2026 (Airtable)",
    isExternal: false,
    targetType: "team",
    targetId: t.id,
    scores: t.scores,
    overallScore: t.overall ?? null,
    wouldInvest: null,
    betLikelihood: null,
    wantsToContinue: null,
    comment: text(t.comment),
    decision: null,
    finalDecision: null,
    updatedDateISOString: now,
  });
  if (t.submission) set(`events/${eventId}/submissions/${t.id}`, { teamId: t.id, ...t.submission });
  return { targetId: t.id, name: t.name, memberIds, score: t.score, criteriaScores: t.scores, evaluationsCount: 1 };
}

function leaderboard(eventId, rows) {
  const ranked = rows
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ ...r, score: round1(r.score), rank: i + 1, rankDelta: null }));
  set(`leaderboards/${eventId}`, { ...scoped, eventId, rows: ranked, computedDateISOString: now });
  return ranked;
}

const submission = (data) => ({
  title: null,
  pitchOneLine: null,
  videoUrl: null,
  repoUrl: null,
  slideUrl: null,
  deliverables: {},
  metrics: {},
  productUrl: null,
  links: [],
  submittedDateISOString: null,
  ...data,
});
const clean = (obj) => Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => typeof v === "number"));

// Presence : une seance par jour (Airtable « Founders (attendance) », une colonne par jour).
const DAYS = { "16 Feb": "2026-02-16", "17 Feb": "2026-02-17", "18 Feb": "2026-02-18", "19 Feb": "2026-02-19", "20 Feb": "2026-02-20", "21 Feb": "2026-02-21", "22 Feb": "2026-02-22", "23 Feb": "2026-02-23", "24 Feb": "2026-02-24", "25 Feb": "2026-02-25", "26 Feb": "2026-02-26", "27 Feb": "2026-02-27", "02 Mar": "2026-03-02" };
const ATTENDANCE = { Present: "present", Late: "late", "In office": "in_office" };
for (const [label, day] of Object.entries(DAYS)) {
  const id = `sp26-day-${day}`;
  event(id, { kind: "session", name: `Program day · ${label}`, startDateISOString: at(day), programWeek: day < "2026-02-23" ? "Week 1" : day < "2026-03-02" ? "Week 2" : "Week 3" });
  for (const f of founders) {
    if (!f.attendance || !(label in f.attendance)) continue;
    set(`events/${id}/attendance/${f.id}`, {
      founderId: f.id,
      status: ATTENDANCE[f.attendance[label]] ?? "absent",
      markedByUid: IMPORT_UID,
      markedDateISOString: now,
    });
  }
}

// Edge drill (sur 15) : equipes numerotees.
{
  const id = "sp26-edge-drill";
  event(id, {
    kind: "team_challenge",
    templateKey: "edge_drill",
    name: "Edge drill",
    startDateISOString: at("2026-02-17", 14),
    programWeek: "Week 1",
    criteria: [criterion("edgeArticulation", "Edge articulation"), criterion("execution", "Execution"), criterion("collaboration", "Collaboration")],
    evaluationTargetType: "team",
  });
  const teams = new Map();
  for (const f of founders) {
    const e = f.edgeDrill;
    if (!e?.team) continue;
    const t = teams.get(e.team) ?? { id: `sp26-edge-${e.team}`, name: `Team ${e.team}`, memberIds: [], e };
    t.memberIds.push(f.id);
    teams.set(e.team, t);
  }
  leaderboard(
    id,
    [...teams.values()].map((t) =>
      team(id, "2026-02-17", {
        ...t,
        scores: clean({ edgeArticulation: t.e.edgeArticulation, execution: t.e.execution, collaboration: t.e.collaboration }),
        overall: num(t.e.total),
        score: num(t.e.total) === null ? null : (t.e.total / 15) * 10,
        submission: submission({ slideUrl: text(t.e.slideUrl) }),
      }),
    ),
  );
}

// Customer discovery (groupes et evaluation).
{
  const id = "sp26-discovery";
  event(id, {
    kind: "team_challenge",
    templateKey: "customer_discovery",
    name: "Customer discovery",
    startDateISOString: at("2026-02-19", 10),
    programWeek: "Week 1",
    criteria: [criterion("overall", "Overall"), criterion("traction", "Traction"), criterion("execution", "Execution"), criterion("proofLevel", "Proof level"), criterion("insights", "Insights")],
    metrics: [
      { key: "interviews", label: "Interviews", unit: null },
      { key: "coldCalls", label: "Cold calls", unit: null },
      { key: "textOutreach", label: "Text outreach", unit: null },
    ],
    evaluationTargetType: "team",
  });
  const groups = new Map();
  const evals = new Map();
  for (const f of founders) {
    for (const g of f.discoveryGroups ?? []) groups.set(g.id, g);
    if (f.discoveryEvaluation) evals.set(f.discoveryEvaluation.teamId, f.discoveryEvaluation);
  }
  leaderboard(
    id,
    [...groups.values()].map((g) => {
      const e = evals.get(g.id) ?? {};
      const scores = clean({ overall: e.overall, traction: e.traction, execution: e.execution, proofLevel: e.proofLevel, insights: e.insights });
      const m = mean(Object.values(scores));
      return team(id, "2026-02-19", {
        id: g.id,
        name: g.groupName,
        memberIds: g.memberIds,
        scores,
        overall: num(e.score),
        score: m === null ? null : m * 2,
        submission: submission({ metrics: clean({ interviews: e.interviews, coldCalls: e.coldCalls, textOutreach: e.textOutreach }) }),
      });
    }),
  );
}

// Vibethon (sur 5) : roles Tech lead, Presenter, Deck maker.
{
  const id = "sp26-vibethon";
  event(id, {
    kind: "team_challenge",
    templateKey: "vibethon",
    name: "Vibethon",
    startDateISOString: at("2026-02-24", 10),
    programWeek: "Week 2",
    criteria: [
      criterion("problemDefinition", "Problem definition"),
      criterion("solution", "Solution"),
      criterion("deck", "Deck"),
      criterion("presentation", "Presentation"),
      criterion("execution", "Execution"),
    ],
    evaluationTargetType: "team",
  });
  const ROLE = { "Tech Lead": "tech_lead", Presenter: "presenter", "Deck Maker": "deck_maker" };
  const teams = new Map();
  for (const f of founders) {
    const v = f.vibethonDrill;
    if (!v) continue;
    const t = teams.get(v.id) ?? { v, roles: {} };
    t.roles[f.id] = (v.founderRoles ?? []).map((r) => ROLE[r]).filter(Boolean);
    teams.set(v.id, t);
  }
  leaderboard(
    id,
    [...teams.values()].map(({ v, roles }) =>
      team(id, "2026-02-24", {
        id: v.id,
        name: v.teamName,
        memberIds: v.memberIds,
        roles,
        scores: clean({ problemDefinition: v.problemDefinition, solution: v.solution, deck: v.deck, presentation: v.presentation, execution: v.execution }),
        overall: num(v.overallScore),
        score: num(v.overallScore) === null ? null : v.overallScore * 2,
        comment: v.comments,
      }),
    ),
  );
}

// Hackathon (score final sur 2 500, criteres qualitatifs et 8 livrables).
{
  const id = "sp26-hackathon";
  event(id, {
    kind: "team_challenge",
    templateKey: "hackathon",
    name: "Hackathon",
    startDateISOString: at("2026-02-26", 9),
    programWeek: "Week 2",
    criteria: [
      criterion("clarityOfProblem", "Clarity of problem"),
      criterion("strengthOfEvidence", "Strength of evidence"),
      criterion("depthOfExecution", "Depth of execution"),
      criterion("strategicPrioritization", "Strategic prioritization"),
      criterion("teamCoherence", "Team coherence"),
      criterion("actualValidation", "Actual validation"),
    ],
    metrics: [
      { key: "lOICount", label: "LOIs", unit: null },
      { key: "revenue", label: "Revenue", unit: "EUR" },
      { key: "userInterviews", label: "User interviews", unit: null },
      { key: "coldCalls", label: "Cold calls", unit: null },
      { key: "emailSubscribers", label: "Email subscribers", unit: null },
      { key: "activeUsers", label: "Active users", unit: null },
    ],
    evaluationTargetType: "team",
  });
  const DELIVERABLE = {
    figmaPrototype: "figma_prototype",
    workingMVP: "working_mvp",
    landingPage: "landing_page",
    elevatorPitch: "elevator_pitch",
    pitchDeck: "six_slide_pitch",
    logo: "logo",
    linkedin: "linkedin_page",
    userOnboarding: "user_onboarding_flow",
  };
  const teams = new Map();
  for (const f of founders) if (f.hackathon) teams.set(f.hackathon.id, f.hackathon);
  leaderboard(
    id,
    [...teams.values()].map((h) =>
      team(id, "2026-02-26", {
        id: h.id,
        name: h.teamName,
        memberIds: h.memberIds,
        scores: clean(h.qualitativeRatings),
        overall: num(h.finalScore),
        score: num(h.finalScore) === null ? null : (h.finalScore / 2500) * 10,
        comment: h.comments,
        submission: submission({
          deliverables: Object.fromEntries(Object.entries(h.checklist ?? {}).filter(([k]) => DELIVERABLE[k]).map(([k, v]) => [DELIVERABLE[k], v === true])),
          metrics: clean(h.stats),
        }),
      }),
    ),
  );
}

// Pitchs hebdomadaires (Weekly pitch) : une seance par semaine, notee par startup.
{
  const WEEK_START = { "Week 3": "2026-03-02", "Week 4": "2026-03-09", "Week 5": "2026-03-16" };
  const CRITERIA = [
    criterion("problemClarity", "Problem clarity"),
    criterion("insightWhyNow", "Insight / why now"),
    criterion("storytelling", "Storytelling"),
    criterion("slidesQuality", "Slides quality"),
    criterion("energy", "Energy"),
    criterion("execution", "Execution"),
  ];
  const bySession = new Map();
  for (const [startupId, page] of Object.entries(startupPages)) {
    for (const p of firstList(page.pitches)) {
      if (!bySession.has(p.sessionLabel)) bySession.set(p.sessionLabel, []);
      bySession.get(p.sessionLabel).push({ startupId, p });
    }
  }
  for (const [label, items] of bySession) {
    const monday = WEEK_START[label];
    if (!monday) continue;
    const friday = new Date(`${monday}T00:00:00Z`);
    friday.setUTCDate(friday.getUTCDate() + 4);
    const day = friday.toISOString().slice(0, 10);
    const id = `sp26-pitch-${label.toLowerCase().replace(/\s+/g, "-")}`;
    const startupIds = [...new Set(items.map((i) => i.startupId))].filter((s) => startupProfiles.has(s));
    event(id, {
      kind: "pitch",
      templateKey: "friday_pitch",
      name: `Weekly pitch · ${label}`,
      startDateISOString: at(day, 16),
      programWeek: label,
      startupIds,
      criteria: CRITERIA,
      evaluationTargetType: "startup",
    });
    const perStartup = new Map();
    for (const { startupId, p } of items) {
      if (!startupProfiles.has(startupId)) continue;
      const scores = clean({
        problemClarity: p.problemClarity,
        insightWhyNow: p.insightWhyNow,
        storytelling: p.storytelling,
        slidesQuality: p.slidesQuality,
        energy: p.energy,
        execution: p.execution,
      });
      set(`events/${id}/evaluations/${p.id}_${startupId}`, {
        evaluatorKind: p.external ? "guest" : "staff",
        evaluatorId: p.id,
        evaluatorName: p.external ? "External reviewer" : "Pioneers team",
        isExternal: p.external === true,
        targetType: "startup",
        targetId: startupId,
        scores,
        overallScore: null,
        wouldInvest: null,
        betLikelihood: null,
        wantsToContinue: null,
        comment: text(p.comments),
        decision: null,
        finalDecision: null,
        updatedDateISOString: now,
      });
      const m = mean(Object.values(scores));
      if (m === null) continue;
      if (!perStartup.has(startupId)) perStartup.set(startupId, []);
      perStartup.get(startupId).push({ m, scores });
    }
    leaderboard(
      id,
      [...perStartup.entries()].map(([startupId, evals]) => {
        const sp = startupProfiles.get(startupId);
        const criteriaScores = {};
        for (const c of CRITERIA) {
          const v = mean(evals.map((e) => e.scores[c.key]));
          if (v !== null) criteriaScores[c.key] = round1(v);
        }
        return {
          targetId: startupId,
          name: sp.startupName,
          memberIds: (sp.coFounderIds ?? []).filter((x) => founderById.has(x)),
          score: mean(evals.map((e) => e.m)) * 2,
          criteriaScores,
          evaluationsCount: evals.length,
        };
      }),
    );
  }
}

// ---- Statistiques du batch (publiques) --------------------------------------------------
{
  const count = (values) => {
    const out = {};
    for (const v of values) if (v) out[v] = (out[v] ?? 0) + 1;
    return out;
  };
  const xp = founders.map((f) => num(f.yearsOfXP)).filter((v) => v !== null);
  set(`batchStats/${BATCH_ID}`, {
    programId: PROGRAM_ID,
    founders: founders.length,
    avgYearsOfXP: xp.length ? round1(xp.reduce((a, b) => a + b, 0) / xp.length) : null,
    // Valeur affichee par le dashboard Spring 2026 (codee en dur, pas de donnee source).
    repeatFounders: 0.51,
    profileDistribution: count(founders.map((f) => CATEGORY[f.profileCategory])),
    skillsDistribution: count(founders.flatMap((f) => list(f.hardSkills))),
    nationalities: count(founders.flatMap((f) => (list(f.nationalities).length ? list(f.nationalities) : [text(f.nationality)]))),
    teamFormationRate: founders.filter((f) => founderStartupId(f)).length / founders.length,
    formResponseRate: null,
    computedDateISOString: now,
  });
}

// ---- Listes fermees : competences et secteurs du batch ----------------------------------
for (const [key, label, values] of [
  ["hardSkills", "Hard skills", founders.flatMap((f) => list(f.hardSkills))],
  ["industries", "Industries", founders.flatMap((f) => list(f.industries))],
]) {
  const ref = db.doc(`lists/${key}`);
  const current = (await ref.get()).data();
  const known = new Set((current?.items ?? []).map((i) => i.value));
  const fresh = [...new Set(values)].filter((v) => !known.has(v)).sort();
  if (fresh.length) {
    set(`lists/${key}`, {
      key,
      label: current?.label ?? label,
      items: [...(current?.items ?? []), ...fresh.map((v) => ({ value: v, label: v, group: null, archived: false }))],
      updatedDateISOString: now,
    });
  }
}

await writer.close();
console.log(
  `import-sp26: ${founders.length} founders, ${startupProfiles.size} startups, ${writes} documents written (${onEmulator ? "emulators" : "pioneers-3627c"})`,
);
