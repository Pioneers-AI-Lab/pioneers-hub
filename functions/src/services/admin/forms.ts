import { z } from "zod";
import { draftOf, duplicatedForm, formArchiveWrite, formStatusWrites, questionsFromEdits, saveFormPlan, type FormDraft, type QuestionEdit } from "../../shared/admin/forms";
import { COL, docPaths } from "../../shared/collections";
import { createWrite, isArchivedAs } from "../../shared/docWrites";
import { FORM_APPROVALS, type Form, type PioneersEvent } from "../../shared/types";
import { formUrl } from "../../api/config";
import { badRequest } from "../../api/errors";
import type { Operation } from "../operations";
import { OFFERED_IDENTITY_CHECKS } from "../../shared/presets/offered";
import { QuestionInput } from "../formCreate";
import { isoDateTime } from "../schemas";
import { changesOf, mustRead, newDocId, readDoc, stamped, staffOnly, writePlan } from "./writes";

// ----------------------------
// services/admin - un formulaire : modifier, ouvrir / fermer, dupliquer, archiver
// ----------------------------
// Les gestes de l'editeur d'Admin > Forms, calcules par shared/admin/forms.ts
// comme a l'ecran : un formulaire publie dont les questions changent passe a la
// version suivante (chaque reponse garde la sienne) ; `formProblems` refuse ce
// que l'editeur refuserait.

const QuestionEdit = QuestionInput.partial()
  .extend({ id: z.string().min(1).optional().describe("An existing question's id (keeps its answers). Omit for a new question.") })
  .strict();

export const UpdateFormInput = z
  .object({
    formId: z.string().min(1),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    questions: z
      .array(QuestionEdit)
      .min(1)
      .max(40)
      .optional()
      .describe(
        "The FULL ordered list. An item with `id` keeps that question and changes only the fields given; without `id`, a new question (needs `type` and `label`). A question left out is removed (archived once the form is published, so past answers keep their question).",
      ),
    eventId: z.string().min(1).nullable().optional(),
    identityCheck: z.enum(OFFERED_IDENTITY_CHECKS).optional().describe("`account` for every founder form, `jury_link` for a jury. A form already anonymous or pick-name keeps it by leaving this out."),
    approval: z.enum(FORM_APPROVALS).optional(),
    opensDateISOString: isoDateTime.nullable().optional(),
    deadlineDateISOString: isoDateTime.nullable().optional(),
  })
  .strict();

const assertNotArchived = (form: Form) => {
  if (form.archivedDateISOString) throw badRequest("archived", "This form is archived: restore it first (`archive_form` with `archived: false`).", "formId");
};

export const updateForm: Operation<typeof UpdateFormInput> = {
  name: "update_form",
  input: UpdateFormInput,
  allowed: staffOnly,
  async plan(tx, _caller, input) {
    const { formId, questions, ...given } = input;
    const [form, event] = await Promise.all([
      mustRead<Form>(tx, docPaths.form(formId), "form", "formId"),
      given.eventId ? readDoc<PioneersEvent>(tx, docPaths.event(given.eventId)) : null,
    ]);
    assertNotArchived(form);
    if (given.eventId && event?.batchId !== form.batchId) throw badRequest("event_not_found", `Event \`${given.eventId}\` is not an event of this batch.`, "eventId");
    const edited = questions ? questionsFromEdits(form.questions, form.version > 0, questions as QuestionEdit[]) : null;
    const draft: FormDraft = { ...draftOf(form), ...given, ...(edited ? { questions: edited } : {}) };
    const plan = saveFormPlan(form, draft, { publish: false }, new Date().toISOString());
    const changes = changesOf(form, given);
    const questionsChanged = edited !== null && JSON.stringify(edited) !== JSON.stringify(form.questions);
    return writePlan(
      {
        form: form.title,
        changes,
        questions: questionsChanged ? edited.map((x) => ({ id: x.id, type: x.type, label: x.label, writesTo: x.dbField, removed: x.archived || undefined })) : "unchanged",
        version: plan.isNewVersion ? `new version ${plan.version} (answers given so far keep version ${form.version})` : form.version,
      },
      plan.writes,
      { formId, version: plan.version },
      Object.keys(changes).length > 0 || questionsChanged,
    );
  },
};

export const SetFormStatusInput = z
  .object({
    formId: z.string().min(1),
    status: z.enum(["open", "closed"]).describe("`open` publishes a draft (version 1) or reopens it; `closed` stops answers (closing a jury form locks the scores)."),
  })
  .strict();

export const setFormStatus: Operation<typeof SetFormStatusInput> = {
  name: "set_form_status",
  input: SetFormStatusInput,
  allowed: staffOnly,
  async plan(tx, _caller, { formId, status }) {
    const form = await mustRead<Form>(tx, docPaths.form(formId), "form", "formId");
    assertNotArchived(form);
    const isSame = form.status === status;
    return writePlan(
      { form: form.title, from: form.status, to: status, publishes: form.version === 0 && !isSame ? "version 1, founders can answer" : undefined },
      isSame ? [] : formStatusWrites(form, status, new Date().toISOString()),
      { formId, status, url: status === "open" ? formUrl(formId) : null },
    );
  },
};

export const FormIdInput = z.object({ formId: z.string().min(1) }).strict();

export const duplicateForm: Operation<typeof FormIdInput> = {
  name: "duplicate_form",
  input: FormIdInput,
  allowed: staffOnly,
  async plan(tx, _caller, { formId }) {
    const form = await mustRead<Form>(tx, docPaths.form(formId), "form", "formId");
    const copy = duplicatedForm(form);
    const id = newDocId(COL.forms);
    return writePlan(
      { copyOf: form.title, title: copy.title, status: "draft", opensDateISOString: copy.opensDateISOString, deadlineDateISOString: copy.deadlineDateISOString },
      [createWrite(docPaths.form(id), stamped(copy, new Date().toISOString()))],
      { formId: id },
    );
  },
};

export const ArchiveFormInput = z
  .object({ formId: z.string().min(1), archived: z.boolean().describe("true: close it and hide it. false: restore it (closed; reopen with `set_form_status`).") })
  .strict();

export const archiveForm: Operation<typeof ArchiveFormInput> = {
  name: "archive_form",
  input: ArchiveFormInput,
  allowed: staffOnly,
  async plan(tx, _caller, { formId, archived }) {
    const form = await mustRead<Form>(tx, docPaths.form(formId), "form", "formId");
    return writePlan(
      { form: form.title, archived, status: archived && form.status === "open" ? "closed" : form.status },
      [formArchiveWrite(form, archived, new Date().toISOString())],
      { formId },
      !isArchivedAs(form, archived),
    );
  },
};
