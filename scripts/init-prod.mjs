// ----------------------------
// Initialisation du projet REEL (pioneers-3627c)
// ----------------------------
// npm run init:prod
//
// Cree les documents de depart, SANS JAMAIS ecraser un document existant
// (rejouable a volonte) :
//   programs/accelerator      Pioneers Accelerator
//   batches/fall-2026         Fall 2026 et son calendrier (SPECS §9)
//   lists/*                   listes fermees connues (les competences et les
//                             secteurs se completent a l'import)
//
// Les fondateurs arrivent par la page d'import (staff). Les roles : npm run grant.
//
// Identifiants : Application Default Credentials (`gcloud auth application-default login`).
// Firestore ne connait pas de collection vide : une collection existe des
// qu'elle contient un document. Les autres se creent a la premiere ecriture.

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "pioneers-3627c";
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("init-prod: FIRESTORE_EMULATOR_HOST est defini, on viserait les emulateurs");

initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
const now = new Date().toISOString();
const stamps = { createdDateISOString: now, updatedDateISOString: now };

const PROGRAM_ID = "accelerator";
const BATCH_ID = "fall-2026";

/** @type {Array<[string, Record<string, unknown>]>} */
const docs = [
  [
    `programs/${PROGRAM_ID}`,
    { ...stamps, archivedDateISOString: null, name: "Pioneers Accelerator", description: null },
  ],
  [
    `batches/${BATCH_ID}`,
    {
      ...stamps,
      archivedDateISOString: null,
      programId: PROGRAM_ID,
      name: "Fall 2026",
      startDayString: "2026-11-16",
      endDayString: "2027-02-25",
      status: "upcoming",
      // Calendrier Fall 2026 (brief du 11/11, SPECS §9). Demos les 15/01, 29/01
      // et 12/02 : ce sont des evenements `pitch`, pas un jalon.
      milestones: [
        { key: "kickoff", label: "Kick-off", dayString: "2026-11-16" },
        { key: "selection_day", label: "Selection Day", dayString: "2026-12-17" },
        { key: "pre_ic", label: "Pre-IC", dayString: "2027-02-18" },
        { key: "ic", label: "Investment Committee", dayString: "2027-02-25" },
        { key: "demo_day", label: "Demo Day", dayString: null },
      ],
      settings: { leaderboardVisibility: "visible", slackChannelId: null, slackTeamId: null },
    },
  ],
];

const item = (value, label = value, group = null) => ({ value, label, group, archived: false });
const list = (key, label, items) => [`lists/${key}`, { key, label, items, updatedDateISOString: now }];

docs.push(
  // Profile Book 2025 « Position Fit » (docs/repos/repos-C.md).
  list("positionFit", "Position Fit", [
    item("Tech Dev / Prototyping"),
    item("Product"),
    item("Design"),
    item("Sales"),
    item("Growth"),
    item("Marketing"),
    item("Operations"),
    item("Finance"),
    item("People / Culture / Hiring"),
  ]),
  // Onboarding « Degree » (docs/repos/repos-A.md).
  list("degrees", "Degree", [item("No degree"), item("Bachelor"), item("Master"), item("PhD"), item("Other")]),
  list("programWeeks", "Program week", [
    ...Array.from({ length: 15 }, (_, i) => item(`Week ${i}`)),
    item("Week 15 - Post IC"),
  ]),
  // shared/types/form.ts COMMITMENT_STATUSES, libelles du Goal form SP26.
  list("commitmentStatuses", "Commitment status", [
    item("committed", "Committed to a startup"),
    item("on_a_project", "On a project but not committed"),
    item("testing_relationships", "Testing relationships"),
    item("what_am_i_doing_here", "What am I doing here?"),
  ]),
  list("startupStatuses", "Startup status", [
    item("active", "Active"),
    item("dead", "Dead"),
    item("selection_day_no_go", "Selection Day No Go"),
  ]),
  // Valeurs non enumerees dans la documentation : completees a l'import.
  list("hardSkills", "Hard skills", []),
  list("industries", "Industries", []),
  list("sessionTypes", "Session types", []),
  list("acquisitionChannels", "Acquisition channels", []),
);

let created = 0;
for (const [path, data] of docs) {
  const ref = db.doc(path);
  try {
    await ref.create(data);
    created++;
    console.log(`  created  ${path}`);
  } catch (err) {
    // 6 = ALREADY_EXISTS : on ne touche pas a un document existant.
    if (err.code === 6) console.log(`  exists   ${path}`);
    else throw err;
  }
}
console.log(`init-prod: ${created} created, ${docs.length - created} already there (${PROJECT_ID})`);
