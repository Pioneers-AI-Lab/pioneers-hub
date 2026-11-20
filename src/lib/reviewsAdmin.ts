import { founderReviewWrite, startupReviewNote, startupReviewWrite, type FounderReviewInput, type StartupReviewInput } from "@shared/weeklyReviews";
import type { FounderReview } from "@shared/types";
import type { StartupReviewRow, WeekRows } from "@/context/AdminReviewsContext";
import { commitWrites } from "@/lib/firestore/write";
import { formatDay, yesNoLabel } from "@/lib/format";
import { paths } from "@/lib/paths";

// ----------------------------
// Admin > Reviews : enregistrer la revue d'un Weekly update (lot 4)
// ----------------------------
// `founderReviews/{founderId}_{semaine}` et `startupReviews/{startupId}_{semaine}` (staff en ecriture,
// staff + IC en lecture ; la regle refuse une note hors 0-5 et l'Outstanding sous 100). La revue est
// verifiee et construite par shared/weeklyReviews.ts ; le dernier enregistrement fait foi.

export const saveFounderReview = (input: FounderReviewInput, reviewedByUid: string) =>
  commitWrites("review_founder_update", [founderReviewWrite(input, reviewedByUid, new Date().toISOString())]);

export const saveStartupReview = (input: StartupReviewInput, reviewedByUid: string) =>
  commitWrites("review_startup_update", [startupReviewWrite(input, reviewedByUid, new Date().toISOString())]);

/** « Week of 23 Nov ». */
export const weekLabel = (week: string) => `Week of ${formatDay(week, true)}`;

/** Le resume d'une revue de fondateur sur une ligne : « Ambitious yes · Reached no · Problem validated yes ». */
export function founderReviewSummary(review: Pick<FounderReview, "goalAmbitious" | "goalReached" | "problemValidated"> | null): string | null {
  if (!review) return null;
  return [
    ["Ambitious", review.goalAmbitious],
    ["Reached", review.goalReached],
    ["Problem validated", review.problemValidated],
  ]
    .flatMap(([label, v]) => (typeof v === "boolean" ? [`${label} ${yesNoLabel(v)!.toLowerCase()}`] : []))
    .join(" · ");
}

/** La note d'une revue de startup, sur 100 (120 avec l'Outstanding). */
export const startupReviewMeta = (row: StartupReviewRow) => {
  const note = row.review ? startupReviewNote(row.review) : null;
  return note === null ? undefined : String(note);
};

/**
 * Le prochain update a revoir de la semaine, apres celui qu'on vient d'enregistrer : les fondateurs
 * d'abord, puis les startups, dans l'ordre de la liste ; la semaine quand tout est revu.
 */
export function nextReviewHref(week: string, { founders, startups }: WeekRows, current: { founderId?: string; startupId?: string }): string {
  const founder = founders.find((r) => !r.review && r.founder.id !== current.founderId);
  if (founder) return paths.adminReviewFounder(week, founder.founder.id);
  const startup = startups.find((r) => !r.review && r.startup.id !== current.startupId);
  return startup ? paths.adminReviewStartup(week, startup.startup.id) : paths.adminReviewsWeek(week);
}

/** Le bouton d'enregistrement : il passe au suivant, ou revient a la semaine quand tout est revu. */
export const saveLabel = (week: string, nextHref: string) => (nextHref === paths.adminReviewsWeek(week) ? "Save" : "Save and review the next");
