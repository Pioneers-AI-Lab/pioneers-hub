import { docPaths } from "../collections";
import { mergeWrite, RuleError, setWrite, type DocWrite } from "../docWrites";
import { emptySubmission, submissionStamp, type Submission } from "../types";

// ----------------------------
// Les resultats d'une equipe, corriges par le staff (SPECS §4.2)
// ----------------------------
// En logique pure (shared/docWrites.ts) : Admin > Events > une equipe
// (lib/resultsAdmin.ts) et l'API (`set_team_results`,
// `set_outstanding`). Le declencheur `onSubmissionWritten` en tire les releves de
// metriques (source `staff`) et recalcule le leaderboard, comme pour le Debrief.

/** Ce que le staff corrige d'une Submission. */
export type TeamResultsPatch = Partial<Pick<Submission, "metrics" | "productUrl" | "proofUrls" | "notes">>;

/** La Submission corrigee par le staff : ses valeurs, marquee `staff` (le retard d'origine reste). */
export function teamResultsWrite(eventId: string, teamId: string, current: (Submission & { id?: string }) | null, patch: TeamResultsPatch, staffUid: string, now: string): DocWrite {
  // L'id vit dans le chemin, jamais dans le document.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, ...saved } = current ?? {};
  const submission: Submission = { ...emptySubmission(teamId), ...saved, ...patch, teamId, ...submissionStamp(staffUid, "staff", now) };
  return setWrite(docPaths.submission(eventId, teamId), submission);
}

/**
 * L'Outstanding mention d'une equipe (decision du 17/11) : seulement une equipe
 * qui a le maximum de la grille (`outstandingEligible` du leaderboard). Elle vit
 * sur la soumission ; une equipe notee par le jury
 * sans avoir rien envoye recoit une soumission vide (ni heure d'envoi, ni metrique).
 */
export function outstandingWrite(eventId: string, teamId: string, outstanding: boolean, team: { hasSubmission: boolean; eligible: boolean }): DocWrite {
  if (outstanding && !team.eligible) throw new RuleError("not_eligible", "The Outstanding mention goes only to a team with the grid's maximum.", "teamId");
  const path = docPaths.submission(eventId, teamId);
  return team.hasSubmission ? mergeWrite(path, { outstanding }) : setWrite(path, { ...emptySubmission(teamId), outstanding });
}
