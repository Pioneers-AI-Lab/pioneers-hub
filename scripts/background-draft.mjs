// ----------------------------
// Grille Background : une premiere note proposee par Claude (lot 2, §2.13)
// ----------------------------
// node scripts/background-draft.mjs fall-2026                          a blanc : qui est note, qui a une proposition
// node scripts/background-draft.mjs fall-2026 --export profiles.json   les profils ANONYMES et la grille, a noter en session Claude
// node scripts/background-draft.mjs fall-2026 --apply profiles.json    a blanc : les propositions lues, ce qui serait ecrit
// node scripts/background-draft.mjs fall-2026 --apply profiles.json --prod   ecrit les propositions (projet REEL)
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/background-draft.mjs ...   emulateurs (--prod y ecrit)
//
// Remplace elo-rank.mjs (retire le 17/11 avec l'Elo). Sans cle API : `--export` ecrit un fichier sans nom ni email (ids
// anonymes P1, P2..., nom retire des textes) ; Claude le note dans une session et
// complete `results` : { "P1": { "execution": 0-5, "founderSignal": 0-5, "pedigree": 0-5,
// "geography": 0-5, "outstanding": false, "reasoning": "..." }, ... }. `--apply` relit
// le fichier, verifie chaque note (shared/background.ts#backgroundProblems) et ecrit
// `founders/{id}/private/internal.background.proposed` SEULEMENT : jamais
// `background.scores`, la note du staff, validee dans Admin > Background.
// Une proposition existante est remplacee ; un alias inconnu arrete le script avant toute ecriture.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Code partage compile (`npm --prefix functions run build`).
const require = createRequire(import.meta.url);
const { isBatchParticipant } = require("../functions/lib/shared/types/founder.js");
const { splitTextList } = require("../functions/lib/shared/text.js");
const { docPaths } = require("../functions/lib/shared/collections.js");
const {
  BACKGROUND_CRITERIA,
  BACKGROUND_MAX_NOTE,
  BACKGROUND_OUTSTANDING_BONUS,
  backgroundProblems,
  backgroundProposalWrite,
  backgroundScore,
  isBackgroundRated,
  ratedBackgroundScore,
} = require("../functions/lib/shared/background.js");

const args = process.argv.slice(2);
const batchId = args[0];
const write = args.includes("--prod");
const flagValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const exportPath = flagValue("--export");
const applyPath = flagValue("--apply");
if (!batchId || batchId.startsWith("--") || (exportPath && applyPath)) {
  console.error("usage: node scripts/background-draft.mjs <batchId> [--export out.json | --apply in.json] [--prod]");
  process.exit(1);
}

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
console.log(`${PROJECT_ID} · ${batchId} · ${write && applyPath ? "ECRITURE" : "a blanc"}\n`);

const PROMPT = `You rate founders' backgrounds for an early-stage founder accelerator like Pioneers, from their onboarding profile.

Score each criterion from 0 to ${BACKGROUND_MAX_NOTE} (integers): 0 nothing (or nothing you can check), 3 what we expect from a good founder in the batch, 5 exceptional.
${BACKGROUND_CRITERIA.map((c) => `- ${c.key} (${c.label}, ${c.points} points)${c.definition ? `: ${c.definition}` : ""}`).join("\n")}

The total is out of 100 (each criterion earns score / ${BACKGROUND_MAX_NOTE} x its points). "outstanding" (+${BACKGROUND_OUTSTANDING_BONUS}) is only possible with ${BACKGROUND_MAX_NOTE} on every criterion, for a truly exceptional profile.
Judge the background, not the idea or the current team. Don't be nice: not all experiences are on the same level. Give a short reasoning naming the decisive elements.`;

// ---- Les profils ----
const founderSnaps = await db.collection("founders").where("batchId", "==", batchId).get();
const founders = founderSnaps.docs.map((d) => ({ id: d.id, ...d.data() })).filter((f) => isBatchParticipant(f, batchId));
if (founders.length === 0) throw new Error(`Batch ${batchId} : aucun fondateur.`);
const [directories, internals] = await Promise.all([
  db.getAll(...founders.map((f) => db.doc(docPaths.founderDirectory(f.id)))),
  db.getAll(...founders.map((f) => db.doc(docPaths.founderInternal(f.id)))),
]);

