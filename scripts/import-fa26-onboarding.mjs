// ----------------------------
// Complement du batch Fall 2026 : export CSV de la vue « onboarding » d'Airtable
// ----------------------------
// node scripts/import-fa26-onboarding.mjs <export.csv> --skills <skills.json>          a blanc, projet reel (lecture seule)
// node scripts/import-fa26-onboarding.mjs <export.csv> --skills <skills.json> --prod   ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/import-fa26-onboarding.mjs ... [--prod]   emulateurs
//
// La vue onboarding a ce que le Profile Book n'a pas (email, WhatsApp, date de
// naissance, logistique, cofondateur recherche) mais PAS les ids des lignes :
// chaque ligne se rattache par son nom (sans casse ni accents) a un fondateur
// non archive du batch. Le CSV et `--skills` contiennent des DONNEES
// PERSONNELLES : ils restent hors du depot.
//
// Remplit le vide, n'ecrase jamais : un champ deja renseigne (par l'import du
// Profile Book, le staff ou le fondateur) garde sa valeur. Rejouable.
// Decisions du 16/11 :
//   - « Maybe » (rejoindre un autre projet) et « I'm open, but it isn't
//     mandatory » (cherche un cofondateur) valent oui ;
//   - les competences cherchees chez un cofondateur (texte libre) sont ramenees
//     a la liste fermee `hardSkills` hors de ce script (par un LLM), fichier
//     `--skills` : { "<Full Name>": ["Software Engineering", ...] } ;
//   - `anythingElse` rassemble « Anything else worth mentioning », la
//     disponibilite a temps partiel et les noms des cofondateurs ;
//   - les textes longs de l'export commencent par une apostrophe (protection
//     d'Airtable contre les formules) : retiree.
// Les valeurs nouvelles des listes fermees (roles, secteurs a explorer) sont
// ajoutees a leur liste, comme le fait import-fa26.mjs.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import Papa from "papaparse";

// Code partage compile (`npm --prefix functions run build`).
const require = createRequire(import.meta.url);
const { isEmptyValue } = require("../functions/lib/shared/fieldRegistry.js");
const { docPaths } = require("../functions/lib/shared/collections.js");
const { searchKey } = require("../functions/lib/shared/text.js");

const args = process.argv.slice(2);
const csvPath = args.find((a) => a.endsWith(".csv"));
const skillsAt = args.indexOf("--skills");
const skillsPath = skillsAt < 0 ? undefined : args[skillsAt + 1];
const write = args.includes("--prod");
if (!csvPath || !skillsPath) {
  console.error("usage: node scripts/import-fa26-onboarding.mjs <export.csv> --skills <skills.json> [--prod]");
  process.exit(1);
}
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
const BATCH_ID = "fall-2026";
const now = new Date().toISOString();
console.log(`${PROJECT_ID} · ${BATCH_ID} · ${write ? "ECRITURE" : "a blanc"}\n`);

// ---- Lecture du CSV et des competences ------------------------------------------------
const { data: rows, errors } = Papa.parse(readFileSync(csvPath, "utf8"), { header: true, skipEmptyLines: true });
if (errors.length) throw new Error(`CSV illisible : ${errors[0].message} (ligne ${errors[0].row})`);
const skillsByName = JSON.parse(readFileSync(skillsPath, "utf8"));

