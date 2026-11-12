import {
  DB_FIELDS,
  INPUT_COMPATIBILITY,
  getFieldDef,
  listKeyOf,
  requiredSubjects,
  type DbFieldKey,
  type SubjectKey,
  type ValueSpec,
} from "./fieldRegistry";
import { EVENT_KIND_FEATURES } from "./types";
import type {
  Attendance,
  EventTeam,
  Form,
  FormAnswer,
  FormAttachments,
  FormFieldType,
  FormIdentityCheck,
  FormQuestion,
  FormResponse,
  Founder,
  PioneersEvent,
  SubjectSource,
} from "./types";

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

/** Longueur maximale d'une reponse : la page publique la borne, le serveur la verifie. */
export const FORM_ANSWER_MAX = { text: 1000, long_text: 10000, link: 2000 } as const;

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

/**
 * L'inverse d'`alignQuestionWithField` : la reponse a une question, a la forme
 * qu'attend son champ (« Yes » -> `true`, une ligne par element, un lien seul
 * dans un champ de fichiers multiples).
 */
export function answerToFieldValue(spec: ValueSpec, answer: FormAnswer): FormAnswer {
  if (spec.kind === "boolean") return answer === "Yes" ? true : answer === "No" ? false : answer;
  if (spec.kind === "textList" && typeof answer === "string") {
    return answer
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (spec.kind === "files" && spec.multiple && typeof answer === "string") return [answer];
  return answer;
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
  const listFromField = question.dbField !== null && listKeyOf(getFieldDef(question.dbField).value) !== null;
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

// ----------------------------
// Qui doit repondre, et qui a repondu (relances du staff)
// ----------------------------
// Le taux de reponse n'est juste que si l'on compte :
//   - des REPONDANTS distincts, pas des reponses (une page rouverte = un envoi de plus) ;
//   - sur la PERIODE en cours pour un formulaire recurrent (sinon le cumul des
//     semaines depasse 100 %) ;
//   - parmi les ATTENDUS seulement : un fondateur parti ou absent qui repond est
//     compte a part, pas dans le taux.
// Un formulaire anonyme ne dit pas qui a repondu : on n'y compte que des reponses.

/** Sur quoi porte le denominateur, affiche avec le taux. */
export type AudienceBasis = "batch" | "present" | "teams" | "invited";

export type FormAudience = { kind: "anonymous" } | { kind: "founders"; basis: AudienceBasis; founderIds: string[] };

type AudienceFounder = Pick<Founder, "status" | "isExternalFounder" | "archivedDateISOString" | "startupId"> & { id: string };

/** Fondateurs du batch attendus a un formulaire : ni partis, ni archives, ni cofondateurs exterieurs au batch. */
const isActiveFounder = (f: AudienceFounder) =>
  f.archivedDateISOString === null && !f.isExternalFounder && (f.status === "enrolled" || f.status === "active");

/**
 * Les fondateurs qui doivent repondre. Rattache a un evenement : les PRESENTS
 * si la presence a ete relevee (un feedback de seance ne se demande pas aux
 * absents), sinon les membres des equipes publiees (hackathon), sinon les
 * invites (audience restreinte). Sinon, tout le batch.
 */
export function formAudience(input: {
  identityCheck: FormIdentityCheck;
  founders: AudienceFounder[];
  event: Pick<PioneersEvent, "kind" | "audience" | "guestFounderIds" | "startupIds"> | null;
  attendance: Pick<Attendance, "founderId" | "status">[];
  teams: Pick<EventTeam, "memberIds" | "publishedDateISOString">[];
}): FormAudience {
  if (input.identityCheck === "anonymous") return { kind: "anonymous" };
  const active = input.founders.filter(isActiveFounder);
  const among = (basis: AudienceBasis, ids: Set<string>): FormAudience => ({
    kind: "founders",
    basis,
    founderIds: active.filter((f) => ids.has(f.id)).map((f) => f.id),
  });
  const { event } = input;
  if (event) {
    const present = input.attendance.filter((a) => a.status !== "absent");
    if (EVENT_KIND_FEATURES[event.kind].attendance && present.length > 0) return among("present", new Set(present.map((a) => a.founderId)));
    const published = input.teams.filter((t) => t.publishedDateISOString !== null);
    if (EVENT_KIND_FEATURES[event.kind].teams && published.length > 0) return among("teams", new Set(published.flatMap((t) => t.memberIds)));
    if (event.audience === "guests") {
      const startups = new Set(event.startupIds);
      return among("invited", new Set([...event.guestFounderIds, ...active.filter((f) => f.startupId && startups.has(f.startupId)).map((f) => f.id)]));
    }
  }
  return { kind: "founders", basis: "batch", founderIds: active.map((f) => f.id) };
}

/** Le lundi (`YYYY-MM-DD`) de la semaine d'un instant, a Paris : la periode d'un formulaire recurrent. */
export function parisMonday(iso: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export type ResponseProgress = {
  /** Reponses de la periode (toutes, doublons compris). */
  responses: number;
  /** Attendus qui ont repondu, et ceux qui manquent (vides pour un formulaire anonyme). */
  answered: string[];
  missing: string[];
  /** Repondants hors des attendus (parti, absent...) : comptes a part, pas dans le taux. */
  outside: string[];
};

/**
 * L'avancement d'un formulaire. `weekStart` : la periode d'un formulaire
 * recurrent (lundi a Paris) ; `null` compte toutes les reponses.
 */
export function responseProgress(
  audience: FormAudience,
  responses: Pick<FormResponse, "respondentFounderId" | "submittedDateISOString">[],
  weekStart: string | null,
): ResponseProgress {
  const inPeriod = weekStart ? responses.filter((r) => parisMonday(r.submittedDateISOString) === weekStart) : responses;
  if (audience.kind === "anonymous") return { responses: inPeriod.length, answered: [], missing: [], outside: [] };
  const respondents = new Set(inPeriod.flatMap((r) => (r.respondentFounderId ? [r.respondentFounderId] : [])));
  const expected = new Set(audience.founderIds);
  return {
    responses: inPeriod.length,
    answered: audience.founderIds.filter((id) => respondents.has(id)),
    missing: audience.founderIds.filter((id) => !respondents.has(id)),
    outside: [...respondents].filter((id) => !expected.has(id)),
  };
}
