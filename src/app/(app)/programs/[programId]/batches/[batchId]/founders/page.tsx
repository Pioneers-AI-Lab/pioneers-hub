"use client";

import { useMemo, useState } from "react";
import { Group, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import type { ProfileCategory } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useCohort } from "@/context/CohortContext";
import { useFounderDirectories, type FoundersView } from "@/context/FounderDirectoriesContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { missingRequiredFields } from "@/lib/completeness";
import { PROFILE_CATEGORY_LABEL, score10 } from "@/lib/format";
import { paths } from "@/lib/paths";
import { FounderGridCard } from "@/components/founder/FounderGridCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty } from "@/components/ui/Section";

type Filter = "all" | ProfileCategory;

export default function FoundersPage() {
  const { program } = useProgram();
  const { batch, role } = useBatch();
  const { founders, isLoading } = useFounders();
  const { startupsById } = useStartups();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { canSeeScores, founderPerformance } = useCohort();
  // Staff et investors : classement par Program Performance (comme le dashboard).
  const [sort, setSort] = useState<"score" | "name">("score");
  const byScore = canSeeScores && sort === "score";
  // Grille : la galerie du Profile Book (1 a 3 cartes par ligne selon la largeur).
  const { view, setView, directoriesById, isLoading: isGridLoading } = useFounderDirectories();

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = founders.filter((f) => {
      if (filter !== "all" && f.profileCategory !== filter) return false;
      if (!q) return true;
      return [f.name, ...f.hardSkills, ...f.industries, ...f.rolesICouldTake].some((v) => v.toLowerCase().includes(q));
    });
    if (!byScore) return list;
    return [...list].sort((a, b) => (founderPerformance(b.id) ?? -1) - (founderPerformance(a.id) ?? -1));
  }, [founders, search, filter, byScore, founderPerformance]);
  // Grille : les profils complets d'abord, l'ordre choisi garde dans chaque groupe.
  // Complet = aucun champ obligatoire vide (le profil prive n'en porte aucun).
  // Sans annuaire (visiteur public), on ne sait pas : ordre inchange.
  const gridFounders = useMemo(() => {
    if (view !== "grid" || directoriesById.size === 0) return visible;
    const isComplete = new Map(visible.map((f) => [f.id, missingRequiredFields(f, directoriesById.get(f.id) ?? null, null).length === 0]));
    return [...visible.filter((f) => isComplete.get(f.id)), ...visible.filter((f) => !isComplete.get(f.id))];
  }, [view, visible, directoriesById]);

  if (isLoading) return <PageLoader />;

  /** Score (staff, investors) ou compte non rattache (staff), a droite de la ligne ou de la carte. */
  const metaOf = (founderId: string, uid: string | null) => {
    if (canSeeScores) {
      const score = founderPerformance(founderId);
      return (
        <Text fw={600} className="num" c={score === null ? "dimmed" : undefined}>
          {score10(score)}
        </Text>
      );
    }
    if (role === "staff" && !uid) return <Text size="xs" c="dimmed">Not linked</Text>;
    return undefined;
  };
  const startupNameOf = (startupId: string | null) => (startupId && startupsById.get(startupId)?.name) || null;

  return (
    <>
      <PageHeader title="Founders" right={<Text c="dimmed" className="num">{founders.length}</Text>} />
      {role === "public" && (
        <Text size="sm" c="dimmed" mb="md">
          Only founders who agreed to a public profile are listed. Sign in to see the whole batch.
        </Text>
      )}
      <Stack gap="sm" mb="xs">
        <TextInput
          placeholder="Search a name, skill or industry"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          type="search"
        />
        <SegmentedControl
          fullWidth
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          data={[
            { value: "all", label: "All" },
            { value: "technical", label: "Tech" },
            { value: "business", label: "Business" },
            { value: "hybrid", label: "Hybrid" },
          ]}
        />
        <Group gap="xs">
          {canSeeScores && (
            <SegmentedControl
              size="xs"
              value={sort}
              onChange={(v) => setSort(v as "score" | "name")}
              data={[
                { value: "score", label: "By score" },
                { value: "name", label: "By name" },
              ]}
            />
          )}
          <SegmentedControl
            size="xs"
            ml="auto"
            value={view}
            onChange={(v) => setView(v as FoundersView)}
            data={[
              { value: "list", label: "List" },
              { value: "grid", label: "Grid" },
            ]}
          />
        </Group>
      </Stack>
      {visible.length === 0 ? (
        <Empty>{founders.length === 0 ? "No founder yet." : "No founder matches."}</Empty>
      ) : view === "grid" && isGridLoading ? (
        <PageLoader />
      ) : view === "grid" ? (
        <div className="bleed-wide">
          <SimpleGrid type="container" cols={{ base: 1, "540px": 2, "840px": 3 }} spacing="md" verticalSpacing="md" mt="xs">
            {gridFounders.map((f) => (
              <FounderGridCard
                key={f.id}
                href={paths.founder(program.id, batch.id, f.id)}
                founder={f}
                directory={directoriesById.get(f.id)}
                startupName={startupNameOf(f.startupId)}
                meta={metaOf(f.id, f.uid)}
              />
            ))}
          </SimpleGrid>
        </div>
      ) : (
        <RowList>
          {visible.map((f) => {
            const startup = startupNameOf(f.startupId);
            const category = f.profileCategory ? PROFILE_CATEGORY_LABEL[f.profileCategory] : null;
            const context = [category, startup ?? f.rolesICouldTake.slice(0, 2).join(", ")].filter(Boolean).join(" · ");
            return (
              <LinkRow
                key={f.id}
                href={paths.founder(program.id, batch.id, f.id)}
                avatar={{ name: f.name, photoUrl: f.photoUrl }}
                title={f.name}
                subtitle={context || undefined}
                meta={metaOf(f.id, f.uid)}
              />
            );
          })}
        </RowList>
      )}
    </>
  );
}
