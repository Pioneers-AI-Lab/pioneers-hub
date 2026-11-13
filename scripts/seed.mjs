// ----------------------------
// Donnees de test pour les emulateurs (JAMAIS un projet reel)
// ----------------------------
// npm run emulators   (dans un terminal)
// npm run seed        (dans un autre)
//
// Toutes les personnes sont fictives. Comptes Google de l'emulateur :
//   staff@pioneers.test   staff
//   ada@pioneers.test     fondatrice rattachee (membre de la startup Lumen)
//   ic@pioneers.test      investor, niveau IC
//   lp@pioneers.test      investor, niveau portfolio
//   mentor@pioneers.test  mentor (pas d'acces en v1 : vu comme public)
//   (tout autre compte)   connecte mais sans profil : vu comme public

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "node:module";

const PROJECT_ID = "demo-pioneers-hub";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8180";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9199";
if (!PROJECT_ID.startsWith("demo-")) throw new Error("seed: emulator demo project only");

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();
const now = new Date().toISOString();
const stamps = { createdDateISOString: now, updatedDateISOString: now };

const PROGRAM_ID = "accelerator";
const BATCH_ID = "fall-2026";
const scoped = { programId: PROGRAM_ID, batchId: BATCH_ID };

// ---- Comptes ----------------------------------------------------------------

const accounts = [
  { uid: "staff-1", email: "staff@pioneers.test", displayName: "Sam Staff", roles: ["staff"], investorAccess: null },
  { uid: "ada-1", email: "ada@pioneers.test", displayName: "Ada Example", roles: [], investorAccess: null, personId: "person-ada-example" },
  { uid: "ic-1", email: "ic@pioneers.test", displayName: "Iris Committee", roles: ["investor"], investorAccess: "ic" },
  { uid: "lp-1", email: "lp@pioneers.test", displayName: "Leo Portfolio", roles: ["investor"], investorAccess: "portfolio" },
  { uid: "mentor-1", email: "mentor@pioneers.test", displayName: "Mia Mentor", roles: ["mentor"], investorAccess: null, personId: "person-mia-mentor" },
  // Profil importe, pas encore reclame : son email est celui de la personne (rattachement automatique).
  { uid: "gina-1", email: "gina-unclaimed@pioneers.test", displayName: "Gina Unclaimed", roles: [], investorAccess: null },
  // Compte sans profil, sans email connu : passe par une demande de rattachement.
  { uid: "stranger-1", email: "stranger@pioneers.test", displayName: "Stan Stranger", roles: [], investorAccess: null, noUserDoc: true },
  // Compte cree par mot de passe, email pas encore confirme : ne peut rien reclamer.
  { uid: "unverified-1", email: "unverified@pioneers.test", displayName: "Uma Unverified", roles: [], investorAccess: null, noUserDoc: true, unverified: true },
];

await auth.importUsers(
  accounts.map((a) => ({
    uid: a.uid,
    email: a.email,
    displayName: a.displayName,
    emailVerified: !a.unverified,
    providerData: a.unverified
      ? [{ uid: a.email, email: a.email, displayName: a.displayName, providerId: "password" }]
      : [{ uid: `google-${a.uid}`, email: a.email, displayName: a.displayName, providerId: "google.com" }],
  })),
);

// ---- Fondateurs (fictifs) ---------------------------------------------------

const founders = [
  { id: "ada-example", name: "Ada Example", category: "technical", consent: true, uid: "ada-1", startupId: "lumen" },
  { id: "ben-sample", name: "Ben Sample", category: "business", consent: true, uid: null, startupId: "lumen" },
  { id: "chloe-demo", name: "Chloe Demo", category: "hybrid", consent: true, uid: null, startupId: null },
  { id: "dan-placeholder", name: "Dan Placeholder", category: "technical", consent: true, uid: null, startupId: null },
  { id: "eva-private", name: "Eva Private", category: "business", consent: false, uid: null, startupId: null },
  { id: "finn-private", name: "Finn Private", category: "technical", consent: false, uid: null, startupId: null },
  { id: "gina-unclaimed", name: "Gina Unclaimed", category: "hybrid", consent: false, uid: null, startupId: null },
];

const batch = db.batch();

