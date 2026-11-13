import {
  DB_FIELDS,
  FAMILY_QUESTION_TYPE,
  INPUT_COMPATIBILITY,
  criterionKeyOf,
  familyOf,
  getFieldDef,
  listKeyOf,
  metricKeyOf,
  parseDbField,
  requiredSubjects,
  scopeOfDoc,
  type DbFieldKey,
  type SubjectKey,
  type ValueSpec,
} from "./fieldRegistry";
import { EVENT_METRIC_RENAMES, standardMetricOf, type StandardMetric } from "./presets/standardMetrics";
import { absentFounderIds, eventRoster } from "./attendance";
import { matchingOf } from "./events";
import { IDENTITY_RULES, SCOPE_RULES, activeQuestions, isBatchParticipant, isJuryForm, scopeOf } from "./types";
import type {
  Attendance,
  Form,
  FormAnswer,
  FormAttachments,
  FormFieldType,
  FormIdentityCheck,
  FormQuestion,
  FormResponse,
  Founder,
  PickerEntity,
  PioneersEvent,
  QuestionScope,
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

/** Les champs de la base qu'une question de ce type peut alimenter (hors familles : metriques et criteres). */
export function compatibleDbFields(type: FormFieldType): DbFieldKey[] {
  const kinds = INPUT_COMPATIBILITY[type];
  return (Object.keys(DB_FIELDS) as DbFieldKey[]).filter((key) => kinds.includes(getFieldDef(key).value.kind));
}

/**
 * La portee qu'exige le champ d'une question : une soumission est celle de
 * l'equipe, un avis entre pairs porte sur chaque coequipier, une note du jury
 * sur chaque equipe notee (`DOC_KINDS[...].scope`) ; `self` sans champ.
 */
export const scopeForField = (dbField: DbFieldKey | null): QuestionScope => (dbField ? scopeOfDoc(parseDbField(dbField).doc) : "self");

/** L'echelle d'une note : celle de la question, 1 a 5 par defaut. */
export const DEFAULT_RATING_SCALE = { min: 1, max: 5 } as const;
export const ratingScale = (q: Pick<FormQuestion, "scale">) => q.scale ?? DEFAULT_RATING_SCALE;

/** Une question de note du jury, comptee dans la moyenne ponderee du leaderboard. */
export const isJuryCriterion = (q: Pick<FormQuestion, "type" | "dbField">) => q.type === "rating" && criterionKeyOf(q.dbField) !== null;

/**
 * Ce qu'une question herite du champ choisi : l'echelle d'une note, les
 * options d'un choix a valeurs fixes, la limite d'une liste de fondateurs.
 */
export function alignQuestionWithField(input: FormQuestion): FormQuestion {
  if (!input.dbField) return input;
  // La portee suit le document du champ (une soumission est celle de l'equipe...).
  // Une metrique standard porte sa definition, quel que soit qui cree la question.
  const description = input.description ?? standardMetricOfField(input.dbField)?.description ?? null;
  const question: FormQuestion = { ...input, scope: scopeForField(input.dbField), description };
  const value = getFieldDef(input.dbField).value;
  if (value.kind === "rating") return { ...question, scale: { min: value.min, max: value.max } };
  if ((value.kind === "enum" || value.kind === "enumMulti") && value.values) return { ...question, options: [...value.values] };
  if (value.kind === "enum" && value.listKey) return { ...question, options: null };
  if (value.kind === "boolean") return { ...question, options: ["Yes", "No"] };
  if (value.kind === "founderRefs") {
    // Le champ borne ; la question peut demander moins (top 3).
    const cap = value.maxItems ?? 50;
    const asked = question.picker?.entity === "founder" ? question.picker.maxItems : null;
    return { ...question, picker: { entity: "founder", maxItems: asked ? Math.min(asked, cap) : cap } };
  }
  return question;
}

/** Ce qu'on donne pour creer une question : le reste prend sa valeur par defaut. */
export type NewQuestionInput = {
  type: FormFieldType;
  label: string;
  dbField?: DbFieldKey | null;
  required?: boolean;
  description?: string | null;
  options?: string[] | null;
  scale?: { min: number; max: number } | null;
  picker?: { entity: PickerEntity; maxItems: number } | null;
  scope?: QuestionScope;
  weight?: number | null;
};

/**
 * Une question neuve, alignee sur son champ : la seule facon d'en construire une
 * (modeles de formulaires, API et MCP). Une note sans echelle vaut 1-5.
 */
export const newQuestion = (id: string, input: NewQuestionInput): FormQuestion =>
  alignQuestionWithField({
    id,
    type: input.type,
    label: input.label,
    description: input.description ?? null,
    required: input.required ?? false,
    options: input.options ?? null,
    scale: input.scale ?? (input.type === "rating" ? { ...DEFAULT_RATING_SCALE } : null),
    picker: input.picker ?? null,
    dbField: input.dbField ?? null,
    requiresApproval: null,
    archived: false,
    scope: input.scope ?? "self",
    weight: input.weight ?? null,
  });

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
  // Un lien par ligne (texte long), ou un lien seul.
  if (spec.kind === "files" && spec.multiple && typeof answer === "string") return answer.split(/\s+/).filter(Boolean);
  return answer;
}

