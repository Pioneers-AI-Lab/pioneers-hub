import type { ConnectionLists, EventTeam, MatchingMode, Membership, ProfileCategory, TeamRole } from "./types";

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
// penalite par equipe sans profil tech (ou sans profil business), moins un
// BONUS par paire de la shortlist reunie (cout negatif), plus une penalite par
// paire qui s'est dite rencontree des deux cotes (« Met » reciproque). Recherche
// aleatoire : plusieurs tirages, chacun ameliore par echanges de deux
// personnes tant que le cout baisse. Instantane pour 40 personnes.
//
// Shortlist et Met : les listes privees des fondateurs
// (`founders/{id}/private/connections`, lues par le staff), resumees en paires
// par `buildPairPreferences`. Mutuelle = A a shortliste B ET B a shortliste A ;
// a sens unique = un seul des deux. Une paire « toujours ensemble » (forcee par
// le staff) n'est jamais comptee comme repetee : le staff l'a voulue.
//
// Les regles, de la plus stricte a la plus souple, sont des POIDS : une regle
// stricte coute tellement plus qu'aucune regle souple ne passe devant. Ce qui
// n'a pas pu etre respecte est dit dans le rapport (`relaxed`).
//
// Choix des poids : chaque palier vaut plus que le TOTAL possible de tous les
// paliers en dessous, pour un batch d'au plus 40 personnes en groupes d'au plus
// 5, soit au plus 80 paires reunies et 20 groupes (P = 80, G = 20) :
//   challenge   repas deja partage   1 x m², et equipe sans business 1 par equipe, au meme
//               palier (m <= 11 repas par paire : 80 x 121 + 20 = 9 700, < 10 000)
//               shortlist a sens unique   -10 000 par paire   (80 x 10 000 = 800 000)
//               shortlist mutuelle   -1 000 000 par paire     (80 x 10^6 = 8 x 10^7, < 10^8)
//               equipe sans tech     10^8 par equipe          (20 x 10^8 = 2 x 10^9, < 10^10)
//               paire deja en hackathon   10^10 x c²
//   matching    coequipiers de hackathon   1 x c² (c <= 11)
//               Met reciproque      10 000 par paire          (80 x 10^4 = 8 x 10^5, < 10^6)
//               paire deja a table   10^6 x m²
// « Jamais » et « toujours » (`HARD`, 10^14) passent devant tout (80 x 16 x 10^10
// = 1,3 x 10^13 pour des paires vues 4 fois). Les couts restent des entiers sous
// 2^53 : aucune perte de precision.

export type GeneratorParticipant = {
  id: string;
  category: ProfileCategory | null;
};

/** Un groupe garde tel quel (verrouille) : ses membres ne sont pas retires. */
export type FixedGroup = { key: string; memberIds: string[] };

/** Une startup du batch, telle que le tirage la lit. */
type StartupTeam = { id: string; name: string; memberIds: readonly string[] };

/**
 * Les startups qui sont des equipes fixes d'un tirage (`EventMatching.lockedTeamsFromStartups`,
 * H5 : docs/FONCTIONNALITES-SEMAINE-1-FUSION.md §4.2) : chacune avec ses fondateurs qui
 * participent, si elle en a au moins deux ; un fondateur ne compte que dans la premiere qui le
 * cite. `skipped` : celles qui n'ont pas deux fondateurs presents (eux sont tires avec les autres).
 */
export function startupFixedGroups(
  startups: readonly StartupTeam[],
  participantIds: ReadonlySet<string>,
): { groups: (FixedGroup & { name: string })[]; skipped: StartupTeam[] } {
  const taken = new Set<string>();
  const groups: (FixedGroup & { name: string })[] = [];
  const skipped: StartupTeam[] = [];
  for (const startup of startups) {
    const memberIds = [...new Set(startup.memberIds)].filter((id) => participantIds.has(id) && !taken.has(id));
    if (memberIds.length < GROUP_SIZE_MIN) {
      skipped.push(startup);
      continue;
    }
    for (const id of memberIds) taken.add(id);
    groups.push({ key: startup.id, name: startup.name, memberIds });
  }
  return { groups, skipped };
}

