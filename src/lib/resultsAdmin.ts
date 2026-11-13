import { setDoc } from "firebase/firestore";
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
