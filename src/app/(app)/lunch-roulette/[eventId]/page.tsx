"use client";

import { useState } from "react";
import { Box, Stack, Text, TextInput } from "@mantine/core";
import type { EventTeam, WithId } from "@shared/types";
import { usePublicRoulette } from "@/context/PublicRouletteContext";
import { PROFILE_CATEGORY_LABEL, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { paths } from "@/lib/paths";
import { Empty, Section } from "@/components/ui/Section";

// Repartition publique d'une lunch roulette : on cherche son nom, on trouve
// sa table. Connecte, sa propre table est en tete, bordee de bleu.
// Chaque membre : avatar, nom, profil (comme l'annuaire du batch), dans la
// limite de ce que le visiteur peut lire (PublicRouletteContext), et un lien
// vers sa fiche. Fiche privee et visiteur sans compte : la fiche le renvoie a
// la connexion, puis le ramene (BlockedState).

/** Minuscules, sans accents : « Chloé » se trouve en tapant « chloe ». */
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

type Member = { id: string; name: string; photoUrl: string | null; context: string | null };

function useMembers() {
  const { foundersById, startupsById } = usePublicRoulette();
  return (table: WithId<EventTeam>): Member[] =>
    table.memberIds.map((id, i) => {
      const f = foundersById.get(id);
      if (!f) return { id, name: table.memberNames?.[i] ?? "Founder", photoUrl: null, context: null };
      const startup = f.startupId ? startupsById.get(f.startupId)?.name : null;
      const category = f.profileCategory ? PROFILE_CATEGORY_LABEL[f.profileCategory] : null;
      const context = [category, startup ?? f.rolesICouldTake.slice(0, 2).join(", ")].filter(Boolean).join(" · ");
      return { id, name: f.name, photoUrl: f.photoUrl, context: context || null };
    });
}

export default function PublicLunchRoulettePage() {
  const { event, tables, viewerFounderId } = usePublicRoulette();
  const membersOf = useMembers();
  const [search, setSearch] = useState("");
  const q = normalize(search);

  const mine = viewerFounderId ? (tables.find((t) => t.memberIds.includes(viewerFounderId)) ?? null) : null;
  const ordered = mine ? [mine, ...tables.filter((t) => t !== mine)] : tables;
  const matches = (m: Member) => q.length > 0 && normalize(m.name).includes(q);
  const visible = q ? ordered.filter((t) => membersOf(t).some(matches)) : ordered;
  const hasNames = tables.some((t) => membersOf(t).some((m) => m.name !== "Founder"));

  return (
    <>
      <PageHeader
        title={event.name}
        subtitle={[formatDateTime(event.startDateISOString), event.location].filter(Boolean).join(" · ")}
      />

      {tables.length === 0 ? (
        <Empty>The tables are not out yet. Come back in a moment.</Empty>
      ) : (
        <>
          {/* Sans noms (tables publiees avant la page publique), la recherche ne trouverait rien. */}
          {hasNames ? (
            <TextInput
              placeholder="Find your name"
              aria-label="Find your name"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              autoComplete="off"
            />
          ) : (
            <Text size="sm" c="dimmed">
              Names are not on this page yet. The Pioneers team adds them in a moment.
            </Text>
          )}

          <Stack gap="sm" mt="md">
            {visible.map((t) => (
              <TableCard
                key={t.id}
                table={t}
                href={(founderId) => paths.founder(event.programId, event.batchId, founderId)}
                members={membersOf(t)}
                isMine={t === mine}
                viewerFounderId={viewerFounderId}
                matches={matches}
              />
            ))}
            {q && visible.length === 0 && <Empty>No one by that name. Check the spelling, or ask the Pioneers team.</Empty>}
          </Stack>

          {!q && (
            <Section title={`${tables.length} tables · ${tables.reduce((n, t) => n + t.memberIds.length, 0)} founders`}>
              <Text size="sm" c="dimmed">
                Sit with your table, introduce yourself, and enjoy lunch.
              </Text>
            </Section>
          )}
        </>
      )}
    </>
  );
}

function TableCard({
  table,
  href,
  members,
  isMine,
  viewerFounderId,
  matches,
}: {
  table: WithId<EventTeam>;
  href: (founderId: string) => string;
  members: Member[];
  isMine: boolean;
  viewerFounderId: string | null;
  matches: (m: Member) => boolean;
}) {
  return (
    <Box
      px="md"
      pt="sm"
      pb={4}
      style={{
        borderRadius: "var(--mantine-radius-md)",
        border: isMine ? "2px solid var(--mantine-color-pioneers-filled)" : "1px solid var(--mantine-color-dark-5)",
      }}
    >
      <Text fw={700}>
        {table.name}
        {isMine && (
          <Text span c="pioneers" fw={600} size="sm" ml="xs">
            Your table
          </Text>
        )}
      </Text>
      <RowList>
        {members.map((m) => (
          <LinkRow
            key={m.id}
            href={href(m.id)}
            avatar={{ name: m.name, photoUrl: m.photoUrl }}
            title={
              <Text span inherit c={matches(m) ? "pioneers" : undefined}>
                {m.name}
                {m.id === viewerFounderId && (
                  <Text span c="dimmed" size="sm" fw={400}>
                    {" "}
                    (you)
                  </Text>
                )}
              </Text>
            }
            subtitle={m.context ?? undefined}
          />
        ))}
      </RowList>
    </Box>
  );
}
