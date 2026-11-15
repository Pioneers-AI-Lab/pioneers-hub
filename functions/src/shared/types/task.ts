import type { Archivable, BatchScoped, DateISOString, Timestamps } from "./common";

// ----------------------------
// Taches du To do (checklist du batch, decision du 15/11)
// ----------------------------
//   batchTasks/{taskId}                      BatchTask       fondateurs du batch + staff + investors
//   taskCompletions/{taskId}_{founderId}     TaskCompletion  le fondateur lui-meme + staff
//
// Une tache est COMMUNE au batch (« Introduce yourself on Slack ») ; chaque
// fondateur la coche lui-meme, sans verification du staff, sans score, sans
// donnee liee. Le staff l'ajoute, la modifie, la retire (archive) depuis
// Admin > Tasks, et y suit les retardataires comme pour un formulaire.

export type BatchTask = BatchScoped &
  Timestamps &
  Archivable & {
    title: string;
    description: string | null;
    /** Adresse externe (`https://…`, nouvel onglet) ou page de l'app (chemin commencant par `/`). */
    linkUrl: string | null;
    /** Rang dans la liste (croissant). */
    order: number;
  };

/** Ecrit par le fondateur lui-meme ; decocher = `done: false` (rien ne se supprime). */
export type TaskCompletion = BatchScoped & {
  taskId: string;
  founderId: string;
  done: boolean;
  updatedDateISOString: DateISOString;
};

/** Rang d'affichage (fondateur et staff) : `order`, puis la plus ancienne d'abord. */
export const byTaskOrder = (a: Pick<BatchTask, "order" | "createdDateISOString">, b: Pick<BatchTask, "order" | "createdDateISOString">) =>
  a.order - b.order || a.createdDateISOString.localeCompare(b.createdDateISOString);
