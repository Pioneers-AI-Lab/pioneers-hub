import { writeBatch } from "firebase/firestore";
import { matchingOf } from "@shared/events";
import { publicShortName } from "@shared/access";
import { docIds } from "@shared/collections";
import { LEADER_ROLE, rolesWithLeader, teamSizeFor } from "@shared/teamGenerator";
import type { EventTeam, Membership, PioneersEvent, WithId } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";

// ----------------------------
// Equipes d'un challenge, groupes de lunch roulette (staff, SPECS §4.1)
// ----------------------------
// Cycle d'un tirage :
//   1. brouillon : les equipes sont enregistrees NON publiees (lisibles du staff
//      et des investors IC seulement, regle `teams`) ; on peut retirer,
//      retoucher, verrouiller, et re-enregistrer autant de fois que voulu.
//   2. publication : les equipes deviennent publiques et chaque membre recoit
//      son appartenance datee (`memberships`), l'historique « qui a ete avec
//      qui » que lisent les tirages suivants. Une equipe publiee ne se
//      retouche plus ici.
// Les appartenances ne s'ecrivent qu'a la publication : elles sont lisibles
// des fondateurs du batch, elles reveleraient un brouillon.
//
// Une equipe de brouillon qui disparait d'un nouveau tirage est effacee : ce
// n'est pas de l'historique (rien n'a ete publie ni attribue).

/** `leaderId` : le leader tire (ou choisi par le staff), membre du groupe. */
export type DraftTeam = { name: string; memberIds: string[]; leaderId: string | null; locked: boolean };

/** Nom complet d'un fondateur, pour en tirer le nom public (prenom + initiale). */
export type FullNameOf = (founderId: string) => string;

/** Id d'equipe unique sur tout le batch : l'id d'appartenance en depend (`docIds.teamMembership`). */
export const teamIdFor = (eventId: string, index: number) => `${eventId}-t${index + 1}`;

function assertNotPublished(existing: WithId<EventTeam>[]) {
  if (existing.some((t) => t.publishedDateISOString !== null))
    throw new Error("These teams are already published: they can no longer be changed here.");
}

function writeTeams(
  batch: ReturnType<typeof writeBatch>,
  eventId: string,
  drafts: DraftTeam[],
  existing: WithId<EventTeam>[],
  publishedDateISOString: string | null,
  fullNameOf: FullNameOf | null,
) {
  const keep = new Set<string>();
  drafts.forEach((draft, index) => {
    const id = teamIdFor(eventId, index);
    keep.add(id);
    const previous = existing.find((t) => t.id === id);
    batch.set(refs.eventTeam(eventId, id), {
      id,
      name: draft.name,
      memberIds: draft.memberIds,
      // Noms publics seulement a la publication : un brouillon n'est lu que du staff.
      memberNames: fullNameOf ? draft.memberIds.map((id) => publicShortName(fullNameOf(id))) : null,
      roles: rolesWithLeader(previous?.roles ?? {}, draft.memberIds, draft.leaderId),
      locked: publishedDateISOString !== null || draft.locked,
      publishedDateISOString,
      startupId: previous?.startupId ?? null,
    });
  });
  for (const team of existing) if (!keep.has(team.id)) batch.delete(refs.eventTeam(eventId, team.id));
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

/** Enregistre le tirage en brouillon (non publie), tire en groupes de `groupSize`. */
export async function saveDraftTeams(event: WithId<PioneersEvent>, drafts: DraftTeam[], existing: WithId<EventTeam>[], groupSize: number) {
  assertNotPublished(existing);
  const batch = writeBatch(db);
  writeTeams(batch, event.id, drafts, existing, null, null);
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
  const now = new Date().toISOString();
  const startDayString = event.startDateISOString.slice(0, 10);
  const endDayString = (event.endDateISOString ?? event.startDateISOString).slice(0, 10);

  const batch = writeBatch(db);
  writeTeams(batch, event.id, drafts, existing, now, fullNameOf);
  writeTeamSize(batch, event, groupSize);
  drafts.forEach((draft, index) => {
    const teamId = teamIdFor(event.id, index);
    for (const founderId of draft.memberIds) {
      const id = docIds.teamMembership(teamId, founderId, startDayString);
      batch.set(refs.teamMembership(id), {
        id,
        programId: event.programId,
        batchId: event.batchId,
        founderId,
        kind: "event_team",
        teamId,
        eventId: event.id,
        role: founderId === draft.leaderId ? LEADER_ROLE : null,
        startDayString,
        endDayString,
        endReason: null,
      } satisfies WithId<Membership>);
    }
  });
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
