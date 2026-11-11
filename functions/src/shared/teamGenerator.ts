import type { EventKind, Membership, ProfileCategory } from "./types";

// ----------------------------
// Generateur de groupes (SPECS §4.1)
// ----------------------------
// Logique pure, partagee : l'outil staff (/admin) s'en sert aujourd'hui, l'API
// et le MCP s'en serviront demain (« genere les equipes du hackathon de
// demain »). Aucune lecture de la base ici : l'appelant fournit les
// participants et l'historique des paires.
//
// Le generateur minimise un COUT : pour chaque paire reunie, le nombre de fois
// ou elle l'a deja ete, au carre, pondere par la regle concernee, plus une
// penalite par equipe sans profil tech (ou sans profil business). Recherche
// aleatoire : plusieurs tirages, chacun ameliore par echanges de deux
// personnes tant que le cout baisse. Instantane pour 40 personnes.
//
// Les regles, de la plus stricte a la plus souple, sont des POIDS : une regle
// stricte coute tellement plus qu'aucune regle souple ne passe devant. Ce qui
// n'a pas pu etre respecte est dit dans le rapport (`relaxed`).

export type GeneratorParticipant = {
  id: string;
  category: ProfileCategory | null;
};

/** Un groupe garde tel quel (verrouille) : ses membres ne sont pas retires. */
export type FixedGroup = { key: string; memberIds: string[] };

/** Nombre de fois ou deux personnes ont deja ete ensemble, par mecanique. */
export type PairHistory = {
  /** Equipes de `team_challenge` (hackathons, exercices). */
  challenge: Map<string, number>;
  /** Groupes de `matching` (lunch roulette, speed dating, round tables). */
  matching: Map<string, number>;
};

export type GeneratorRules = {
  /** Poids d'une paire deja reunie en challenge (au carre du nombre de fois). */
  challengeRepeatWeight: number;
  /** Poids d'une paire deja reunie en matching. */
  matchingRepeatWeight: number;
  /** Penalite d'une equipe sans profil tech (hybride compte comme tech). 0 = regle inactive. */
  noTechPenalty: number;
  /** Penalite d'une equipe sans profil business (hybride compte comme business). */
  noBusinessPenalty: number;
};

/**
 * Reglages par mecanique (SPECS §4.1).
 *   challenge  1. jamais deux fois la meme paire en hackathon ; 2. au moins un
 *              tech par equipe ; 3. eviter les paires deja reunies en roulette.
 *   matching   faire rencontrer de nouvelles personnes : jamais deux fois la
 *              meme paire en roulette, puis eviter les coequipiers de hackathon.
 */
export const GENERATOR_PRESETS = {
  challenge: {
    defaultSize: 3,
    rules: { challengeRepeatWeight: 10_000, noTechPenalty: 1_000, matchingRepeatWeight: 10, noBusinessPenalty: 5 },
  },
  matching: {
    defaultSize: 4,
    rules: { matchingRepeatWeight: 10_000, challengeRepeatWeight: 100, noTechPenalty: 0, noBusinessPenalty: 0 },
  },
} as const satisfies Record<string, { defaultSize: number; rules: GeneratorRules }>;

export type GeneratorMode = keyof typeof GENERATOR_PRESETS;

export const GROUP_SIZE_MIN = 2;
export const GROUP_SIZE_MAX = 5;

/** Mecanique d'evenement -> reglages du generateur. */
export const generatorModeOfKind = (kind: EventKind): GeneratorMode | null =>
  kind === "team_challenge" ? "challenge" : kind === "matching" ? "matching" : null;

export type GeneratorInput = {
  participants: GeneratorParticipant[];
  /** Taille visee (2 a 5). Les groupes ne sont jamais plus grands, sauf pour eviter une personne seule. */
  groupSize: number;
  history: PairHistory;
  rules: GeneratorRules;
  /** Paires a ne jamais reunir. */
  keepApart: [string, string][];
  /** Paires a toujours reunir (cofondateurs deja formes). */
  keepTogether: [string, string][];
  /** Groupes verrouilles, gardes tels quels ; leurs membres ne sont pas tires. */
  fixedGroups: FixedGroup[];
  /** Nombre de tirages (redemarrages). */
  restarts?: number;
  /** Source d'aleatoire, remplacable pour les tests. */
  random?: () => number;
  /** Mot affiche dans le rapport : « team » (challenge) ou « group » (matching). */
  groupWord?: string;
};

