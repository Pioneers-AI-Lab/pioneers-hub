import { docPaths } from "../collections";
import { archiveWrite, mergeWrite, RuleError, setWrite, type DocWrite } from "../docWrites";
import { isDbFieldKey } from "../fieldRegistry";
import { deriveAttachments, formProblems, newQuestion, retiredFormProblems, versionedSnapshot, type NewQuestionInput } from "../formRules";
import { firstPublication, formVersion, type FormData } from "../forms";
import type { Form, FormQuestion } from "../types";

// ----------------------------
// Admin > Forms : enregistrer, publier, dupliquer, archiver un formulaire (SPECS §4.4)
// ----------------------------
// En logique pure (shared/docWrites.ts) : l'editeur (lib/formsAdmin.ts) et
// l'API (services/admin/forms.ts) ecrivent les memes documents.
//
// Un formulaire nait en brouillon (version 0). Le PUBLIER fige ses questions
// dans `forms/{id}/versions/{n}` et l'ouvre. Ensuite, toute modification des
// questions, du rattachement ou de la validation cree la version suivante :
// chaque reponse garde la version a laquelle elle repond. Le titre, les dates
// et le statut se modifient sans nouvelle version.

/** Les reglages modifiables d'un formulaire depuis l'editeur. */
export type FormDraft = Pick<
  Form,
  "kind" | "title" | "description" | "questions" | "approval" | "identityCheck" | "eventId" | "status" | "opensDateISOString" | "deadlineDateISOString"
> & { attachments?: Form["attachments"] };

/** Les reglages modifiables d'un formulaire, tels qu'il est enregistre. */
export const draftOf = (form: Form): FormDraft => ({
  kind: form.kind,
  title: form.title,
  description: form.description,
  questions: form.questions,
  approval: form.approval,
  identityCheck: form.identityCheck,
  eventId: form.eventId,
  status: form.status,
  opensDateISOString: form.opensDateISOString,
  deadlineDateISOString: form.deadlineDateISOString,
});

export type FormSave = { writes: DocWrite[]; version: number; status: Form["status"]; isNewVersion: boolean };

/**
 * L'enregistrement d'un brouillon de l'editeur. `publish` : publie un
 * formulaire jamais publie (`firstPublication`, shared/forms.ts). Un formulaire
 * deja publie passe a la version suivante si ses champs figes ont change.
 * Leve le premier probleme de `formProblems` (ce que l'editeur refuse), et ce
 * qui est retire le 17/11 sans que le formulaire l'ait deja (`retiredFormProblems`).
 */
export function saveFormPlan(form: Form & { id: string }, draft: FormDraft, options: { publish: boolean }, now: string): FormSave {
  const attachments = deriveAttachments(draft.questions, draft.attachments ?? form.attachments);
  const next = { ...form, ...draft, attachments };
  const problem = [...retiredFormProblems(next, form), ...formProblems(next)][0];
  if (problem) throw new RuleError("invalid_form", problem, "questions");

  const path = docPaths.form(form.id);
  if (options.publish && form.version === 0) {
    const { form: published, version } = firstPublication(next, now);
    const { opensDateISOString, status } = published;
    return {
      writes: [mergeWrite(path, { ...draft, opensDateISOString, attachments, version: 1, status, updatedDateISOString: now }), setWrite(docPaths.formVersion(form.id, 1), version)],
      version: 1,
      status,
      isNewVersion: true,
    };
  }
  const isNewVersion = form.version > 0 && versionedSnapshot(next) !== versionedSnapshot(form);
  const version = isNewVersion ? form.version + 1 : form.version;
  const status = form.version === 0 ? "draft" : draft.status;
  const writes = [mergeWrite(path, { ...draft, attachments, version, status, updatedDateISOString: now })];
  if (isNewVersion) writes.push(setWrite(docPaths.formVersion(form.id, version), formVersion(next, version, now)));
  return { writes, version, status, isNewVersion };
}

/**
 * Ouvrir ou fermer : un brouillon s'ouvre en se publiant (version 1) ; un
 * formulaire publie change de statut sans nouvelle version. Fermer le
 * formulaire de jury, c'est verrouiller les notes.
 */
export function formStatusWrites(form: Form & { id: string }, status: "open" | "closed", now: string): DocWrite[] {
  if (form.version > 0) return [mergeWrite(docPaths.form(form.id), { status, updatedDateISOString: now })];
  if (status === "closed") throw new RuleError("draft", "A draft is not open: publish it (`open`) or leave it.", "status");
  return saveFormPlan(form, draftOf(form), { publish: true }, now).writes;
}

