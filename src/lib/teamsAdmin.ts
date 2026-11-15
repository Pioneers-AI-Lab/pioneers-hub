import { writeBatch } from "firebase/firestore";
import { matchingOf } from "@shared/events";
import { publicShortName } from "@shared/access";
import { docIds } from "@shared/collections";
import { LEADER_ROLE, isDrawPublished, publishedDateOf, rolesWithLeader, teamSizeFor } from "@shared/teamGenerator";
import type { DrawConstraints, EventMatching, EventTeam, Membership, PioneersEvent, WithId } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";

// ----------------------------
// Equipes d'un challenge, groupes de lunch roulette (staff, SPECS §4.1)
// ----------------------------
// Cycle d'un tirage :
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

/** Id d'equipe unique sur tout le batch : l'id d'appartenance en depend (`docIds.teamMembership`). */
export const teamIdFor = (eventId: string, index: number) => `${eventId}-t${index + 1}`;

function assertNotPublished(existing: WithId<EventTeam>[], message = "These teams are already published: they can no longer be changed here.") {
  if (isDrawPublished(existing)) throw new Error(message);
}

type Batch = ReturnType<typeof writeBatch>;

/** Une equipe a enregistrer, sous son id. */
type SavedTeam = DraftTeam & { id: string };

type TeamWrite = {
  publishedDateISOString: string | null;
  /** Noms publics : seulement une fois publie (un brouillon n'est lu que du staff). */
  fullNameOf: FullNameOf | null;
  drawConstraints: DrawConstraints | null;
};

/** Ecrit les equipes ; les equipes enregistrees absentes de `teams` sont effacees. */
function writeTeams(batch: Batch, eventId: string, teams: SavedTeam[], existing: WithId<EventTeam>[], write: TeamWrite) {
  const { publishedDateISOString, fullNameOf, drawConstraints } = write;
  for (const team of teams) {
    const previous = existing.find((t) => t.id === team.id);
    batch.set(refs.eventTeam(eventId, team.id), {
      id: team.id,
      name: team.name,
      memberIds: team.memberIds,
      memberNames: fullNameOf ? team.memberIds.map((id) => publicShortName(fullNameOf(id))) : null,
      roles: rolesWithLeader(previous?.roles ?? {}, team.memberIds, team.leaderId),
      locked: publishedDateISOString !== null || team.locked,
      publishedDateISOString,
      startupId: previous?.startupId ?? null,
      drawConstraints,
    } satisfies WithId<EventTeam>);
  }
  const keep = new Set(teams.map((t) => t.id));
  for (const team of existing) if (!keep.has(team.id)) batch.delete(refs.eventTeam(eventId, team.id));
}

/** Brouillon et publication : numerotation continue, l'id suit la position. */
const withPositionalIds = (eventId: string, drafts: DraftTeam[]): SavedTeam[] => drafts.map((d, index) => ({ ...d, id: teamIdFor(eventId, index) }));

/**
 * Les appartenances datees des equipes publiees de l'evenement : creees pour
 * les nouveaux membres, role de leader mis a jour, supprimees pour qui n'est
 * plus dans l'equipe (une correction, voir en tete). `current` : celles deja
 * en base, retrouvees par leur vrai id (l'evenement a pu etre deplace depuis).
 */
function writeMemberships(
  batch: Batch,
  event: WithId<PioneersEvent>,
  teams: SavedTeam[],
  current: readonly WithId<Membership>[],
) {
  const startDayString = event.startDateISOString.slice(0, 10);
  const endDayString = (event.endDateISOString ?? event.startDateISOString).slice(0, 10);
  const key = (teamId: string, founderId: string) => `${teamId}|${founderId}`;
  const left = new Map(
    current.filter((m) => m.kind === "event_team" && m.eventId === event.id).map((m) => [key(m.teamId, m.founderId), m]),
  );
  for (const { id: teamId, memberIds, leaderId } of teams) {
    for (const founderId of memberIds) {
      const isLeader = founderId === leaderId;
      const previous = left.get(key(teamId, founderId));
      left.delete(key(teamId, founderId));
      if (previous) {
        // Seul le role de leader change (les roles SP26 restent).
        if ((previous.role === LEADER_ROLE) !== isLeader) batch.set(refs.teamMembership(previous.id), { role: isLeader ? LEADER_ROLE : null }, { merge: true });
        continue;
      }
      const id = docIds.teamMembership(teamId, founderId, startDayString);
      batch.set(refs.teamMembership(id), {
        id,
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
      } satisfies WithId<Membership>);
    }
  }
  for (const m of left.values()) batch.delete(refs.teamMembership(m.id));
}

/**
 * La taille du matching suit celle du dernier tirage enregistre : la page de
 * l'evenement et le prochain tirage la relisent.
 */