/**
 * La valeur d'un champ, a la forme d'une reponse a cette question (reponses
 * deja donnees, prerempliees) : `true` -> « Yes », une liste -> une ligne par
 * element dans un texte long. `undefined` : rien a preremplir.
 */
export function fieldValueToAnswer(q: Pick<FormQuestion, "type">, spec: ValueSpec, value: unknown): FormAnswer | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (spec.kind === "boolean") return value === true ? "Yes" : value === false ? "No" : undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    if (q.type === "long_text") return value.join("\n");
    if (q.type === "link" || q.type === "file" || q.type === "text") return String(value[0]);
    return value.map(String);
  }
  if (typeof value === "object") return undefined;
  return value as FormAnswer;
}

/** La metrique standard d'un champ : un chiffre de l'update (`checkin.<cle>`) ou une metrique d'equipe (`submission.metrics.<cle>`). */
export function standardMetricOfField(dbField: DbFieldKey): StandardMetric | null {
  const { doc, field } = parseDbField(dbField);
  const key = doc === "checkin" ? field : metricKeyOf(dbField);
  return key ? standardMetricOf(key) : null;
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
  if (question.dbField) {
    const expected = scopeForField(question.dbField);
    if (scopeOf(question) !== expected) problems.push(`"${getFieldDef(question.dbField).label}" is filled ${SCOPE_PHRASE[expected]}.`);
    const family = familyOf(question.dbField);
    // Une ancienne cle (SPECS annexe A.5) casserait la comparaison entre hackathons.
    const legacy = metricKeyOf(question.dbField);
    if (legacy && legacy in EVENT_METRIC_RENAMES) problems.push(`The key ${legacy} is now ${EVENT_METRIC_RENAMES[legacy]}: use the standard key.`);
    if (family && FAMILY_QUESTION_TYPE[family.family] !== question.type) {
      problems.push(`A ${family.family === "submission.metrics" ? "team metric" : "jury criterion"} is a ${FORM_FIELD_TYPE_LABELS[FAMILY_QUESTION_TYPE[family.family]].toLowerCase()} question.`);
    }
  }
  if (question.weight !== undefined && question.weight !== null) {
    if (!isJuryCriterion(question)) problems.push("Only a jury score has a weight.");
    else if (!(question.weight > 0)) problems.push("A weight is a number above 0.");
  }
  return problems;
}

/** Comment se remplit une question, selon sa portee (messages de l'editeur). */
const SCOPE_PHRASE: Record<QuestionScope, string> = {
  self: "by each respondent",
  team: "once per team",
  each_teammate: "for each teammate",
  each_target: "for each team scored",
};

