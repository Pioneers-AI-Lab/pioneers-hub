import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { absenceWrites } from "../shared/admin/teams";
import { absentFounderIds } from "../shared/attendance";
import { COL, eventCollectionPaths } from "../shared/collections";
import type { Attendance, EventTeam, Membership, WithId } from "../shared/types";
import { applyWrites } from "./admin/writes";

// ----------------------------
// services - la presence masque les absents des groupes publies (19/11)
// ----------------------------
// La presence est LA source : un absent pose apres la publication est masque de son groupe
// (`EventTeam.absentMemberIds`) et de l'historique (`Membership.masked`), sans quitter le tirage ;
// remis present, il revient. Declencheur `onAttendanceWritten` (toute ecriture de presence : Admin,
// `mark_attendance`, `set_fields`), rattrapage `scripts/sync-team-absences.mjs`. Le groupe ecrit
// declenche `onTeamWritten` : le leaderboard suit.

const db = () => getFirestore();

/** Les absents marques a un evenement (lus dans la transaction). */
export const absentOf = async (tx: Transaction, eventId: string) =>
  absentFounderIds((await tx.get(db().collection(eventCollectionPaths.attendance(eventId)))).docs.map((d) => d.data() as Attendance));

/** Recalcule le masque d'absence des groupes publies d'un evenement ; rend le nombre d'ecritures. */
export async function syncTeamAbsences(eventId: string): Promise<number> {
  return db().runTransaction(async (tx) => {
    const [absentIds, teams, memberships] = await Promise.all([
      absentOf(tx, eventId),
      tx.get(db().collection(eventCollectionPaths.teams(eventId))),
      tx.get(db().collection(COL.memberships).where("eventId", "==", eventId)),
    ]);
    const writes = absenceWrites(
      eventId,
      teams.docs.map((d) => ({ ...(d.data() as EventTeam), id: d.id }) as WithId<EventTeam>),
      memberships.docs.map((d) => ({ ...(d.data() as Membership), id: d.id }) as WithId<Membership>),
      absentIds,
    );
    applyWrites(tx, writes);
    return writes.length;
  });
}

/** Une marque de presence : seul un passage vers ou depuis `absent` change les groupes. */
export async function onAttendanceChange(eventId: string, before: Pick<Attendance, "status"> | null, after: Pick<Attendance, "status"> | null): Promise<void> {
  if ((before?.status === "absent") === (after?.status === "absent")) return;
  await syncTeamAbsences(eventId);
}
