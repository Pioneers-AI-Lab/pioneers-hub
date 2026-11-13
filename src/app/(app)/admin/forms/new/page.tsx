"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select, Stack } from "@mantine/core";
import { templateContext } from "@shared/forms";
import { FORM_TEMPLATES, templateQuestions, type FormTemplateKey } from "@shared/presets/formTemplates";
import { useAdmin } from "@/context/AdminContext";
import { useAction } from "@/hooks/useAction";
import { formatDateTime } from "@/lib/format";
import { createForm } from "@/lib/formsAdmin";
import { paths } from "@/lib/paths";
import { ActionBar } from "@/components/admin/ActionBar";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";

const BLANK = "blank";

// Admin > Forms > nouveau formulaire : un modele (SPECS §4.4) ou une page
// blanche, cree en brouillon ; on arrive ensuite sur son editeur.
export default function NewFormPage() {
  const router = useRouter();
  const { batch, events, eventsById } = useAdmin();
  const { isBusy, run } = useAction();
  const [templateKey, setTemplateKey] = useState<string>("weekly_update");
  const [eventId, setEventId] = useState<string | null>(null);
  const template = templateKey === BLANK ? null : FORM_TEMPLATES[templateKey as FormTemplateKey];
  // Le Debrief, le jury et les picks construisent leurs questions depuis l'evenement (metriques et grille de son modele).
  const event = eventId ? (eventsById.get(eventId) ?? null) : null;
  const countOf = (key: FormTemplateKey) => {
    const n = templateQuestions(FORM_TEMPLATES[key], templateContext({ event: key === templateKey ? event : null })).length;
    return `${n} ${n === 1 ? "question" : "questions"}`;
  };

  const submit = async () => {
    const id = await run(
      () =>
        createForm({
          programId: batch.programId,
          batchId: batch.id,
          templateKey: template ? (templateKey as FormTemplateKey) : null,
          eventId,
          event,
        }),
      "Draft created",
    );
    if (id) router.replace(paths.adminForm(id));
  };

  return (
    <>
      <PageHeader
        back={{ href: paths.adminForms(), label: "Forms" }}
        title="New form"
        subtitle={`Created as a draft in ${batch.name}. Nothing is sent until you publish it.`}
      />
      <BatchPicker />
      <Section title="Start from">
        <Stack>
          <Select
            label="Template"
            allowDeselect={false}
            value={templateKey}
            onChange={(v) => v && setTemplateKey(v)}
            data={[
              ...(Object.entries(FORM_TEMPLATES) as [FormTemplateKey, (typeof FORM_TEMPLATES)[FormTemplateKey]][]).map(([key, t]) => ({
                value: key,
                label: `${t.label} · ${t.build && !(key === templateKey && event) ? "questions from its event" : countOf(key)}`,
              })),
              { value: BLANK, label: "Blank form" },
            ]}
          />
          {template?.needsEvent && (
            <Select
              label="Event"
              description="The form is tied to this event: a submission or a jury takes its metrics or its scoring grid from the event's model."
              clearable
              searchable
              value={eventId}
              onChange={setEventId}
              data={events.map((e) => ({ value: e.id, label: `${e.name} · ${formatDateTime(e.startDateISOString)}` }))}
            />
          )}
        </Stack>
      </Section>
      <ActionBar label="Create and edit" loading={isBusy} onClick={submit} />
    </>
  );
}