for (const a of accounts) {
  if (a.noUserDoc) continue;
  batch.set(db.doc(`users/${a.uid}`), {
    personId: a.personId ?? null,
    roles: a.roles,
    investorAccess: a.investorAccess,
    loginCount: 0,
    createdDateISOString: now,
    lastSeenDateISOString: now,
  });
}

batch.set(db.doc(`programs/${PROGRAM_ID}`), {
  ...stamps,
  archivedDateISOString: null,
  name: "Pioneers Accelerator",
  description: "Demo program (emulator data).",
});

batch.set(db.doc(`batches/${BATCH_ID}`), {
  ...stamps,
  archivedDateISOString: null,
  programId: PROGRAM_ID,
  name: "fa26",
  startDayString: "2026-11-16",
  endDayString: null,
  status: "active",
  milestones: [
    { key: "kickoff", label: "Kick-off", dayString: "2026-11-16" },
    { key: "selection_day", label: "Selection Day", dayString: null },
    { key: "ic", label: "Investment Committee", dayString: "2027-02-25" },
  ],
  settings: { leaderboardVisibility: "visible", slackChannelId: null, slackTeamId: null },
});

for (const f of founders) {
  batch.set(db.doc(`founders/${f.id}`), {
    ...stamps,
    ...scoped,
    archivedDateISOString: null,
    uid: f.uid,
    personId: `person-${f.id}`,
    claimedDateISOString: f.uid ? now : null,
    name: f.name,
    photoUrl: null,
    profileCategory: f.category,
    hardSkills: f.category === "business" ? ["Sales", "Marketing"] : ["Backend", "AI/ML"],
    industries: ["B2B SaaS"],
    rolesICouldTake: f.category === "business" ? ["CEO"] : ["CTO"],
    trackRecordOneLiner: `${f.name} (demo profile).`,
    startupId: f.startupId,
    status: "active",
    leftProgramReason: null,
    isExternalFounder: false,
    publicProfileConsent: f.consent,
    stats: null,
  });
  batch.set(db.doc(`founders/${f.id}/private/directory`), {
    email: `${f.id}@pioneers.test`,
    whatsapp: null,
    linkedinUrl: null,
    phone: null,
    slackUserId: null,
    gender: null,
    nationality: null,
    country: "France",
    introduceYourself: "Demo introduction.",
    education: "Demo University",
    degree: "MSc",
    fieldOfStudy: "Computer Science",
    yearsOfXP: 5,
    notableCompanies: ["Demo Corp"],
    trackRecord: null,
    trackRecord3Liners: [],
    interestedInWorkingOn: null,
    hasExistingProject: false,
    projectExplanation: null,
    hasExistingCoFounders: "none",
    openToJoinAnotherProject: true,
  });
  batch.set(db.doc(`founders/${f.id}/private/profile`), { age: null, birthDayString: null });
  batch.set(db.doc(`founders/${f.id}/private/internal`), { eloScore: 1000, eloMatchesCount: 0 });
}

batch.set(db.doc(`batchMemberships/${BATCH_ID}_ada-1`), {
  ...scoped,
  uid: "ada-1",
  founderId: "ada-example",
  createdDateISOString: now,
});

batch.set(db.doc("startups/lumen"), {
  ...stamps,
  ...scoped,
  archivedDateISOString: null,
  name: "Lumen (demo)",
  logoUrl: null,
  websiteUrl: null,
  ideaOneLine: "Demo startup for the emulator.",
  vertical: "B2B SaaS",
  status: "active",
  members: [
    { founderId: "ben-sample", title: "CEO" },
    { founderId: "ada-example", title: "CTO" },
  ],
  memberIds: ["ada-example", "ben-sample"],
  stats: null,
});
batch.set(db.doc("startups/lumen/private/profile"), {
  icp: "Demo ICP",
  problem: "Demo problem",
  solution: "Demo solution",
  whyNow: "Demo timing",
  currentStatus: null,
  anythingElse: null,
  pitchDeckUrl: null,
  marketAnalysis: null,
});
batch.set(db.doc("startups/lumen/private/internal"), {
  go: null,
  clearIdea: true,
  highPotential: null,
  slideQuality: null,
  achievements: null,
  achievementsScore: null,
  risks: "Demo risk",
  notes: null,
  tractionNotes: null,
});

// ---- Donnees internes et lisibles par les investors (fictives) -------------

