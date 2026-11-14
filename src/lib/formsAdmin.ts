import { writeBatch } from "firebase/firestore";
import { deriveAttachments, formProblems, versionedSnapshot } from "@shared/formRules";
import { formVersion, newForm, type NewFormInput } from "@shared/forms";
import type { Form, FormQuestion, WithId } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";
import { createDoc, patchDoc } from "@/lib/firestore/write";

// ----------------------------
// Formulaires (staff, SPECS §4.4)
// ----------------------------
// Un formulaire nait en brouillon (version 0). Le PUBLIER fige ses questions
// dans `forms/{id}/versions/{n}` et l'ouvre. Ensuite, toute modification des
// questions, du rattachement ou de la validation cree la version suivante :
// chaque reponse garde la version a laquelle elle repond. Le titre, les dates
// et le statut se modifient sans nouvelle version.

/** Les reglages modifiables d'un formulaire depuis l'editeur. */
export type FormDraft = Pick<
  Form,
  | "kind"
  | "title"
  | "description"
  | "questions"
  | "approval"
  | "identityCheck"
  | "eventId"
  | "status"
  | "opensDateISOString"
  | "deadlineDateISOString"
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

/** Ajoute une question a un formulaire (nouvelle version s'il est publie). */
export const appendQuestion = (form: WithId<Form>, question: FormQuestion) =>
  saveForm(form, { ...draftOf(form), questions: [...form.questions, question] }, { publish: false });

export async function createForm(input: NewFormInput): Promise<string> {
  return createDoc<Form>(refs.forms(), newForm(input));
}

/**
 * Enregistre le brouillon de l'editeur. `publish` : publie un formulaire
 * jamais publie (version 1, ouvert). Un formulaire deja publie passe a la
 * version suivante si ses champs figes ont change.
 * @returns la version courante apres l'enregistrement.
 */
export async function saveForm(form: WithId<Form>, draft: FormDraft, options: { publish: boolean }): Promise<number> {
  const attachments = deriveAttachments(draft.questions, draft.attachments ?? form.attachments);
  const next = { ...form, ...draft, attachments };
  const problems = formProblems(next);
  if (problems.length > 0) throw new Error(problems[0]);

  const isFirstPublication = options.publish && form.version === 0;
  const isNewVersion = form.version > 0 && versionedSnapshot(next) !== versionedSnapshot(form);
  const version = isFirstPublication || isNewVersion ? form.version + 1 : form.version;
  const status = isFirstPublication ? "open" : form.version === 0 ? "draft" : draft.status;
  const now = new Date().toISOString();

  const batch = writeBatch(db);
  // La semaine d'un formulaire est celle de son ouverture : publie sans date, il ouvre maintenant.
  const opensDateISOString = isFirstPublication ? (draft.opensDateISOString ?? now) : draft.opensDateISOString;
  batch.set(
    refs.form(form.id),
    { ...draft, opensDateISOString, attachments, version, status, updatedDateISOString: now },
    { merge: true },
  );
  if (version !== form.version) {
    batch.set(refs.formVersion(form.id, version), { ...formVersion({ ...next, attachments }, version, now), id: String(version) });
  }
  await batch.commit();
  return version;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const nextWeek = (iso: string | null) => (iso ? new Date(Date.parse(iso) + WEEK_MS).toISOString() : null);

/**
 * Copie en brouillon (version 0), sans les reponses ni l'historique. Un
 * formulaire par occurrence : celui d'une semaine (`attachments.week`) donne
 * celui de la semaine suivante, dates decalees de 7 jours ; les autres (un
 * feedback d'evenement) repartent sans dates, a fixer pour leur occurrence.
 */
export async function duplicateForm(form: WithId<Form>): Promise<string> {
  const isWeekly = form.attachments.week !== undefined;
  return createDoc<Form>(refs.forms(), {
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
  });
}

/** Rien n'est supprime : on archive (le formulaire ferme et sort des listes). */
export async function archiveForm(form: WithId<Form>) {
  await patchDoc<Form>(refs.form(form.id), {
    archivedDateISOString: new Date().toISOString(),
    status: form.status === "open" ? "closed" : form.status,
  });
}

/**
 * Ouvre ou ferme un formulaire publie, sans nouvelle version. Fermer le
 * formulaire de jury, c'est verrouiller les notes ; fermer un formulaire Picks,
 * c'est clore les choix.
 */
export async function setFormStatus(formId: string, status: "open" | "closed"): Promise<void> {
  await patchDoc<Form>(refs.form(formId), { status });
}
