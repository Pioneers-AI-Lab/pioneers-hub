import { notifications } from "@mantine/notifications";
import { FORM_UPDATED, type PublicForm, type PublicFormQuestion } from "@shared/callables";
import { normalizeHttpUrl } from "@shared/text";
import type { FormAnswer } from "@shared/types";
import { errorMessage } from "@/lib/errors";

// ----------------------------
// Les reponses en cours de saisie, communes a `TypeForm` et `FormSheet`
// ----------------------------

/** Ce que le repondant a saisi, avant nettoyage : un nombre reste du texte tant qu'on le tape. */
export type Draft = string | number | string[];
export type Drafts = Record<string, Draft | undefined>;

export const isEmptyDraft = (value: Draft | undefined) =>
  value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);

const parseNumber = (value: Draft) => Number(String(value).trim().replace(",", "."));

/** Ce qui empeche d'envoyer une reponse (la meme regle est verifiee par le serveur). */
export function problemOf(q: PublicFormQuestion, value: Draft | undefined): string | null {
  if (isEmptyDraft(value)) return q.required ? "Please answer this question." : null;
  if (q.type === "number" && !Number.isFinite(parseNumber(value!))) return "Enter a number.";
  if ((q.type === "link" || q.type === "file") && !normalizeHttpUrl(String(value))) return "Enter a web address, e.g. https://...";
  return null;
}

/** Les reponses deja donnees (identite prouvee), a la forme des champs. */
export function draftsFromPrefill(prefill: PublicForm["prefill"]): Drafts {
  const out: Drafts = {};
  for (const [key, value] of Object.entries(prefill)) {
    if (typeof value === "string" || typeof value === "number" || Array.isArray(value)) out[key] = value;
  }
  return out;
}

/** Les reponses, a la forme que lit le serveur ; vides omises. `typeOf` : le type de la question d'une cle. */
export function toAnswers(drafts: Drafts, typeOf: (key: string) => PublicFormQuestion["type"] | undefined): Record<string, FormAnswer> {
  const out: Record<string, FormAnswer> = {};
  for (const [key, value] of Object.entries(drafts)) {
    if (isEmptyDraft(value)) continue;
    out[key] = typeOf(key) === "number" ? parseNumber(value!) : typeof value === "string" ? value.trim() : value!;
  }
  return out;
}

/**
 * Identite d'un envoi de formulaire, tiree une fois par ouverture de la page
 * (et a nouveau apres chaque enregistrement d'une feuille) : un second appui
 * sur « Submit » (ou un reseau qui rejoue) retombe sur la meme reponse cote
 * serveur au lieu d'en creer une seconde.
 */
export function newSubmissionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Un envoi refuse. Le formulaire a change depuis l'ouverture de la page et la
 * reponse n'y suffit plus (`FORM_UPDATED`) : `reload` le relit, la page reste
 * montee et garde la saisie.
 */
export function notifySendError(err: unknown, title: string, reload: () => void) {
  const isUpdated = (err as { details?: { reason?: unknown } } | null)?.details?.reason === FORM_UPDATED;
  if (isUpdated) reload();
  notifications.show({ color: isUpdated ? "yellow" : "red", title, message: errorMessage(err) });
}

/** « 1 new question », « 2 new questions » (questions ajoutees depuis la reponse du fondateur). */
export const newQuestionsLabel = (n: number) => `${n} new ${n === 1 ? "question" : "questions"}`;

/**
 * Les valeurs d'une feuille changent-elles ce qui est enregistre (`prefill`) ?
 * Meme nettoyage que l'envoi (`toAnswers`) ; `keys` : les cles a comparer.
 */
export function changesSaved(drafts: Drafts, prefill: PublicForm["prefill"], keys: readonly string[], typeOf: (key: string) => PublicFormQuestion["type"] | undefined): boolean {
  const now = toAnswers(drafts, typeOf);
  const saved = toAnswers(draftsFromPrefill(prefill), typeOf);
  return keys.some((key) => JSON.stringify(now[key] ?? null) !== JSON.stringify(saved[key] ?? null));
}

/** Sous une question dont la valeur prerempliee attend la validation du staff (`pendingAnswerKeys`). */
export const PENDING_NOTE = "Waiting for the Pioneers team's approval: this is the answer you sent.";

/** Ce que la page dit en tete du formulaire : apercu, questions ajoutees depuis sa reponse, reponses en attente de validation. */
export function formNotes(form: PublicForm): string[] {
  const added = form.newQuestionIds.length;
  return [
    form.preview
      ? form.state === "draft"
        ? "Draft: you are previewing it. Publish the form to collect answers."
        : "Preview: founders answer this form signed in. You can read it, not send it."
      : null,
    added > 0 ? `Updated since your answer: ${newQuestionsLabel(added)}.` : null,
    form.pendingAnswerKeys.length > 0 ? "Some of your answers are waiting for the Pioneers team's approval: they show here as you sent them." : null,
  ].filter((note): note is string => note !== null);
}
