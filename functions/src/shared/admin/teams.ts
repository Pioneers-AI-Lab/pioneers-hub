import { publicShortName } from "../access";
import { docIds, docPaths } from "../collections";
import { deleteWrite, mergeWrite, RuleError, setWrite, type DocWrite } from "../docWrites";
import { sameIds } from "../kpis";
import { matchingOf } from "../events";
import { actingLeaderId, generateGroups, groupNumber, isDrawPublished, LEADER_ROLE, leaderIdOf, pairKey, publishedDateOf, rolesWithLeader, teamSizeFor, type GeneratorInput } from "../teamGenerator";
import type { DrawConstraints, EventMatching, EventTeam, Membership, PioneersEvent, WithId } from "../types";

// ----------------------------
// Admin > Events > Matching : le cycle d'un tirage (SPECS §4.1)
// ----------------------------
// En logique pure (shared/docWrites.ts) : TeamGenerator (lib/teamsAdmin.ts) et
// l'API (services/admin/teams.ts) ecrivent les memes documents.
//   1. brouillon : les equipes sont enregistrees NON publiees (lisibles du staff
//      et des investors IC seulement, regle `teams`), avec les contraintes du
//      tirage (`drawConstraints`) ; on peut retirer, retoucher, verrouiller, et
//      re-enregistrer autant de fois que voulu.
//   2. publication : les equipes deviennent publiques (sans les contraintes) et
//      chaque membre recoit son appartenance datee (`memberships`), l'historique
//      « qui a ete avec qui » que lisent les tirages suivants.
//   3. retouche d'un tirage publie (decision du 15/11) : echanger, deplacer,
//      changer le leader, ajouter un retard, retirer un absent. Ni nouveau tirage
//      ni depublication. Les ids d'equipe ne bougent plus (soumissions, notes du
//      jury et appartenances y sont rattachees) ; les appartenances suivent : une
//      retouche CORRIGE le tirage, celui qui quitte une equipe n'y a jamais ete
//      (son appartenance est supprimee, sinon l'historique des paires, sa To do
//      et les formulaires d'equipe compteraient une table qui n'a pas eu lieu).
// Les appartenances ne s'ecrivent qu'a la publication : elles sont lisibles
// des fondateurs du batch, elles reveleraient un brouillon.
//
// Une equipe de brouillon qui disparait d'un nouveau tirage est effacee : ce
// n'est pas de l'historique (rien n'a ete publie ni attribue). Une equipe
// publiee videe par une retouche aussi ; si elle a deja des resultats (Submission,
// note du jury), l'enregistrement est refuse.

/**
 * `id` : celui de l'equipe enregistree (un tirage publie le garde), `null` pour
 * une equipe nouvelle. `leaderId` : le leader tire (ou choisi par le staff), membre du groupe.
 */
export type DraftTeam = { id: string | null; name: string; memberIds: string[]; leaderId: string | null; locked: boolean };

/** Nom complet d'un fondateur, pour en tirer le nom public (prenom + initiale). */
export type FullNameOf = (founderId: string) => string;

type TeamEvent = WithId<Pick<PioneersEvent, "programId" | "batchId" | "startDateISOString" | "endDateISOString" | "matching" | "kind" | "teamSize">>;

/** Id d'equipe unique sur tout le batch : l'id d'appartenance en depend (`docIds.teamMembership`). */
export const teamIdFor = (eventId: string, index: number) => `${eventId}-t${index + 1}`;

function assertNotPublished(existing: readonly WithId<EventTeam>[], message = "These teams are already published: they can no longer be changed here.") {
  if (isDrawPublished(existing)) throw new RuleError("published", message, "eventId");
}

/** Une equipe a enregistrer, sous son id. */
type SavedTeam = DraftTeam & { id: string };

