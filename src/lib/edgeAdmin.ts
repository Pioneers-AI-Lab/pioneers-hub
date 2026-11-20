import { edgeRatingWrite } from "@shared/edge";
import { commitWrites } from "@/lib/firestore/write";

// ----------------------------
// La note du staff sur l'Edge d'un fondateur (Admin > Edge, fiche du fondateur)
// ----------------------------
// `founders/{id}/private/internal.edge` (staff en ecriture, staff + IC en lecture ; la regle
// `edgeOk` refuse une note hors de 0 a 5), avec le texte note : un texte change depuis est a renoter.

export const saveEdge = (founderId: string, score: number, ratedText: string | null, ratedByUid: string) =>
  commitWrites("rate_edge", [edgeRatingWrite(founderId, { score, ratedText }, ratedByUid, new Date().toISOString())]);
