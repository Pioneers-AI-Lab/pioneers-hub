import { criterionKeyOf, metricKeyOf } from "./fieldRegistry";
import { deriveAttachments, isJuryCriterion, ratingScale } from "./formRules";
import { eventTemplateOf } from "./presets/eventTemplates";
import { FORM_TEMPLATES, templateQuestions, type FormTemplateKey, type TemplateContext } from "./presets/formTemplates";
import { standardEventMetric, standardMetricOf, type StandardMetricKey } from "./presets/standardMetrics";
import { activeQuestions, type Criterion, type EventMetric, type Form, type FormVersion, type PioneersEvent, type Timestamps } from "./types";

// ----------------------------
// Un formulaire : sa construction et sa publication
// ----------------------------
// Une seule facon de construire un document `forms` (comme `newEvent` pour les
// evenements) : Admin > Forms (src/lib/formsAdmin.ts) et l'API / le MCP
// (functions/src/services/formCreate.ts). Un modele COPIE ses questions :
// modifier un modele ne change aucun formulaire existant.

export type NewFormInput = {
  programId: string;
  batchId: string;
  /** `null` : formulaire libre (`custom`). */
  templateKey: FormTemplateKey | null;
  eventId: string | null;
  /**
   * L'evenement du formulaire : ses reglages par defaut (metriques du Debrief,
   * grille du jury) viennent de son modele (`templateKey`).
   */
  event?: Pick<PioneersEvent, "kind" | "templateKey"> | null;
  /** Remplace les reglages du modele d'evenement (import, migration) : metriques, grille, champs de la Submission, seances de la retro. */
  defaults?: Partial<Pick<TemplateContext, "metrics" | "criteria" | "submissionFields" | "sessions">>;
};

/** Ce dont un modele de formulaire construit ses questions, pour cet evenement. */
export function templateContext(input: Pick<NewFormInput, "event" | "defaults">): TemplateContext {
  const preset = eventTemplateOf(input.event?.templateKey ?? null);
  return {
    eventKind: input.event?.kind ?? null,
    metrics: input.defaults?.metrics ?? preset?.metrics ?? [],
    criteria: input.defaults?.criteria ?? preset?.criteria ?? [],
    submissionFields: input.defaults?.submissionFields ?? null,
    sessions: input.defaults?.sessions ?? [],
  };
}

/** Un document `forms` sans ses horodatages (poses a l'ecriture). */
export type FormData = Omit<Form, keyof Timestamps>;

/**
 * Un formulaire neuf, en brouillon (version 0). `extra` complete ou remplace
 * les valeurs du modele (titre, questions donnees...) ; le rattachement se
 * deduit toujours des questions finales.
 */
export function newForm(input: NewFormInput, extra: Partial<Omit<FormData, "attachments" | "version" | "status">> = {}): FormData {
  const template = input.templateKey ? FORM_TEMPLATES[input.templateKey] : null;
  const questions = extra.questions ?? (template ? templateQuestions(template, templateContext(input)) : []);
  return {
    programId: input.programId,
    batchId: input.batchId,
    archivedDateISOString: null,
    kind: template?.kind ?? "custom",
    title: template?.title ?? "Untitled form",
    description: template?.description ?? null,
    approval: template?.approval ?? "none",
    identityCheck: template?.identityCheck ?? "select_name",
    eventId: input.eventId,
    opensDateISOString: null,
    deadlineDateISOString: null,
    ...extra,
    questions,
    attachments: deriveAttachments(questions),
    version: 0,
    status: "draft",
  };
}

/** Ce que fige une publication : `forms/{id}/versions/{version}`. */
export const formVersion = (
  form: Pick<Form, "questions" | "attachments" | "approval">,
  version: number,
  publishedDateISOString: string,
): FormVersion => ({
  version,
  questions: form.questions,
  attachments: form.attachments,
  approval: form.approval,
  publishedDateISOString,
});

/**
 * La PREMIERE publication d'un brouillon : version 1, ouvert, et ouvert
 * maintenant s'il n'a pas de date (la semaine d'un formulaire est celle de son
 * ouverture). Rend le formulaire publie et sa version figee.
 */
export function firstPublication<F extends Pick<Form, "questions" | "attachments" | "approval" | "opensDateISOString">>(
  form: F,
  now: string,
): { form: F & Pick<Form, "version" | "status">; version: FormVersion } {
  const published = { ...form, version: 1, status: "open" as const, opensDateISOString: form.opensDateISOString ?? now };
  return { form: published, version: formVersion(published, 1, now) };
}

/**
 * Etat du lien d'un formulaire : seul `open` prend des reponses. Lu par
 * `submitFormResponse` (et `getPublicForm`) comme par le « To do » du fondateur.
 */
export function formState(
  form: Pick<Form, "status" | "opensDateISOString">,
  nowISO: string,
): "open" | "not_open_yet" | "closed" | "draft" {
  if (form.status === "draft") return "draft";
  if (form.status === "closed") return "closed";
  if (form.opensDateISOString && form.opensDateISOString > nowISO) return "not_open_yet";
  return "open";
}

// ----------------------------
// Ce que les formulaires d'un evenement declarent (SPECS §2, modele standard)
// ----------------------------
// La grille du jury et les metriques ne vivent plus sur l'evenement : ce sont
// les questions de ses formulaires. Le leaderboard, l'administration et le
// classement les relisent ici.

type EventForm = Pick<Form, "questions" | "archivedDateISOString">;

const liveQuestions = (forms: readonly EventForm[]) =>
  forms.filter((f) => f.archivedDateISOString === null).flatMap((f) => activeQuestions(f));

/** La grille du jury : les questions de note reliees a `evaluation.scores.<cle>`, une par cle, avec leur poids. */
export function juryCriteria(forms: readonly EventForm[]): Criterion[] {
  const out = new Map<string, Criterion>();
  for (const q of liveQuestions(forms)) {
    const key = criterionKeyOf(q.dbField);
    if (!key || !isJuryCriterion(q) || out.has(key)) continue;
    const scale = ratingScale(q);
    out.set(key, { key, label: q.label, min: scale.min, max: scale.max, weight: q.weight ?? 1 });
  }
  return [...out.values()];
}

/**
 * Les metriques d'equipe : les questions reliees a `submission.metrics.<cle>`, une
 * par cle. Une cle standard prend le libelle et l'unite du dictionnaire (memes
 * mots d'un hackathon a l'autre) ; une autre, le libelle de sa question.
 */
export function eventMetrics(forms: readonly EventForm[]): EventMetric[] {
  const out = new Map<string, EventMetric>();
  for (const q of liveQuestions(forms)) {
    const key = metricKeyOf(q.dbField);
    if (key && !out.has(key)) out.set(key, standardMetricOf(key) ? standardEventMetric(key as StandardMetricKey) : { key, label: q.label, unit: null });
  }
  return [...out.values()];
}
