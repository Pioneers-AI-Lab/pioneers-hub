"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { FORM_TEMPLATES, type FormTemplateKey } from "@shared/presets/formTemplates";
import { useAdmin } from "@/context/AdminContext";
import { formatDateTime } from "@/lib/format";
import { createForm } from "@/lib/formsAdmin";
import { paths } from "@/lib/paths";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { FORM_KIND_LABELS, FORM_STATUS_LABELS } from "@/components/admin/formLabels";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

const BLANK = "blank";

// Formulaires du batch : creation depuis un modele (SPECS §4.4), puis la liste.
export default function AdminFormsPage() {
  const router = useRouter();
  const { batch, forms, events } = useAdmin();
  const [templateKey, setTemplateKey] = useState<string>("weekly_update");
  const [eventId, setEventId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const template = templateKey === BLANK ? null : FORM_TEMPLATES[templateKey as FormTemplateKey];

  const submit = async () => {
    setIsSaving(true);
    try {
      const id = await createForm({
        programId: batch.programId,
        batchId: batch.id,
        templateKey: templateKey === BLANK ? null : (templateKey as FormTemplateKey),
        eventId,
      });
      router.push(paths.adminForm(id));
    } catch (err) {
      notifications.show({ color: "red", message: (err as Error).message });
      setIsSaving(false);
    }
  };

  return (
    <>
      <PageHeader back={{ href: paths.admin(), label: "Admin" }} title="Forms" subtitle="Templates from Spring 2026 and 2025, or a blank form." />
      <BatchPicker />

      <Section title="New form" hint={`Created as a draft in ${batch.name}. Nothing is sent until you publish it.`}>
        <Stack>
          <Select
            label="Template"
            allowDeselect={false}
            value={templateKey}
            onChange={(v) => v && setTemplateKey(v)}
            data={[
              ...Object.entries(FORM_TEMPLATES).map(([key, t]) => ({ value: key, label: `${t.label} · ${t.questions.length} questions` })),
              { value: BLANK, label: "Blank form" },
            ]}
          />
          {template?.needsEvent && (
            <Select
              label="Event"
              description="The feedback is tied to this event."
              clearable
              searchable
              value={eventId}
              onChange={setEventId}
              data={events.map((e) => ({ value: e.id, label: `${e.name} · ${formatDateTime(e.startDateISOString)}` }))}
            />
          )}
          <Button size="md" fullWidth loading={isSaving} onClick={submit}>
            Create and edit
          </Button>
        </Stack>
      </Section>

      <Section title={`Forms · ${forms.length}`}>
        {forms.length === 0 ? (
          <Empty>No form in {batch.name} yet.</Empty>
        ) : (
          <RowList>
            {forms.map((f) => (
              <LinkRow
                key={f.id}
                href={paths.adminForm(f.id)}
                title={f.title}
                subtitle={[
                  FORM_KIND_LABELS[f.kind],
                  f.version > 0 ? `v${f.version}` : null,
                  `${f.questions.filter((q) => !q.archived).length} questions`,
                  f.deadlineDateISOString ? `due ${formatDateTime(f.deadlineDateISOString)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                meta={
                  <Text size="sm" fw={600} c={f.status === "open" ? "pioneers" : "dimmed"}>
                    {FORM_STATUS_LABELS[f.status]}
                  </Text>
                }
              />
            ))}
          </RowList>
        )}
      </Section>
    </>
  );
}
