import { draftOf, duplicatedForm, formArchiveWrite, saveFormPlan, type FormDraft } from "@shared/admin/forms";
import { addedFormDates, type EventTimes } from "@shared/eventForms";
import { newForm, type NewFormInput } from "@shared/forms";
import type { Form, FormQuestion, WithId } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { docPaths } from "@shared/collections";
import { mergeWrite } from "@shared/docWrites";
import { commitWrites, createDoc } from "@/lib/firestore/write";

// ----------------------------
// Formulaires (staff, SPECS §4.4)
// ----------------------------
// Versions, publication, copie, archivage : shared/admin/forms.ts, la regle que
// suit aussi l'API (`update_form`, `set_form_status`, `duplicate_form`, `archive_form`).

export { draftOf, type FormDraft };

/** Ajoute une question a un formulaire (nouvelle version s'il est publie). */
export const appendQuestion = (form: WithId<Form>, question: FormQuestion) =>
  saveForm(form, { ...draftOf(form), questions: [...form.questions, question] }, { publish: false });

/**
 * Un brouillon neuf. Rattache a un evenement, il porte les dates de son modele
 * dans cet evenement (`addedFormDates` : ouvert 15 min avant la fin, echeance
 * 24 h apres...) ; `events` (ceux du batch) situe le creneau Debrief d'un Peer rating.
 */
export async function createForm(
  input: NewFormInput & { event?: (NewFormInput["event"] & EventTimes) | null },
  events: readonly WithId<EventTimes>[] = [],
): Promise<string> {
  const { event, eventId, templateKey } = input;
  const dates = event && eventId ? addedFormDates(templateKey, { ...event, id: eventId }, events) : {};
  return createDoc<Form>("create_form", refs.forms(), newForm(input, dates));
}

/**
 * Enregistre le brouillon de l'editeur (shared/admin/forms.ts#saveFormPlan) :
 * publie, ou passe a la version suivante si ses champs figes ont change.
 * @returns la version courante apres l'enregistrement.
 */
export async function saveForm(form: WithId<Form>, draft: FormDraft, options: { publish: boolean }): Promise<number> {
  const plan = saveFormPlan(form, draft, options, new Date().toISOString());
  await commitWrites("update_form", plan.writes);
  return plan.version;
}

/** Copie en brouillon (shared/admin/forms.ts#duplicatedForm). */
export const duplicateForm = (form: WithId<Form>): Promise<string> => createDoc<Form>("duplicate_form", refs.forms(), duplicatedForm(form));

/** Rien n'est supprime : on archive (le formulaire ferme et sort des listes). */
export const archiveForm = (form: WithId<Form>) => commitWrites("archive_form", [formArchiveWrite(form, true, new Date().toISOString())]);

/**
 * Ouvre ou ferme un formulaire PUBLIE, sans nouvelle version (le verrou du
 * jury) : la branche publiee de `formStatusWrites` (shared/admin/forms.ts),
 * qui publie aussi un brouillon pour l'API. Fermer le formulaire de jury,
 * c'est verrouiller les notes.
 */
export async function setFormStatus(formId: string, status: "open" | "closed"): Promise<void> {
  await commitWrites("set_form_status", [mergeWrite(docPaths.form(formId), { status, updatedDateISOString: new Date().toISOString() })]);
}
