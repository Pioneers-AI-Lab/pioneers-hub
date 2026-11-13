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
 * La verification des preuves (SPECS §4.2) : lever le retard d'une soumission,
 * ou mettre a 0 des elements du bareme (une fausse preuve). Ni l'heure d'envoi
 * ni la source des releves ne changent ; le declencheur recalcule le classement.
 */
export async function setTeamProofCheck(eventId: string, teamId: string, patch: Partial<Pick<Submission, "lateWaived" | "zeroedItemKeys">>): Promise<void> {
  await updateDoc(refs.submission(eventId, teamId), patch);
}
