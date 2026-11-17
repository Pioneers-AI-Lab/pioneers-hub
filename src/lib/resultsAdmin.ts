import { setDoc, updateDoc } from "firebase/firestore";
import { emptySubmission, submissionStamp, type Submission, type WithId } from "@shared/types";
import { refs } from "@/lib/firestore/refs";

// ----------------------------
// Les resultats d'une equipe, corriges par le staff (SPECS §4.2)
// ----------------------------
// Ecriture staff directe (regle `submissions` : write staff), comme Admin >
// Events. Le declencheur `onSubmissionWritten` en tire les releves de metriques
// (source `staff`) et recalcule le leaderboard, comme pour le Debrief.

export type TeamResultsPatch = Pick<Submission, "metrics" | "productUrl" | "proofUrls" | "notes">;

export async function saveTeamResults(
  eventId: string,
  teamId: string,
  current: WithId<Submission> | null,
  patch: TeamResultsPatch,
  staffUid: string,
): Promise<void> {
  // Le convertisseur retire l'id : il vit dans le chemin.
  const submission: WithId<Submission> = {
    ...emptySubmission(teamId),
    ...current,
    ...patch,
    id: teamId,
    teamId,
    ...submissionStamp(staffUid, "staff", new Date().toISOString()),
  };
  await setDoc(refs.submission(eventId, teamId), submission);
}

/**
 * Lever (ou remettre) le retard d'une soumission (SPECS §4.2) : sinon le bareme lui donne 0.
 * Ni l'heure d'envoi ni la source des releves ne changent ; le declencheur recalcule le classement.
 */
export async function setLateWaived(eventId: string, teamId: string, lateWaived: boolean): Promise<void> {
  await updateDoc(refs.submission(eventId, teamId), { lateWaived });
}

/**
 * L'Outstanding mention d'une equipe (decision du 17/11) : +20 a une equipe qui a
 * 100. Elle vit sur la soumission, comme l'exception de retard ; une equipe notee
 * par le jury sans avoir rien envoye recoit une soumission vide (ni heure d'envoi,
 * ni metrique : rien d'autre ne change). Le declencheur recalcule le classement.
 */
export async function setTeamOutstanding(eventId: string, teamId: string, outstanding: boolean, hasSubmission: boolean): Promise<void> {
  const ref = refs.submission(eventId, teamId);
  if (hasSubmission) await updateDoc(ref, { outstanding });
  else await setDoc(ref, { ...emptySubmission(teamId), id: teamId, outstanding });
}
