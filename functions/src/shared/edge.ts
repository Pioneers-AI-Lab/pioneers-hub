import { isWholeNote } from "./background";
import { docPaths } from "./collections";
import { mergeWrite, RuleError, type DocWrite } from "./docWrites";
import type { FounderEdgeRating } from "./types";

// ----------------------------
// L'Edge d'un fondateur (18/11, docs/FONCTIONNALITES.md §2.14)
// ----------------------------
// Son avantage intrinseque, hors marche (fort en code, en marketing, n'abandonne jamais,
// leadership...). Le fondateur l'ecrit dans « Mon profil » (`founderDirectory.edge`, texte
// libre, obligatoire) ; le staff le note de 0 a 5 sur sa fiche ou dans Admin > Edge
// (`founders/{id}/private/internal.edge`, staff + investors IC), avec le texte qu'il a note
// (`ratedText`) : un texte change depuis la note est « To rate » a nouveau. La derniere note
// compte (sous-score Edge de la Program Performance, 10 %).

/** La note maximale. */
export const EDGE_MAX_NOTE = 5;

/** La note du staff sur 100 (note ÷ 5 × 100) ; `null` sans note. */
export const edgeScore = (rating: FounderEdgeRating | null | undefined): number | null =>
  typeof rating?.score === "number" ? (rating.score / EDGE_MAX_NOTE) * 100 : null;

/** Ou en est l'Edge d'un fondateur : pas encore ecrit, a noter (jamais note, ou change depuis), ou note. */
export type EdgeStatus = "missing" | "to_rate" | "rated";

/** Le texte compare sans ses espaces de bord (`ratedText` est enregistre ainsi) : un retour a la ligne ajoute ne demande pas de renoter. */
export function edgeStatus(text: string | null | undefined, rating: FounderEdgeRating | null | undefined): EdgeStatus {
  const t = text?.trim();
  if (!t) return "missing";
  return rating && rating.ratedText === t ? "rated" : "to_rate";
}

/** Ce qui empeche d'enregistrer une note (vide si rien) : un entier de 0 a 5. */
export const edgeProblems = (score: unknown): string[] => (isWholeNote(score, EDGE_MAX_NOTE) ? [] : [`Edge: a score from 0 to ${EDGE_MAX_NOTE}.`]);

/**
 * La note du staff, a fusionner dans `founders/{id}/private/internal` : la note, le texte note
 * (sans ses espaces de bord), qui et quand. Refuse (RuleError) une note invalide, ou un Edge pas
 * encore ecrit (rien a noter). Lue par l'Admin (lib/edgeAdmin.ts) et l'action `rate_edge`.
 */
export function edgeRatingWrite(founderId: string, rating: { score: number; ratedText: string | null }, ratedByUid: string, nowISO: string): DocWrite {
  const problem = edgeProblems(rating.score)[0];
  if (problem) throw new RuleError("invalid_edge", problem, "score");
  const ratedText = rating.ratedText?.trim();
  if (!ratedText) throw new RuleError("edge_missing", "No edge written yet: nothing to rate.", "founderId");
  const edge: FounderEdgeRating = { score: rating.score, ratedText, ratedByUid, ratedDateISOString: nowISO };
  return mergeWrite(docPaths.founderInternal(founderId), { edge });
}
