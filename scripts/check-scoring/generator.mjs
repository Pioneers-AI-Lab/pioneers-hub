// ----------------------------
// Verification du generateur de groupes (shared/teamGenerator.ts) : shortlists et « Met »
// ----------------------------
// node scripts/check-scoring/generator.mjs
// Lit le code partage compile : `npm --prefix functions run build` avant.
// Cas deterministes (aleatoire a graine, plusieurs graines par cas) ; sort en
// code 1 au premier echec, avec le cas et le tirage fautif.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GENERATOR_PRESETS, buildPairPreferences, generateGroups, pairKey, scoreGroups } = require("../../functions/lib/shared/teamGenerator.js");

const SEEDS = 20;

/** Aleatoire a graine (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Meme sortie que les autres suites de check-scoring.
function fail(name, message, groups) {
  console.error(`  FAIL ${name}\n${message}${groups ? `\ngroups: ${JSON.stringify(groups)}` : ""}`);
  process.exit(1);
}

const pass = (name) => console.log(`  ok  ${name}`);

/** { id: ["shortlisted", ...] } et { id: ["met", ...] } -> Map de ConnectionLists. */
function connections({ shortlist = {}, met = {} }) {
  const ids = new Set([...Object.keys(shortlist), ...Object.keys(met)]);
  return new Map([...ids].map((id) => [id, { shortlistedFounderIds: shortlist[id] ?? [], metFounderIds: met[id] ?? [] }]));
}

const history = ({ challenge = [], matching = [] } = {}) => ({
  challenge: new Map(challenge.map(([a, b, n = 1]) => [pairKey(a, b), n])),
  matching: new Map(matching.map(([a, b, n = 1]) => [pairKey(a, b), n])),
});

const people = (ids, category = "technical") => ids.map((id) => ({ id, category }));

/** L'entree du generateur, a partir d'un cas ecrit court. */
const makeInput = ({ mode = "challenge", participants, groupSize, prefs = {}, past, keepApart = [], keepTogether = [], fixedGroups = [] }) => ({
  participants,
  groupSize,
  history: history(past),
  rules: GENERATOR_PRESETS[mode].rules,
  preferences: buildPairPreferences(connections(prefs)),
  keepApart,
  keepTogether,
  fixedGroups,
});

/** Tire avec chaque graine et verifie `check(groups, report)` (message d'echec ou rien). */
function draw(name, scenario, check) {
  const input = makeInput(scenario);
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { groups, report } = generateGroups({ ...input, random: seeded(seed) });
    const error = check(groups, report);
    if (error) fail(name, `${error} (seed ${seed}, ${report.summary} ${report.relaxed.join(" ")})`, groups);
  }
  pass(name);
}

const together = (groups, a, b) => groups.some((g) => g.includes(a) && g.includes(b));

// ---- Paires de preferences -----------------------------------------------------------

{
  const name = "preferences: mutual, one-way, reciprocal Met, self ignored";
  const prefs = buildPairPreferences(
    connections({
      shortlist: { a: ["b", "c", "a"], b: ["a"], d: ["a"] },
      met: { a: ["b", "c"], b: ["a"], c: [] },
    }),
  );
  const same = (set, keys) => set.size === keys.length && keys.every((k) => set.has(k));
  if (!same(prefs.mutualShortlist, [pairKey("a", "b")])) fail(name, `mutual = ${[...prefs.mutualShortlist]}`);
  if (!same(prefs.oneWayShortlist, [pairKey("a", "c"), pairKey("a", "d")])) fail(name, `one-way = ${[...prefs.oneWayShortlist]}`);
  if (!same(prefs.reciprocalMet, [pairKey("a", "b")])) fail(name, `reciprocal Met = ${[...prefs.reciprocalMet]}`);
  pass(name);
}

// ---- Hackathon (challenge) ---------------------------------------------------------------

draw(
  "challenge: a mutual shortlist pair ends up together",
  { participants: people(["a", "b", "c", "d", "e", "f", "g", "h", "i"]), groupSize: 3, prefs: { shortlist: { a: ["b"], b: ["a"] } } },
  (groups, report) => {
    if (!together(groups, "a", "b")) return "a and b apart";
    if (report.mutualShortlistPairs !== 1 || report.mutualShortlistPossible !== 1) return "report does not count the mutual pair";
    if (!report.summary.includes("1 of 1 mutual shortlist pairs together")) return "summary does not mention the mutual pair";
  },
);