type TeamWrite = {
  publishedDateISOString: string | null;
  /** Noms publics : seulement une fois publie (un brouillon n'est lu que du staff). */
  fullNameOf: FullNameOf | null;
  drawConstraints: DrawConstraints | null;
  /** Absents a l'evenement : masques dans un groupe publie (`absentMemberIds`). */
  absentIds: ReadonlySet<string>;
};

/** Les equipes ; les equipes enregistrees absentes de `teams` sont effacees. */
function teamWrites(eventId: string, teams: SavedTeam[], existing: readonly WithId<EventTeam>[], write: TeamWrite): DocWrite[] {
  const { publishedDateISOString, fullNameOf, drawConstraints, absentIds } = write;
  const writes = teams.map((team) => {
    const previous = existing.find((t) => t.id === team.id);
    return setWrite(docPaths.team(eventId, team.id), {
      name: team.name,
      memberIds: team.memberIds,
      memberNames: fullNameOf ? team.memberIds.map((id) => publicShortName(fullNameOf(id))) : null,
      roles: rolesWithLeader(previous?.roles ?? {}, team.memberIds, team.leaderId),
      locked: publishedDateISOString !== null || team.locked,
      publishedDateISOString,
      startupId: previous?.startupId ?? null,
      drawConstraints,
      absentMemberIds: publishedDateISOString ? team.memberIds.filter((id) => absentIds.has(id)) : [],
    } satisfies EventTeam);
  });
  const keep = new Set(teams.map((t) => t.id));
  return [...writes, ...existing.filter((t) => !keep.has(t.id)).map((t) => deleteWrite(docPaths.team(eventId, t.id)))];
}

/** Brouillon et publication : numerotation continue, l'id suit la position. */
const withPositionalIds = (eventId: string, drafts: DraftTeam[]): SavedTeam[] => drafts.map((d, index) => ({ ...d, id: teamIdFor(eventId, index) }));

/**
 * Les appartenances datees des equipes publiees de l'evenement : creees pour
 * les nouveaux membres, role de leader mis a jour, supprimees pour qui n'est
 * plus dans l'equipe (une correction, voir en tete). `current` : celles deja
 * en base, retrouvees par leur vrai id (l'evenement a pu etre deplace depuis).
 */
function membershipWrites(event: TeamEvent, teams: SavedTeam[], current: readonly WithId<Membership>[], absentIds: ReadonlySet<string>): DocWrite[] {
  const startDayString = event.startDateISOString.slice(0, 10);
  const endDayString = (event.endDateISOString ?? event.startDateISOString).slice(0, 10);
  const key = (teamId: string, founderId: string) => `${teamId}|${founderId}`;
  const left = new Map(current.filter((m) => m.kind === "event_team" && m.eventId === event.id).map((m) => [key(m.teamId, m.founderId), m]));
  const writes: DocWrite[] = [];
  for (const { id: teamId, memberIds, leaderId } of teams) {
    for (const founderId of memberIds) {
      const isLeader = founderId === leaderId;
      const masked = absentIds.has(founderId);
      const previous = left.get(key(teamId, founderId));
      left.delete(key(teamId, founderId));
      if (previous) {
        // Seuls le role de leader (les roles SP26 restent) et le masque d'absence changent.
        const patch: Partial<Membership> = {};
        if ((previous.role === LEADER_ROLE) !== isLeader) patch.role = isLeader ? LEADER_ROLE : null;
        if (Boolean(previous.masked) !== masked) patch.masked = masked;
        if (Object.keys(patch).length) writes.push(mergeWrite(docPaths.teamMembership(previous.id), patch));
        continue;
      }
      writes.push(
        setWrite(docPaths.teamMembership(docIds.teamMembership(teamId, founderId, startDayString)), {
          programId: event.programId,
          batchId: event.batchId,
          founderId,
          kind: "event_team",
          teamId,
          eventId: event.id,
          role: isLeader ? LEADER_ROLE : null,
          startDayString,
          endDayString,
          endReason: null,
          masked,
        } satisfies Membership),
      );
    }
  }
  return [...writes, ...[...left.values()].map((m) => deleteWrite(docPaths.teamMembership(m.id)))];
}

