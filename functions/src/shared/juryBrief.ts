import type { JuryAnswer, JuryBrief } from "./callables";

// ----------------------------
// Ce que lit un jure : la place d'une cible sur un chiffre declare (18/11)
// ----------------------------
// Sur un critere chiffre (« 5 = la meilleure equipe »), le jure voit la valeur de l'equipe qu'il
// note, sa place parmi les equipes qui l'ont declaree et la meilleure valeur. Logique pure : le
// formulaire de jury (components/forms/JuryBrief.tsx) et la fiche de notation du MCP (`jury_sheet`).

/** La place d'une cible sur un chiffre : 1 = la meilleure ; `of` = les cibles qui l'ont declare ; `tied` : une autre a la meme valeur. */
export type MetricRank = { value: number; rank: number; of: number; best: number; tied: boolean };

/**
 * La place de chaque cible qui a declare ce chiffre, du plus grand au plus petit (plus = mieux).
 * Les ex aequo partagent leur place, et la suivante saute d'autant (1, 2, 2, 4).
 */
export function metricRanks(values: ReadonlyMap<string, number>): Map<string, MetricRank> {
  const sorted = [...values.values()].sort((a, b) => b - a);
  const of = sorted.length;
  const best = sorted[0];
  return new Map([...values].map(([id, value]) => [id, { value, rank: sorted.indexOf(value) + 1, of, best, tied: sorted.lastIndexOf(value) !== sorted.indexOf(value) }]));
}

/** La place de chaque cible (`targetIds`) sur un chiffre de la Submission (`brief.submissions[id].metrics[key]`). */
export const briefMetricRanks = (brief: Pick<JuryBrief, "submissions">, targetIds: readonly string[], metricKey: string): Map<string, MetricRank> =>
  metricRanks(
    new Map(
      targetIds.flatMap((id) => {
        const v = brief.submissions[id]?.metrics[metricKey];
        return typeof v === "number" ? [[id, v] as const] : [];
      }),
    ),
  );

/** Une question sans reponse : ni texte, ni lien (« Not answered »). */
export const isBlankAnswer = (a: JuryAnswer): boolean => a.text === null && a.urls.length === 0;

/** 1st, 2nd, 3rd, 4th... 11th, 12th, 13th, 21st. */
export const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
};

/** « 2nd of 8 », « 1st of 8 (tied) ». */
export const rankLabel = (r: MetricRank): string => `${ordinal(r.rank)} of ${r.of}${r.tied ? " (tied)" : ""}`;