/** D'ou vient, par defaut, l'id d'un sujet exige par les champs. */
const DEFAULT_SOURCE: Record<SubjectKey, SubjectSource | null> = {
  person: { from: "respondent" },
  founder: { from: "respondent" },
  startup: { from: "respondent_startup" },
  week: { from: "submission_week" },
  event: { from: "form_event" },
  // L'equipe publiee du repondant a l'evenement du formulaire (une question
  // « choisir une equipe » peut la remplacer, reglee a la main).
  team: { from: "respondent_team" },
  target: { from: "target" },
  judge: { from: "respondent" },
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
  const active = activeQuestions(form);
  active.forEach((q, i) => questionProblems(q).forEach((p) => problems.push(`Question ${i + 1}: ${p}`)));
  const subjects = requiredSubjects(active.filter((q) => q.dbField).map((q) => q.dbField as DbFieldKey));
  if (isAnonymous(form.identityCheck) && subjects.some((s) => s === "founder" || s === "person" || s === "startup"))
    problems.push("An anonymous form cannot write to a founder or startup field: remove the database fields or ask for the name.");
  if (subjects.includes("event") && form.attachments.event?.from === "form_event" && !form.eventId)
    problems.push("Some questions write to an event: attach the form to an event.");
  if (subjects.includes("team") && !form.attachments.team)
    problems.push("Some questions write to a team: add a question that picks the team.");
  const scopes = new Set(active.map(scopeOf));
  if ([...scopes].some((sc) => sc !== "self") && !form.eventId)
    problems.push("Questions about a team, teammates or teams scored need the form to be attached to an event.");
  const isJury = isJuryForm(form);
  if (formNeedsTeam(form) && (isAnonymous(form.identityCheck) || isJury))
    problems.push("Questions about the respondent's team or teammates need the respondent's name: ask for it, or ask to sign in.");
  if (scopes.has("each_target") && !isJury)
    problems.push("Questions about each team scored are for a jury: use the shared jury link as respondent.");
  if (isJury && [...scopes].some((sc) => sc !== "each_target")) problems.push("A jury form only asks about each team scored.");
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
// Le taux de reponse se compte PAR FORMULAIRE, et n'est juste que si l'on compte :
//   - des REPONDANTS distincts, pas des reponses (une page rouverte = un envoi de plus) ;
//   - parmi les ATTENDUS seulement : un fondateur parti ou absent qui repond est
//     compte a part, pas dans le taux.
// Pas de formulaire recurrent (decision du 12/11) : l'update de chaque semaine
// est son propre formulaire, duplique du precedent. Son taux est donc le sien.
// Un formulaire anonyme ne dit pas qui a repondu : on n'y compte que des reponses.
// Un formulaire de jury non plus (les jures ne sont pas des attendus connus).
// Un formulaire qui parle de l'equipe ou des coequipiers (Debrief) ne s'adresse
// qu'aux membres d'une equipe publiee de son evenement.

/** Le formulaire parle de l'equipe du repondant ou de ses coequipiers : il faut etre membre d'une equipe publiee. */
export const formNeedsTeam = (form: Pick<Form, "questions">) => activeQuestions(form).some((q) => SCOPE_RULES[scopeOf(q)].needsTeam);

/** Toutes ses questions portent sur l'equipe (la Submission) : un envoi vaut pour toute l'equipe. */
export const isTeamForm = (questions: readonly FormQuestion[]) => questions.length > 0 && questions.every((q) => scopeOf(q) === "team");

/** Sur quoi porte le denominateur, affiche avec le taux. */
export type AudienceBasis = "batch" | "present" | "teams" | "invited";

export type FormAudience =
  | { kind: "anonymous" }
  | { kind: "jury" }
  | { kind: "founders"; basis: AudienceBasis; founderIds: string[] };

type AudienceInput = {
  identityCheck: FormIdentityCheck;
  /** `formNeedsTeam` : seuls les membres des equipes publiees sont attendus. */
  needsTeam: boolean;
  batchId: string;
  founders: (Pick<Founder, "batchId" | "status" | "archivedDateISOString" | "isExternalFounder" | "startupId"> & { id: string })[];
  event: Pick<PioneersEvent, "kind" | "matching" | "teamSize" | "audience" | "guestFounderIds" | "startupIds"> | null;
  attendance: Pick<Attendance, "founderId" | "status">[];
  /** Membres des equipes publiees de l'evenement (`memberships`). */
  teamMemberIds: string[];
};

/**
 * A qui s'adresse le formulaire, anonyme ou non : les participants du batch
 * (`isBatchParticipant`), et pour un formulaire rattache a un evenement, ses
 * attendus moins ses absents (`eventRoster`, shared/attendance.ts). Le Debrief :
 * les membres des equipes publiees. Sinon tous les presents si la presence a
 * ete relevee (un feedback de seance ne se demande pas aux absents), sinon les
 * membres des equipes publiees (hackathon), sinon les invites ou le batch.
 */
function addressees(input: Omit<AudienceInput, "identityCheck">): { basis: AudienceBasis; founderIds: string[] } {
  const participants = input.founders.filter((f) => isBatchParticipant(f, input.batchId));
  const among = (basis: AudienceBasis, keep: (id: string) => boolean) => ({
    basis,
    founderIds: participants.filter((f) => keep(f.id)).map((f) => f.id),
  });

  const { event } = input;
  const members = new Set(input.teamMemberIds);
  if (!event) return input.needsTeam ? among("teams", (id) => members.has(id)) : among("batch", () => true);
  // Le Debrief : les membres des equipes publiees, personne avant le tirage.
  const absent = absentFounderIds(input.attendance);
  if (input.needsTeam) return among("teams", (id) => members.has(id) && !absent.has(id));
  const roster = eventRoster(input.batchId, event, participants, input.attendance);
  const present = new Set(roster.rows.filter((r) => r.status !== "absent").map((r) => r.founder.id));
  if (roster.isTaken) return among("present", (id) => present.has(id));
  if (matchingOf(event) && members.size > 0) return among("teams", (id) => members.has(id) && present.has(id));
  return among(roster.isRestricted ? "invited" : "batch", (id) => present.has(id));
}

/** Les fondateurs qui doivent repondre (`addressees`) ; un formulaire anonyme ne dit pas lesquels ont repondu. */
export function formAudience(input: AudienceInput): FormAudience {
  const respondent = IDENTITY_RULES[input.identityCheck].respondent;
  if (respondent === "none") return { kind: "anonymous" };
  if (respondent === "judge") return { kind: "jury" };
  return { kind: "founders", ...addressees(input) };
}

export type ResponseProgress = {
  /** Reponses du formulaire (toutes, doublons compris). */
  responses: number;
  /** Attendus qui ont repondu, et ceux qui manquent (vides pour un formulaire anonyme). */
  answered: string[];
  missing: string[];
  /** Repondants hors des attendus (parti, absent...) : comptes a part, pas dans le taux. */
  outside: string[];
};

/** L'avancement d'un formulaire, sur toutes ses reponses. */
export function responseProgress(
  audience: FormAudience,
  responses: Pick<FormResponse, "respondentFounderId">[],
): ResponseProgress {
  if (audience.kind !== "founders") return { responses: responses.length, answered: [], missing: [], outside: [] };
  const respondents = new Set(responses.flatMap((r) => (r.respondentFounderId ? [r.respondentFounderId] : [])));
  const expected = new Set(audience.founderIds);
  return {
    responses: responses.length,
    answered: audience.founderIds.filter((id) => respondents.has(id)),
    missing: audience.founderIds.filter((id) => !respondents.has(id)),
    outside: [...respondents].filter((id) => !expected.has(id)),
  };
}

/**
 * Le formulaire s'adresse-t-il a CE fondateur (son « To do ») ? La meme
 * audience que `formAudience`, vue du fondateur : avec sa seule presence a
 * l'evenement (il lit la sienne, pas celle des autres) et ses seules equipes.
 * Un absent ne le voit donc pas ; un fondateur sans equipe voit celui d'un
 * hackathon a equipes : mieux vaut un formulaire de trop qu'un formulaire cache. Un
 * formulaire anonyme suit l'audience de son evenement, comme les autres. Deux
 * exceptions : le Debrief ne s'adresse qu'aux membres d'une equipe publiee
 * (`formNeedsTeam`), et un formulaire de jury a aucun fondateur.
 */
export function formConcernsFounder(
  form: Pick<Form, "batchId" | "identityCheck" | "questions">,
  founder: AudienceInput["founders"][number],
  event: AudienceInput["event"],
  /** Le fondateur est dans une equipe publiee de l'evenement du formulaire. */
  isTeamMember: boolean,
  /** Sa presence a l'evenement du formulaire, absente si elle n'a pas ete relevee. */
  attendance?: Pick<Attendance, "founderId" | "status">,
): boolean {
  if (isJuryForm(form)) return false;
  const { founderIds } = addressees({
    needsTeam: formNeedsTeam(form),
    batchId: form.batchId,
    founders: [founder],
    event,
    attendance: attendance ? [attendance] : [],
    teamMemberIds: isTeamMember ? [founder.id] : [],
  });
  return founderIds.includes(founder.id);
}
