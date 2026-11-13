"use client";

import { Text } from "@mantine/core";
import { useAdmin } from "@/context/AdminContext";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { ActionBar } from "@/components/admin/ActionBar";
import { FORM_KIND_LABELS, FORM_STATUS_LABELS } from "@/components/admin/formLabels";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// Formulaires du batch ; « New form » ouvre la page de creation (forms/new).
export default function AdminFormsPage() {
  const { batch, forms } = useAdmin();

  return (
    <>
      <PageHeader back={{ href: paths.admin(), label: "Admin" }} title="Forms" subtitle="Templates from Spring 2026 and 2025, or a blank form." />
      <BatchPicker />

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
      <ActionBar label="New form" href={paths.adminFormNew()} />
    </>
  );
}