/** La taille du matching suit celle du dernier tirage enregistre : la page de l'evenement et le prochain tirage la relisent. */
function teamSizeWrites(event: TeamEvent, groupSize: number, now: string): DocWrite[] {
  const matching = matchingOf(event);
  if (!matching || matching.size.max === groupSize) return [];
  return [mergeWrite(docPaths.event(event.id), { matching: { ...matching, size: teamSizeFor(groupSize) }, updatedDateISOString: now })];
}

/**
 * Changer le type du matching ou le retirer (`null`), jusqu'a la publication : le
 * brouillon de tirage, fait pour l'ancien matching, est efface dans le meme lot.
 * Un tirage publie fige le matching (historique, fiches, resultats).
 */
export function replaceMatchingWrites(eventId: string, matching: EventMatching | null, existing: readonly WithId<EventTeam>[], now: string): DocWrite[] {
  assertNotPublished(existing, "The groups are published: the matching can no longer be changed or removed.");
  return [...existing.map((t) => deleteWrite(docPaths.team(eventId, t.id))), mergeWrite(docPaths.event(eventId), { matching, updatedDateISOString: now })];
}

/** Le tirage en brouillon (non publie), en groupes de `groupSize`, avec ses contraintes. */
export function draftTeamsWrites(event: TeamEvent, drafts: DraftTeam[], existing: readonly WithId<EventTeam>[], groupSize: number, constraints: DrawConstraints, now: string): DocWrite[] {
  assertNotPublished(existing);
  return [
    ...teamWrites(event.id, withPositionalIds(event.id, drafts), existing, { publishedDateISOString: null, fullNameOf: null, drawConstraints: constraints, absentIds: new Set() }),
    ...teamSizeWrites(event, groupSize, now),
  ];
}

/** La publication : equipes publiques (sans les contraintes) et appartenances datees de chaque membre. */
export function publishTeamsWrites(event: TeamEvent, drafts: DraftTeam[], existing: readonly WithId<EventTeam>[], fullNameOf: FullNameOf, groupSize: number, now: string): DocWrite[] {
  assertNotPublished(existing);
  if (drafts.length === 0) throw new RuleError("nothing_to_publish", "There is nothing to publish.", "eventId");
  const teams = withPositionalIds(event.id, drafts);
  return [
    // Un absent ne se publie pas (refuse avant) : rien a masquer.
    ...teamWrites(event.id, teams, existing, { publishedDateISOString: now, fullNameOf, drawConstraints: null, absentIds: new Set() }),
    ...teamSizeWrites(event, groupSize, now),
    // Aucune appartenance avant la publication.
    ...membershipWrites(event, teams, [], new Set()),
  ];
}

/**
 * Retouche d'un tirage publie : chaque equipe garde son id (une nouvelle a recu
 * le numero libre suivant) ; noms publics et appartenances suivent, la date de
 * publication reste. Une equipe videe est retiree, sauf si elle a des resultats
 * (`withResults` : Submission ou note du jury), qui lui restent attaches.
 */
export function publishedTeamsWrites(
  event: TeamEvent,
  given: DraftTeam[],
  existing: readonly WithId<EventTeam>[],
  memberships: readonly WithId<Membership>[],
  fullNameOf: FullNameOf,
  withResults: ReadonlySet<string>,
  absentIds: ReadonlySet<string>,
): DocWrite[] {
  const publishedDateISOString = publishedDateOf(existing);
  if (!publishedDateISOString) throw new RuleError("not_published", "These teams are not published yet.", "eventId");
  const drafts = keepMaskedMembers(given, existing);
  const teams = drafts.filter((d): d is SavedTeam => d.id !== null);
  const kept = new Set(teams.map((t) => t.id));
  if (kept.size !== drafts.length) throw new RuleError("missing_team_id", "Each team needs its own id: reload the page and try again.", "teams");
  const emptied = existing.filter((t) => !kept.has(t.id) && withResults.has(t.id));
  if (emptied.length > 0) {
    throw new RuleError("team_has_results", `${emptied.map((t) => t.name).join(", ")} already sent results: keep at least one person in ${emptied.length === 1 ? "it" : "them"}.`, "teams");
  }
  return [
    ...teamWrites(event.id, teams, existing, { publishedDateISOString, fullNameOf, drawConstraints: null, absentIds }),
    ...membershipWrites(event, teams, memberships, absentIds),
  ];
}