export type GeneratorReport = {
  groupCount: number;
  /** Paires reunies qui l'avaient deja ete en challenge. */
  repeatedChallengePairs: number;
  repeatedMatchingPairs: number;
  /** Equipes avec au moins un tech et un business (hybride compte pour les deux). */
  mixedGroups: number;
  groupsWithoutTech: number;
  keepApartViolations: number;
  keepTogetherViolations: number;
  /** Participants sans categorie (tech / business / hybride) : comptes comme ni l'un ni l'autre. */
  uncategorized: number;
  /** Ce que le generateur a du assouplir, en phrases (interface en anglais). */
  relaxed: string[];
  /** Le resume en une ligne : « 0 repeated pairs, 9 mixed teams out of 10 ». */
  summary: string;
  cost: number;
};

export type GeneratorResult = {
  /** Groupes tires (sans les groupes verrouilles). */
  groups: string[][];
  report: GeneratorReport;
};

// ---- Paires et historique ------------------------------------------------------

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

/**
 * L'historique « qui a ete avec qui » d'un batch, tire des appartenances
 * datees (`memberships`, kind `event_team`). `excludeEventId` : l'evenement en
 * cours de tirage ne compte pas contre lui-meme.
 */
export function buildPairHistory(
  memberships: readonly Pick<Membership, "kind" | "teamId" | "eventId" | "founderId">[],
  kindOfEvent: (eventId: string) => EventKind | null,
  excludeEventId: string | null,
): PairHistory {
  const teams = new Map<string, { mode: GeneratorMode; members: Set<string> }>();
  for (const m of memberships) {
    if (m.kind !== "event_team" || !m.eventId || m.eventId === excludeEventId) continue;
    const kind = kindOfEvent(m.eventId);
    const mode = kind ? generatorModeOfKind(kind) : null;
    if (!mode) continue;
    const key = `${m.eventId}/${m.teamId}`;
    const team = teams.get(key) ?? { mode, members: new Set<string>() };
    team.members.add(m.founderId);
    teams.set(key, team);
  }
  const history: PairHistory = { challenge: new Map(), matching: new Map() };
  for (const { mode, members } of teams.values()) {
    const ids = [...members];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) bump(history[mode], pairKey(ids[i], ids[j]));
  }
  return history;
}

// ---- Tailles des groupes --------------------------------------------------------

/**
 * Tailles des groupes : on complete avec des groupes plus petits, jamais plus
 * grands (38 presents en 3 = 12 groupes de 3 + 1 de 2). Seule exception : un
 * groupe d'une personne rejoint un autre groupe.
 */
export function groupSizes(count: number, size: number): number[] {
  if (count <= 0) return [];
  const target = Math.min(GROUP_SIZE_MAX, Math.max(GROUP_SIZE_MIN, Math.round(size)));
  if (count <= target) return [count];
  const groups = Math.ceil(count / target);
  const smaller = groups * target - count;
  const sizes = Array.from({ length: groups }, (_, i) => (i < groups - smaller ? target : target - 1));
  // Une personne seule (taille 2 et effectif impair) : elle rejoint le premier groupe.
  if (sizes[sizes.length - 1] === 1) {
    sizes.pop();
    sizes[0] += 1;
  }
  return sizes;
}

// ---- Cout -------------------------------------------------------------------------

type CostContext = {
  history: PairHistory;
  rules: GeneratorRules;
  apart: Set<string>;
  together: Set<string>;
  categoryOf: Map<string, ProfileCategory | null>;
};

/** Une contrainte « jamais » ou « toujours » coute plus que toutes les regles reunies. */
const HARD = 1_000_000;

const isTech = (c: ProfileCategory | null | undefined) => c === "technical" || c === "hybrid";
const isBusiness = (c: ProfileCategory | null | undefined) => c === "business" || c === "hybrid";

