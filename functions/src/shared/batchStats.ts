import { mean, roundTo, type BatchStats, type Founder, type FounderDirectory } from "./types";

// ----------------------------
// batchStats/{batchId} : les chiffres du batch (accueil : tuiles, « Profile distribution », « Nationalities »)
// ----------------------------
// Logique pure, ecrite par `services/scores.ts` avec les scores (chaque nuit et
// sur « Recompute scores ») pour un batch du Hub ; Spring 2026 garde ceux de son
// import (scripts/import-sp26.mjs, memes regles de comptage).

export type BatchStatsFounder = {
  founder: Pick<Founder, "profileCategory" | "hardSkills" | "industries" | "rolesICouldTake" | "startupId">;
  directory: Pick<FounderDirectory, "yearsOfXP" | "nationality" | "repeatFounder"> | null;
};

/** Effectif par valeur (les valeurs vides ne comptent pas). */
function countBy(values: readonly (string | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) if (v) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/** Les chiffres du batch, sur ses fondateurs participants. */
export function computeBatchStats(programId: string, founders: readonly BatchStatsFounder[], nowISO: string): BatchStats {
  const xp = mean(founders.flatMap((f) => f.directory?.yearsOfXP ?? []));
  // Part des « oui » parmi les fondateurs qui ont repondu (non renseigne : ignore).
  const repeat = mean(founders.map((f) => f.directory?.repeatFounder).filter((v) => typeof v === "boolean").map(Number));
  return {
    programId,
    founders: founders.length,
    avgYearsOfXP: xp === null ? null : roundTo(xp, 1),
    repeatFounders: repeat === null ? null : roundTo(repeat, 3),
    profileDistribution: countBy(founders.map((f) => f.founder.profileCategory)),
    skillsDistribution: countBy(founders.flatMap((f) => f.founder.hardSkills)),
    industriesDistribution: countBy(founders.flatMap((f) => f.founder.industries)),
    rolesDistribution: countBy(founders.flatMap((f) => f.founder.rolesICouldTake)),
    // Une double nationalite est stockee « A, B » (comme a l'import du Spring 2026).
    nationalities: countBy(founders.flatMap((f) => (f.directory?.nationality ?? "").split(",").map((n) => n.trim()))),
    teamFormationRate: founders.length ? founders.filter((f) => f.founder.startupId).length / founders.length : null,
    formResponseRate: null,
    computedDateISOString: nowISO,
  };
}
