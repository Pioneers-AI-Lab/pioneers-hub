"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { FAMILY_KEY, FAMILY_QUESTION_TYPE, familyOf, getFieldDef, isFormOnly, parseDbField, type DbFieldKey, type DocKind, type FieldFamily } from "@shared/fieldRegistry";
import {
  FORM_FIELD_TYPE_LABELS,
  alignQuestionWithField,
  compatibleDbFields,
  deriveAttachments,
  feedsIndicator,
  formProblems,
  isJuryCriterion,
  questionProblems,
  versionedSnapshot,
} from "@shared/formRules";
import { formState } from "@shared/forms";
import { EVENT_TEMPLATES } from "@shared/presets/eventTemplates";
import { EVENT_METRIC_RENAMES, STANDARD_METRICS, standardEventMetricKey } from "@shared/presets/standardMetrics";
import { keyFromLabel } from "@shared/text";
import { needsAccount, scopeOf, type Form, type FormApproval, type FormFieldType, type FormIdentityCheck, type FormKind, type FormQuestion, type PickerEntity, type QuestionScope, type WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminForm } from "@/context/AdminFormContext";
import { formatDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { archiveForm, draftOf, duplicateForm, saveForm, type FormDraft } from "@/lib/formsAdmin";
import { paths } from "@/lib/paths";
import {
  APPROVAL_OPTIONS,
  FORM_KIND_LABELS,
  IDENTITY_HINTS,
  IDENTITY_OPTIONS,
  SCOPE_LABELS,
} from "@/components/admin/formLabels";
import { FormResponses } from "@/components/admin/FormResponses";
import { PageHeader } from "@/components/ui/PageHeader";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Editeur de formulaire (SPECS §4.4)
// ----------------------------
// Le brouillon vit ici jusqu'a l'enregistrement. Garde-fous de l'historique,
// des qu'un formulaire a ete publie :
//   - une question supprimee est ARCHIVEE (les reponses passees la gardent) ;
//   - changer le type d'une question cree une nouvelle question (nouvel id) ;
//   - une question qui alimente un indicateur ne se supprime ni ne change de champ.
// Le modele standard (SPECS §2) : une question a une PORTEE (le repondant, son
// equipe, chaque coequipier, chaque equipe notee), dictee par son champ. Une
// metrique d'equipe (`submission.metrics.<cle>`) et un critere du jury
// (`evaluation.scores.<cle>`, avec son poids) gardent leur cle d'un evenement a
// l'autre : l'editeur propose celles des modeles et celles deja utilisees.

const DOC_KIND_LABELS: Record<DocKind, string> = {
  person: "Person",
  founder: "Founder",
  founderDirectory: "Founder · directory",
  founderProfile: "Founder · private",
  founderInternal: "Founder · internal",
  founderWeek: "Founder · week",
  startup: "Startup",
  startupProfile: "Startup · profile",
  startupInternal: "Startup · internal",
  checkin: "Thursday update",
  attendance: "Attendance",
  sessionRating: "Session rating",
  submission: "Team submission",
  picks: "Picks",
  peerRating: "Peer rating",
  evaluation: "Jury score",
};

/** Comment l'editeur nomme une famille (le type de question qui l'alimente : `FAMILY_QUESTION_TYPE`). */
const FAMILY_CHOICES: Record<FieldFamily, { group: string; noun: string }> = {
  "submission.metrics": { group: "Team metric (submission)", noun: "metric" },
  "evaluation.scores": { group: "Jury criterion", noun: "criterion" },
};

/** Valeur de la liste pour « nouvelle cle » d'une famille. */
const NEW_KEY = (family: FieldFamily) => `${family}.__new__`;

const PICKER_ENTITIES: { value: PickerEntity; label: string }[] = [
  { value: "founder", label: "Founder" },
  { value: "startup", label: "Startup" },
  { value: "event", label: "Event" },
  { value: "team", label: "Team" },
  { value: "mentor", label: "Mentor" },
];

const newQuestionId = () => `q_${Math.random().toString(36).slice(2, 10)}`;

const blankQuestion = (): FormQuestion => ({
  id: newQuestionId(),
  type: "text",
  label: "",
  description: null,
  required: false,
  options: null,
  scale: null,
  picker: null,
  dbField: null,
  requiresApproval: null,
  archived: false,
  scope: "self",
  weight: null,
});

export function FormEditor() {
  const { form } = useAdminForm();
  // Remonte a chaque enregistrement (ou modification distante) : le brouillon repart de la base.
  return <Editor key={form.updatedDateISOString} form={form} />;
}

function Editor({ form }: { form: WithId<Form> }) {
  const router = useRouter();
  const { events } = useAdmin();
  const [draft, setDraft] = useState<FormDraft>(() => draftOf(form));
  const [editing, setEditing] = useState<{ original: FormQuestion | null; index: number } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const isPublished = form.version > 0;
  const savedById = useMemo(() => new Map(form.questions.map((q) => [q.id, q])), [form.questions]);
  /** Publiee = presente dans une version figee : elle a pu recevoir des reponses. */
  const isPublishedQuestion = (q: FormQuestion) => isPublished && savedById.has(q.id);
  const isIndicatorLocked = (q: FormQuestion) => {
    const saved = savedById.get(q.id);
    return isPublished && saved !== undefined && feedsIndicator(saved);
  };

  const attachments = deriveAttachments(draft.questions, form.attachments);
  const next = { ...form, ...draft, attachments };
  const problems = formProblems(next);
  const isDirty = JSON.stringify(draftOf(form)) !== JSON.stringify(draft);
  const willBumpVersion = isPublished && versionedSnapshot(next) !== versionedSnapshot(form);
  const active = draft.questions.map((q, index) => ({ q, index })).filter(({ q }) => !q.archived);
  const archivedCount = draft.questions.length - active.length;

  const save = async (publish: boolean) => {
    setIsSaving(true);
    try {
      const version = await saveForm(form, draft, { publish });
      notifications.show({
        message: publish ? "Form published and open" : version !== form.version ? `Saved as version ${version}` : "Form saved",
      });
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  const applyQuestion = (original: FormQuestion | null, edited: FormQuestion) => {
    const aligned = alignQuestionWithField(edited);
    setDraft((d) => {
      if (!original) return { ...d, questions: [...d.questions, aligned] };
      // Type change d'une question publiee : l'ancienne est archivee, la nouvelle a un nouvel id.
      if (isPublishedQuestion(original) && original.type !== aligned.type) {
        return {
          ...d,
          questions: [
            ...d.questions.map((q) => (q.id === original.id ? { ...q, archived: true } : q)),
            { ...aligned, id: newQuestionId() },
          ],
        };
      }
      return { ...d, questions: d.questions.map((q) => (q.id === original.id ? aligned : q)) };
    });
    setEditing(null);
  };

  const removeQuestion = (original: FormQuestion) => {
    setDraft((d) => ({
      ...d,
      questions: isPublishedQuestion(original)
        ? d.questions.map((q) => (q.id === original.id ? { ...q, archived: true } : q))
        : d.questions.filter((q) => q.id !== original.id),
    }));
    setEditing(null);
  };

  /** Deplace parmi les questions actives (les archivees gardent leur place). */
  const moveQuestion = (id: string, delta: -1 | 1) => {
    setDraft((d) => {
      const list = [...d.questions];
      const from = list.findIndex((q) => q.id === id);
      let to = from + delta;
      while (to >= 0 && to < list.length && list[to].archived) to += delta;
      if (from < 0 || to < 0 || to >= list.length) return d;
      [list[from], list[to]] = [list[to], list[from]];
      return { ...d, questions: list };
    });
  };

  const duplicate = async () => {
    try {
      const id = await duplicateForm(form);
      router.push(paths.adminForm(id));
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    }
  };

  const archive = async () => {
    try {
      await archiveForm(form);
      router.push(paths.adminForms());
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
    }
  };

  return (
    <>
      <PageHeader
        back={{ href: paths.adminForms(), label: "Forms" }}
        title={draft.title || "Untitled form"}
        subtitle={[
          FORM_KIND_LABELS[form.kind],
          isPublished ? `version ${form.version}` : "draft, never published",
          // L'etat du lien, pas seulement le statut : publie mais pas encore ouvert = programme.
          formState(form, new Date().toISOString()) === "not_open_yet" && form.opensDateISOString
            ? `scheduled, opens ${formatDateTime(form.opensDateISOString)}`
            : form.status === "open"
              ? "open"
              : form.status === "closed"
                ? "closed"
                : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      {isPublished && (
        <Section title="Status" hint="A closed form no longer accepts answers.">
          <SegmentedControl
            fullWidth
            value={draft.status === "draft" ? "open" : draft.status}
            onChange={(v) => set("status", v as Form["status"])}
            data={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ]}
          />
        </Section>
      )}

      {form.identityCheck === "jury_link" ? (
        <Section title="Jury link" hint="The jury link carries a secret: copy it, or make a new one, from the event's page (Admin > Challenge teams).">
          <Empty>Scores are locked by closing this form.</Empty>
        </Section>
      ) : (
        <PublicLinkSection formId={form.id} isPublished={isPublished} needsAccount={needsAccount(form.identityCheck)} />
      )}

      {isPublished && <FormResponses />}

      <Section title="Form">
        <Stack>
          <TextInput label="Title" value={draft.title} onChange={(e) => set("title", e.currentTarget.value)} />
          <Textarea
            label="Description"
            autosize
            minRows={2}
            value={draft.description ?? ""}
            onChange={(e) => set("description", e.currentTarget.value || null)}
          />
          <Select
            label="Type"
            allowDeselect={false}
            value={draft.kind}
            onChange={(v) => v && set("kind", v as FormKind)}
            data={Object.entries(FORM_KIND_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Select
            label="Event"
            description="Submission, peer rating, jury, picks, retro or feedback: the answers are tied to this event, its teams and its teams scored."
            clearable
            searchable
            value={draft.eventId}
            onChange={(v) => set("eventId", v)}
            data={events.map((e) => ({ value: e.id, label: `${e.name} · ${formatDateTime(e.startDateISOString)}` }))}
          />
        </Stack>
      </Section>

      <Section title="Respondent" hint={IDENTITY_HINTS[draft.identityCheck]}>
        <SegmentedControl
          fullWidth
          value={draft.identityCheck === "email_code" ? "account" : draft.identityCheck}
          onChange={(v) => set("identityCheck", v as FormIdentityCheck)}
          data={IDENTITY_OPTIONS}
        />
      </Section>

      <Section title="Database writes" hint="Questions linked to a field write their answer into the founder or startup record.">
        <Select
          allowDeselect={false}
          value={draft.approval}
          onChange={(v) => v && set("approval", v as FormApproval)}
          data={APPROVAL_OPTIONS}
        />
      </Section>

      <Section
        title="Schedule"
        hint="One form per occurrence. A weekly form writes to the week it opens: for next week, duplicate it."
      >
        <Stack>
          <TextInput
            label="Opens"
            type="datetime-local"
            value={toLocalInput(draft.opensDateISOString)}
            onChange={(e) => set("opensDateISOString", fromLocalInput(e.currentTarget.value))}
          />
          <TextInput
            label="Deadline"
            type="datetime-local"
            value={toLocalInput(draft.deadlineDateISOString)}
            onChange={(e) => set("deadlineDateISOString", fromLocalInput(e.currentTarget.value))}
          />
        </Stack>
      </Section>

      <Section
        title={`Questions · ${active.length}`}
        hint={archivedCount > 0 ? `${archivedCount} archived ${archivedCount === 1 ? "question is" : "questions are"} kept for past answers.` : undefined}
        right={
          <Button variant="subtle" size="compact-sm" onClick={() => setEditing({ original: null, index: draft.questions.length })}>
            Add question
          </Button>
        }
      >
        {active.length === 0 ? (
          <Empty>No question yet.</Empty>
        ) : (
          <RowList>
            {active.map(({ q }, i) => (
              <ButtonRow
                key={q.id}
                onClick={() => setEditing({ original: q, index: i })}
                title={`${i + 1}. ${q.label || "Untitled question"}`}
                subtitle={[
                  FORM_FIELD_TYPE_LABELS[q.type],
                  scopeOf(q) !== "self" ? SCOPE_LABELS[scopeOf(q)].toLowerCase() : null,
                  q.required ? "required" : null,
                  q.dbField ? `writes ${fieldName(q)}` : "not linked",
                  q.weight ? `weight ${q.weight}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                meta={
                  questionProblems(q).length > 0 ? (
                    <Text size="sm" c="red.4" fw={600}>
                      Fix
                    </Text>
                  ) : undefined
                }
              />
            ))}
          </RowList>
        )}
      </Section>

      <Section title="Actions">
        <RowList>
          <ButtonRow
            onClick={duplicate}
            title="Duplicate"
            subtitle={
              form.attachments.week
                ? "Next week's draft: same questions, dates moved by a week"
                : "A new draft with the same questions, without dates"
            }
          />
          <ButtonRow onClick={() => setConfirmArchive(true)} title="Archive" subtitle="Closes the form and hides it from the lists" />
        </RowList>
      </Section>

      <Box className="savebar">
        {problems.length > 0 && (
          <Text size="sm" c="red.4" mb={6}>
            {problems[0]}
          </Text>
        )}
        {isPublished ? (
          <Button size="md" fullWidth disabled={!isDirty || problems.length > 0} loading={isSaving} onClick={() => save(false)}>
            {!isDirty ? "No changes" : willBumpVersion ? `Publish changes as version ${form.version + 1}` : "Save"}
          </Button>
        ) : (
          <Group grow gap="xs">
            <Button size="md" variant="default" disabled={!isDirty} loading={isSaving} onClick={() => save(false)}>
              {isDirty ? "Save draft" : "Saved"}
            </Button>
            <Button size="md" disabled={problems.length > 0 || active.length === 0 || isSaving} onClick={() => save(true)}>
              Publish
            </Button>
          </Group>
        )}
        {!isPublished && (
          <Text size="xs" c="dimmed" ta="center" mt={6}>
            Publishing opens the public link and lists the form in the founders&apos; To do.
          </Text>
        )}
      </Box>

      {editing && (
        <QuestionModal
          key={editing.original?.id ?? "new"}
          original={editing.original}
          isPublished={editing.original ? isPublishedQuestion(editing.original) : false}
          isIndicatorLocked={editing.original ? isIndicatorLocked(editing.original) : false}
          onClose={() => setEditing(null)}
          onApply={(edited) => applyQuestion(editing.original, edited)}
          onRemove={() => editing.original && removeQuestion(editing.original)}
          onMove={(delta) => editing.original && moveQuestion(editing.original.id, delta)}
        />
      )}

      <Modal opened={confirmArchive} onClose={() => setConfirmArchive(false)} title="Archive this form?" centered>
        <Stack>
          <Text size="sm">The form closes and leaves the lists. Its answers and versions are kept.</Text>
          <Button size="md" color="red" fullWidth onClick={archive}>
            Archive
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

// ---- Une question -------------------------------------------------------------------

function QuestionModal({
  original,
  isPublished,
  isIndicatorLocked,
  onClose,
  onApply,
  onRemove,
  onMove,
}: {
  original: FormQuestion | null;
  isPublished: boolean;
  isIndicatorLocked: boolean;
  onClose: () => void;
  onApply: (q: FormQuestion) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const { forms } = useAdmin();
  const [q, setQ] = useState<FormQuestion>(() => original ?? blankQuestion());
  // Une nouvelle cle de famille, en cours de saisie (`null` : une cle existante, ou un autre champ).
  const [newFamily, setNewFamily] = useState<{ family: FieldFamily; key: string } | null>(null);
  const set = <K extends keyof FormQuestion>(key: K, value: FormQuestion[K]) => setQ((x) => ({ ...x, [key]: value }));
  // Une cle invalide n'est pas encore un champ : la question reste sans champ tant qu'elle ne l'est pas.
  const badKey = newFamily !== null && !FAMILY_KEY.test(newFamily.key);
  const withKey = newFamily && !badKey ? { ...q, dbField: `${newFamily.family}.${newFamily.key}` as DbFieldKey } : q;
  const aligned = alignQuestionWithField(withKey);
  const problems = [...(badKey ? ["A key is a word in camelCase starting with a letter, e.g. callsMade."] : []), ...questionProblems(aligned)];
  const fieldValue = q.dbField ? getFieldDef(q.dbField).value : null;
  const optionsFromField = fieldValue !== null && (fieldValue.kind === "enum" || fieldValue.kind === "enumMulti" || fieldValue.kind === "boolean");

  // Les cles connues de chaque famille : le dictionnaire standard, celles des modeles
  // d'evenements, puis celles des formulaires du batch (sauf une ancienne cle renommee).
  const known = useMemo(() => {
    const out: Record<FieldFamily, Map<string, string>> = { "submission.metrics": new Map(), "evaluation.scores": new Map() };
    for (const [key, m] of Object.entries(STANDARD_METRICS)) out["submission.metrics"].set(key, m.label);
    for (const t of Object.values(EVENT_TEMPLATES)) {
      for (const m of t.metrics) out["submission.metrics"].set(m.key, m.label);
      for (const c of t.criteria) out["evaluation.scores"].set(c.key, c.label);
    }
    for (const f of forms) {
      for (const x of f.questions) {
        const family = x.dbField ? familyOf(x.dbField) : null;
        const legacy = family?.family === "submission.metrics" && family.key in EVENT_METRIC_RENAMES;
        if (family && !legacy && !out[family.family].has(family.key)) out[family.family].set(family.key, x.label);
      }
    }
    return out;
  }, [forms]);

  const fieldData = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const key of compatibleDbFields(q.type)) {
      const group = DOC_KIND_LABELS[parseDbField(key).doc];
      const def = getFieldDef(key);
      const items = groups.get(group) ?? [];
      items.push({ value: key, label: `${def.label}${def.indicator ? " (indicator)" : ""}${isFormOnly(parseDbField(key).doc) ? " (private)" : ""}` });
      groups.set(group, items);
    }
    const ownFamily = q.dbField ? familyOf(q.dbField) : null;
    for (const family of Object.keys(FAMILY_CHOICES) as FieldFamily[]) {
      const choice = FAMILY_CHOICES[family];
      if (FAMILY_QUESTION_TYPE[family] !== q.type) continue;
      const items = [...known[family]].map(([key, label]) => ({ value: `${family}.${key}`, label: `${label} (${key})` }));
      // La cle de la question, si elle n'est pas encore connue (ajoutee dans cette fenetre).
      const current = ownFamily?.family === family ? ownFamily.key : null;
      if (current && !known[family].has(current)) items.unshift({ value: q.dbField!, label: `${q.label || current} (${current})` });
      items.push({ value: NEW_KEY(family), label: `New ${choice.noun}...` });
      groups.set(choice.group, items);
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }, [q.type, q.dbField, q.label, known]);

  const chooseField = (value: string | null) => {
    const family = (Object.keys(FAMILY_CHOICES) as FieldFamily[]).find((f) => value === NEW_KEY(f));
    if (family) {
      const key = keyFromLabel(q.label || FAMILY_CHOICES[family].noun);
      // « Cold calls » -> `callsMade` : une metrique deja connue sous une autre cle prend la cle standard.
      setNewFamily({ family, key: family === "submission.metrics" ? standardEventMetricKey(key) : key });
      return;
    }
    setNewFamily(null);
    set("dbField", (value as DbFieldKey | null) ?? null);
  };

  const changeType = (type: FormFieldType) =>
    setQ((x) => {
      const family = x.dbField ? familyOf(x.dbField) : null;
      return {
      ...x,
      type,
      // Un champ incompatible avec le nouveau type est retire.
      dbField: x.dbField && (family ? FAMILY_QUESTION_TYPE[family.family] === type : compatibleDbFields(type).includes(x.dbField)) ? x.dbField : null,
      scale: type === "rating" ? (x.scale ?? { min: 1, max: 5 }) : null,
      options: type === "single_choice" || type === "multiple_choice" ? (x.options ?? []) : null,
      picker: type === "entity_picker" ? (x.picker ?? { entity: "founder", maxItems: 1 }) : null,
      };
    });

  return (
    <Modal opened onClose={onClose} title={original ? "Edit question" : "New question"} size="lg" centered>
      <Stack>
        <Select
          label="Answer type"
          allowDeselect={false}
          disabled={isIndicatorLocked}
          value={q.type}
          onChange={(v) => v && changeType(v as FormFieldType)}
          data={Object.entries(FORM_FIELD_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          description={isPublished && !isIndicatorLocked ? "Changing the type of a published question archives it and creates a new one." : undefined}
        />
        <TextInput label="Question" value={q.label} onChange={(e) => set("label", e.currentTarget.value)} />
        <Textarea
          label="Help text"
          autosize
          minRows={1}
          value={q.description ?? ""}
          onChange={(e) => set("description", e.currentTarget.value || null)}
        />
        <Switch label="Required" checked={q.required} onChange={(e) => set("required", e.currentTarget.checked)} />

        {(q.type === "single_choice" || q.type === "multiple_choice") &&
          (optionsFromField ? (
            <Text size="sm" c="dimmed">
              Options come from the linked field{aligned.options ? `: ${aligned.options.join(", ")}` : " (closed list)"}.
            </Text>
          ) : (
            <TagsInput label="Options" placeholder="Type and press Enter" value={q.options ?? []} onChange={(v) => set("options", v)} />
          ))}

        {q.type === "rating" && (
          <Group grow gap="xs">
            <NumberInput
              label="From"
              disabled={fieldValue?.kind === "rating"}
              value={aligned.scale?.min ?? 1}
              onChange={(v) => set("scale", { min: Number(v), max: q.scale?.max ?? 5 })}
            />
            <NumberInput
              label="To"
              disabled={fieldValue?.kind === "rating"}
              value={aligned.scale?.max ?? 5}
              onChange={(v) => set("scale", { min: q.scale?.min ?? 1, max: Number(v) })}
            />
          </Group>
        )}

        {q.type === "entity_picker" && (
          <Group grow gap="xs">
            <Select
              label="Pick a"
              allowDeselect={false}
              disabled={fieldValue?.kind === "founderRefs"}
              value={aligned.picker?.entity ?? "founder"}
              onChange={(v) => v && set("picker", { entity: v as PickerEntity, maxItems: q.picker?.maxItems ?? 1 })}
              data={PICKER_ENTITIES}
            />
            <NumberInput
              label="At most"
              min={1}
              value={q.picker?.maxItems ?? 1}
              onChange={(v) => set("picker", { entity: q.picker?.entity ?? "founder", maxItems: Math.max(1, Number(v)) })}
            />
          </Group>
        )}

        <Select
          label="Database field"
          description={
            isIndicatorLocked
              ? "This question feeds an indicator (curves, scores): its field cannot change."
              : "Where the answer is written. Leave empty to keep it as a free answer, analysed by Claude."
          }
          placeholder="Not linked"
          clearable
          searchable
          disabled={isIndicatorLocked}
          value={newFamily ? NEW_KEY(newFamily.family) : q.dbField}
          onChange={chooseField}
          data={fieldData}
          comboboxProps={{ withinPortal: true }}
        />

        {newFamily && (
          <TextInput
            label={`Key of the new ${FAMILY_CHOICES[newFamily.family].noun}`}
            description="Stable across events, to compare them: reuse the same key for the same number. camelCase, e.g. callsMade."
            value={newFamily.key}
            onChange={(e) => setNewFamily({ ...newFamily, key: e.currentTarget.value.trim() })}
          />
        )}

        {aligned.dbField ? (
          scopeOf(aligned) !== "self" && (
            <Text size="sm" c="dimmed">
              Asked for: {SCOPE_LABELS[scopeOf(aligned)].toLowerCase()} (set by the field).
            </Text>
          )
        ) : (
          <Select
            label="Asked for"
            description="A question about each teammate or each team scored is repeated for every one of them."
            allowDeselect={false}
            value={scopeOf(q)}
            onChange={(v) => v && set("scope", v as QuestionScope)}
            data={(Object.keys(SCOPE_LABELS) as QuestionScope[]).map((value) => ({ value, label: SCOPE_LABELS[value] }))}
          />
        )}

        {isJuryCriterion(aligned) && (
          <NumberInput
            label="Weight"
            description="In the jury's weighted average (the IC grid is 40 / 40 / 20)."
            min={0}
            value={q.weight ?? 1}
            onChange={(v) => set("weight", typeof v === "number" && v > 0 ? v : null)}
          />
        )}

        {q.dbField && (
          <Select
            label="Approval for this question"
            allowDeselect={false}
            value={q.requiresApproval === null ? "form" : q.requiresApproval ? "always" : "never"}
            onChange={(v) => set("requiresApproval", v === "form" ? null : v === "always")}
            data={[
              { value: "form", label: "Use the form setting" },
              { value: "always", label: "Always approve before writing" },
              { value: "never", label: "Never ask for approval" },
            ]}
          />
        )}

        {problems.map((p) => (
          <Text key={p} size="sm" c="red.4">
            {p}
          </Text>
        ))}

        <Button size="md" fullWidth disabled={problems.length > 0} onClick={() => onApply(withKey)}>
          {original ? "Apply" : "Add question"}
        </Button>
        {original && (
          <Group grow gap="xs">
            <Button variant="default" onClick={() => onMove(-1)}>
              Move up
            </Button>
            <Button variant="default" onClick={() => onMove(1)}>
              Move down
            </Button>
            <Button variant="default" color="red" disabled={isIndicatorLocked} onClick={onRemove}>
              {isPublished ? "Archive" : "Delete"}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}

/** Le champ d'une question, tel que l'editeur le nomme : « Team metric callsMade ». */
function fieldName(q: FormQuestion): string {
  const family = q.dbField ? familyOf(q.dbField) : null;
  if (family) return `${FAMILY_CHOICES[family.family].noun} ${family.key}`;
  return q.dbField ? getFieldDef(q.dbField).label : "";
}

/** Le lien a partager (Slack) : la page publique, une question par ecran. Un brouillon s'y relit, sans prendre de reponse. */
function PublicLinkSection({ formId, isPublished, needsAccount }: { formId: string; isPublished: boolean; needsAccount: boolean }) {
  const clipboard = useClipboard({ timeout: 1500 });
  const path = paths.form(formId);
  return (
    <Section
      title="Public link"
      hint={
        !isPublished
          ? "Preview the form as founders will see it. Publish it to collect answers."
          : needsAccount
            ? "Share it on Slack. Founders sign in with their Pioneers account to answer."
            : "Share it on Slack. No account is needed to answer."
      }
    >
      <Group gap="sm">
        {isPublished && (
          <Button size="md" onClick={() => clipboard.copy(`${window.location.origin}${path}`)}>
            {clipboard.copied ? "Copied" : "Copy link"}
          </Button>
        )}
        <Button component="a" href={path} target="_blank" rel="noreferrer" variant="default" size="md">
          {isPublished ? "Open" : "Preview"}
        </Button>
      </Group>
    </Section>
  );
}
