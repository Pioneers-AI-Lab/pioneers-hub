import type { DocWrite } from "./docWrites";
import type { AuditLog, AuditSource } from "./types";

// ----------------------------
// Le journal d'audit : une ligne = une RESPONSABILITE (decision du 20/11)
// ----------------------------
// Une ligne dit QUI a fait QUELLE action, sur QUELS documents, QUAND et PAR OU.
// Elle ne porte JAMAIS la donnee : ni valeur, ni avant/apres, ni e-mail, ni nom.
// La donnee vit dans la base ; ce qui doit survivre a une suppression a sa propre
// collection (une note du jury supprimee : `events/*/deletedEvaluations`).
// `fields` nomme les champs touches, sans leur valeur.
//
// Gardee AUDIT_RETENTION_DAYS jours au plus : `expireAt` porte la politique TTL
// de Firestore (firestore.indexes.json), qui la supprime ensuite. Rien ne lit
// le journal pour fonctionner : le perdre ne fait perdre aucune donnee.
//
// Une action porte le NOM de l'operation de l'API (`update_event`, `delete_jury_score`...),
// quel que soit le chemin du geste (Admin, callable, API, MCP).
//
// Trois executants, une seule forme (`auditLine`) : les services (SDK admin), le
// front (gestes de l'Admin, dans le lot du geste : lib/firestore/write.ts) et
// les scripts (functions/lib/shared/audit.js). firestore.rules#auditLineOk
// verifie celle du front.

export const AUDIT_RETENTION_DAYS = 7;
/** Bornes d'une ligne (firestore.rules#auditLineOk) : un geste qui touche plus de documents le dit par `targetCount`. */
export const AUDIT_MAX_PATHS = 100;
export const AUDIT_MAX_FIELDS = 100;
export const AUDIT_MAX_ACTION = 80;

/** Horodatages et id : ecrits a chaque geste, ils ne disent rien de ce qui change. */
const NOT_A_FIELD = new Set(["id", "createdDateISOString", "updatedDateISOString"]);

export type AuditEntry = {
  action: string;
  targetPaths: readonly string[];
  /** Noms des champs ecrits, sans valeur. */
  fields?: readonly string[];
  /** Pour le compte de qui (`jury:<judgeId>` : le staff saisit une feuille papier). */
  onBehalfOf?: string | null;
  idempotencyKey?: string | null;
};

/** Qui ecrit : un compte (`ui`, `api`, `mcp`), un jure ou un formulaire (`function`), un script, un import. */
export type AuditActor = { uid: string; via: AuditSource; apiKeyId: string | null };

const uniqueSorted = (values: Iterable<string>) => [...new Set(values)].sort();

/** Les champs qu'ecrit un geste de l'Admin : les cles de premier niveau, sans horodatage. */
export function writtenFieldsOf(writes: readonly DocWrite[]): string[] {
  return uniqueSorted(writes.flatMap((w) => (w.op === "delete" ? [] : Object.keys(w.data).filter((k) => !NOT_A_FIELD.has(k)))));
}

/**
 * Les champs que demande une entree d'API : les chemins de ses cles (3 niveaux),
 * sans valeur, ni les identifiants (`eventId`, `founderId`...) : ce sont les
 * documents vises, deja dans `targetPaths`.
 */
export function inputFieldsOf(input: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown, prefix: string, depth: number) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || (depth === 0 && (key === "id" || key.endsWith("Id") || key.endsWith("Ids")))) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (depth < 2 && v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) walk(v, path, depth + 1);
      else out.push(path);
    }
  };
  walk(input, "", 0);
  return uniqueSorted(out);
}

/** La ligne d'audit, prete a ecrire. `expireAt` est une `Date` : les deux SDK l'ecrivent en Timestamp (TTL). */
export function auditLine(actor: AuditActor, entry: AuditEntry, now = new Date()): AuditLog {
  const paths = uniqueSorted(entry.targetPaths);
  return {
    actorUid: actor.uid,
    apiKeyId: actor.apiKeyId,
    via: actor.via,
    action: entry.action.slice(0, AUDIT_MAX_ACTION),
    targetPaths: paths.slice(0, AUDIT_MAX_PATHS),
    targetCount: paths.length,
    fields: uniqueSorted(entry.fields ?? []).slice(0, AUDIT_MAX_FIELDS),
    onBehalfOf: entry.onBehalfOf ?? null,
    idempotencyKey: entry.idempotencyKey ?? null,
    dateISOString: now.toISOString(),
    expireAt: new Date(now.getTime() + AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  };
}

/** La ligne d'un geste de l'Admin, d'apres ses ecritures. */
export const auditLineOfWrites = (actor: AuditActor, action: string, writes: readonly DocWrite[], now = new Date()) =>
  auditLine(actor, { action, targetPaths: writes.map((w) => w.path), fields: writtenFieldsOf(writes) }, now);
