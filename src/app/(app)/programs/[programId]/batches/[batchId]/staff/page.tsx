"use client";

import { Text } from "@mantine/core";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useStaff } from "@/context/StaffContext";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";
import { StatGrid, StatTile } from "@/components/ui/StatTile";

export default function StaffHomePage() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founders } = useFounders();
  const { claimRequests } = useStaff();
  const pending = claimRequests.filter((r) => r.status === "pending").length;
  const linked = founders.filter((f) => f.uid).length;

  return (
    <>
      <PageHeader title="Staff" subtitle={`Tools for ${batch.name}`} />
      <StatGrid>
        <StatTile label="Founders" value={founders.length} />
        <StatTile label="Accounts linked" value={`${linked}/${founders.length}`} />
      </StatGrid>
      <Section title="Tools">
        <RowList>
          <LinkRow
            href={paths.staffAccess(program.id, batch.id)}
            title="Access"
            subtitle="Account links, requests, team roles"
            meta={pending > 0 ? <Text size="sm" c="pioneers" fw={600} className="num">{pending} pending</Text> : undefined}
          />
          <LinkRow href={paths.staffImport(program.id, batch.id)} title="Import founders" subtitle="From the onboarding CSV" />
          <LinkRow href={paths.staffSettings(program.id, batch.id)} title="Batch settings" subtitle="Status, milestones, leaderboard" />
        </RowList>
      </Section>
    </>
  );
}
