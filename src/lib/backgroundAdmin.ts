import { backgroundRatingWrite, type BackgroundScores } from "@shared/background";
import type { FounderDirectory } from "@shared/types";
import { commitWrites } from "@/lib/firestore/write";

// ----------------------------
// Admin > Background : enregistrer la note du staff
// ----------------------------
// `founders/{id}/private/internal.background` (staff en ecriture, staff + IC en lecture ;
// la regle refuse l'Outstanding sous 100). La proposition de Claude (`background.proposed`) reste.
// La note est verifiee par `backgroundRatingWrite` (shared/background.ts).

export const saveBackground = (founderId: string, scores: BackgroundScores, outstanding: boolean, ratedByUid: string) =>
  commitWrites("rate_background", [backgroundRatingWrite(founderId, { scores, outstanding }, ratedByUid, new Date().toISOString())]);

/** Le resume d'un profil sur une ligne (liste d'Admin > Background) : experience, repeat founder, nationalite. */
export function backgroundFacts(directory: Pick<FounderDirectory, "yearsOfXP" | "repeatFounder" | "nationality"> | null): string {
  if (!directory) return "";
  const years = directory.yearsOfXP;
  return [
    years === null || years === undefined ? null : `${years} year${years === 1 ? "" : "s"} of experience`,
    directory.repeatFounder === true ? "Repeat founder" : null,
    directory.nationality,
  ]
    .filter(Boolean)
    .join(" · ");
}
