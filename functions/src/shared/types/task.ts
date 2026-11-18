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
//
// Dates et verification (18/11) : une tache a, comme un formulaire, une ouverture
// (le To do la montre dans « Coming up » 7 jours avant) et une echeance. Une tache
// VERIFIEE par l'app (`check`) n'a pas de coche : elle est faite quand la donnee
// le dit (shared/tasks.ts#isTaskDone), au To do comme dans Admin > Tasks.

export type BatchTask = BatchScoped &
  Timestamps &
  Archivable & {
    title: string;
    description: string | null;
    /** Adresse externe (`https://…`, nouvel onglet) ou page de l'app (chemin commencant par `/`). */
    linkUrl: string | null;
    /** Rang dans la liste (croissant). */
    order: number;
    /** Ouverture ; absente ou `null` : ouverte des sa creation. */
    opensDateISOString?: DateISOString | null;
    /** Echeance ; absente ou `null` : sans echeance. */
    deadlineDateISOString?: DateISOString | null;
    /** Ce que l'app verifie a la place de la coche ; absent ou `null` : le fondateur la coche. */
    check?: TaskCheck | null;
  };

/** `shortlist` : au moins `SHORTLIST_TASK_MIN` (5) autres fondateurs du batch dans sa shortlist (shared/tasks.ts). */
export const TASK_CHECKS = ["shortlist"] as const;
export type TaskCheck = (typeof TASK_CHECKS)[number];

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
