"use client";

import { useState } from "react";
import { Box, Stack, Text, TextInput } from "@mantine/core";
import { leaderIdOf } from "@shared/teamGenerator";
import type { EventTeam, WithId } from "@shared/types";
import { usePublicTeams } from "@/context/PublicTeamsContext";
import { PROFILE_CATEGORY_LABEL, formatDateTime, searchKey } from "@/lib/format";
import { TEAM_LABELS } from "@/components/event/teamLabels";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { paths } from "@/lib/paths";
import { Empty, Section } from "@/components/ui/Section";

// Repartition publique des groupes d'un evenement (tables d'une lunch roulette,
// equipes d'un challenge) : on cherche son nom, on trouve son groupe. Connecte,
// son propre groupe est en tete, borde de bleu. Le leader de chaque groupe est
// marque « (leader) », son role rappele en tete de la liste.
// Chaque membre : avatar, nom, profil (comme l'annuaire du batch), dans la
// limite de ce que le visiteur peut lire (PublicTeamsContext), et un lien
// vers sa fiche. Fiche privee et visiteur sans compte : la fiche le renvoie a
// la connexion, puis le ramene (BlockedState).

type Member = { id: string; name: string; photoUrl: string | null; context: string | null };

function useMembers() {
  const { foundersById, startupsById } = usePublicTeams();
  return (group: WithId<EventTeam>): Member[] =>
    group.memberIds.map((id, i) => {
      const f = foundersById.get(id);
      if (!f) return { id, name: group.memberNames?.[i] ?? "Founder", photoUrl: null, context: null };
      const startup = f.startupId ? startupsById.get(f.startupId)?.name : null;
      const category = f.profileCategory ? PROFILE_CATEGORY_LABEL[f.profileCategory] : null;
      const context = [category, startup ?? f.rolesICouldTake.slice(0, 2).join(", ")].filter(Boolean).join(" · ");
      return { id, name: f.name, photoUrl: f.photoUrl, context: context || null };
    });
}

export function PublicTeamsPage() {
  // Fondateur du batch, staff ou investor : retour a la page de l'evenement (sans compte, pas de batch a ouvrir).
  const { event, mode, groups, viewerFounderId, canOpenEvent } = usePublicTeams();
  const tool = TEAM_LABELS[mode];
  const membersOf = useMembers();
  const [search, setSearch] = useState("");
  const q = searchKey(search);

  const mine = viewerFounderId ? (groups.find((t) => t.memberIds.includes(viewerFounderId)) ?? null) : null;
  const ordered = mine ? [mine, ...groups.filter((t) => t !== mine)] : groups;
  const matches = (m: Member) => q.length > 0 && searchKey(m.name).includes(q);
  const visible = q ? ordered.filter((t) => membersOf(t).some(matches)) : ordered;
  const hasNames = groups.some((t) => membersOf(t).some((m) => m.name !== "Founder"));
  const hasLeaders = groups.some((t) => leaderIdOf(t) !== null);

  return (
    <>
      <PageHeader
        back={canOpenEvent ? { href: paths.event(event.programId, event.batchId, event.id), label: event.name } : undefined}
        title={event.name}
        subtitle={[formatDateTime(event.startDateISOString), event.location].filter(Boolean).join(" · ")}
      />

      {groups.length === 0 ? (
        <Empty>The {tool.groupWord}s are not out yet. Come back in a moment.</Empty>
      ) : (
        <>
          {/* Sans noms (groupes publies avant la page publique), la recherche ne trouverait rien. */}
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

          {hasLeaders && (
            <Text size="sm" c="dimmed" mt="md">
              {tool.leaderReminder}
            </Text>
          )}

          <Stack gap="sm" mt="md">
            {visible.map((t) => (
              <GroupCard
                key={t.id}
                group={t}
                groupWord={tool.groupWord}
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
            <Section title={`${groups.length} ${tool.groupWord}s · ${groups.reduce((n, t) => n + t.memberIds.length, 0)} founders`}>
              <Text size="sm" c="dimmed">
                {tool.publicHint}
              </Text>
            </Section>
          )}
        </>
      )}
    </>
  );
}

function GroupCard({
  group,
  groupWord,
  href,
  members,
  isMine,
  viewerFounderId,
  matches,
}: {
  group: WithId<EventTeam>;
  groupWord: string;
  href: (founderId: string) => string;
  members: Member[];
  isMine: boolean;
  viewerFounderId: string | null;
  matches: (m: Member) => boolean;
}) {
  const leaderId = leaderIdOf(group);
  // Le leader en premiere ligne : c'est lui qu'on cherche en arrivant.
  const ordered = [...members].sort((a, b) => Number(b.id === leaderId) - Number(a.id === leaderId));
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
        {group.name}
        {isMine && (
          <Text span c="pioneers" fw={600} size="sm" ml="xs">
            Your {groupWord}
          </Text>
        )}
      </Text>
      <RowList>
        {ordered.map((m) => {
          const marks = [m.id === leaderId && "leader", m.id === viewerFounderId && "you"].filter(Boolean);
          return (
            <LinkRow
              key={m.id}
              href={href(m.id)}
              avatar={{ name: m.name, photoUrl: m.photoUrl }}
              title={
                <Text span inherit c={matches(m) ? "pioneers" : undefined}>
                  {m.name}
                  {marks.length > 0 && (
                    <Text span c="dimmed" size="sm" fw={400}>
                      {" "}
                      ({marks.join(", ")})
                    </Text>
                  )}
                </Text>
              }
              subtitle={m.context ?? undefined}
            />
          );
        })}
      </RowList>
    </Box>
  );
}