draw(
  "challenge: a pair already teamed up is never reunited, even mutually shortlisted",
  {
    participants: people(["a", "b", "c", "d", "e", "f"]),
    groupSize: 3,
    prefs: { shortlist: { a: ["b"], b: ["a"] } },
    past: { challenge: [["a", "b"]] },
  },
  (groups, report) => {
    if (together(groups, "a", "b")) return "a and b reunited";
    if (report.repeatedChallengePairs !== 0) return "repeated pair reported";
    if (!report.relaxed.some((l) => l.includes("1 mutual shortlist pair apart"))) return "report does not say the mutual pair is apart";
  },
);

draw(
  "challenge: a pair already teamed up is reunited when the staff forces it, not reported as repeated",
  {
    participants: people(["a", "b", "c", "d", "e", "f"]),
    groupSize: 3,
    prefs: { shortlist: { a: ["b"], b: ["a"] } },
    past: { challenge: [["a", "b"]] },
    keepTogether: [["a", "b"]],
  },
  (groups, report) => {
    if (!together(groups, "a", "b")) return "forced pair apart";
    if (report.repeatedChallengePairs !== 0) return "forced pair reported as repeated";
    if (report.relaxed.length > 0) return `unexpected relaxed lines`;
  },
);

draw(
  "challenge: mutual beats one-way when they conflict (one partner each)",
  {
    participants: people(["a", "b", "c", "d"]),
    groupSize: 2,
    // a et b mutuels ; c a shortliste a (sens unique) : a ne peut aller qu'avec l'un des deux.
    prefs: { shortlist: { a: ["b"], b: ["a"], c: ["a"] } },
  },
  (groups) => (together(groups, "a", "b") ? undefined : "mutual pair a-b apart"),
);

draw(
  "challenge: one mutual pair beats two one-way pairs",
  {
    participants: people(["a", "b", "c", "d", "e", "f"]),
    groupSize: 2,
    // {ab, cd, ef} : 1 mutuelle ; {ac, be, df} : 2 a sens unique.
    prefs: { shortlist: { a: ["b"], b: ["a"], c: ["a"], e: ["b"] } },
  },
  (groups) => (together(groups, "a", "b") ? undefined : "mutual pair a-b apart"),
);

draw(
  "challenge: a one-way shortlist pair ends up together",
  { participants: people(["a", "b", "c", "d", "e", "f"]), groupSize: 3, prefs: { shortlist: { a: ["b"] } } },
  (groups, report) => {
    if (!together(groups, "a", "b")) return "one-way pair a-b apart";
    if (!report.summary.includes("1 of 1 one-way")) return "summary does not mention the one-way pair";
  },
);

draw(
  "challenge: a one-way shortlist beats a shared lunch",
  {
    participants: people(["a", "b", "c", "d", "e", "f"]),
    groupSize: 3,
    prefs: { shortlist: { a: ["b"] } },
    past: { matching: [["a", "b", 3]] },
  },
  (groups) => (together(groups, "a", "b") ? undefined : "one-way pair a-b apart"),
);

draw(
  "challenge: the tech rule beats the shortlists",
  {
    // 2 tech, 4 business : les 3 business x, y, z se shortlistent tous (3 paires mutuelles).
    participants: [...people(["t1", "t2"]), ...people(["x", "y", "z", "w"], "business")],
    groupSize: 3,
    prefs: { shortlist: { x: ["y", "z"], y: ["x", "z"], z: ["x", "y"], t1: ["t2"], t2: ["t1"] } },
  },
  (groups, report) => {
    if (report.groupsWithoutTech !== 0) return "a team without a technical profile";
    if (together(groups, "t1", "t2")) return "both techs in the same team";
  },
);

