import type { BatchScoped, DateISOString, DayString } from "./common";

// ----------------------------
// La file de revue des Weekly updates (lot 4, docs/FONCTIONNALITES.md §2.8, §2.9)
// ----------------------------
//   founderReviews/{founderId}_{weekStart}   FounderReview   staff + investors IC (ecrit par le staff)
//   startupReviews/{startupId}_{weekStart}   StartupReview   staff + investors IC (ecrit par le staff)
//
// Le staff note chaque Weekly update dans Admin > Reviews, une reponse apres l'autre
// (shared/weeklyReviews.ts). Un id de fondateur ou de startup n'existe que dans UN batch :
// l'id et le lundi de la semaine (celle ou le formulaire ouvre, comme `founderWeeks`) suffisent.
// Jamais lues par les fondateurs : elles ne remontent que par les scores (milestones Weekly goal
// et Problem validated, Traction de la startup).

/** Grille Weekly founder : des oui / non, sans Outstanding (une milestone est atteinte ou non). */
export type FounderReview = BatchScoped & {
  founderId: string;
  /** Lundi de la semaine du Weekly update revu. */
  weekStartDayString: DayString;
  /** « Is this goal ambitious enough? » : l'objectif donne CETTE semaine (pour la suivante). */
  goalAmbitious: boolean | null;
  /** « Was last week's goal reached? » : l'objectif donne la semaine d'avant. */
  goalReached: boolean | null;
  /** « Problem validated? » : une fois oui, la milestone reste atteinte. */
  problemValidated: boolean | null;
  comment: string | null;
  reviewedByUid: string;
  reviewedDateISOString: DateISOString;
};

/** Les criteres de la grille Weekly startup (Traction 60, Progress 40). */
export type StartupReviewCriterion = "traction" | "progress";

/** Grille Weekly startup : deux criteres de 0 a 5, plus l'Outstanding mention (seulement a 100). */
export type StartupReview = BatchScoped & {
  startupId: string;
  weekStartDayString: DayString;
  /** Note de 0 a 5 par critere ; absente ou `null` : pas encore notee. */
  scores: Partial<Record<StartupReviewCriterion, number | null>>;
  outstanding: boolean;
  comment: string | null;
  reviewedByUid: string;
  reviewedDateISOString: DateISOString;
};