/** Nombre de fois ou deux personnes ont deja ete ensemble, par mecanique. */
export type PairHistory = {
  /** Equipes de `team_challenge` (hackathons, exercices). */
  challenge: Map<string, number>;
  /** Groupes de `matching` (lunch roulette, speed dating, round tables). */
  matching: Map<string, number>;
};

/**
 * Les paires tirees des shortlists et des « Met » des participants
 * (`buildPairPreferences`), en cles `pairKey`.
 */
export type PairPreferences = {
  /** A a shortliste B et B a shortliste A. */
  mutualShortlist: Set<string>;
  /** Un seul des deux a shortliste l'autre. */
  oneWayShortlist: Set<string>;
  /** A a coche B « Met » et B a coche A. */
  reciprocalMet: Set<string>;
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
  /** Bonus (cout retranche) d'une paire a shortlist mutuelle reunie. */
  mutualShortlistBonus: number;
  /** Bonus d'une paire a shortlist a sens unique reunie. */
  oneWayShortlistBonus: number;
  /** Penalite d'une paire « Met » reciproque reunie. */
  reciprocalMetWeight: number;
};

/**
 * Reglages par mode de matching (SPECS §4.1, `EventMatching.mode`), poids
 * justifies en tete de fichier (chaque regle vaut plus que toutes les suivantes
 * reunies, jusqu'a 40 personnes).
 *   challenge  1. jamais deux fois la meme paire en hackathon (sauf paire forcee) ;
 *              2. au moins un tech par equipe ; 3. reunir les shortlists
 *              mutuelles ; 4. puis a sens unique ; 5. eviter les paires deja
 *              reunies en roulette (et, au meme rang, les
 *              equipes sans business) ; enfin le hasard.
 *   matching   faire rencontrer de nouvelles personnes : 1. jamais deux fois la
 *              meme paire en roulette ; 2. eviter les « Met » reciproques ;
 *              3. eviter les coequipiers de hackathon ; enfin le hasard.
 */
export const GENERATOR_PRESETS = {
  challenge: {
    defaultSize: 3,
    rules: {
      challengeRepeatWeight: 10_000_000_000,
      noTechPenalty: 100_000_000,
      mutualShortlistBonus: 1_000_000,
      oneWayShortlistBonus: 10_000,
      matchingRepeatWeight: 1,
      noBusinessPenalty: 1,
      reciprocalMetWeight: 0,
    },
  },
  matching: {
    defaultSize: 4,
    rules: {
      matchingRepeatWeight: 1_000_000,
      reciprocalMetWeight: 10_000,
      challengeRepeatWeight: 1,
      noTechPenalty: 0,
      noBusinessPenalty: 0,
      mutualShortlistBonus: 0,
      oneWayShortlistBonus: 0,
    },
  },
} as const satisfies Record<MatchingMode, { defaultSize: number; rules: GeneratorRules }>;

export type GeneratorMode = MatchingMode;

export const GROUP_SIZE_MIN = 2;
export const GROUP_SIZE_MAX = 5;

/** Les tailles proposees dans les outils, en texte (`SegmentedControl`). */
export const GROUP_SIZES = Array.from({ length: GROUP_SIZE_MAX - GROUP_SIZE_MIN + 1 }, (_, i) => String(GROUP_SIZE_MIN + i));

/** L'ordre d'affichage des groupes d'un tirage : `…-t2` avant `…-t10` (ids de `teamIdFor`). */
/** Le tirage se publie en entier : une equipe publiee, il l'est (le matching est alors fige). */
export const isDrawPublished = (teams: readonly { publishedDateISOString: string | null }[]) => teams.some((t) => t.publishedDateISOString !== null);

/** La date de publication du tirage, `null` s'il ne l'est pas. */
export const publishedDateOf = (teams: readonly { publishedDateISOString: string | null }[]) =>
  teams.find((t) => t.publishedDateISOString !== null)?.publishedDateISOString ?? null;

export const byGroupOrder = (a: { id: string }, b: { id: string }) => groupNumber(a.id) - groupNumber(b.id);
/** Le numero d'un groupe, tire de son id (`…-t7` : 7). */
export const groupNumber = (id: string) => Number(id.match(/(\d+)$/)?.[1] ?? 0);

/** Taille d'un matching (`EventMatching.size`) a partir de sa taille maximale. */
export const teamSizeFor = (max: number) => ({ min: Math.max(GROUP_SIZE_MIN, max - 1), max });