function groupCost(members: readonly string[], ctx: CostContext): number {
  let cost = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const key = pairKey(members[i], members[j]);
      const c = ctx.history.challenge.get(key) ?? 0;
      const m = ctx.history.matching.get(key) ?? 0;
      cost += c * c * ctx.rules.challengeRepeatWeight + m * m * ctx.rules.matchingRepeatWeight;
      if (ctx.apart.has(key)) cost += HARD;
    }
  }
  if (ctx.rules.noTechPenalty > 0 && !members.some((id) => isTech(ctx.categoryOf.get(id)))) cost += ctx.rules.noTechPenalty;
  if (ctx.rules.noBusinessPenalty > 0 && !members.some((id) => isBusiness(ctx.categoryOf.get(id))))
    cost += ctx.rules.noBusinessPenalty;
  return cost;
}

/** Paires « toujours ensemble » separees : comptees sur l'ensemble des groupes. */
function togetherCost(groupOf: Map<string, number>, ctx: CostContext): number {
  let cost = 0;
  for (const key of ctx.together) {
    const [a, b] = key.split("|");
    const ga = groupOf.get(a);
    const gb = groupOf.get(b);
    if (ga !== undefined && gb !== undefined && ga !== gb) cost += HARD;
  }
  return cost;
}

function makeContext(input: Pick<GeneratorInput, "participants" | "history" | "rules" | "keepApart" | "keepTogether">): CostContext {
  return {
    history: input.history,
    rules: input.rules,
    apart: new Set(input.keepApart.map(([a, b]) => pairKey(a, b))),
    together: new Set(input.keepTogether.filter(([a, b]) => a !== b).map(([a, b]) => pairKey(a, b))),
    categoryOf: new Map(input.participants.map((p) => [p.id, p.category])),
  };
}

// ---- Recherche --------------------------------------------------------------------

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Ameliore une repartition par echanges de deux personnes, tant que le cout baisse. */
function improve(groups: string[][], ctx: CostContext): number {
  const costs = groups.map((g) => groupCost(g, ctx));
  const groupOf = new Map<string, number>();
  groups.forEach((g, gi) => g.forEach((id) => groupOf.set(id, gi)));
  let together = togetherCost(groupOf, ctx);

  let improved = true;
  let passes = 0;
  while (improved && passes < 50) {
    improved = false;
    passes++;
    for (let g1 = 0; g1 < groups.length; g1++) {
      for (let g2 = g1 + 1; g2 < groups.length; g2++) {
        for (let i = 0; i < groups[g1].length; i++) {
          for (let j = 0; j < groups[g2].length; j++) {
            const a = groups[g1][i];
            const b = groups[g2][j];
            groups[g1][i] = b;
            groups[g2][j] = a;
            groupOf.set(a, g2);
            groupOf.set(b, g1);
            const c1 = groupCost(groups[g1], ctx);
            const c2 = groupCost(groups[g2], ctx);
            const t = ctx.together.size > 0 ? togetherCost(groupOf, ctx) : 0;
            if (c1 + c2 + t < costs[g1] + costs[g2] + together) {
              costs[g1] = c1;
              costs[g2] = c2;
              together = t;
              improved = true;
            } else {
              groups[g1][i] = a;
              groups[g2][j] = b;
              groupOf.set(a, g1);
              groupOf.set(b, g2);
            }
          }
        }
      }
    }
  }
  return costs.reduce((s, c) => s + c, 0) + together;
}

/** Tire les groupes. Les groupes verrouilles ne sont pas retouches et ne figurent pas dans `groups`. */
export function generateGroups(input: GeneratorInput): GeneratorResult {
  const random = input.random ?? Math.random;
  const fixed = new Set(input.fixedGroups.flatMap((g) => g.memberIds));
  const pool = input.participants.filter((p) => !fixed.has(p.id)).map((p) => p.id);
  const sizes = groupSizes(pool.length, input.groupSize);
  const ctx = makeContext(input);

  let best: string[][] = [];
  let bestCost = Infinity;
  const restarts = Math.max(1, input.restarts ?? 60);
  for (let r = 0; r < restarts && pool.length > 0; r++) {
    const order = shuffle(pool, random);
    const groups: string[][] = [];
    let cursor = 0;
    for (const size of sizes) {
      groups.push(order.slice(cursor, cursor + size));
      cursor += size;
    }
    const cost = improve(groups, ctx);
    if (cost < bestCost) {
      bestCost = cost;
      best = groups.map((g) => [...g]);
      if (cost === 0) break;
    }
  }

  return { groups: best, report: scoreGroups([...input.fixedGroups.map((g) => g.memberIds), ...best], input) };
}

