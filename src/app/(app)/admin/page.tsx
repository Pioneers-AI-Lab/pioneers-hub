"use client";

import { paths } from "@/lib/paths";
import { TEAM_TOOLS } from "@/components/admin/teamModes";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";

// Accueil de /admin : un outil par ligne (une ligne = un bouton plein ecran).
// Le batch se choisit dans chaque outil, pas ici.
export default function AdminHomePage() {

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
      <Section title="Tools">
        <RowList>
          <LinkRow
            href={paths.adminForms()}
            title="Forms"
            subtitle="Create, edit and publish forms, from templates"
          />
          {(["challenge", "matching"] as const).map((mode) => {
            const tool = TEAM_TOOLS[mode];
            return <LinkRow key={mode} href={tool.listHref()} title={tool.title} subtitle={tool.subtitle} />;
          })}
        </RowList>
      </Section>
    </>
  );
}
