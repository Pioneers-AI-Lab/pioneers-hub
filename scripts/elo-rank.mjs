// ----------------------------
// Classement Elo du parcours (SPECS §5.1, sous-score Achievements et Team)
// ----------------------------
// node scripts/elo-rank.mjs fall-2026                 a blanc : les groupes, sans appel au modele
// node scripts/elo-rank.mjs fall-2026 --prod          classe et ecrit (projet REEL ; appelle Claude, payant)
// node scripts/elo-rank.mjs fall-2026 --prod --rounds 8
//
// Repris de FoundersEloRanking (prompt, facteur K, duels deux a deux) : a chaque
// tour, les fondateurs du batch sont repartis en groupes de 5 ; Claude classe
// chaque groupe du meilleur au moins bon profil ; chaque classement donne 10
// duels, et l'Elo de chacun suit la methode Elo (depart 1 000, ou l'Elo deja en
// base : relancer le script affine le classement quand les profils sont completes).
//
// Le modele ne recoit NI nom NI email (SPECS §5.1) : chaque profil a un id
// anonyme (P1, P2...), et le nom du fondateur est retire de ses textes.
// Ecrit `eloMatches/{id}` (le raisonnement est garde : il alimente la fiche) et
// `founders/{id}/private/internal` (`eloScore`, `eloMatchesCount`). Puis le
// bouton « Recompute scores » (Admin > Batch settings) les fait entrer dans les scores.
//
// Il faut une cle API Anthropic (ANTHROPIC_API_KEY) ou un profil `ant auth login`.

import { createRequire } from "node:module";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const require = createRequire(import.meta.url);
const { isBatchParticipant } = require("../functions/lib/shared/types/founder.js");

const PROJECT_ID = "pioneers-3627c";
/** Appels au modele en parallele ; l'Elo, lui, se met a jour dans l'ordre des groupes. */
const CONCURRENCY = 6;
const MODEL = "claude-opus-5-5";
const PROMPT_VERSION = "fa26-elo-1";
const GROUP = 5;

const args = process.argv.slice(2);
const batchId = args[0];
const write = args.includes("--prod");
const rounds = Number(args[args.indexOf("--rounds") + 1]) || 8;
if (!batchId || batchId.startsWith("--")) {
  console.error("usage: node scripts/elo-rank.mjs <batchId> [--prod] [--rounds 8]");
  process.exit(1);
}

const PROMPT = `You are an investment committee member for an early-stage founder accelerator like Pioneers.

Your goal is to identify founders most able to build and scale a global tech company.

Profile looked for:

If Technical Profile
- Built and launched software from scratch.
- Deployed products at scale.
- Full-stack development with LLM expertise.
- Speed over perfection: execution trumps perfectionism.

If Business Profile
- Deep industry expertise and market insights.
- Hands-on operators in sales, growth, or product.
- 5-10 years of working experience in a sector or function.
- Bias for action: fast, iterative, and decisive.

Bonus for Repeat Founder:
++ If Users (for b2c) / paying customers (for b2b) (more the better)
+++ If Raised round (higher the better)
++++ If Strong ARR kpi (higher the better)
+++++ If Exited previous company (bigger exit the better)

Bonus for Experiences in famous scale-ups or big tech:
+ For long experience
+ For high responsibilities
+++ For early employees
+++ For C-level or Head of Sales / Product / Engineering (bigger company the better)
+ For industry insight

Bonus Community:
++ For community leader with a big following base

Bonus Education:
++ For top international universities
+ For prestigious schools
+ For PhD or Masters degree

Bonus Mindset:
+ Obsessive Ambition
+ Unconventional Leadership
+ Contrarian Actions

Idea and team are not important. Judge on their background and their potential, not on the idea or team they currently have.

You will get 5 founder profiles from the onboarding form of the batch: how they introduce themselves, their track record, education, experience, skills and what they want to work on.

Compare them to each other and rank them from the best fitting profile for the Pioneers batch to the least fitting.
Don't be nice. Be honest, fair and objective. Not all experiences are on the same level: we are looking for outstanding achievements, not attendance credits.
Rank all 5, each Id exactly once, no ties: make a decision even if founders are close. Give a short reasoning for each place, naming the decisive elements.`;