/**
 * Une retouche ne voit que les membres presents (`visibleTeam`) : un membre masque que la retouche
 * ne place nulle part reste dans son groupe, et le reste masque (il reviendra s'il est remis present).
 * Un leader masque reste leader si la retouche n'en nomme pas d'autre que celui de remplacement (`actingLeaderId`).
 */
export function keepMaskedMembers(drafts: DraftTeam[], existing: readonly WithId<EventTeam>[]): DraftTeam[] {
  const placed = new Set(drafts.flatMap((d) => d.memberIds));
  return drafts.map((draft) => {
    const saved = draft.id ? existing.find((t) => t.id === draft.id) : undefined;
    const masked = saved?.absentMemberIds?.filter((id) => !placed.has(id)) ?? [];
    if (!saved || masked.length === 0) return draft;
    const leader = leaderIdOf(saved);
    const keepLeader = leader !== null && masked.includes(leader) && (draft.leaderId === null || draft.leaderId === actingLeaderId(saved));
    return { ...draft, memberIds: [...draft.memberIds, ...masked], leaderId: keepLeader ? leader : draft.leaderId };
  });
}

/**
 * Le masque d'absence d'un tirage publie, d'apres la presence (services/teamAbsences.ts, a chaque
 * absence posee ou levee) : `absentMemberIds` de chaque groupe et `masked` de chaque appartenance.
 * Seuls les ecarts s'ecrivent ; rien sur un brouillon (le tirage ecarte deja les absents).
 */
export function absenceWrites(eventId: string, teams: readonly WithId<EventTeam>[], memberships: readonly WithId<Membership>[], absentIds: ReadonlySet<string>): DocWrite[] {
  const published = teams.filter((t) => t.publishedDateISOString !== null);
  const writes: DocWrite[] = [];
  for (const team of published) {
    const next = team.memberIds.filter((id) => absentIds.has(id));
    if (!sameIds(next, team.absentMemberIds)) writes.push(mergeWrite(docPaths.team(eventId, team.id), { absentMemberIds: next }));
  }
  const teamIds = new Set(published.map((t) => t.id));
  for (const m of memberships) {
    if (m.kind !== "event_team" || m.eventId !== eventId || !teamIds.has(m.teamId)) continue;
    const masked = absentIds.has(m.founderId);
    if (Boolean(m.masked) !== masked) writes.push(mergeWrite(docPaths.teamMembership(m.id), { masked }));
  }
  return writes;
}

/** Les noms publics des equipes publiees (page publique, ou apres un changement de nom) : seul `memberNames` change. */
export const publicNamesWrites = (eventId: string, teams: readonly WithId<EventTeam>[], fullNameOf: FullNameOf): DocWrite[] =>
  teams.map((team) => mergeWrite(docPaths.team(eventId, team.id), { memberNames: team.memberIds.map((id) => publicShortName(fullNameOf(id))) }));

// ---- Le tirage ---------------------------------------------------------------------

// Une equipe publiee est enregistree verrouillee (le generateur n'y touche plus) ;
// a la retouche, plus de tirage : rien n'y est verrouille.
/** Les noms courts enregistres sur les groupes (`memberNames`), par membre ; vide si le groupe n'en a pas. */
export const savedShortNames = (teams: readonly Pick<EventTeam, "memberIds" | "memberNames">[]): Map<string, string> =>
  new Map(teams.flatMap((t) => t.memberIds.map((id, i) => [id, t.memberNames?.[i] ?? ""] as const)));

