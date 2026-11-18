import { criterionKeyOf, metricKeyOf, parseDbField, type DbFieldKey, type DocKind } from "./fieldRegistry";
import { deriveAttachments, isJuryCriterion, ratingScale } from "./formRules";
import { eventTemplateOf } from "./presets/eventTemplates";
import { FORM_TEMPLATES, templateDescription, templateQuestions, type FormTemplate, type FormTemplateKey, type TemplateContext } from "./presets/formTemplates";
import { standardEventMetric, standardMetricOf, type StandardMetricKey } from "./presets/standardMetrics";
import { activeQuestions, type Criterion, type EventMetric, type Form, type FormQuestion, type FormVersion, type PioneersEvent, type Timestamps } from "./types";

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
   * grille du jury) viennent de son modele (`templateKey`) ; son etape (`stage`), celle d'un pitch.
   */
  event?: (Pick<PioneersEvent, "kind" | "templateKey"> & Partial<Pick<PioneersEvent, "stage">>) | null;
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
    stage: input.event?.stage ?? preset?.stage ?? null,
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
  const template: FormTemplate | null = input.templateKey ? FORM_TEMPLATES[input.templateKey] : null;
  const ctx = templateContext(input);
  const questions = extra.questions ?? (template ? templateQuestions(template, ctx) : []);
  return {
    programId: input.programId,
    batchId: input.batchId,
    archivedDateISOString: null,
    kind: template?.kind ?? "custom",
    title: template?.title ?? "Untitled form",
    description: template ? templateDescription(template, ctx) : null,
    approval: template?.approval ?? "none",
    identityCheck: template?.identityCheck ?? "account",
    eventId: input.eventId,
    opensDateISOString: null,
    deadlineDateISOString: null,
    ...(template?.setsSubmissionLate !== undefined ? { setsSubmissionLate: template.setsSubmissionLate } : {}),
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

/**
 * Un absent de l'evenement ne repond pas a ses formulaires (shared/attendance.ts) :
 * le refus de `submitFormResponse` et ce que dit la page du formulaire.
 */
export const absentFromEventMessage = (eventName: string | null) =>
  `You were marked absent at ${eventName ?? "this event"}: this form is for the founders who attended. Ask the Pioneers team if this is a mistake.`;

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

/** Une question reliee a un champ de la base. */
export type FieldQuestion = FormQuestion & { dbField: DbFieldKey };

/**
 * Les questions de ces documents hors metriques (par defaut la Submission, champs `submission.*` :
 * textes, liens, choix ; le Pitch deck, `startup.*` et `startupProfile.*`), une par champ, dans
 * l'ordre des formulaires : ce que lit le jury.
 */
export function submissionQuestions(forms: readonly EventForm[], docKinds: readonly DocKind[] = ["submission"]): FieldQuestion[] {
  const out = new Map<string, FieldQuestion>();
  for (const q of liveQuestions(forms)) {
    if (q.dbField && !out.has(q.dbField) && !metricKeyOf(q.dbField) && docKinds.includes(parseDbField(q.dbField).doc)) out.set(q.dbField, q as FieldQuestion);
  }
  return [...out.values()];
}

// ---- Ce que lit un jure (18/11, services/jury.ts#loadJuryBrief) ------------------------------

/** Le dossier Drive d'une equipe : mis en avant par le jury, hors des blocs de reponses. */
export const DRIVE_FIELD = "submission.driveFolderUrl";

/** Les documents qu'un formulaire de l'evenement remplit pour une cible du jury : la Submission ; une startup a aussi sa fiche (Pitch deck). */
export const JURY_TARGET_DOCS: Record<"team" | "startup", readonly DocKind[]> = { team: ["submission"], startup: ["submission", "startup", "startupProfile"] };

type BriefForm = EventForm & Pick<Form, "title" | "opensDateISOString">;

/**
 * Les blocs que lit le jure : un par formulaire vivant de l'evenement qui remplit les documents de la
 * cible, dans l'ordre d'ouverture (H5 : Plan, Snapshot, Final numbers), avec TOUTES ses questions de
 * ces documents (chiffres compris), sans le dossier Drive.
 */
export function juryBlockForms(forms: readonly BriefForm[], target: "team" | "startup"): { title: string; questions: FieldQuestion[] }[] {
  const kinds = JURY_TARGET_DOCS[target];
  return forms
    .filter((f) => f.archivedDateISOString === null)
    .sort((a, b) => (a.opensDateISOString ?? "").localeCompare(b.opensDateISOString ?? ""))
    .flatMap((f) => {
      const questions = activeQuestions(f).filter((q): q is FieldQuestion => !!q.dbField && q.dbField !== DRIVE_FIELD && kinds.includes(parseDbField(q.dbField).doc));
      return questions.length ? [{ title: f.title, questions }] : [];
    });
}

/** Chaque critere du jury qui note un chiffre declare (`evaluation.scores.<cle>`, `cle` dans `metricKeys`) : id de la question -> cle. */
export function juryCriterionMetrics(forms: readonly EventForm[], metricKeys: ReadonlySet<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of liveQuestions(forms)) {
    const key = criterionKeyOf(q.dbField);
    if (key && metricKeys.has(key) && isJuryCriterion(q)) out[q.id] = key;
  }
  return out;
}

/** Un formulaire vivant de l'evenement demande le dossier Drive. */
export const asksDriveFolder = (forms: readonly EventForm[]): boolean => liveQuestions(forms).some((q) => q.dbField === DRIVE_FIELD);