/** Retire le nom du fondateur de ses textes (prenom, nom, nom complet). */
const scrub = (text, name) => {
  if (text === null || text === undefined) return text;
  const parts = [name, ...String(name).split(/\s+/)].filter((p) => p && p.length > 2);
  return parts.reduce((t, p) => t.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[name]"), String(text));
};
const list = (v) => (Array.isArray(v) && v.length ? v.join(", ") : null);
const yesNo = (v) => (v === true ? "yes" : v === false ? "no" : null);

const people = founders.map((f, i) => {
  const d = directories[i].data() ?? {};
  // Ni nom, ni email, ni telephone, ni LinkedIn : seulement ce qui sert a noter.
  const fields = [
    ["Profile", f.profileCategory],
    ["Roles I could take", list(f.rolesICouldTake)],
    ["Hard skills", list(f.hardSkills)],
    ["Years of experience", d.yearsOfXP],
    ["Repeat founder", yesNo(d.repeatFounder)],
    ["Nationality", d.nationality],
    ["Country", d.country],
    ["Education", [splitTextList(d.education).join("; "), d.degree, d.fieldOfStudy].filter(Boolean).join(", ") || null],
    ["Notable companies", list(d.notableCompanies)],
    ["Track record", d.trackRecord],
    ["Highlights", list(d.trackRecord3Liners)],
    ["Main startup in 2025", d.mainStartup2025],
    ["Existing project", d.projectExplanation],
    ["Introduce yourself", d.introduceYourself],
  ];
  const lines = fields.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([label, v]) => `${label}: ${scrub(v, f.name)}`);
  return { founder: f, alias: `P${i + 1}`, text: lines.join("\n"), background: internals[i].data()?.background ?? null };
});

// ---- Exporter : profils anonymes et grille ----
if (exportPath) {
  const out = {
    batchId,
    prompt: PROMPT,
    criteria: BACKGROUND_CRITERIA,
    // Ids anonymes -> ids de fondateurs (ni nom ni email) : `--apply` relie les notes.
    founderIdByAlias: Object.fromEntries(people.map((p) => [p.alias, p.founder.id])),
    profiles: Object.fromEntries(people.map((p) => [p.alias, p.text])),
    results: {},
  };
  writeFileSync(exportPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${people.length} profils anonymes exportes dans ${exportPath}. Completer \`results\`, puis --apply.`);
  process.exit(0);
}

// ---- A blanc sans fichier : l'etat du batch ----
if (!applyPath) {
  for (const p of people) {
    const b = p.background;
    const rated = isBackgroundRated(b) ? `note ${ratedBackgroundScore(b)}` : "a noter";
    const proposed = b?.proposed ? ` · proposition ${backgroundScore(b.proposed.scores, b.proposed.outstanding)}` : "";
    console.log(`  ${p.alias.padEnd(4)} ${p.founder.name} : ${rated}${proposed}`);
  }
  console.log(`\n${people.length} fondateurs. --export pour les noter en session Claude, puis --apply.`);
  process.exit(0);
}

// ---- Appliquer : verifier chaque note, puis ecrire `background.proposed` ----
const file = JSON.parse(readFileSync(applyPath, "utf8"));
if (file.batchId !== batchId) throw new Error(`${applyPath} est pour le batch ${file.batchId}.`);
const byFounderId = new Map(people.map((p) => [p.founder.id, p]));
const now = new Date().toISOString();
const planned = Object.entries(file.results ?? {}).map(([alias, r]) => {
  const person = byFounderId.get(file.founderIdByAlias?.[alias]);
  if (!person) throw new Error(`${alias} : fondateur inconnu ou sorti du batch.`);
  const scores = Object.fromEntries(BACKGROUND_CRITERIA.map((c) => [c.key, r?.[c.key]]));
  const outstanding = r?.outstanding === true;
  const problems = backgroundProblems(scores, outstanding);
  if (problems.length) throw new Error(`${alias} : ${problems.join(" ")}`);
  const reasoning = typeof r.reasoning === "string" && r.reasoning.trim() ? r.reasoning.trim() : null;
  return { person, write: backgroundProposalWrite(person.founder.id, { scores, outstanding, reasoning }, now), score: backgroundScore(scores, outstanding) };
});
if (planned.length === 0) throw new Error(`${applyPath} : aucune note dans \`results\`.`);

for (const { person, score } of planned.sort((a, b) => b.score - a.score)) {
  const staff = isBackgroundRated(person.background) ? ` (note du staff gardee : ${ratedBackgroundScore(person.background)})` : "";
  console.log(`  ${String(score).padStart(5)}  ${person.alias.padEnd(4)} ${person.founder.name}${staff}`);
}
if (write) {
  const batch = db.batch();
  for (const { write: w } of planned) batch.set(db.doc(w.path), w.data, { merge: true });
  await batch.commit();
}
console.log(`\n${planned.length} proposition(s) ${write ? "ecrite(s) dans background.proposed" : "a ecrire (relancer avec --prod)"}.`);