/** Cle de nom, comme l'import CSV de l'app (lib/import/founders.ts#nameKey). */
const nameKey = (name) => searchKey(name).replace(/\s+/g, " ");
const cellOf = (row, column) => {
  if (!(column in row)) throw new Error(`colonne absente du CSV : « ${column} »`);
  return (row[column] ?? "").trim();
};
/** Texte : l'apostrophe de tete de l'export retiree, vide -> null. */
const text = (v) => v.replace(/^'/, "").trim() || null;
const list = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
const YES = new Set(["yes", "maybe", "i'm open, but it isn't mandatory"]);
const yesNo = (v) => {
  const answer = v.toLowerCase();
  return YES.has(answer) ? true : answer === "no" ? false : null;
};
/** `D/M/YYYY` (export Airtable, format europeen) -> `YYYY-MM-DD`. */
const day = (v) => {
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};
const CATEGORY = { Technical: "technical", "Non-technical": "business", Hybrid: "hybrid" };
const CO_FOUNDERS = { Yes: "in_batch", "Outside the batch": "outside_batch", No: "none" };
/** Reponses qui ne disent rien (« No », « / », « Nope :) ») : pas recopiees. */
const NOTHING = /^(\/|\.|no|nope|not really|not for now|not in mind at this time)\W*$/i;

function anythingElseOf(row) {
  const parts = [];
  if (/part-time/i.test(cellOf(row, "Status"))) parts.push("Available part-time only.");
  const coFounders = text(cellOf(row, "If yes, write their names below."));
  if (coFounders) parts.push(`Co-founders: ${coFounders}`);
  const more = text(cellOf(row, "Anything else worth mentioning"));
  if (more && !NOTHING.test(more)) parts.push(more);
  return parts.join("\n\n") || null;
}

/** Ce que la ligne apporte, document par document (champs du modele, shared/types). */
function valuesOf(row) {
  const email = cellOf(row, "Email").toLowerCase() || null;
  const whatsapp = text(cellOf(row, "WhatsApp"));
  const age = cellOf(row, "Age");
  const name = cellOf(row, "Full Name");
  if (!(name in skillsByName)) throw new Error(`--skills : « ${name} » absent`);
  return {
    person: { email, whatsapp },
    founder: {
      profileCategory: CATEGORY[cellOf(row, "Profile type")] ?? null,
      hardSkills: list(cellOf(row, "Hard skills")),
      industries: list(cellOf(row, "Industries you have experience on")),
      rolesICouldTake: list(cellOf(row, "Roles I could take")),
    },
    directory: {
      email,
      whatsapp,
      nationality: text(cellOf(row, "Nationality")),
      education: list(cellOf(row, "Main education")),
      notableCompanies: list(cellOf(row, "Notable companies worked at")),
      trackRecord: text(cellOf(row, "Track Record")),
      interestedInWorkingOn: text(cellOf(row, "What I am interested in working on")),
      hasExistingProject: yesNo(cellOf(row, "Do you have an existing project/idea?")),
      projectExplanation: text(cellOf(row, "If yes, explain it in a few words")),
      hasExistingCoFounders: CO_FOUNDERS[cellOf(row, "Do you have existing co-founders in the batch?")] ?? null,
      openToJoinAnotherProject: yesNo(cellOf(row, "Are you open to join another project during the program?")),
      lookingForCoFounder: yesNo(cellOf(row, "Are you looking for a co-founder?")),
      coFounderTypeWanted: list(cellOf(row, "What type of co-founder are you looking for?")).join(", ") || null,
      coFounderSkillsWanted: skillsByName[name],
      industriesToExplore: list(cellOf(row, "Industries you want to gain experience in")),
      anythingElse: anythingElseOf(row),
    },
    profile: {
      birthDayString: day(cellOf(row, "Birth Date")),
      age: /^\d+$/.test(age) ? Number(age) : null,
      housingSupport: yesNo(cellOf(row, "Do you require housing support?")),
      tShirtSize: text(cellOf(row, "What's your t-shirt size?")),
      enrolmentConfirmed: cellOf(row, "I confirm my enrollment to the Pioneers 2026 Fall batch") === "I confirm" ? true : null,
    },
  };
}

// ---- Rattachement des lignes aux fondateurs du batch ----------------------------------
const founders = (await db.collection("founders").where("batchId", "==", BATCH_ID).get()).docs.filter(
  (d) => !d.data().archivedDateISOString,
);
const byName = Map.groupBy(founders, (d) => nameKey(d.data().name));
const problems = [];
const matches = [];
for (const row of rows) {
  const name = cellOf(row, "Full Name");
  const found = byName.get(nameKey(name)) ?? [];
  if (found.length !== 1) problems.push(`${name} : ${found.length} fondateur(s) de ${BATCH_ID} a ce nom`);
  else matches.push({ founder: found[0], incoming: valuesOf(row) });
}
if (problems.length) throw new Error(`lignes non rattachees, rien n'est ecrit :\n  ${problems.join("\n  ")}`);
const matchedIds = new Set(matches.map((m) => m.founder.id));
const unmatched = founders.filter((d) => !matchedIds.has(d.id)).map((d) => d.data().name);

// ---- Listes fermees : les valeurs nouvelles y entrent -----------------------------------
const LISTS = [
  ["positionFit", "rolesICouldTake", "founder"],
  ["industries", "industries", "founder"],
  ["industries", "industriesToExplore", "directory"],
  ["hardSkills", "hardSkills", "founder"],
  ["hardSkills", "coFounderSkillsWanted", "directory"],
];
const listUpdates = [];
for (const [key, specs] of Map.groupBy(LISTS, ([k]) => k)) {
  const current = (await db.doc(docPaths.list(key)).get()).data();
  if (!current) throw new Error(`liste ${docPaths.list(key)} absente`);
  const known = new Set(current.items.map((i) => i.value));
  const used = specs.flatMap(([, field, doc]) => matches.flatMap((m) => m.incoming[doc][field]));
  const fresh = [...new Set(used)].filter((v) => !known.has(v)).sort();
  // Les competences cherchees viennent d'un LLM : une valeur inconnue est une erreur, pas un ajout.
  if (key === "hardSkills" && fresh.length) throw new Error(`hard skills hors liste : ${fresh.join(", ")}`);
  if (fresh.length) {
    listUpdates.push({
      key,
      fresh,
      items: [...current.items, ...fresh.map((v) => ({ value: v, label: v, group: null, archived: false }))],
    });
  }
}

// ---- Remplir le vide ---------------------------------------------------------------------
// Les autres documents de chaque fondateur, lus en un appel (le document racine vient de la requete).
const refsOf = (founder) => ({
  founder: founder.ref,
  person: db.doc(docPaths.person(founder.data().personId)),
  directory: db.doc(docPaths.founderDirectory(founder.id)),
  profile: db.doc(docPaths.founderProfile(founder.id)),
});
const allRefs = matches.map((m) => refsOf(m.founder));
const snapshots = await db.getAll(...allRefs.flatMap((r) => [r.person, r.directory, r.profile]));
const STAMPED = new Set(["person", "founder"]);
const counts = {};
const writer = db.bulkWriter();
let documents = 0;
for (const [i, { founder, incoming }] of matches.entries()) {
  const refs = allRefs[i];
  const [person, directory, profile] = snapshots.slice(i * 3, i * 3 + 3).map((d) => d.data());
  const current = { person, founder: founder.data(), directory, profile };
  for (const [doc, fields] of Object.entries(incoming)) {
    if (!current[doc]) throw new Error(`${founder.data().name} : document ${doc} absent`);
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([field, v]) => !isEmptyValue(v) && isEmptyValue(current[doc][field])),
    );
    if (!Object.keys(patch).length) continue;
    for (const field of Object.keys(patch)) counts[`${doc}.${field}`] = (counts[`${doc}.${field}`] ?? 0) + 1;
    if (STAMPED.has(doc)) patch.updatedDateISOString = now;
    documents += 1;
    if (write) writer.update(refs[doc], patch);
  }
}
for (const { key, items } of listUpdates) {
  documents += 1;
  if (write) writer.set(db.doc(docPaths.list(key)), { items, updatedDateISOString: now }, { merge: true });
}
await writer.close();

console.log(`${matches.length} lignes rattachees${unmatched.length ? ` ; sans ligne : ${unmatched.join(", ")}` : ""}`);
for (const [field, n] of Object.entries(counts).sort()) console.log(`  ${field.padEnd(40)} ${n} rempli(s)`);
for (const { key, fresh } of listUpdates) console.log(`  lists/${key} +${fresh.length} : ${fresh.join(", ")}`);
console.log(`\n${documents} documents ${write ? "ecrits" : "a ecrire (a blanc, rien n'est ecrit)"}`);