batch.set(db.doc("scores/founder_ada-example"), {
  ...scoped,
  targetType: "founder",
  targetId: "ada-example",
  subScores: { engagement: 8, execution: null, likability: 6, commitment: 7, achievements: 5 },
  dataCompleteness: 0.8,
  computedDateISOString: now,
});
batch.set(db.doc("scoreSignals/founder_ada-example"), {
  ...scoped,
  targetType: "founder",
  targetId: "ada-example",
  signals: { commitment: [{ label: "Commitment status", raw: "Committed", score: 10, weight: 1 }] },
  computedDateISOString: now,
});
batch.set(db.doc("kpiSeries/lumen"), {
  ...scoped,
  memberIds: ["ada-example", "ben-sample"],
  series: { totalAmountPaid: [{ weekStartDayString: "2026-11-16", value: 0 }] },
  computedDateISOString: now,
});
batch.set(db.doc("notes/demo-note"), {
  ...stamps,
  archivedDateISOString: null,
  ...scoped,
  targetType: "founder",
  targetId: "ada-example",
  founderIds: ["ada-example"],
  startupId: "lumen",
  mentorId: null,
  eventId: null,
  authorUid: "staff-1",
  source: "observation",
  dayString: "2026-11-16",
  body: "Demo note.",
});
batch.set(db.doc("mentors/mia-mentor"), {
  ...stamps,
  archivedDateISOString: null,
  personId: "person-mia-mentor",
  company: "Demo Scale-up",
  title: "VP Sales",
  bio: null,
  superpowers: ["enterprise_sales"],
  level: 1,
  tier: "B",
  fit: { expertise: true, mindset: null, drive: null, reliability: null },
  capacity: 2,
  status: "active",
  programIds: [PROGRAM_ID],
});
const formResponse = (formId, formKind, subjects) => ({
  ...scoped,
  formId,
  formKind,
  formVersion: 1,
  respondentPersonId: "person-ada-example",
  respondentFounderId: "ada-example",
  subjects,
  answers: {},
  writes: [],
  unmatched: [],
  status: "processed",
  submittedDateISOString: now,
});
batch.set(db.doc("formResponses/demo-peer"), formResponse("demo-peer-form", "peer_feedback", { founderId: "ada-example" }));
batch.set(
  db.doc("formResponses/demo-weekly"),
  formResponse("demo-weekly-form", "weekly_update", { founderId: "ada-example", startupId: "lumen" }),
);
// « J'ai repondu » du « To do », ecrit par submitFormResponse avec la reponse.
for (const [formId, formKind, responseId] of [
  ["demo-peer-form", "peer_feedback", "demo-peer"],
  ["demo-weekly-form", "weekly_update", "demo-weekly"],
]) {
  batch.set(db.doc(`formCompletions/${formId}_ada-example`), {
    ...scoped,
    formId,
    founderId: "ada-example",
    formKind,
    responseId,
    completedDateISOString: now,
  });
}

// ---- Identites, suivi dans le temps (fictifs) --------------------------------

