// ----------------------------
// Une ecriture de document, decrite sans SDK
// ----------------------------
// Les gestes de l'Admin (shared/admin/*.ts) se calculent en logique pure et
// rendent une liste d'ecritures : le front l'execute en un lot
// (`lib/firestore/write.ts#commitWrites`), l'API dans sa transaction
// (`services/admin/writes.ts#applyWrites`). Une seule regle, deux executants.
//
// `create` : le document ne doit pas exister (le front, sans `create` dans un
// lot, l'ecrit en `set` : la regle de creation tranche). `merge` : fusion des
// champs donnes. Aucune valeur `undefined` (Firestore la refuse).

export type DocWrite =
  | { op: "create" | "set" | "merge"; path: string; data: Record<string, unknown> }
  | { op: "delete"; path: string };

export const createWrite = (path: string, data: object): DocWrite => ({ op: "create", path, data: data as Record<string, unknown> });
export const setWrite = (path: string, data: object): DocWrite => ({ op: "set", path, data: data as Record<string, unknown> });
export const mergeWrite = (path: string, data: object): DocWrite => ({ op: "merge", path, data: data as Record<string, unknown> });
export const deleteWrite = (path: string): DocWrite => ({ op: "delete", path });

/**
 * Archiver ou restaurer un document (rien n'est supprime) : la meme ecriture
 * pour une tache, un fondateur, un formulaire, un evenement.
 */
export const archiveWrite = (path: string, archived: boolean, now: string, extra: object = {}): DocWrite =>
  mergeWrite(path, { archivedDateISOString: archived ? now : null, ...extra, updatedDateISOString: now });

/** Le document est deja dans l'etat demande : rien a ecrire. */
export const isArchivedAs = (doc: { archivedDateISOString: string | null }, archived: boolean) => (doc.archivedDateISOString !== null) === archived;

/**
 * Un refus d'une regle partagee (shared/admin/*.ts) : un code stable et le
 * champ fautif. L'API en fait un 400 (`api/errors.ts`), le front affiche le message.
 */
export class RuleError extends Error {
  readonly code: string;
  readonly field: string | null;
  constructor(code: string, message: string, field: string | null = null) {
    super(message);
    this.code = code;
    this.field = field;
  }
}