// ---- Rapport ----------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Le rapport d'une repartition, tiree ou retouchee a la main : ce qui a ete
 * respecte, et ce qui a du etre assoupli.
 */
export function scoreGroups(
  groups: readonly (readonly string[])[],
  input: Pick<GeneratorInput, "participants" | "history" | "rules" | "keepApart" | "keepTogether"> & {
    /** Mot affiche : « team » (challenge) ou « group » (matching). */
    groupWord?: string;
  },
): GeneratorReport {
  const ctx = makeContext(input);
  const word = input.groupWord ?? "team";
  const groupOf = new Map<string, number>();
  groups.forEach((g, gi) => g.forEach((id) => groupOf.set(id, gi)));

  let repeatedChallengePairs = 0;
  let repeatedMatchingPairs = 0;
  let keepApartViolations = 0;
  let mixedGroups = 0;
  let groupsWithoutTech = 0;
  let cost = 0;
  for (const g of groups) {
    cost += groupCost(g, ctx);
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const key = pairKey(g[i], g[j]);
        if ((ctx.history.challenge.get(key) ?? 0) > 0) repeatedChallengePairs++;
        if ((ctx.history.matching.get(key) ?? 0) > 0) repeatedMatchingPairs++;
        if (ctx.apart.has(key)) keepApartViolations++;
      }
    }
    const hasTech = g.some((id) => isTech(ctx.categoryOf.get(id)));
    const hasBusiness = g.some((id) => isBusiness(ctx.categoryOf.get(id)));
    if (!hasTech) groupsWithoutTech++;
    if (hasTech && hasBusiness) mixedGroups++;
  }
  let keepTogetherViolations = 0;
  for (const key of ctx.together) {
    const [a, b] = key.split("|");
    if (groupOf.has(a) && groupOf.has(b) && groupOf.get(a) !== groupOf.get(b)) keepTogetherViolations++;
  }
  cost += keepTogetherViolations * HARD;

  const placed = [...groupOf.keys()];
  const uncategorized = placed.filter((id) => !ctx.categoryOf.get(id)).length;
  const techCount = placed.filter((id) => isTech(ctx.categoryOf.get(id))).length;

  const relaxed: string[] = [];
  if (keepApartViolations > 0) relaxed.push(`${plural(keepApartViolations, "pair")} marked "keep apart" ended up together.`);
  if (keepTogetherViolations > 0) relaxed.push(`${plural(keepTogetherViolations, "pair")} marked "keep together" ended up apart.`);
  if (input.rules.challengeRepeatWeight >= 1_000 && repeatedChallengePairs > 0)
    relaxed.push(`${plural(repeatedChallengePairs, "pair")} already teamed up in a challenge: no other split was possible.`);
  if (input.rules.matchingRepeatWeight >= 1_000 && repeatedMatchingPairs > 0)
    relaxed.push(`${plural(repeatedMatchingPairs, "pair")} already met at a lunch roulette: no other split was possible.`);
  if (input.rules.noTechPenalty > 0 && groupsWithoutTech > 0)
    relaxed.push(
      techCount < groups.length
        ? `${plural(groupsWithoutTech, word)} without a technical profile: only ${techCount} technical or hybrid ${techCount === 1 ? "profile is" : "profiles are"} present.`
        : `${plural(groupsWithoutTech, word)} without a technical profile, to avoid repeated pairs.`,
    );
  if (input.rules.noTechPenalty > 0 && uncategorized > 0)
    relaxed.push(`${plural(uncategorized, "participant")} without a profile category (technical, business, hybrid): set it on their profile for better balance.`);

  const repeated = input.rules.matchingRepeatWeight > input.rules.challengeRepeatWeight ? repeatedMatchingPairs : repeatedChallengePairs;
  const summary =
    groups.length === 0
      ? `No ${word} yet.`
      : input.rules.noTechPenalty > 0
        ? `${plural(repeated, "repeated pair")}, ${mixedGroups} mixed ${word}${mixedGroups === 1 ? "" : "s"} out of ${groups.length}.`
        : `${plural(repeated, "pair")} who already met, ${plural(groups.length, word)}.`;

  return {
    groupCount: groups.length,
    repeatedChallengePairs,
    repeatedMatchingPairs,
    mixedGroups,
    groupsWithoutTech,
    keepApartViolations,
    keepTogetherViolations,
    uncategorized,
    relaxed,
    summary,
    cost,
  };
}