const RankingSchema = z.object({
  ranking: z
    .array(z.object({ id: z.string(), reasoning: z.string() }))
    .length(GROUP),
});
const RANKING_JSON_SCHEMA = {
  type: "object",
  properties: {
    ranking: {
      type: "array",
      description: "From the strongest (first) to the weakest (last) founder.",
      items: {
        type: "object",
        properties: { id: { type: "string" }, reasoning: { type: "string" } },
        required: ["id", "reasoning"],
        additionalProperties: false,
      },
    },
  },
  required: ["ranking"],
  additionalProperties: false,
};

// ---- Methode Elo (FoundersEloRanking) ----
const probabilityOfWin = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
const kFactor = (nA, nB, minK = 10) => {
  const rawK = 100 * 0.8 ** Math.sqrt(nA);
  const uncertainty = 1 / ((nB / 2) ** 2 + 1);
  return Math.max(rawK * (1 - uncertainty), minK);
};

// ---- Les profils ----
initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();

const founderSnaps = await db.collection("founders").where("batchId", "==", batchId).get();
const founders = founderSnaps.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((f) => isBatchParticipant(f, batchId));
if (founders.length < GROUP) throw new Error(`Batch ${batchId} : ${founders.length} fondateur(s), il en faut au moins ${GROUP}.`);
const [directories, internals] = await Promise.all([
  db.getAll(...founders.map((f) => db.doc(`founders/${f.id}/private/directory`))),
  db.getAll(...founders.map((f) => db.doc(`founders/${f.id}/private/internal`))),
]);

/** Retire le nom du fondateur de ses textes (prenom, nom, nom complet). */
const scrub = (text, name) => {
  if (!text) return text;
  const parts = [name, ...String(name).split(/\s+/)].filter((p) => p && p.length > 2);
  return parts.reduce((t, p) => t.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[name]"), String(text));
};
const list = (v) => (Array.isArray(v) && v.length ? v.join(", ") : null);

const people = founders.map((f, i) => {
  const d = directories[i].data() ?? {};
  const alias = `P${i + 1}`;
  const fields = [
    ["Profile", f.profileCategory],
    ["Roles I could take", list(f.rolesICouldTake)],
    ["Hard skills", list(f.hardSkills)],
    ["Industries", list(f.industries)],
    ["Years of experience", d.yearsOfXP],
    ["Education", [d.education, d.degree, d.fieldOfStudy].filter(Boolean).join(", ") || null],
    ["Notable companies", list(d.notableCompanies)],
    ["Introduce yourself", d.introduceYourself],
    ["Track record", d.trackRecord],
    ["Highlights", list(d.trackRecord3Liners)],
    ["Main startup in 2025", d.mainStartup2025],
    ["Existing project", d.projectExplanation],
    ["Interested in working on", d.interestedInWorkingOn],
  ];
  const lines = [`Id: ${alias}`, ...fields.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([label, v]) => `${label}: ${scrub(v, f.name)}`)];
  const internal = internals[i].data() ?? {};
  return {
    founderId: f.id,
    alias,
    text: lines.join("\n"),
    elo: typeof internal.eloScore === "number" ? internal.eloScore : 1000,
    matches: internal.eloMatchesCount ?? 0,
  };
});
const byAlias = new Map(people.map((p) => [p.alias, p]));

// ---- Les groupes : a chaque tour, un melange, des groupes de 5 (le dernier complete au hasard) ----
const shuffle = (xs) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const plan = [];
for (let r = 0; r < rounds; r++) {
  const order = shuffle(people);
  for (let i = 0; i < order.length; i += GROUP) {
    const group = order.slice(i, i + GROUP);
    if (group.length < 2) continue;
    while (group.length < GROUP) {
      const extra = people[Math.floor(Math.random() * people.length)];
      if (!group.includes(extra)) group.push(extra);
    }
    plan.push(group);
  }
}
console.log(`${people.length} fondateurs, ${rounds} tours : ${plan.length} classements de ${GROUP} (${plan.length * 10} duels), modele ${MODEL}.`);
if (!write) {
  console.log("A blanc : aucun appel au modele, rien d'ecrit. Ajouter --prod pour classer (appels payants a l'API Anthropic).");
  process.exit(0);
}

