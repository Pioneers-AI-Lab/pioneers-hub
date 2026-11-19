// ----------------------------
// Migration : secteurs et roles resserres en familles (decision du 19/11)
// ----------------------------
// node scripts/migrate-tag-families.mjs            a blanc, projet reel (lecture seule)
// node scripts/migrate-tag-families.mjs --prod     ecrit, projet reel
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 node scripts/migrate-tag-families.mjs [--prod]   emulateurs
//
// Tous les batchs. Card « Profile distribution » de l'accueil : une dizaine de barres au plus.
//   - `founders.industries` et `founderDirectory.industriesToExplore` (liste `industries`) : 64 secteurs
//     -> 9 familles (INDUSTRY_FAMILIES) ; « Generative AI » est RETIRE (tout le monde l'indiquait).
//   - `founders.rolesICouldTake` (liste `positionFit`) : les 9 libelles du Profile Book 2025 rejoignent
//     les 12 roles de l'onboarding (ROLE_MERGES).
//   - Competences (`hardSkills`) : inchangees (10 valeurs, deja propres).
// Dedoublonne (Fintech + Financial Services -> une seule « Finance & Insurance »), garde l'ordre.
// Listes fermees : les familles sont ajoutees, les anciennes valeurs ARCHIVEES (rien n'est supprime),
// le profil ne propose plus que les familles. Puis `batchStats.industriesDistribution` et
// `rolesDistribution` de chaque batch (regle de shared/batchStats.ts) : spring-2026 n'est jamais
// recalcule par les scores (`scoresSource: "imported"`), seul ce script les lui donne.
// Rejouable : une valeur deja en famille n'est pas touchee. Affiche avant -> apres.
//
// Lit le code partage compile : `npm --prefix functions run build` apres un changement de functions/src/shared.

import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { COL, docPaths } = require("../functions/lib/shared/collections.js");
const { computeBatchStats } = require("../functions/lib/shared/batchStats.js");
const { isBatchParticipant } = require("../functions/lib/shared/types/index.js");

/** Famille -> secteurs qu'elle remplace (table validee le 19/11). */
const INDUSTRY_FAMILIES = {
  "Finance & Insurance": ["Fintech", "Financial Services", "Investment Banking", "M&A", "Corporate Finance", "Private Equity", "Venture Capital", "InsurTech", "Insurance"],
  "B2B Software & Services": ["B2B SaaS", "Productivity Tools", "CRM", "Sales Enablement", "Marketing Tech", "AdTech", "Human Resources", "Future of Work", "Frontline Worker Tech", "Cybersecurity", "Strategy Consulting", "GovTech", "Public Policy"],
  "Consumer & Media": ["Consumer", "Marketplace", "E-commerce", "Retail", "FoodTech", "Beauty Tech", "Gaming", "Media"],
  "Deep Tech & Robotics": ["DeepTech", "Robotics", "Quantum Computing", "Nanotechnology", "Physics", "Autonomous Vehicles"],
  "Health & Life Sciences": ["HealthTech", "MedTech", "Biotechnology", "Pharmaceuticals", "Genomics", "Wellness"],
  "Energy, Climate & Industry": ["Energy", "Cleantech", "Sustainability", "AgTech", "Mining", "Metals", "Manufacturing", "Heavy Industry", "Supply Chain", "Logistics", "Automotive"],
  "Aerospace & Defense": ["Defense", "Military", "Military Operations", "Space Tech", "Aerospace", "Aeronautics"],
  "Real Estate": ["Real Estate", "PropTech"],
  Education: ["EdTech", "Education"],
};
const DROPPED_INDUSTRIES = new Set(["Generative AI"]);

/** Role de l'onboarding -> anciens libelles du Profile Book 2025 qu'il absorbe. */
const ROLE_MERGES = {
  "Engineering & Technology": ["Tech Dev / Prototyping"],
  "Product & User Experience": ["Product"],
  "Sales & Revenue": ["Sales"],
  "Marketing & Growth": ["Growth", "Marketing"],
  "Operations & Delivery": ["Operations"],
  "Design & Brand": ["Design"],
  "Finance & Legal": ["Finance"],
  "People & Culture": ["People / Culture / Hiring"],
};

const inverse = (groups) => new Map(Object.entries(groups).flatMap(([to, froms]) => froms.map((from) => [from, to])));
const industryOf = inverse(INDUSTRY_FAMILIES);
const roleOf = inverse(ROLE_MERGES);

/** Valeurs migrees, dedoublonnees dans l'ordre ; une valeur inconnue est gardee et notee dans `unknown`. */
function migrate(values, renames, known, unknown, dropped = new Set()) {
  const out = [];
  for (const v of values ?? []) {
    if (dropped.has(v)) continue;
    const to = renames.get(v) ?? v;
    if (!renames.has(v) && !known.has(v)) unknown.add(v);
    if (!out.includes(to)) out.push(to);
  }
  return out;
}
const same = (a, b) => (a ?? []).length === b.length && b.every((v, i) => a[i] === v);

const write = process.argv.includes("--prod");
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
const now = new Date().toISOString();
console.log(`${PROJECT_ID} · tous les batchs · ${write ? "ECRITURE" : "a blanc"}\n`);