function writeTeamSize(batch: ReturnType<typeof writeBatch>, event: WithId<PioneersEvent>, groupSize: number) {
  const matching = matchingOf(event);
  if (!matching || matching.size.max === groupSize) return;
  batch.set(refs.event(event.id), { matching: { ...matching, size: teamSizeFor(groupSize) }, updatedDateISOString: new Date().toISOString() }, { merge: true });
}

/**
 * Change le type du matching ou le retire (`null`), jusqu'a la publication : le
 * brouillon de tirage, fait pour l'ancien matching, est efface dans le meme lot.
 * Un tirage publie fige le matching (historique, fiches, resultats).
 */
export async function replaceMatching(event: WithId<PioneersEvent>, matching: EventMatching | null, existing: WithId<EventTeam>[]) {
  assertNotPublished(existing, "The groups are published: the matching can no longer be changed or removed.");
  const batch = writeBatch(db);
  for (const team of existing) batch.delete(refs.eventTeam(event.id, team.id));
  batch.set(refs.event(event.id), { matching, updatedDateISOString: new Date().toISOString() }, { merge: true });
  await batch.commit();
}

/** Enregistre le tirage en brouillon (non publie), tire en groupes de `groupSize`, avec ses contraintes. */
export async function saveDraftTeams(
  event: WithId<PioneersEvent>,
  drafts: DraftTeam[],
  existing: WithId<EventTeam>[],
  groupSize: number,
  constraints: DrawConstraints,
) {
  assertNotPublished(existing);
  const batch = writeBatch(db);
  writeTeams(batch, event.id, withPositionalIds(event.id, drafts), existing, { publishedDateISOString: null, fullNameOf: null, drawConstraints: constraints });
  writeTeamSize(batch, event, groupSize);
  await batch.commit();
}

/** Publie les equipes et ecrit les appartenances datees de chaque membre. */
export async function publishTeams(
  event: WithId<PioneersEvent>,
  drafts: DraftTeam[],
  existing: WithId<EventTeam>[],
  fullNameOf: FullNameOf,
  groupSize: number,
) {
  assertNotPublished(existing);
  if (drafts.length === 0) throw new Error("There is nothing to publish.");
  const teams = withPositionalIds(event.id, drafts);
  const batch = writeBatch(db);
  // Les contraintes tombent : les equipes deviennent publiques.
  writeTeams(batch, event.id, teams, existing, { publishedDateISOString: new Date().toISOString(), fullNameOf, drawConstraints: null });
  writeTeamSize(batch, event, groupSize);
  // Aucune appartenance avant la publication.
  writeMemberships(batch, event, teams, []);
  await batch.commit();
}

/**
 * Retouche d'un tirage publie : chaque equipe garde son id (une nouvelle a recu
 * le numero libre suivant) ; noms publics et appartenances suivent, la date de
 * publication reste. Une equipe videe est retiree, sauf si elle a des resultats
 * (`withResults` : Submission ou note du jury), qui lui restent attaches.
 */
export async function updatePublishedTeams(
  event: WithId<PioneersEvent>,
  drafts: DraftTeam[],
  existing: WithId<EventTeam>[],
  memberships: readonly WithId<Membership>[],
  fullNameOf: FullNameOf,
  withResults: ReadonlySet<string>,
) {
  const publishedDateISOString = publishedDateOf(existing);
  if (!publishedDateISOString) throw new Error("These teams are not published yet.");
  const teams = drafts.filter((d): d is SavedTeam => d.id !== null);
  const kept = new Set(teams.map((t) => t.id));
  if (kept.size !== drafts.length) throw new Error("Each team needs its own id: reload the page and try again.");
  const emptied = existing.filter((t) => !kept.has(t.id) && withResults.has(t.id));
  if (emptied.length > 0) {
    throw new Error(`${emptied.map((t) => t.name).join(", ")} already sent results: keep at least one person in ${emptied.length === 1 ? "it" : "them"}.`);
  }
  const batch = writeBatch(db);
  writeTeams(batch, event.id, teams, existing, { publishedDateISOString, fullNameOf, drawConstraints: null });
  writeMemberships(batch, event, teams, memberships);
  await batch.commit();
}

/**
 * Ajoute les noms publics aux equipes publiees avant la page publique (ou
 * apres un changement de nom) : seul `memberNames` change.
 */
export async function refreshPublicNames(event: WithId<PioneersEvent>, teams: WithId<EventTeam>[], fullNameOf: FullNameOf) {
  const batch = writeBatch(db);
  for (const team of teams) {
    batch.set(
      refs.eventTeam(event.id, team.id),
      { memberNames: team.memberIds.map((id) => publicShortName(fullNameOf(id))) },
      { merge: true },
    );
  }
  await batch.commit();
}
