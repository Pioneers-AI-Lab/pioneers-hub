import type { JuryAnswer, JuryBrief, JuryFormsFilled } from "./callables";
import { docIds } from "./collections";
import { formAudience, isTeamForm, type AudienceInput } from "./formRules";
import { formState } from "./forms";
import { activeQuestions, scopeOf, type Form } from "./types";

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

// ---- Les formulaires de l'equipe notee sont-ils remplis ? (18/11) ---------------------------
// Chaque formulaire d'equipe (une reponse coche tous ses membres) et chaque Peer rating (une reponse
// par membre attendu), deja ouverts. Qui est attendu : `formAudience`, comme le To do et le taux de reponse.

export type FormsFilledForm = Pick<Form, "title" | "status" | "archivedDateISOString" | "opensDateISOString" | "questions" | "identityCheck"> & { id: string };

/** Un formulaire verifie : ce qu'il demande (`team` : une reponse ; `each_member` : une par attendu) et ses attendus. */
export type CheckedForm = { id: string; title: string; due: "team" | "each_member"; expected: ReadonlySet<string> };

/** Les formulaires vivants, deja ouverts, d'equipe ou d'avis entre coequipiers, avec leurs attendus. */
export function checkedForms(forms: readonly FormsFilledForm[], audience: Omit<AudienceInput, "form">, now: string): CheckedForm[] {
  return forms.flatMap((f) => {
    const state = formState(f, now);
    if (f.archivedDateISOString !== null || (state !== "open" && state !== "closed")) return [];
    const questions = activeQuestions(f);
    const due = isTeamForm(questions) ? "team" : questions.some((q) => scopeOf(q) === "each_teammate") ? "each_member" : null;
    const who = due ? formAudience({ ...audience, form: f }) : null;
    return due && who?.kind === "founders" ? [{ id: f.id, title: f.title, due, expected: new Set(who.founderIds) }] : [];
  });
}

/** Ce qu'une equipe a rempli (`JuryFormsFilled`) ; `completed` : les ids `formCompletions` de ces formulaires. */
export function formsFilledOf(forms: readonly CheckedForm[], memberIds: readonly string[], completed: ReadonlySet<string>): JuryFormsFilled {
  const missing = forms.flatMap((f): string[] => {
    const hasDone = (id: string) => completed.has(docIds.formCompletion(f.id, id));
    const owed = memberIds.filter((id) => f.expected.has(id));
    // Une reponse d'equipe coche tous ses membres, meme un membre ajoute apres.
    if (f.due === "team") return owed.length === 0 || memberIds.some(hasDone) ? [] : [f.title];
    // Seul attendu de son equipe, un membre n'a personne a noter.
    const done = owed.filter(hasDone).length;
    return owed.length < 2 || done === owed.length ? [] : [`${f.title} (${done}/${owed.length})`];
  });
  return { done: missing.length === 0, missing };
}
