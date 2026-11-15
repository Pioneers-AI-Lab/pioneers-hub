import type { DateISOString } from "./common";

// ----------------------------
// founders/{founderId}/private/connections  (le fondateur lui-meme + staff + investors IC)
// ----------------------------
// La shortlist et les rencontres d'un fondateur (demande du client du 15/11) :
// un outil pour LUI, sans aucun effet sur les scores, les picks ni Likability.
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