const person = ({ id, name, email, uid, founderIds = [], mentorId = null }) => {
  const [firstName, lastName] = name.split(" ");
  batch.set(db.doc(`people/${id}`), {
    ...stamps,
    archivedDateISOString: null,
    firstName,
    lastName,
    displayName: name,
    email,
    altEmails: [],
    phone: null,
    whatsapp: null,
    linkedinUrl: null,
    photoUrl: null,
    slackUserId: null,
    uid,
    founderIds,
    mentorId,
    investorId: null,
  });
};
for (const f of founders) {
  person({ id: `person-${f.id}`, name: f.name, email: `${f.id}@pioneers.test`, uid: f.uid, founderIds: [f.id] });
}
person({ id: "person-mia-mentor", name: "Mia Mentor", email: "mentor@pioneers.test", uid: "mentor-1", mentorId: "mia-mentor" });
batch.set(db.doc("checkins/lumen_2026-11-16_ada-example"), {
  ...scoped,
  startupId: "lumen",
  founderId: "ada-example",
  memberIds: ["ada-example", "ben-sample"],
  weekStartDayString: "2026-11-16",
  messagesSent: 40,
  callsMade: 25,
  conversationsDone: 12,
  meetingsBooked: 4,
  demosDone: 2,
  proposalsSent: 1,
  closedWon: 0,
  featuresShipped: 2,
  totalAmountPaid: 0,
  mrr: 0,
  payingCustomers: 0,
  totalUsers: 5,
  activeUsers: 3,
  moral: 8,
  goalMessagesSent: 60,
  goalConversationsDone: 15,
  goalAccountsCreated: 5,
  goalAmountPaid: 0,
  revenue: null,
  totalRevenue: null,
  goals: null,
  obstacle: "Demo obstacle",
  learned: null,
  achievement: null,
  helpNeeded: null,
  attachmentUrls: [],
  updatedDateISOString: now,
});
batch.set(db.doc("founderWeeks/ben-sample_2026-11-16"), {
  ...scoped,
  founderId: "ben-sample",
  weekStartDayString: "2026-11-16",
  programWeek: "Week 1",
  learnings: null,
  interestedInFounderIds: ["chloe-demo"],
  goalForWeek: null,
  commitmentStatus: "testing_relationships",
  projectName: null,
  workingWithFounderIds: [],
  priorityForWeek: null,
  feelingForWeek: null,
  anythingSpecific: null,
  updatedDateISOString: now,
});
batch.set(db.doc("memberships/lumen_ada-example_2026-11-25"), {
  ...scoped,
  founderId: "ada-example",
  kind: "startup",
  teamId: "lumen",
  eventId: null,
  role: "CTO",
  startDayString: "2026-11-25",
  endDayString: null,
  endReason: null,
});
batch.set(db.doc("metricSnapshots/lumen_totalAmountPaid_2026-11-16"), {
  ...scoped,
  subjectType: "startup",
  subjectId: "lumen",
  founderIds: ["ada-example", "ben-sample"],
  eventId: null,
  metric: "totalAmountPaid",
  value: 0,
  dayString: "2026-11-16",
  phase: null,
  source: "self_reported",
  proofUrl: null,
  sourcePath: "checkins/lumen_2026-11-16_ada-example",
  recordedByUid: null,
  recordedDateISOString: now,
});

// ---- Evenements, leaderboard, formulaire (fictifs) ----------------------------

