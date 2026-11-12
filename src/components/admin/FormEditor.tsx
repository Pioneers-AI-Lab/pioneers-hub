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
import { getFieldDef, parseDbField, type DbFieldKey, type DocKind } from "@shared/fieldRegistry";
import {
  FORM_FIELD_TYPE_LABELS,
  alignQuestionWithField,
  compatibleDbFields,
  deriveAttachments,
  feedsIndicator,
  formProblems,
  questionProblems,
  versionedSnapshot,
} from "@shared/formRules";
import type { Form, FormApproval, FormFieldType, FormIdentityCheck, FormKind, FormQuestion, PickerEntity, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminForm } from "@/context/AdminFormContext";
import { formatDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { archiveForm, duplicateForm, saveForm, type FormDraft } from "@/lib/formsAdmin";
import { paths } from "@/lib/paths";
import {
  APPROVAL_OPTIONS,
  FORM_KIND_LABELS,
  IDENTITY_HINTS,
  IDENTITY_OPTIONS,
  WEEKDAYS,
  parseWeeklyRule,
  weeklyRule,
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
};

const PICKER_ENTITIES: { value: PickerEntity; label: string }[] = [
  { value: "founder", label: "Founder" },
  { value: "startup", label: "Startup" },
  { value: "event", label: "Event" },
  { value: "team", label: "Team" },
  { value: "mentor", label: "Mentor" },
];

const newQuestionId = () => `q_${Math.random().toString(36).slice(2, 10)}`;

const draftOf = (form: Form): FormDraft => ({
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
  recurrenceRule: form.recurrenceRule,
});

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
  const weekly = parseWeeklyRule(draft.recurrenceRule);

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
          form.status === "open" ? "open" : form.status === "closed" ? "closed" : null,
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

      <PublicLinkSection formId={form.id} isPublished={isPublished} />

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
            description="Exercise or session feedback: the answers are tied to this event."
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
          value={draft.identityCheck}
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

      <Section title="Schedule">
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
          <Group grow gap="xs" align="flex-end">
            <Select
              label="Repeats every"
              placeholder="Never"
              clearable
              value={weekly?.day ?? null}
              onChange={(day) => set("recurrenceRule", weeklyRule(day, weekly?.time ?? "10:00"))}
              data={WEEKDAYS}
            />
            <TextInput
              label="At"
              type="time"
              disabled={!weekly}
              value={weekly?.time ?? "10:00"}
              onChange={(e) => set("recurrenceRule", weeklyRule(weekly?.day ?? null, e.currentTarget.value))}
            />
          </Group>
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
                  q.required ? "required" : null,
                  q.dbField ? `writes ${getFieldDef(q.dbField).label}` : "not linked",
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
          <ButtonRow onClick={duplicate} title="Duplicate" subtitle="A new draft with the same questions" />
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
  const [q, setQ] = useState<FormQuestion>(() => original ?? blankQuestion());
  const set = <K extends keyof FormQuestion>(key: K, value: FormQuestion[K]) => setQ((x) => ({ ...x, [key]: value }));
  const aligned = alignQuestionWithField(q);
  const problems = questionProblems(aligned);
  const fieldValue = q.dbField ? getFieldDef(q.dbField).value : null;
  const optionsFromField = fieldValue !== null && (fieldValue.kind === "enum" || fieldValue.kind === "enumMulti" || fieldValue.kind === "boolean");

  const fieldData = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const key of compatibleDbFields(q.type)) {
      const group = DOC_KIND_LABELS[parseDbField(key).doc];
      const def = getFieldDef(key);
      const items = groups.get(group) ?? [];
      items.push({ value: key, label: `${def.label}${def.indicator ? " (indicator)" : ""}` });
      groups.set(group, items);
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }, [q.type]);

  const changeType = (type: FormFieldType) =>
    setQ((x) => ({
      ...x,
      type,
      // Un champ incompatible avec le nouveau type est retire.
      dbField: x.dbField && compatibleDbFields(type).includes(x.dbField) ? x.dbField : null,
      scale: type === "rating" ? (x.scale ?? { min: 1, max: 5 }) : null,
      options: type === "single_choice" || type === "multiple_choice" ? (x.options ?? []) : null,
      picker: type === "entity_picker" ? (x.picker ?? { entity: "founder", maxItems: 1 }) : null,
    }));

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
          value={q.dbField}
          onChange={(v) => set("dbField", (v as DbFieldKey | null) ?? null)}
          data={fieldData}
          comboboxProps={{ withinPortal: true }}
        />

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

        <Button size="md" fullWidth disabled={problems.length > 0} onClick={() => onApply(q)}>
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

/** Le lien a partager (Slack) : la page publique, une question par ecran. Un brouillon s'y relit, sans prendre de reponse. */
function PublicLinkSection({ formId, isPublished }: { formId: string; isPublished: boolean }) {
  const clipboard = useClipboard({ timeout: 1500 });
  const path = paths.form(formId);
  return (
    <Section
      title="Public link"
      hint={isPublished ? "Share it on Slack. No account is needed to answer." : "Preview the form as founders will see it. Publish it to collect answers."}
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
