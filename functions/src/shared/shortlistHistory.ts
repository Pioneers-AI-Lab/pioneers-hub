import type { BatchScoped, DateISOString, ShortlistRecord } from "./types";

// ----------------------------
// L'historique des shortlists (docs/FONCTIONNALITES.md §3.1, Likability)
// ----------------------------
// Logique pure, partagee par le declencheur (services/shortlistHistory.ts) et le
// rattrapage (scripts/backfill-shortlist-history.mjs). Un enregistrement par paire
// (qui shortliste, qui est shortliste), cree une fois, jamais modifie ni retire.

/** La collection (hors `shared/collections.ts`, en refonte dans une autre session : a y deplacer). */
export const SHORTLIST_HISTORY_COLLECTION = "shortlistHistory";

/**
 * Le code gRPC d'un `create` sur un document qui existe deja (Firestore, SDK admin) : un
 * enregistrement deja ecrit (autre declencheur, rattrapage) n'est pas une erreur.
 */
export const ALREADY_EXISTS = 6;

export const shortlistHistoryId = (founderId: string, targetFounderId: string) => `${founderId}_${targetFounderId}`;
export const shortlistHistoryPath = (founderId: string, targetFounderId: string) =>
  `${SHORTLIST_HISTORY_COLLECTION}/${shortlistHistoryId(founderId, targetFounderId)}`;

/**
 * Les enregistrements a creer pour la shortlist actuelle de `founderId` : chaque cible
 * qui n'a pas encore le sien (`existingIds` : ids deja en base). Jamais lui-meme.
 */
export function shortlistRecordsToCreate(
  scope: BatchScoped & { founderId: string },
  shortlistedFounderIds: readonly string[],
  existingIds: ReadonlySet<string>,
  nowISOString: DateISOString,
): { path: string; data: ShortlistRecord }[] {
  const targets = [...new Set(shortlistedFounderIds)].filter(
    (id) => id && id !== scope.founderId && !existingIds.has(shortlistHistoryId(scope.founderId, id)),
  );
  return targets.map((targetFounderId) => ({
    path: shortlistHistoryPath(scope.founderId, targetFounderId),
    data: {
      programId: scope.programId,
      batchId: scope.batchId,
      founderId: scope.founderId,
      targetFounderId,
      firstShortlistedDateISOString: nowISOString,
    },
  }));
}
