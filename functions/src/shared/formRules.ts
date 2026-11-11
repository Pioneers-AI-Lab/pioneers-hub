import { DB_FIELDS, INPUT_COMPATIBILITY, getFieldDef, requiredSubjects, type DbFieldKey, type SubjectKey } from "./fieldRegistry";
import type { Form, FormAttachments, FormFieldType, FormIdentityCheck, FormQuestion, SubjectSource } from "./types";

// ----------------------------
// Regles d'edition d'un formulaire (SPECS §4.4)
// ----------------------------
// Logique pure, partagee : l'editeur staff s'en sert, l'API et le MCP
// verifieront les memes regles avant d'enregistrer un formulaire.

export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Short text",
  long_text: "Long text",
  number: "Number",
  rating: "Rating",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  entity_picker: "Pick from a list",
  link: "Link",
  file: "File",
};

/** Les champs de la base qu'une question de ce type peut alimenter. */
export function compatibleDbFields(type: FormFieldType): DbFieldKey[] {
  const kinds = INPUT_COMPATIBILITY[type];
  return (Object.keys(DB_FIELDS) as DbFieldKey[]).filter((key) => kinds.includes(getFieldDef(key).value.kind));
}

/**
 * Ce qu'une question herite du champ choisi : l'echelle d'une note, les
 * options d'un choix a valeurs fixes, la limite d'une liste de fondateurs.
 */
export function alignQuestionWithField(question: FormQuestion): FormQuestion {
  if (!question.dbField) return question;
  const value = getFieldDef(question.dbField).value;
  if (value.kind === "rating") return { ...question, scale: { min: value.min, max: value.max } };
  if ((value.kind === "enum" || value.kind === "enumMulti") && value.values) return { ...question, options: [...value.values] };
  if (value.kind === "enum" && value.listKey) return { ...question, options: null };
  if (value.kind === "boolean") return { ...question, options: ["Yes", "No"] };
  if (value.kind === "founderRefs")
    return { ...question, picker: { entity: "founder", maxItems: value.maxItems ?? question.picker?.maxItems ?? 1 } };
  return question;
}

/** Ce qui empeche d'enregistrer une question (vide si rien). */
export function questionProblems(question: FormQuestion): string[] {
  const problems: string[] = [];
  if (!question.label.trim()) problems.push("The question has no label.");
  if (question.dbField) {
    const def = getFieldDef(question.dbField);
    if (!INPUT_COMPATIBILITY[question.type].includes(def.value.kind))
      problems.push(`"${def.label}" cannot be filled by a ${FORM_FIELD_TYPE_LABELS[question.type].toLowerCase()} question.`);
  }
  const listFromField =
    question.dbField !== null &&
    (() => {
      const v = getFieldDef(question.dbField).value;
      return (v.kind === "enum" || v.kind === "enumMulti") && v.listKey !== null;
    })();
  if ((question.type === "single_choice" || question.type === "multiple_choice") && !listFromField) {
    if (!question.options || question.options.filter((o) => o.trim()).length < 2) problems.push("A choice question needs at least two options.");
  }
  if (question.type === "rating") {
    if (!question.scale || question.scale.min >= question.scale.max) problems.push("The rating scale is invalid.");
  }
  if (question.type === "entity_picker") {
    if (!question.picker || question.picker.maxItems < 1) problems.push("Choose what to pick, and how many at most.");
  }
  return problems;
}

/** D'ou vient, par defaut, l'id d'un sujet exige par les champs. */
const DEFAULT_SOURCE: Record<SubjectKey, SubjectSource | null> = {
  person: { from: "respondent" },
  founder: { from: "respondent" },
  startup: { from: "respondent_startup" },
  week: { from: "submission_week" },
  event: { from: "form_event" },
  // Une equipe se choisit par une question « choisir une equipe » : a regler a la main.
  team: null,
};

/**
 * Le rattachement automatique : chaque sujet exige par les champs des
 * questions actives, avec sa source par defaut. Une source deja choisie par le
 * staff (ex. `fixed`, `question`) est gardee.
 */
export function deriveAttachments(questions: readonly FormQuestion[], current: FormAttachments = {}): FormAttachments {
  const keys = questions.filter((q) => !q.archived && q.dbField).map((q) => q.dbField as DbFieldKey);
  const out: FormAttachments = {};
  for (const subject of requiredSubjects(keys)) {
    const source = current[subject] ?? DEFAULT_SOURCE[subject];
    if (source) out[subject] = source;
  }
  return out;
}

/** Ce qui empeche d'enregistrer le formulaire entier. */
export function formProblems(
  form: Pick<Form, "title" | "questions" | "identityCheck" | "eventId" | "attachments">,
): string[] {
  const problems: string[] = [];
  if (!form.title.trim()) problems.push("The form has no title.");
  const active = form.questions.filter((q) => !q.archived);
  active.forEach((q, i) => questionProblems(q).forEach((p) => problems.push(`Question ${i + 1}: ${p}`)));
  const subjects = requiredSubjects(active.filter((q) => q.dbField).map((q) => q.dbField as DbFieldKey));
  if (isAnonymous(form.identityCheck) && subjects.some((s) => s === "founder" || s === "person" || s === "startup"))
    problems.push("An anonymous form cannot write to a founder or startup field: remove the database fields or ask for the name.");
  if (subjects.includes("event") && form.attachments.event?.from === "form_event" && !form.eventId)
    problems.push("Some questions write to an event: attach the form to an event.");
  if (subjects.includes("team") && !form.attachments.team)
    problems.push("Some questions write to a team: add a question that picks the team.");
  return problems;
}

const isAnonymous = (identity: FormIdentityCheck) => identity === "anonymous";

/**
 * Une question qui alimente un indicateur (courbes, scores) ne se supprime ni
 * ne change de champ une fois publiee (SPECS §4.4).
 */
export const feedsIndicator = (question: FormQuestion) =>
  question.dbField !== null && getFieldDef(question.dbField).indicator !== null;

/** Les champs que fige une version publiee : les changer cree une nouvelle version. */
export const versionedSnapshot = (form: Pick<Form, "questions" | "attachments" | "approval">) =>
  JSON.stringify({ questions: form.questions, attachments: form.attachments, approval: form.approval });