export const toDrafts = (teams: readonly WithId<EventTeam>[]): DraftTeam[] =>
  teams.map((t) => ({ id: t.id, name: t.name, memberIds: [...t.memberIds], leaderId: leaderIdOf(t), locked: t.locked && t.publishedDateISOString === null }));

export type DrawInput = Omit<GeneratorInput, "groupSize" | "fixedGroups">;

/** Un tirage : les groupes verrouilles restent tels quels, les autres sont tires puis numerotes. */
export function drawGroups(groups: readonly DraftTeam[], groupSize: number, input: DrawInput, groupLabel: string) {
  const locked = groups.filter((g) => g.locked);
  const result = generateGroups({ ...input, groupSize, fixedGroups: locked.map((g, i) => ({ key: String(i), memberIds: g.memberIds })) });
  const next = [...locked, ...result.groups.map((memberIds): DraftTeam => ({ id: null, name: "", memberIds, leaderId: null, locked: false }))];
  return { groups: next.map((g, i) => ({ ...g, name: g.locked && g.name ? g.name : `${groupLabel} ${i + 1}` })), report: result.report };
}

/** Les groupes sans ces personnes ; un groupe vide disparait (le leader parti est remplace par `assignLeaders`). */
export const withoutMembers = (groups: readonly DraftTeam[], ids: ReadonlySet<string>): DraftTeam[] =>
  groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => !ids.has(m)) })).filter((g) => g.memberIds.length > 0);

/** Les startups en equipes verrouillees, a leur nom, et les autres groupes sans leurs fondateurs. */
export const withStartupTeams = (groups: readonly DraftTeam[], startupGroups: readonly { name: string; memberIds: string[] }[]): DraftTeam[] => [
  ...startupGroups.map((g) => ({ id: null, name: g.name, memberIds: [...g.memberIds], leaderId: null, locked: true })),
  ...withoutMembers(groups, new Set(startupGroups.flatMap((g) => g.memberIds))),
];

/** Les paires enregistrees avec le brouillon (les memes sur chaque equipe), en paires d'ids. */
export const savedPairs = (teams: readonly Pick<EventTeam, "drawConstraints">[], key: keyof DrawConstraints): [string, string][] =>
  (teams[0]?.drawConstraints?.[key] ?? []).map((k) => k.split("|") as [string, string]);

/** Les contraintes a enregistrer avec un brouillon (`pairKey` : Firestore refuse les tableaux de tableaux). */
export const constraintsOf = (keepApart: readonly [string, string][], keepTogether: readonly [string, string][]): DrawConstraints => ({
  keepApart: keepApart.map(([a, b]) => pairKey(a, b)),
  keepTogether: keepTogether.map(([a, b]) => pairKey(a, b)),
});

/** Le numero libre d'un groupe ajoute : apres les groupes affiches et les equipes enregistrees (un id publie ne se reutilise pas). */
export const nextTeamNumber = (groups: readonly Pick<DraftTeam, "id">[], teams: readonly { id: string }[]) =>
  Math.max(groups.length, ...groups.map((g) => (g.id ? groupNumber(g.id) : 0)), ...teams.map((t) => groupNumber(t.id))) + 1;

/** Les groupes qui ont deja des resultats (Submission, note du jury) : une retouche ne peut pas les vider. */
export const teamIdsWithResults = (submissionTeamIds: Iterable<string>, evaluations: readonly { targetId: string }[]) =>
  new Set([...submissionTeamIds, ...evaluations.map((e) => e.targetId)]);

/** Un aleatoire rejouable (mulberry32) : un meme `seed` redonne le meme tirage (apercu puis confirmation). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
