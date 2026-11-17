import type { BatchScoped, DateISOString } from "./common";

// ----------------------------
// founders/{founderId}/private/connections  (le fondateur lui-meme + staff + investors IC)
// ----------------------------
// La shortlist et les rencontres d'un fondateur (demande du client du 15/11) :
// un outil pour LUI, que les scores lisent depuis le 17/11 (services/scores.ts) :
// Likability (qui l'a shortliste, avec l'historique `shortlistHistory`), milestones
// Shortlist done et Met (reciproque). Jamais affichees aux autres fondateurs.
// Ni classee ni plafonnee ; « Met » se coche a la main seulement (rien n'est
// deduit des tables ou des equipes). Seul le fondateur ecrit (firestore.rules),
// une liste a la fois, par `arrayUnion` / `arrayRemove` fusionnes (la premiere
// coche cree le document avec sa seule liste) ; jamais lu par l'API.

export type FounderConnections = {
  /** Fondateurs du MEME batch qu'il garde en tete comme cofondateurs possibles (jamais lui-meme). Absent = vide. */
  shortlistedFounderIds?: string[];
  /** Fondateurs du MEME batch qu'il dit avoir rencontres (jamais lui-meme). Absent = vide. */
  metFounderIds?: string[];
  updatedDateISOString: DateISOString;
};

/** Les deux listes, celles qu'un bouton bascule. */
export type FounderConnectionList = "shortlistedFounderIds" | "metFounderIds";

/** Les deux listes d'un fondateur, vides si le document ou la liste n'existe pas encore. */
export type ConnectionLists = Required<Pick<FounderConnections, FounderConnectionList>>;

export const readConnections = (doc: FounderConnections | null): ConnectionLists => ({
  shortlistedFounderIds: doc?.shortlistedFounderIds ?? [],
  metFounderIds: doc?.metFounderIds ?? [],
});

// ----------------------------
// shortlistHistory/{founderId}_{targetFounderId}  (staff + investors IC, ecrit par le serveur seul)
// ----------------------------
// Chaque fondateur qu'un fondateur a shortliste AU MOINS UNE FOIS (17/11) : retirer
// quelqu'un de sa shortlist n'efface pas l'historique, que Likability lit. Ajout
// seul, par le declencheur `onConnectionsWritten` et `scripts/backfill-shortlist-history.mjs`
// (shared/shortlistHistory.ts) ; jamais ecrit par un client, jamais lu par l'API.

export type ShortlistRecord = BatchScoped & {
  /** Qui a shortliste. */
  founderId: string;
  /** Le fondateur shortliste. */
  targetFounderId: string;
  /** La premiere fois qu'on l'a vu dans la liste (le declencheur, ou le rattrapage). */
  firstShortlistedDateISOString: DateISOString;
};
