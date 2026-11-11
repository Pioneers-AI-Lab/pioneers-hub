import { writeBatch } from "firebase/firestore";
import { deriveAttachments, formProblems, versionedSnapshot } from "@shared/formRules";
import { FORM_TEMPLATES, type FormTemplateKey } from "@shared/presets/formTemplates";
import type { Form, FormVersion, WithId } from "@shared/types";
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
  | "recurrenceRule"
> & { attachments?: Form["attachments"] };

export async function createForm(input: {
  programId: string;
  batchId: string;
  templateKey: FormTemplateKey | null;
  eventId: string | null;
}): Promise<string> {
  const template = input.templateKey ? FORM_TEMPLATES[input.templateKey] : null;
  const questions = template ? template.questions.map((q) => ({ ...q })) : [];
  return createDoc<Form>(refs.forms(), {
    programId: input.programId,
    batchId: input.batchId,
    archivedDateISOString: null,
    kind: template?.kind ?? "custom",
    title: template?.title ?? "Untitled form",
    description: template?.description ?? null,
    version: 0,
    questions,
    attachments: deriveAttachments(questions),
    approval: template?.approval ?? "none",
    identityCheck: template?.identityCheck ?? "select_name",
    eventId: input.eventId,
    status: "draft",
    opensDateISOString: null,
    deadlineDateISOString: null,
    recurrenceRule: null,
  });
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
  batch.set(
    refs.form(form.id),
    { ...draft, attachments, version, status, updatedDateISOString: now },
    { merge: true },
  );
  if (version !== form.version) {
    const snapshot: FormVersion = {
      version,
      questions: next.questions,
      attachments,
      approval: next.approval,
      publishedDateISOString: now,
    };
    batch.set(refs.formVersion(form.id, version), { ...snapshot, id: String(version) });
  }
  await batch.commit();
  return version;
}

/** Copie en brouillon (version 0), sans les reponses ni l'historique. */
export async function duplicateForm(form: WithId<Form>): Promise<string> {
  return createDoc<Form>(refs.forms(), {
    programId: form.programId,
    batchId: form.batchId,
    archivedDateISOString: null,
    kind: form.kind,
    title: `Copy of ${form.title}`,
    description: form.description,
    version: 0,
    // Les questions archivees ne servent qu'a l'historique de l'original.
    questions: form.questions.filter((q) => !q.archived),
    attachments: form.attachments,
    approval: form.approval,
    identityCheck: form.identityCheck,
    eventId: form.eventId,
    status: "draft",
    opensDateISOString: form.opensDateISOString,
    deadlineDateISOString: form.deadlineDateISOString,
    recurrenceRule: form.recurrenceRule,
  });
}

/** Rien n'est supprime : on archive (le formulaire ferme et sort des listes). */
export async function archiveForm(form: WithId<Form>) {
  await patchDoc<Form>(refs.form(form.id), {
    archivedDateISOString: new Date().toISOString(),
    status: form.status === "open" ? "closed" : form.status,
  });
}