/** Une question editee : ses champs, et `id` pour une question existante (sans `id` : nouvelle). */
export type QuestionEdit = Partial<NewQuestionInput> & { id?: string };

/**
 * Les questions apres une edition (API, MCP) : `edits` est la liste COMPLETE et
 * ordonnee. Une question existante (`id`) ne change que les champs donnes ;
 * une nouvelle a besoin de `type` et `label`. Une question absente est
 * archivee si le formulaire est publie (ses reponses gardent leur question),
 * retiree d'un brouillon. Creer un formulaire, c'est editer un formulaire vide.
 */
export function questionsFromEdits(current: readonly FormQuestion[], isPublished: boolean, edits: readonly QuestionEdit[]): FormQuestion[] {
  const byId = new Map(current.map((q) => [q.id, q]));
  let next = Math.max(0, ...current.map((q) => Number(/^q(\d+)$/.exec(q.id)?.[1] ?? 0))) + 1;
  const seen = new Set<string>();
  const out = edits.map(({ id, ...given }, i) => {
    if (given.dbField && !isDbFieldKey(given.dbField)) {
      throw new RuleError("unknown_field", `\`${given.dbField}\` is not a writable field. The full list: list \`fields\`.`, `questions.${i}.dbField`);
    }
    if (!id) {
      if (!given.type || !given.label) throw new RuleError("missing_argument", "A new question needs `type` and `label`.", `questions.${i}`);
      return newQuestion(`q${next++}`, { ...given, type: given.type, label: given.label });
    }
    const q = byId.get(id);
    if (!q) throw new RuleError("unknown_question", `This form has no question \`${id}\`.`, `questions.${i}.id`);
    if (seen.has(id)) throw new RuleError("duplicate_question", `Question \`${id}\` is listed twice.`, `questions.${i}.id`);
    seen.add(id);
    // Seuls les champs donnes changent ; l'approbation par question reste.
    const before: NewQuestionInput = { type: q.type, label: q.label, dbField: q.dbField, required: q.required, description: q.description, options: q.options, scale: q.scale, picker: q.picker, scope: q.scope, weight: q.weight };
    return { ...newQuestion(id, { ...before, ...given }), requiresApproval: q.requiresApproval };
  });
  const dropped = current.filter((q) => !seen.has(q.id));
  return isPublished ? [...out, ...dropped.map((q) => ({ ...q, archived: true }))] : out;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const nextWeek = (iso: string | null) => (iso ? new Date(Date.parse(iso) + WEEK_MS).toISOString() : null);

/**
 * Une copie en brouillon (version 0), sans les reponses ni l'historique. Un
 * formulaire par occurrence : celui d'une semaine (`attachments.week`) donne
 * celui de la semaine suivante, dates decalees de 7 jours ; les autres (un
 * feedback d'evenement) repartent sans dates, a fixer pour leur occurrence.
 */
export function duplicatedForm(form: Form): FormData {
  const isWeekly = form.attachments.week !== undefined;
  return {
    programId: form.programId,
    batchId: form.batchId,
    archivedDateISOString: null,
    kind: form.kind,
    // L'occurrence suivante d'un formulaire de semaine garde son titre (ses dates la distinguent).
    title: isWeekly ? form.title : `Copy of ${form.title}`,
    description: form.description,
    version: 0,
    // Les questions archivees ne servent qu'a l'historique de l'original.
    questions: form.questions.filter((q) => !q.archived),
    attachments: form.attachments,
    approval: form.approval,
    identityCheck: form.identityCheck,
    eventId: form.eventId,
    status: "draft",
    opensDateISOString: isWeekly ? nextWeek(form.opensDateISOString) : null,
    deadlineDateISOString: isWeekly ? nextWeek(form.deadlineDateISOString) : null,
  };
}

/**
 * Archiver : le formulaire ferme et sort des listes. Restaurer le remet dans
 * les listes, FERME s'il etait ouvert (le rouvrir est un geste a part).
 */
export const formArchiveWrite = (form: Pick<Form, "status"> & { id: string }, archived: boolean, now: string): DocWrite =>
  archiveWrite(docPaths.form(form.id), archived, now, archived && form.status === "open" ? { status: "closed" } : {});