// ---- Le classement d'un groupe par Claude ----
const client = new Anthropic();

async function rankGroup(group) {
  const ids = new Set(group.map((p) => p.alias));
  const profiles = shuffle(group).map((p) => p.text).join("\n\n---\n\n");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: RANKING_JSON_SCHEMA } },
      system: PROMPT,
      messages: [{ role: "user", content: `FOUNDERS TO RANK\n\n${profiles}` }],
    });
    if (response.stop_reason === "refusal") {
      console.warn(`  refus du modele (${response.stop_details?.category ?? "?"}), essai ${attempt}`);
      continue;
    }
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    let parsed;
    try {
      parsed = RankingSchema.parse(JSON.parse(text));
    } catch (e) {
      console.warn(`  reponse illisible, essai ${attempt}: ${e.message}`);
      continue;
    }
    const ranked = parsed.ranking.map((r) => r.id);
    if (new Set(ranked).size !== GROUP || ranked.some((id) => !ids.has(id))) {
      console.warn(`  classement incomplet (${ranked.join(", ")}), essai ${attempt}`);
      continue;
    }
    return { ranked, reasoning: parsed.ranking.map((r, i) => `${i + 1}. ${r.id}: ${r.reasoning}`).join("\n"), model: response.model };
  }
  return null;
}

// Les classements en parallele, par paquets ; chacun garde sa place dans le plan.
const results = new Array(plan.length);
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < plan.length) {
      const n = next++;
      results[n] = await rankGroup(plan[n]);
      if (n % 10 === 9) console.log(`  ~${n + 1}/${plan.length} classements`);
    }
  }),
);

const matches = [];
for (const [n, group] of plan.entries()) {
  const result = results[n];
  if (!result) {
    console.warn(`groupe ${group.map((p) => p.alias).join(", ")} : ignore apres 3 essais`);
    continue;
  }
  const before = new Map(result.ranked.map((a) => [a, byAlias.get(a).elo]));
  // Chaque paire (i avant j) : i gagne. Mise a jour sequentielle, comme FoundersEloRanking.
  for (let i = 0; i < result.ranked.length; i++) {
    for (let j = i + 1; j < result.ranked.length; j++) {
      const winner = byAlias.get(result.ranked[i]);
      const loser = byAlias.get(result.ranked[j]);
      const kW = kFactor(winner.matches, loser.matches);
      const kL = kFactor(loser.matches, winner.matches);
      const eloW = winner.elo;
      winner.elo += kW * (1 - probabilityOfWin(eloW, loser.elo));
      loser.elo += kL * (0 - probabilityOfWin(loser.elo, eloW));
      winner.matches += 1;
      loser.matches += 1;
    }
  }
  // Le raisonnement garde les ids anonymes ; le document les relie aux fondateurs.
  const match = {
    programId: founders[0].programId,
    batchId,
    rankedFounderIds: result.ranked.map((a) => byAlias.get(a).founderId),
    reasoning: result.reasoning,
    eloDeltas: Object.fromEntries(result.ranked.map((a) => [byAlias.get(a).founderId, Math.round((byAlias.get(a).elo - before.get(a)) * 10) / 10])),
    model: result.model,
    promptVersion: PROMPT_VERSION,
    dateISOString: new Date().toISOString(),
  };
  matches.push(match);
}

const writer = db.bulkWriter();
for (const match of matches) writer.create(db.collection("eloMatches").doc(), match);
for (const p of people) {
  writer.set(db.doc(`founders/${p.founderId}/private/internal`), { eloScore: Math.round(p.elo * 10) / 10, eloMatchesCount: p.matches }, { merge: true });
}
await writer.close();
console.log(`${matches.length}/${plan.length} classements. Elo ecrit pour ${people.length} fondateurs :`);
for (const p of [...people].sort((a, b) => b.elo - a.elo)) console.log(`  ${Math.round(p.elo)}  ${p.alias}  (${p.matches} duels)`);
