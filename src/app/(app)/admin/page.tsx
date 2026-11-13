"use client";

import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";

// Accueil de /admin : TOUS les outils du staff, un par ligne (une ligne = un
// bouton plein ecran). Le batch se choisit dans chaque outil, pas ici.
export default function AdminHomePage() {
  return (
    <>
      <PageHeader title="Admin" subtitle="Staff tools. Only the Pioneers team sees this space." />
      <Section title="Accounts">
        <RowList>
          <LinkRow
            href={paths.adminAccess()}
            title="Access"
            subtitle="Every account: invite, change roles, remove access, block sign-in"
          />
          <LinkRow
            href={paths.adminProfiles()}
            title="Founder profiles"
            subtitle="The account linked to each founder profile: link, unlink"
          />
        </RowList>
      </Section>
      <Section title="Batch">
        <RowList>
          <LinkRow
            href={paths.adminEvents()}
            title="Events"
            subtitle="Create events from a template (event, matching, forms), set them up, draw teams and tables"
          />
          <LinkRow href={paths.adminForms()} title="Forms" subtitle="Create, edit and publish forms, from templates" />
          <LinkRow href={paths.adminImport()} title="Import founders" subtitle="From the onboarding CSV" />
          <LinkRow href={paths.adminBatchSettings()} title="Batch settings" subtitle="Status, milestones, leaderboard, Slack; new program or batch" />
        </RowList>
      </Section>
    </>
  );
}