const inDays = (n, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const event = (id, data) =>
  batch.set(db.doc(`events/${id}`), {
    ...stamps,
    ...scoped,
    archivedDateISOString: null,
    templateKey: null,
    stage: null,
    topic: null,
    endDateISOString: null,
    location: "Station F",
    programWeek: "Week 1",
    isMilestone: false,
    audience: "batch",
    guests: [],
    guestFounderIds: [],
    mentorIds: [],
    startupIds: [],
    signUpUrl: null,
    resourceUrl: null,
    evaluationTargetType: null,
    teamSize: null,
    leaderboardRevealDateISOString: null,
    ...data,
  });
event("demo-hackathon-1", {
  kind: "team_challenge",
  name: "Hackathon 1: Demo Agents",
  startDateISOString: inDays(-2, 9),
  status: "completed",
  evaluationTargetType: "team",
  teamSize: { min: 2, max: 3 },
});
// Hackathon en cours : son formulaire de jury (grille) et son lien partage (check-rules).
event("demo-hackathon-2", {
  kind: "team_challenge",
  name: "Hackathon 2: Demo Calls",
  startDateISOString: inDays(-1, 9),
  status: "live",
  evaluationTargetType: "team",
  teamSize: { min: 2, max: 2 },
});

// Les formulaires des hackathons (SPECS §2, modele standard) : le Debrief porte les
// metriques, le formulaire de jury la grille, le formulaire Picks les choix. Construits
// par le code partage compile (`npm run emulators` le compile avant), comme Admin.
const require = createRequire(import.meta.url);
const { newForm, firstPublication } = require("../functions/lib/shared/forms.js");
const openForm = (id, input, tweak = (f) => f) => {
  const { form } = firstPublication(newForm({ ...scoped, event: { kind: "team_challenge", templateKey: null }, ...input }), now);
  batch.set(db.doc(`forms/${id}`), { ...tweak(form), ...stamps });
};
// La Submission du hackathon 1 : son echeance est passee, tout envoi est « en retard ».
openForm(
  "demo-debrief-1",
  {
    templateKey: "debrief",
    eventId: "demo-hackathon-1",
    defaults: {
      metrics: [
        { key: "callsMade", label: "Calls made", unit: null },
        { key: "meetingsBooked", label: "Meetings booked", unit: null },
      ],
    },
  },
  (f) => ({ ...f, deadlineDateISOString: new Date(Date.parse(now) - 3600_000).toISOString() }),
);
// Le Peer rating du hackathon 1 : un avis sur chaque coequipier (formulaire a part).
openForm("demo-peer-1", { templateKey: "peer_rating", eventId: "demo-hackathon-1" });
openForm("demo-debrief-2", {
  templateKey: "debrief",
  eventId: "demo-hackathon-2",
  defaults: { metrics: [{ key: "conversationsDone", label: "Conversations done", unit: null }] },
});
openForm("demo-jury-2", {
  templateKey: "jury",
  eventId: "demo-hackathon-2",
  defaults: {
    criteria: [
      { key: "execution", label: "Execution", min: 1, max: 5, weight: 2 },
      { key: "pitch", label: "Pitch", min: 1, max: 5, weight: 1 },
    ],
  },
});
// Mutual picks, top 2.
openForm("demo-picks-2", { templateKey: "picks", eventId: "demo-hackathon-2" }, (f) => ({
  ...f,
  questions: f.questions.map((q) => ({ ...q, picker: { entity: "founder", maxItems: 2 } })),
}));
for (const [id, name, memberIds] of [
  ["team-c", "Team Demo C", ["ada-example", "ben-sample"]],
  ["team-d", "Team Demo D", ["chloe-demo", "dan-placeholder"]],
]) {
  batch.set(db.doc(`events/demo-hackathon-2/teams/${id}`), {
    name,
    memberIds,
    memberNames: null,
    roles: {},
    locked: true,
    publishedDateISOString: now,
    startupId: null,
  });
}
event("demo-masterclass", { kind: "session", name: "Masterclass: Demo pricing", startDateISOString: inDays(2, 14), status: "scheduled" });
// Presence a la masterclass : Ada presente, Ben absent (le fondateur lit la sienne).
for (const [founderId, status] of [["ada-example", "present"], ["ben-sample", "absent"]]) {
  batch.set(db.doc(`events/demo-masterclass/attendance/${founderId}`), { founderId, status, markedByUid: "staff-1", markedDateISOString: now });
}
batch.set(db.doc("events/demo-hackathon-1/teams/team-a"), {
  name: "Team Demo A",
  memberIds: ["ada-example", "chloe-demo"],
  roles: {},
  locked: true,
  publishedDateISOString: now,
  startupId: null,
});
batch.set(db.doc("events/demo-hackathon-1/teams/team-b"), {
  name: "Team Demo B",
  memberIds: ["ben-sample", "dan-placeholder"],
  roles: {},
  locked: true,
  publishedDateISOString: now,
  startupId: null,
});
batch.set(db.doc("memberships/team-a_ada-example_hack1"), {
  ...scoped,
  founderId: "ada-example",
  kind: "event_team",
  teamId: "team-a",
  eventId: "demo-hackathon-1",
  role: "tech_lead",
  startDayString: inDays(-2).slice(0, 10),
  endDayString: inDays(-2).slice(0, 10),
  endReason: null,
});
batch.set(db.doc("leaderboards/demo-hackathon-1"), {
  ...scoped,
  eventId: "demo-hackathon-1",
  rows: [
    { targetId: "team-a", name: "Team Demo A", memberIds: ["ada-example", "chloe-demo"], score: 8.4, rank: 1, rankDelta: null, criteriaScores: {}, evaluationsCount: 3 },
    { targetId: "team-b", name: "Team Demo B", memberIds: ["ben-sample", "dan-placeholder"], score: 7.1, rank: 2, rankDelta: null, criteriaScores: {}, evaluationsCount: 3 },
  ],
  computedDateISOString: now,
});
batch.set(db.doc("forms/demo-weekly-form"), {
  ...stamps,
  ...scoped,
  archivedDateISOString: null,
  kind: "weekly_update",
  title: "Thursday update",
  description: "Your numbers of the week, in two minutes.",
  version: 1,
  questions: [],
  attachments: {},
  approval: "none",
  identityCheck: "select_name",
  eventId: null,
  status: "open",
  opensDateISOString: now,
  deadlineDateISOString: inDays(1, 18),
});

await batch.commit();
console.log(`seed: ${founders.length} founders, 1 startup, ${accounts.length} accounts in ${PROJECT_ID}`);