// ---- Listes fermees ----
const [industriesList, positionFitList] = (await db.getAll(db.doc(docPaths.list("industries")), db.doc(docPaths.list("positionFit")))).map((d) => d.data());
const industryFamilies = new Set(Object.keys(INDUSTRY_FAMILIES));
const roles = new Set((positionFitList?.items ?? []).map((i) => i.value).filter((v) => !roleOf.has(v)));

/** La liste : les valeurs cibles actives (dans `order`, ajoutees si absentes), les autres archivees. */
function migratedList(list, active, order) {
  const items = (list?.items ?? []).map((i) => ({ ...i, archived: !active.has(i.value) }));
  for (const v of order) if (!items.some((i) => i.value === v)) items.push({ value: v, label: v, group: null, archived: false });
  const rank = (i) => (i.archived ? order.length : order.indexOf(i.value));
  return items.sort((a, b) => rank(a) - rank(b));
}
const listOps = [
  { key: "industries", before: industriesList, after: migratedList(industriesList, industryFamilies, Object.keys(INDUSTRY_FAMILIES)) },
  { key: "positionFit", before: positionFitList, after: migratedList(positionFitList, roles, [...roles]) },
].filter(({ before, after }) => JSON.stringify(before?.items) !== JSON.stringify(after));
for (const { key, before, after } of listOps) {
  const archived = after.filter((i) => i.archived && !before?.items.find((b) => b.value === i.value)?.archived).map((i) => i.value);
  console.log(`lists/${key}\n  actives  : ${after.filter((i) => !i.archived).map((i) => i.value).join(", ")}\n  archivees: ${archived.join(", ") || "(aucune nouvelle)"}`);
}

// ---- Fondateurs et annuaires ----
const founders = (await db.collection(COL.founders).get()).docs;
const directories = founders.length ? await db.getAll(...founders.map((f) => db.doc(docPaths.founderDirectory(f.id)))) : [];
const unknown = new Set();
/** Les ecritures a faire : `{ path, data }`. */
const founderOps = [];
const directoryOps = [];
const migrated = [];
for (const [i, f] of founders.entries()) {
  const before = f.data();
  const lines = [];
  const industries = migrate(before.industries, industryOf, industryFamilies, unknown, DROPPED_INDUSTRIES);
  const rolesICouldTake = migrate(before.rolesICouldTake, roleOf, roles, unknown);
  migrated.push({ ...before, industries, rolesICouldTake });
  /** `next` differe de `was` : il va dans `doc` et s'affiche avant -> apres. */
  const changes = (doc, field, was, next) => {
    if (same(was, next)) return;
    doc[field] = next;
    lines.push(`  ${field} : ${JSON.stringify(was ?? [])}\n    -> ${JSON.stringify(next)}`);
  };
  const data = {};
  changes(data, "industries", before.industries, industries);
  changes(data, "rolesICouldTake", before.rolesICouldTake, rolesICouldTake);
  if (Object.keys(data).length) founderOps.push({ path: f.ref.path, data });
  const dir = directories[i];
  const was = dir.exists ? dir.get("industriesToExplore") : undefined;
  if (Array.isArray(was)) {
    const dirData = {};
    changes(dirData, "industriesToExplore", was, migrate(was, industryOf, industryFamilies, unknown, DROPPED_INDUSTRIES));
    if (Object.keys(dirData).length) directoryOps.push({ path: dir.ref.path, data: dirData });
  }
  if (lines.length) console.log(`\n${before.name ?? f.id} (${before.batchId})\n${lines.join("\n")}`);
}
if (unknown.size) console.log(`\nATTENTION valeurs hors table, gardees telles quelles : ${[...unknown].join(", ")}`);

// ---- batchStats : les deux nouvelles repartitions, sur les fondateurs migres ----
const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ");
const batchIds = [...new Set(founders.map((f) => f.get("batchId")))];
const statsDocs = await db.getAll(...batchIds.map((id) => db.doc(`${COL.batchStats}/${id}`)));
const statsOps = [];
for (const [i, batchId] of batchIds.entries()) {
  if (!statsDocs[i].exists) continue;
  const participants = migrated.filter((f) => isBatchParticipant(f, batchId));
  const s = computeBatchStats("", participants.map((founder) => ({ founder, directory: null })), now);
  statsOps.push({ path: statsDocs[i].ref.path, data: { industriesDistribution: s.industriesDistribution, rolesDistribution: s.rolesDistribution } });
  console.log(`\nbatchStats/${batchId} (${participants.length} participants)\n  industries : ${fmt(s.industriesDistribution)}\n  roles      : ${fmt(s.rolesDistribution)}`);
}

console.log(`\n${founders.length} fondateur(s) lu(s) : ${founderOps.length} fiche(s) et ${directoryOps.length} annuaire(s) a migrer, ${listOps.length} liste(s), ${statsOps.length} batchStats.`);
if (!write) {
  console.log("A blanc : rien n'est ecrit. Relancer avec --prod pour ecrire.");
  process.exit(0);
}
const all = [
  ...founderOps,
  ...directoryOps,
  ...listOps.map(({ key, after }) => ({ path: docPaths.list(key), data: { items: after, updatedDateISOString: now } })),
  ...statsOps,
];
for (let i = 0; i < all.length; i += 400) {
  const batch = db.batch();
  for (const o of all.slice(i, i + 400)) batch.update(db.doc(o.path), o.data);
  await batch.commit();
}
console.log(`Ecrit : ${all.length} document(s).`);