draw(
  "challenge: the no-repeat rule beats the tech rule",
  {
    participants: [...people(["t1", "t2"]), ...people(["x", "y", "z", "w"], "business")],
    groupSize: 3,
    // Chaque tech deja avec y, z et w : la seule repartition sans paire repetee laisse une equipe sans tech.
    past: { challenge: ["t1", "t2"].flatMap((t) => ["y", "z", "w"].map((b) => [t, b])) },
  },
  (groups, report) => {
    if (report.repeatedChallengePairs !== 0) return "a repeated pair to keep a tech in each team";
    if (report.groupsWithoutTech !== 1) return "expected one team without a technical profile";
  },
);

draw(
  "challenge: locked groups (H5) are kept and counted in the report",
  {
    participants: people(["a", "b", "c", "d", "e", "f", "g"]),
    groupSize: 2,
    prefs: { shortlist: { a: ["b"], b: ["a"], c: ["d"], d: ["c"] } },
    fixedGroups: [{ key: "0", memberIds: ["a", "b", "e"] }],
  },
  (groups, report) => {
    if (groups.some((g) => g.some((id) => ["a", "b", "e"].includes(id)))) return "a locked member was drawn";
    if (groups.flat().length !== 4) return "not every free participant was placed";
    if (!together(groups, "c", "d")) return "mutual pair c-d apart";
    if (report.mutualShortlistPairs !== 2 || report.mutualShortlistPossible !== 2) return "locked mutual pair not counted";
  },
);

// ---- Lunch roulette (matching) -------------------------------------------------------------

draw(
  "matching: avoids a reciprocal Met, not a one-way Met (and Met beats hackathon teammates)",
  {
    mode: "matching",
    participants: people(["a", "b", "c", "d"]),
    groupSize: 2,
    // a-b : Met reciproque ; a-c : Met a sens unique ; a-d : coequipiers de hackathon.
    prefs: { met: { a: ["b", "c"], b: ["a"] } },
    past: { challenge: [["a", "d"]] },
  },
  (groups) => (together(groups, "a", "c") ? undefined : "a should sit with c (one-way Met is not avoided)"),
);

draw(
  "matching: the no-repeat rule beats a reciprocal Met",
  {
    mode: "matching",
    participants: people(["a", "b", "c", "d"]),
    groupSize: 2,
    prefs: { met: { a: ["b"], b: ["a"] } },
    past: { matching: [["a", "c"], ["a", "d"]] },
  },
  (groups, report) => {
    if (!together(groups, "a", "b")) return "a should sit with b";
    if (report.reciprocalMetPairs !== 1 || !report.relaxed.some((l) => l.includes("both marked each other as met"))) return "Met pair not reported";
  },
);

draw(
  "matching: shortlists play no part at a lunch",
  { mode: "matching", participants: people(["a", "b", "c", "d"]), groupSize: 2, prefs: { shortlist: { a: ["b"], b: ["a"] } } },
  (groups, report) => (report.summary.includes("shortlist") ? "lunch summary mentions shortlists" : undefined),
);

// ---- Un batch de 40 : les ordres tiennent a l'echelle ------------------------------------------

{
  const name = "challenge: 40 founders, scoreGroups agrees with the draw";
  const ids = Array.from({ length: 40 }, (_, i) => `f${String(i).padStart(2, "0")}`);
  const participants = ids.map((id, i) => ({ id, category: i % 3 === 0 ? "technical" : "business" }));
  const random = seeded(7);
  const shortlist = Object.fromEntries(ids.map((id) => [id, ids.filter(() => random() < 0.08)]));
  const past = { challenge: Array.from({ length: 30 }, () => [ids[Math.floor(random() * 40)], ids[Math.floor(random() * 40)]]).filter(([a, b]) => a !== b) };
  const input = { ...makeInput({ participants, groupSize: 3, prefs: { shortlist }, past }), random: seeded(3) };
  const { groups, report } = generateGroups(input);
  if (report.repeatedChallengePairs !== 0) fail(name, "repeated pair", groups);
  if (report.groupsWithoutTech !== 0) fail(name, "team without tech", groups);
  if (scoreGroups(groups, input).cost !== report.cost) fail(name, "scoreGroups cost differs from the draw");
  if (!Number.isSafeInteger(report.cost)) fail(name, `cost ${report.cost} is not a safe integer`);
  console.log(`      ${report.summary}`);
  pass(name);
}

