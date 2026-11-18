import { COL, docIds, docPaths } from "./collections";
import { RuleError, mergeWrite, setWrite, type DocWrite } from "./docWrites";
import { slugify } from "./text";
import type { Founder, Membership, Startup, StartupInternal, StartupProfile, TeamLock, WithId } from "./types";

// ----------------------------
// Lock my team -> startups (lot 2, docs/FONCTIONNALITES.md §2.10)
// ----------------------------
// Chaque fondateur dit s'il verrouille une equipe et avec qui (`teamLocks/{founderId}`,
// types/teamLock.ts). Le staff en tire les startups dans Admin > Startups : une
// equipe est PROPOSEE quand ses reponses sont RECIPROQUES (chaque membre a repondu
// oui et cite exactement les autres membres) ; le reste est a verifier a la main.
// Puis le staff confirme : la startup, ses profils, les appartenances datees
// (`memberships`, kind `startup`) et le `startupId` des fondateurs, en un lot.
// Logique pure : le front l'execute (lib/startupsAdmin.ts), le MCP le fera plus tard.

/** La collection des reponses (`collections.ts` ne se touche pas dans ce lot : nom declare ici). */
export const TEAM_LOCKS_COLLECTION = "teamLocks";
/** Une reponse par fondateur : son id de fondateur, deja propre a un batch. */
export const teamLockPath = (founderId: string) => `${TEAM_LOCKS_COLLECTION}/${founderId}`;

/** Cofondateurs qu'une reponse peut citer (registre, modele du formulaire) : une startup a donc 5 membres au plus. */
export const TEAM_LOCK_MAX_COFOUNDERS = 4;
export const STARTUP_MAX_MEMBERS = TEAM_LOCK_MAX_COFOUNDERS + 1;

/** Une reponse lue, reduite a ce que le regroupement lit. */
export type TeamLockAnswer = Pick<TeamLock, "founderId" | "locked" | "coFounderIds" | "startupName">;

/** Une equipe reciproque : ses membres (tries) et les noms de startup donnes. */
export type ProposedTeam = {
  /** Cle stable de l'equipe : ses membres tries, joints par `+`. */
  key: string;
  memberIds: string[];
  /** Les noms donnes par ses membres, sans doublon (casse ignoree), le plus cite d'abord. */
  startupNames: string[];
};

/**
 * Pourquoi une reponse « oui » n'entre pas dans une equipe proposee, pour un cofondateur cite :
 * pas encore repondu, repondu « non », cite une autre equipe, ou deja dans une startup.
 */
export type LockGap = { kind: "not_answered" | "said_no" | "other_team" | "has_startup"; founderId: string };

/** Une reponse « oui » qui ne forme pas (encore) une equipe reciproque. */
export type PartialLock = {
  founderId: string;
  coFounderIds: string[];
  startupName: string | null;
  /** Vide : il a repondu oui sans citer personne. */
  gaps: LockGap[];
};

export type TeamLockGroups = {
  proposed: ProposedTeam[];
  partial: PartialLock[];
  /** Ont repondu « non » : aucune startup, tires au sort pour le H5. */
  noTeam: string[];
};