export type GeneratorInput = {
  participants: GeneratorParticipant[];
  /** Taille visee (2 a 5). Les groupes ne sont jamais plus grands, sauf pour eviter une personne seule. */
  groupSize: number;
  history: PairHistory;
  rules: GeneratorRules;
  /** Shortlists et « Met » des participants (`buildPairPreferences`) ; absent = aucune. */
  preferences?: PairPreferences;
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
  /** Paires a shortlist mutuelle reunies, et le nombre possible (les deux places dans la repartition). */
  mutualShortlistPairs: number;
  mutualShortlistPossible: number;
  oneWayShortlistPairs: number;
  oneWayShortlistPossible: number;
  /** Paires « Met » reciproques reunies. */
  reciprocalMetPairs: number;
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

/**
 * Mecanique d'une appartenance qui compte dans l'historique : equipe d'un
 * evenement a groupes, hors l'evenement en cours de tirage. `null` sinon.
 */
function modeOfMembership(
  m: Pick<Membership, "kind" | "eventId">,
  modeOfEvent: (eventId: string) => GeneratorMode | null,
  excludeEventId: string | null,
): GeneratorMode | null {
  if (m.kind !== "event_team" || !m.eventId || m.eventId === excludeEventId) return null;
  return modeOfEvent(m.eventId);
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

/**
 * L'historique « qui a ete avec qui » d'un batch, tire des appartenances
 * datees (`memberships`, kind `event_team`). `excludeEventId` : l'evenement en
 * cours de tirage ne compte pas contre lui-meme.
 */
export function buildPairHistory(
  memberships: readonly Pick<Membership, "kind" | "teamId" | "eventId" | "founderId">[],
  /** Le mode du matching de l'evenement d'une appartenance (`matchingOf(event)?.mode`). */
  modeOfEvent: (eventId: string) => GeneratorMode | null,
  excludeEventId: string | null,
): PairHistory {
  const teams = new Map<string, { mode: GeneratorMode; members: Set<string> }>();
  for (const m of memberships) {
    const mode = modeOfMembership(m, modeOfEvent, excludeEventId);
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

/**
 * Les paires de preferences, tirees des listes privees de chaque fondateur
 * (`readConnections`), par id de fondateur. Un fondateur dont le document
 * manque compte comme sans liste : sa shortlist ne rend pas mutuelle celle
 * des autres.
 */
export function buildPairPreferences(connections: ReadonlyMap<string, ConnectionLists>): PairPreferences {
  const preferences = emptyPreferences();
  const lists = (b: string) => connections.get(b);
  for (const [a, own] of connections) {
    for (const b of own.shortlistedFounderIds) {
      if (b === a) continue;
      (lists(b)?.shortlistedFounderIds.includes(a) ? preferences.mutualShortlist : preferences.oneWayShortlist).add(pairKey(a, b));
    }
    for (const b of own.metFounderIds) if (b !== a && lists(b)?.metFounderIds.includes(a)) preferences.reciprocalMet.add(pairKey(a, b));
  }
  return preferences;
}

const emptyPreferences = (): PairPreferences => ({ mutualShortlist: new Set(), oneWayShortlist: new Set(), reciprocalMet: new Set() });

/** Nombre de paires dont les deux membres sont la (`has`). */
const countPairsAmong = (pairs: ReadonlySet<string>, has: (id: string) => boolean) => {
  let count = 0;
  for (const key of pairs) if (key.split("|").every(has)) count++;
  return count;
};

// ---- Leader d'un groupe -----------------------------------------------------------
// Un leader par groupe, tire au sort : il rassemble le groupe et veille au bon
// deroulement. Rotation : on tire parmi les membres qui ont le moins mene, par
// mecanique (mener une table de lunch ne dispense pas de mener une equipe de
// hackathon). Garde dans `EventTeam.roles` et, a la publication, dans
// l'appartenance datee (`Membership.role`), que lit la rotation.

export const LEADER_ROLE = "leader" satisfies TeamRole;

/** Le leader d'une equipe enregistree (`null` : aucun, ex. equipes d'avant les leaders). */
export const leaderIdOf = (team: Pick<EventTeam, "memberIds" | "roles">): string | null =>
  team.memberIds.find((id) => team.roles[id]?.includes(LEADER_ROLE)) ?? null;

/** Nombre de fois ou chacun a deja mene un groupe de cette mecanique dans le batch. */
export function buildLeaderCounts(
  memberships: readonly Pick<Membership, "kind" | "eventId" | "founderId" | "role">[],
  modeOfEvent: (eventId: string) => GeneratorMode | null,
  mode: GeneratorMode,
  excludeEventId: string | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of memberships) {
    if (m.role === LEADER_ROLE && modeOfMembership(m, modeOfEvent, excludeEventId) === mode) bump(counts, m.founderId);
  }
  return counts;
}

/** Tire le leader d'un groupe parmi ceux qui ont le moins mene. */
export function pickLeader(memberIds: readonly string[], counts: ReadonlyMap<string, number>, random = Math.random): string | null {
  if (memberIds.length === 0) return null;
  const least = Math.min(...memberIds.map((id) => counts.get(id) ?? 0));
  const candidates = memberIds.filter((id) => (counts.get(id) ?? 0) === least);
  return candidates[Math.floor(random() * candidates.length)];
}

/**
 * Chaque groupe a un leader : celui qui est encore membre reste, les autres
 * groupes en tirent un (`pickLeader`). Apres un tirage, un echange, un depart.
 */
export function assignLeaders<G extends { memberIds: string[]; leaderId: string | null }>(
  groups: readonly G[],
  counts: ReadonlyMap<string, number>,
  random = Math.random,
): G[] {
  return groups.map((g) =>
    g.leaderId && g.memberIds.includes(g.leaderId) ? g : { ...g, leaderId: pickLeader(g.memberIds, counts, random) },
  );
}

/** `EventTeam.roles` a enregistrer : les autres roles des membres gardes (SP26), le leader marque. */
export function rolesWithLeader(previous: EventTeam["roles"], memberIds: readonly string[], leaderId: string | null): EventTeam["roles"] {
  const roles: Record<string, TeamRole[]> = {};
  for (const id of memberIds) {
    const kept = (previous[id] ?? []).filter((r) => r !== LEADER_ROLE);
    const all: TeamRole[] = id === leaderId ? [...kept, LEADER_ROLE] : kept;
    if (all.length > 0) roles[id] = all;
  }
  return roles;
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
  preferences: PairPreferences;
  apart: Set<string>;
  together: Set<string>;
  categoryOf: Map<string, ProfileCategory | null>;
};

/** Poids a partir duquel une regle de paires est stricte (elle ne cede que faute d'autre repartition). */
const STRICT_WEIGHT = 1_000_000;

/** Une contrainte « jamais » ou « toujours » coute plus que toutes les regles reunies. */
const HARD = 100_000_000_000_000;

const isTech = (c: ProfileCategory | null | undefined) => c === "technical" || c === "hybrid";
const isBusiness = (c: ProfileCategory | null | undefined) => c === "business" || c === "hybrid";

function groupCost(members: readonly string[], ctx: CostContext): number {
  let cost = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const key = pairKey(members[i], members[j]);
      if (ctx.apart.has(key)) cost += HARD;
      if (ctx.preferences.mutualShortlist.has(key)) cost -= ctx.rules.mutualShortlistBonus;
      else if (ctx.preferences.oneWayShortlist.has(key)) cost -= ctx.rules.oneWayShortlistBonus;
      if (ctx.preferences.reciprocalMet.has(key)) cost += ctx.rules.reciprocalMetWeight;
      const c = ctx.history.challenge.get(key) ?? 0;
      const m = ctx.history.matching.get(key) ?? 0;
      cost += c * c * ctx.rules.challengeRepeatWeight + m * m * ctx.rules.matchingRepeatWeight;
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

type ContextInput = Pick<GeneratorInput, "participants" | "history" | "rules" | "preferences" | "keepApart" | "keepTogether">;

function makeContext(input: ContextInput): CostContext {
  const together = new Set(input.keepTogether.filter(([a, b]) => a !== b).map(([a, b]) => pairKey(a, b)));
  // Une paire forcee par le staff n'est pas une repetition : retiree de l'historique, pour le cout comme pour le rapport.
  const withoutForced = (counts: Map<string, number>) =>
    together.size === 0 ? counts : new Map([...counts].filter(([key]) => !together.has(key)));
  return {
    history: { challenge: withoutForced(input.history.challenge), matching: withoutForced(input.history.matching) },
    rules: input.rules,
    preferences: input.preferences ?? emptyPreferences(),
    apart: new Set(input.keepApart.map(([a, b]) => pairKey(a, b))),
    together,
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
  // Meilleur cout imaginable : toutes les shortlists du tirage reunies, rien d'autre (0 sans shortlist).
  const inPool = new Set(pool);
  const has = (id: string) => inPool.has(id);
  const floor =
    -ctx.rules.mutualShortlistBonus * countPairsAmong(ctx.preferences.mutualShortlist, has) -
    ctx.rules.oneWayShortlistBonus * countPairsAmong(ctx.preferences.oneWayShortlist, has);

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
      if (cost <= floor) break;
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
  input: ContextInput & {
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
  let mutualShortlistPairs = 0;
  let oneWayShortlistPairs = 0;
  let reciprocalMetPairs = 0;
  let cost = 0;
  for (const g of groups) {
    cost += groupCost(g, ctx);
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const key = pairKey(g[i], g[j]);
        if (ctx.apart.has(key)) keepApartViolations++;
        if (ctx.preferences.mutualShortlist.has(key)) mutualShortlistPairs++;
        if (ctx.preferences.oneWayShortlist.has(key)) oneWayShortlistPairs++;
        if (ctx.preferences.reciprocalMet.has(key)) reciprocalMetPairs++;
        if ((ctx.history.challenge.get(key) ?? 0) > 0) repeatedChallengePairs++;
        if ((ctx.history.matching.get(key) ?? 0) > 0) repeatedMatchingPairs++;
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
  // Paires de shortlist dont les deux sont places : celles que le tirage pouvait reunir.
  const isPlaced = (id: string) => groupOf.has(id);
  const mutualShortlistPossible = countPairsAmong(ctx.preferences.mutualShortlist, isPlaced);
  const oneWayShortlistPossible = countPairsAmong(ctx.preferences.oneWayShortlist, isPlaced);

  const relaxed: string[] = [];
  if (keepApartViolations > 0) relaxed.push(`${plural(keepApartViolations, "pair")} marked "keep apart" ended up together.`);
  if (keepTogetherViolations > 0) relaxed.push(`${plural(keepTogetherViolations, "pair")} marked "keep together" ended up apart.`);
  // Toute regle de paires active qui cede est dite : stricte, faute d'autre repartition ; souple, evitee si possible.
  const pairRule = (weight: number, count: number, what: string) => {
    if (weight > 0 && count > 0)
      relaxed.push(`${plural(count, "pair")} ${what}: ${weight >= STRICT_WEIGHT ? "no other split was possible" : "avoided where possible"}.`);
  };
  pairRule(input.rules.challengeRepeatWeight, repeatedChallengePairs, "already teamed up in a challenge");
  pairRule(input.rules.matchingRepeatWeight, repeatedMatchingPairs, "already met at a lunch roulette");
  pairRule(input.rules.reciprocalMetWeight, reciprocalMetPairs, "both marked each other as met");
  const mutualApart = mutualShortlistPossible - mutualShortlistPairs;
  if (input.rules.mutualShortlistBonus > 0 && mutualApart > 0)
    relaxed.push(`${plural(mutualApart, "mutual shortlist pair")} apart: stricter rules (no repeated pair, a technical profile per ${word}) or ${word} size came first.`);
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
  // L'effet des shortlists, des qu'il y en a : « 3 of 4 mutual shortlist pairs together, 5 of 12 one-way. »
  const shortlists =
    groups.length > 0 && input.rules.mutualShortlistBonus > 0 && mutualShortlistPossible + oneWayShortlistPossible > 0
      ? ` ${mutualShortlistPairs} of ${mutualShortlistPossible} mutual shortlist pairs together, ${oneWayShortlistPairs} of ${oneWayShortlistPossible} one-way.`
      : "";

  return {
    groupCount: groups.length,
    repeatedChallengePairs,
    repeatedMatchingPairs,
    mixedGroups,
    groupsWithoutTech,
    keepApartViolations,
    keepTogetherViolations,
    uncategorized,
    mutualShortlistPairs,
    mutualShortlistPossible,
    oneWayShortlistPairs,
    oneWayShortlistPossible,
    reciprocalMetPairs,
    relaxed,
    summary: summary + shortlists,
    cost,
  };
}
