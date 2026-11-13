import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { COL, docPaths, SUB } from "../shared/collections";
import { isStaffViewer } from "../shared/access";
import { isDbFieldKey, type DbFieldKey } from "../shared/fieldRegistry";
import { formProblems, newQuestion } from "../shared/formRules";
import { firstPublication, newForm } from "../shared/forms";
import { FORM_TEMPLATES, type FormTemplateKey } from "../shared/presets/formTemplates";
import { FORM_APPROVALS, FORM_FIELD_TYPES, FORM_IDENTITY_CHECKS, PICKER_ENTITIES, QUESTION_SCOPES, type Batch, type Form, type PioneersEvent } from "../shared/types";
import { FRONTEND_BASE_URL } from "../api/config";
import { badRequest, notFound } from "../api/errors";
import type { Operation } from "./operations";
import { isoDateTime } from "./schemas";

// ----------------------------
// services - CREER un formulaire
// ----------------------------
// SPECS §4.8 : « Cree un formulaire de 3 questions pour la masterclass de
// jeudi ». Construit par `newForm` et publie par `firstPublication`
// (shared/forms.ts), comme dans Admin > Forms ; refuse ce que l'editeur
// refuserait (`formProblems`). Sans `publish`, il reste un brouillon a relire
// dans Admin ; publie, il est ouvert et son lien se partage.
//
// Staff seulement (regle `forms` : write staff).

const TEMPLATE_KEYS = Object.keys(FORM_TEMPLATES) as [FormTemplateKey, ...FormTemplateKey[]];

const QuestionInput = z
  .object({
    type: z.enum(FORM_FIELD_TYPES),
    label: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(1000).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(200)).min(2).max(30).optional().describe("single_choice and multiple_choice."),
    scale: z.object({ min: z.number().int().min(0).max(10), max: z.number().int().min(1).max(10) }).strict().optional().describe("rating. Default 1-5."),
    picker: z
      .object({ entity: z.enum(PICKER_ENTITIES), maxItems: z.number().int().min(1).max(10) })
      .strict()
      .optional()
      .describe("entity_picker: what to pick (never a typed name)."),
    dbField: z
      .string()
      .optional()
      .describe(
        "Database field the answer writes to (list `fields`; a team metric is `submission.metrics.<key>`, a jury criterion `evaluation.scores.<key>`). Omit: the answer stays attached to the response.",
      ),
    scope: z.enum(QUESTION_SCOPES).optional().describe("What the answer is about. Default: the field's (a team metric is the team's), else the respondent."),
    weight: z.number().positive().max(100).optional().describe("Weight of a jury criterion (rating writing `evaluation.scores.<key>`)."),
  })
  .strict();

export const CreateFormInput = z
  .object({
    batchId: z.string().min(1),
    templateKey: z.enum(TEMPLATE_KEYS).optional().describe("Form model: copies its questions. Omit to give `questions`."),
    title: z.string().trim().min(1).max(200).optional().describe("Default: the model's title."),
    description: z.string().trim().min(1).max(2000).optional(),
    questions: z.array(QuestionInput).min(1).max(40).optional().describe("Replace the model's questions, or the questions of a form without model."),
    eventId: z.string().min(1).optional().describe("Event the form is about (session or exercise feedback, debrief, jury, picks)."),
    identityCheck: z.enum(FORM_IDENTITY_CHECKS).optional().describe("How a respondent says who they are. Default: the model's, or select_name."),
    approval: z.enum(FORM_APPROVALS).optional().describe("Staff validation of answers before they are written. Default: the model's, or none."),
    publish: z.boolean().optional().describe("true: open it now (or at `opensDateISOString`). Default: a draft, to review in Admin > Forms."),
    opensDateISOString: isoDateTime.optional(),
    deadlineDateISOString: isoDateTime.optional(),
  })
  .strict();

type Created = { formId: string; version: number; status: Form["status"]; url: string | null };