/** L'equipe que decrit une reponse « oui » : le repondant et ses cofondateurs, sans doublon, tries. */
const teamOf = (a: TeamLockAnswer): string[] => [...new Set([a.founderId, ...a.coFounderIds])].sort();
const sameTeam = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Les noms donnes, sans doublon (casse et espaces ignores), le plus cite d'abord puis par ordre alphabetique. */
function namesOf(answers: readonly TeamLockAnswer[]): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  for (const a of answers) {
    const name = a.startupName?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const hit = counts.get(key);
    counts.set(key, { name: hit?.name ?? name, n: (hit?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((c) => c.name);
}

/**
 * Range les reponses : equipes reciproques proposees, reponses « oui » a verifier
 * (avec, pour chaque cofondateur cite, ce qui manque), et « non ».
 * `assigned` : les fondateurs deja dans une startup. Ils ne sont plus ranges, et
 * une equipe qui en contient un n'est plus proposee (elle est deja creee, ou a revoir).
 * Une reponse sans `locked` (formulaire envoye sans la question) n'est pas rangee.
 */
export function groupTeamLocks(answers: readonly TeamLockAnswer[], assigned: ReadonlySet<string> = new Set()): TeamLockGroups {
  const byId = new Map(answers.map((a) => [a.founderId, a]));

  const proposed = new Map<string, ProposedTeam>();
  const partial: PartialLock[] = [];
  const noTeam: string[] = [];
  for (const a of answers) {
    if (assigned.has(a.founderId)) continue;
    if (a.locked === false) {
      noTeam.push(a.founderId);
      continue;
    }
    if (a.locked !== true) continue;
    const members = teamOf(a);
    const coFounderIds = members.filter((id) => id !== a.founderId);
    const gaps = coFounderIds.flatMap((id): LockGap[] => {
      if (assigned.has(id)) return [{ kind: "has_startup", founderId: id }];
      const other = byId.get(id);
      if (!other || other.locked === null) return [{ kind: "not_answered", founderId: id }];
      if (other.locked === false) return [{ kind: "said_no", founderId: id }];
      return sameTeam(teamOf(other), members) ? [] : [{ kind: "other_team", founderId: id }];
    });
    // Reciproque : au moins un cofondateur, et chacun cite exactement la meme equipe.
    if (members.length > 1 && gaps.length === 0) {
      const key = members.join("+");
      if (!proposed.has(key)) proposed.set(key, { key, memberIds: members, startupNames: namesOf(members.map((id) => byId.get(id)!)) });
    } else {
      partial.push({ founderId: a.founderId, coFounderIds, startupName: a.startupName?.trim() || null, gaps });
    }
  }
  return { proposed: [...proposed.values()], partial, noTeam };
}

// ---- Creer les startups -----------------------------------------------------------

/** Une startup a creer : son nom et ses membres, tels que le staff les a confirmes. */
export type StartupDraft = { name: string; memberIds: string[] };

/** Un brouillon tel qu'il sera ecrit : nom sans espaces autour, membres sans doublon. */
export const normalizeDraft = (draft: StartupDraft): StartupDraft => ({ name: draft.name.trim(), memberIds: [...new Set(draft.memberIds)] });

type NoStamps<T> = Omit<T, "createdDateISOString" | "updatedDateISOString">;

/** L'id d'une startup creee depuis Lock my team : le batch et le nom (`fall-2026-lumen`), unique parmi `taken`. */
export function startupIdFor(batchId: string, name: string, taken: ReadonlySet<string>): string {
  const base = `${batchId}-${slugify(name) || "startup"}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const emptyProfile = (teamFormedDayString: string): StartupProfile => ({
  icp: null,
  problem: null,
  solution: null,
  whyNow: null,
  currentStatus: null,
  anythingElse: null,
  pitchDeckUrl: null,
  driveFolderUrl: null,
  product: null,
  technology: null,
  usersGoal: null,
  revenueGoal: null,
  plannedMilestones: null,
  teamFormedDayString,
  marketAnalysis: null,
});

const emptyInternal: StartupInternal = {
  go: null,
  clearIdea: null,
  highPotential: null,
  slideQuality: null,
  achievements: null,
  achievementsScore: null,
  risks: null,
  notes: null,
  tractionNotes: null,
};

/**
 * Ce qui empeche de creer ces startups (`null` si rien) : un nom, de 1 a
 * `STARTUP_MAX_MEMBERS` membres, chacun fondateur du batch non archive, sans startup,
 * dans une seule des startups. LA regle : la page l'affiche, `startupCreationWrites` la leve.
 */
export function startupDraftsProblem(
  drafts: readonly StartupDraft[],
  founders: StartupCreationInput["founders"],
  batchId: string,
): { code: string; message: string } | null {
  const byId = new Map(founders.map((f) => [f.id, f]));
  const used = new Set<string>();
  for (const { name, memberIds } of drafts.map(normalizeDraft)) {
    if (!name) return { code: "missing_name", message: "Every startup needs a name." };
    if (memberIds.length === 0) return { code: "no_members", message: `${name}: add at least one founder.` };
    if (memberIds.length > STARTUP_MAX_MEMBERS) return { code: "too_many_members", message: `${name}: ${STARTUP_MAX_MEMBERS} founders at most.` };
    for (const id of memberIds) {
      const f = byId.get(id);
      if (!f || f.batchId !== batchId || f.archivedDateISOString !== null) return { code: "unknown_founder", message: `${name}: founder ${id} is not in this batch.` };
      if (f.startupId) return { code: "already_in_startup", message: `${name}: ${f.name} is already in a startup.` };
      if (used.has(id)) return { code: "member_twice", message: `${f.name} is in two of these startups.` };
      used.add(id);
    }
  }
  return null;
}

export type StartupCreationInput = {
  programId: string;
  batchId: string;
  drafts: readonly StartupDraft[];
  /** Les fondateurs du batch (non archives) : un membre doit en etre, sans startup. */
  founders: readonly WithId<Pick<Founder, "batchId" | "name" | "startupId" | "archivedDateISOString">>[];
  /** Ids des startups qui existent deja (l'id d'une nouvelle startup les evite). */
  existingStartupIds: ReadonlySet<string>;
  /** Le jour ou l'equipe se forme (debut des appartenances), `YYYY-MM-DD`. */
  dayString: string;
  nowISO: string;
};

/**
 * Les ecritures qui creent les startups confirmees, en un lot : `startups/{id}` et
 * ses deux documents prives, une appartenance datee par membre, et le `startupId`
 * de chaque fondateur. Refuse (RuleError) ce que dit `startupDraftsProblem`.
 */
export function startupCreationWrites(input: StartupCreationInput): { writes: DocWrite[]; startupIds: string[] } {
  const drafts = input.drafts.map(normalizeDraft);
  const problem = startupDraftsProblem(drafts, input.founders, input.batchId);
  if (problem) throw new RuleError(problem.code, problem.message, problem.code === "missing_name" ? "name" : "memberIds");
  const taken = new Set(input.existingStartupIds);
  const writes: DocWrite[] = [];
  const startupIds: string[] = [];
  for (const { name, memberIds } of drafts) {
    const startupId = startupIdFor(input.batchId, name, taken);
    taken.add(startupId);
    startupIds.push(startupId);
    const scoped = { programId: input.programId, batchId: input.batchId };
    const startup: NoStamps<Startup> = {
      ...scoped,
      archivedDateISOString: null,
      name,
      logoUrl: null,
      websiteUrl: null,
      ideaOneLine: null,
      vertical: null,
      status: "active",
      members: memberIds.map((founderId) => ({ founderId, title: null })),
      memberIds,
      stats: null,
    };
    writes.push(
      setWrite(docPaths.startup(startupId), { ...startup, createdDateISOString: input.nowISO, updatedDateISOString: input.nowISO }),
      setWrite(docPaths.startupProfile(startupId), emptyProfile(input.dayString)),
      setWrite(docPaths.startupInternal(startupId), emptyInternal),
    );
    for (const founderId of memberIds) {
      // Une startup formee par Lock my team, hors evenement : `eventId` nul.
      const membership: Membership = {
        ...scoped,
        founderId,
        kind: "startup",
        teamId: startupId,
        eventId: null,
        role: null,
        startDayString: input.dayString,
        endDayString: null,
        endReason: null,
      };
      writes.push(
        setWrite(`${COL.memberships}/${docIds.teamMembership(startupId, founderId, input.dayString)}`, membership),
        mergeWrite(docPaths.founder(founderId), { startupId, updatedDateISOString: input.nowISO }),
      );
    }
  }
  return { writes, startupIds };
}
