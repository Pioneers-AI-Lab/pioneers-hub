"use client";

import { Text } from "@mantine/core";
import { useAdmin } from "@/context/AdminContext";
import { paths } from "@/lib/paths";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { TEAM_TOOLS } from "@/components/admin/teamModes";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";

// Accueil de /admin : un outil par ligne (une ligne = un bouton plein ecran).
export default function AdminHomePage() {
  const { batch, forms, events } = useAdmin();
  const openForms = forms.filter((f) => f.status === "open").length;
  const count = (kind: string) => events.filter((e) => e.kind === kind).length;

  return (
    <>
      <PageHeader title="Admin" subtitle="Staff tools. Only the Pioneers team sees this space." />
      <Section title="Platform">
        <RowList>
          <LinkRow
            href={paths.adminAccess()}
            title="Access"
            subtitle="Every account: invite, change roles, remove access, block sign-in"
          />
        </RowList>
      </Section>
      <BatchPicker />
      <Section title={`Tools · ${batch.name}`}>
        <RowList>
          <LinkRow
            href={paths.adminForms()}
            title="Forms"
            subtitle="Create, edit and publish forms, from templates"
            meta={openForms > 0 ? <Text size="sm" c="pioneers" fw={600} className="num">{openForms} open</Text> : undefined}
          />
          {(["challenge", "matching"] as const).map((mode) => {
            const tool = TEAM_TOOLS[mode];
            const n = count(tool.kind);
            return (
              <LinkRow
                key={mode}
                href={tool.listHref()}
                title={tool.title}
                subtitle={tool.subtitle}
                meta={n > 0 ? <Text size="sm" c="dimmed" className="num">{n}</Text> : undefined}
              />
            );
          })}
        </RowList>
      </Section>
    </>
  );
}
