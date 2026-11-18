import { outstandingWrite, teamResultsWrite, type TeamResultsPatch } from "@shared/admin/results";
import type { Submission, WithId } from "@shared/types";
import { commitWrites } from "@/lib/firestore/write";

// ----------------------------
// Les resultats d'une equipe, corriges par le staff (SPECS §4.2)
// ----------------------------
// Ecriture staff directe (regle `submissions` : write staff). Les gestes :
// shared/admin/results.ts, comme pour l'API.

const now = () => new Date().toISOString();

export const saveTeamResults = (eventId: string, teamId: string, current: WithId<Submission> | null, patch: TeamResultsPatch, staffUid: string) =>
  commitWrites([teamResultsWrite(eventId, teamId, current, patch, staffUid, now())]);

/** `eligible` : la ligne du leaderboard a le maximum de la grille (`outstandingEligible`). */
export const setTeamOutstanding = (eventId: string, teamId: string, outstanding: boolean, team: { hasSubmission: boolean; eligible: boolean }) =>
  commitWrites([outstandingWrite(eventId, teamId, outstanding, team)]);
