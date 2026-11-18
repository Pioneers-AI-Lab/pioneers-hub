import type { BatchScoped, DateISOString } from "./common";

// ----------------------------
// teamLocks/{founderId}  (le fondateur lui-meme + staff + investors IC)
// ----------------------------
// La reponse d'un fondateur au formulaire « Lock my team » (lot 2,
// docs/FONCTIONNALITES.md §2.10) : verrouille-t-il une equipe,
// avec qui, sous quel nom. Le staff en tire les startups (Admin > Startups,
// shared/teamLocks.ts). Un id de fondateur n'existe que dans UN batch : l'id
// du document suffit (une reponse par fondateur et par batch).
//
// Ecrit par `submitFormResponse` seulement (registre : `teamLock.*`, document
// « formulaire seulement ») ; le dernier envoi fait foi. Jamais lu par l'API.

export type TeamLock = BatchScoped & {
  founderId: string;
  /** « Do you lock a team? » ; `null` tant qu'il n'a pas repondu. */
  locked: boolean | null;
  /** Ses cofondateurs choisis (fondateurs du batch, jamais lui-meme), 4 au plus. */
  coFounderIds: string[];
  /** Le nom propose pour la startup, facultatif. */
  startupName: string | null;
  updatedDateISOString: DateISOString;
};