export const createForm: Operation<typeof CreateFormInput, Created> = {
  name: "create_form",
  input: CreateFormInput,
  allowed: (caller) => isStaffViewer(caller.viewer),
  async plan(tx, _caller, input) {
    const db = getFirestore();
    const template = input.templateKey ? FORM_TEMPLATES[input.templateKey] : null;
    if (!template && !input.questions) throw badRequest("missing_argument", "Give `templateKey` (a form model) or `questions`.", "questions");
    // Un formulaire libre n'a pas de titre par defaut (l'editeur, lui, propose « Untitled form »).
    if (!template && !input.title) throw badRequest("missing_argument", "A form without model needs a `title`.", "title");
    if (template?.needsEvent && !input.eventId) {
      throw badRequest("missing_argument", `The model \`${input.templateKey}\` is about an event: give \`eventId\`.`, "eventId");
    }
    const unknownField = input.questions?.find((q) => q.dbField && !isDbFieldKey(q.dbField));
    if (unknownField) {
      throw badRequest("unknown_field", `\`${unknownField.dbField}\` is not a writable field. The full list: list \`fields\`.`, "questions");
    }

    // L'evenement d'abord : un Debrief ou un jury construit ses questions depuis son modele.
    const [batchSnap, eventSnap] = await tx.getAll(
      db.doc(docPaths.batch(input.batchId)),
      ...(input.eventId ? [db.doc(docPaths.event(input.eventId))] : []),
    );
    const batch = batchSnap.data() as Batch | undefined;
    if (!batch) throw notFound("batch_not_found", `Batch \`${input.batchId}\` does not exist.`, "batchId");
    const event = eventSnap?.data() as PioneersEvent | undefined;
    if (input.eventId && event?.batchId !== input.batchId) {
      throw notFound("event_not_found", `Event \`${input.eventId}\` is not an event of this batch.`, "eventId");
    }

    // Construit comme dans Admin, puis verifie comme dans l'editeur.
    const form = newForm(
      { programId: batch.programId, batchId: input.batchId, templateKey: input.templateKey ?? null, eventId: input.eventId ?? null, event: event ?? null },
      {
        ...(input.title ? { title: input.title } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.questions ? { questions: input.questions.map((q, i) => newQuestion(`q${i + 1}`, { ...q, dbField: q.dbField as DbFieldKey | undefined })) } : {}),
        ...(input.approval ? { approval: input.approval } : {}),
        ...(input.identityCheck ? { identityCheck: input.identityCheck } : {}),
        opensDateISOString: input.opensDateISOString ?? null,
        deadlineDateISOString: input.deadlineDateISOString ?? null,
      },
    );
    const problem = formProblems(form)[0];
    if (problem) throw badRequest("invalid_form", problem, "questions");
    const publish = input.publish === true;

    return {
      preview: {
        form: {
          title: form.title,
          batch: batch.name,
          model: template?.label ?? null,
          event: event?.name ?? null,
          status: publish ? "open as soon as confirmed (founders can answer)" : "draft (review it in Admin > Forms, then publish)",
          identityCheck: form.identityCheck,
          approval: form.approval,
          opensDateISOString: form.opensDateISOString,
          deadlineDateISOString: form.deadlineDateISOString,
          questions: form.questions.map((q) => ({ type: q.type, label: q.label, required: q.required, writesTo: q.dbField, about: q.scope ?? "self" })),
        },
      },
      targetPaths: [COL.forms],
      commit: (wtx) => {
        const ref = db.collection(COL.forms).doc();
        const now = new Date().toISOString();
        const published = publish ? firstPublication(form, now) : null;
        const doc: Form = { ...(published?.form ?? form), createdDateISOString: now, updatedDateISOString: now };
        wtx.create(ref, doc);
        if (published) wtx.create(ref.collection(SUB.versions).doc(String(published.version.version)), published.version);
        // Le meme chemin que `paths.form` du front (src/lib/paths.ts).
        return { formId: ref.id, version: doc.version, status: doc.status, url: published ? `${FRONTEND_BASE_URL}/forms/${ref.id}` : null };
      },
    };
  },
};
