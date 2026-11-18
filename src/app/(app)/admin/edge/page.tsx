"use client";

import { Avatar, Group, Stack, Text } from "@mantine/core";
import { EDGE_MAX_NOTE, edgeStatus, type EdgeStatus } from "@shared/edge";
import { FOUNDER_PILLAR_WEIGHTS } from "@shared/types";
import { useAdminBackground, type BackgroundRow } from "@/context/AdminBackgroundContext";
import { paths } from "@/lib/paths";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { EdgeRating } from "@/components/admin/EdgeRating";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Admin > Edge : l'Edge de chaque fondateur du batch (18/11, shared/edge.ts)
// ----------------------------
// Le fondateur l'ecrit dans « Mon profil » ; le staff le note de 0 a 5, ici ou sur sa fiche.
// A noter d'abord (jamais note, ou change depuis la note), puis les notes, puis ceux qui ne l'ont
// pas encore ecrit.

export default function AdminEdgePage() {
  const { rows, isLoading } = useAdminBackground();
  if (isLoading) return <PageLoader />;

  const groups: Record<EdgeStatus, BackgroundRow[]> = { to_rate: [], rated: [], missing: [] };
  for (const r of rows) groups[edgeStatus(r.directory?.edge, r.edge)].push(r);
  const { to_rate: toRate, missing } = groups;
  const rated = groups.rated.sort((a, b) => (b.edge?.score ?? 0) - (a.edge?.score ?? 0) || a.founder.name.localeCompare(b.founder.name));

  // Une carte par fondateur : son nom, son texte et la note (a toucher).
  const card = (r: BackgroundRow) => (
    <Stack key={r.founder.id} gap="sm" className="card card-pad">
      <Group gap="sm" wrap="nowrap">
        <Avatar src={r.founder.photoUrl ?? null} name={r.founder.name} color="initials" size={40} radius="xl" />
        <Text fw={500} truncate>
          {r.founder.name}
        </Text>
      </Group>
      <EdgeRating founderId={r.founder.id} founderName={r.founder.name} text={r.directory?.edge ?? null} rating={r.edge} />
    </Stack>
  );
  const cards = (list: BackgroundRow[], empty: string) => (list.length === 0 ? <Empty>{empty}</Empty> : <Stack gap={12}>{list.map(card)}</Stack>);

  return (
    <>
      <PageHeader
        back={{ href: paths.admin(), label: "Admin" }}
        title="Edge"
        help={`Each founder writes their edge in their profile: what makes them stand out, whatever the market. Rate it from 0 to ${EDGE_MAX_NOTE}: it is ${FOUNDER_PILLAR_WEIGHTS.edge}% of the Program Performance. Staff and IC investors see the rating.`}
      />
      <BatchPicker />

      <Section title={`To rate · ${toRate.length}`} help="Never rated, or changed since the last rating.">
        {cards(toRate, "Nothing to rate.")}
      </Section>

      <Section title={`Rated · ${rated.length}`} help="Best first.">
        {cards(rated, "No edge rated yet.")}
      </Section>

      <Section title={`Not written yet · ${missing.length}`} help="The field is required in their profile: it shows in their To do.">
        {cards(missing, "Every founder has written their edge.")}
      </Section>
    </>
  );
}
