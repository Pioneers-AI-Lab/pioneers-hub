// ----------------------------
// Types de base, partages front / Cloud Functions
// ----------------------------
// Ce dossier (`functions/src/shared/`) est la SOURCE DE VERITE du modele de
// donnees, reflet de SPECS.md §6.1 (modele) et annexe A (dictionnaire). Le
// front l'importe par l'alias `@shared/*`, les Functions par un chemin
// relatif. Il ne doit JAMAIS importer `firebase`, `firebase-admin` ni rien
// qui depende de Node ou du navigateur : seulement des types, des constantes
// et de la logique pure.

/**
 * Jour calendaire, `YYYY-MM-DD` (ex. `"2026-11-16"`).
 *
 * Aucune date du modele n'est un `Timestamp` Firestore : le SDK client et le
 * SDK admin ont chacun LEUR classe `Timestamp`, incompatibles, et un type
 * partage ne peut pas choisir. Les chaines se trient comme des dates et
 * traversent tels quels le JSON des callables, de l'API et du MCP.
 */
export type DayString = string;

/** Mois calendaire, `YYYY-MM` (ex. `"2027-03"`), pour le reporting mensuel. */
export type MonthString = string;

/** Instant complet, ISO 8601 (ex. `"2026-11-16T09:30:00.000Z"`). */
export type DateISOString = string;

/** Un document lu : ses champs plus l'id Firestore (jamais stocke dans le doc). */
export type WithId<T> = T & { id: string };

/** Horodatage commun a tous les documents ecrits par l'application. */
export type Timestamps = {
  createdDateISOString: DateISOString;
  updatedDateISOString: DateISOString;
};

/** Rien n'est supprime : on archive (garde-fou de la spec, Claude ne supprime rien). */
export type Archivable = {
  archivedDateISOString: DateISOString | null;
};

/** Tout document rattache a un batch porte ses deux parents, pour des requetes a plat. */
export type BatchScoped = {
  programId: string;
  batchId: string;
};

/** Ce qu'on evalue, score ou complete : un fondateur ou une startup. */
export type TargetKind = "founder" | "startup";

/**
 * Document rattache a une startup, avec une COPIE de ses membres : les regles
 * s'en servent sans lire la startup (une lecture facturee de moins par
 * evaluation). Copie tenue a jour par Cloud Functions a chaque changement
 * d'equipe : `checkins`, `kpiSeries`, `mentorships`, `portfolioReports`.
 */
export type StartupScoped = BatchScoped & {
  startupId: string;
  memberIds: string[];
};

/**
 * Moyenne ponderee des valeurs presentes ; une valeur `null` est retiree et
 * les autres se partagent son poids (SPECS §5). `null` si aucune valeur.
 */
export function weightedMean(entries: readonly (readonly [value: number | null, weight: number])[]): number | null {
  let total = 0;
  let weightSum = 0;
  for (const [value, weight] of entries) {
    if (value === null) continue;
    total += value * weight;
    weightSum += weight;
  }
  return weightSum === 0 ? null : total / weightSum;
}

/** Estimation a trois niveaux, utilisee par l'analyse de marche (TAM, SAM, SOM, CAGR). */
export type RangeEstimate = {
  low: number | null;
  mid: number | null;
  high: number | null;
};
