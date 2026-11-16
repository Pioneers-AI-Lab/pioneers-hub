"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Anchor, Group, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import type { ProfileCategory } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useBatch } from "@/context/BatchContext";
import { useCohort } from "@/context/CohortContext";
import { useFounderDirectories } from "@/context/FounderDirectoriesContext";
import { useUrlState } from "@/hooks/useUrlState";
import { useFounders } from "@/context/FoundersContext";
import { useMyConnections } from "@/context/MyConnectionsContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { missingRequiredFields } from "@/lib/completeness";
import { PROFILE_CATEGORY_LABEL, score10, searchKey } from "@/lib/format";
import { paths } from "@/lib/paths";
import { FounderGridCard } from "@/components/founder/FounderGridCard";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { searchCount } from "@/components/ui/SearchCount";
import { Empty } from "@/components/ui/Section";

type Filter = "all" | ProfileCategory;
/** Fondateur du batch : sa shortlist et ses rencontres (« Not met » exclut sa propre fiche). */

// Vue, filtres, tri et recherche dans l'URL (demande du 16/11) : un rechargement
// ou un lien partage rouvre la meme vue (`?view=list&type=technical&q=...`).
const VIEWS = ["grid", "list"] as const;
const FILTERS = ["all", "technical", "business", "hybrid"] as const satisfies readonly Filter[];
const CONNECTION_FILTERS = ["all", "shortlisted", "met", "not_met"] as const;
type ConnectionFilter = (typeof CONNECTION_FILTERS)[number];
const SORTS = ["score", "name"] as const;

/** `useSearchParams` (useUrlState) : la page est sous un Suspense, comme l'exige le prerendu. */
export default function FoundersPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <FoundersDirectory />
    </Suspense>
  );
}

function FoundersDirectory() {
  const { program } = useProgram();
  const { batch, role } = useBatch();
  const { firebaseUser } = useAuth();
  const { founders, isLoading } = useFounders();
  const { startupsById } = useStartups();
  const [query, setQuery] = useUrlState<string>("q", "");
  // La saisie reste locale (l'URL suit sans faire sauter le curseur).
  const [search, setSearch] = useState(query);
  const [filter, setFilter] = useUrlState<Filter>("type", "all", FILTERS);
  const { founderId: myFounderId, shortlisted, met } = useMyConnections();
  const [connectionFilter, setConnectionFilter] = useUrlState<ConnectionFilter>("connections", "all", CONNECTION_FILTERS);
  const { canSeeScores, founderPerformance } = useCohort();
  // Staff et investors : classement par Program Performance (comme le dashboard).
  const [sort, setSort] = useUrlState("sort", "score", SORTS);
  const byScore = canSeeScores && sort === "score";
  // Grille : la galerie du Profile Book (1 a 3 cartes par ligne selon la largeur).
  const [view, setView] = useUrlState("view", "grid", VIEWS);
  const { ensureOpen, rememberQuery, directoriesById, isLoading: isGridLoading } = useFounderDirectories();
  // Premiere visite : l'annuaire ouvre ses ecouteurs (gardes ensuite, au layout de /founders).
  useEffect(ensureOpen, [ensureOpen]);
  // « All founders » d'une fiche ramene a cette vue (FounderDirectoriesContext).
  // Notee en quittant la page seulement : pas de rendu de plus a chaque frappe.
  const params = useSearchParams();
  const lastQuery = useRef("");
  useEffect(() => {
    lastQuery.current = params.toString();
  }, [params]);
  useEffect(() => () => rememberQuery(lastQuery.current), [rememberQuery]);

  // Texte cherchable de chaque fondateur, sans accents ni casse : calcule une fois par liste, pas a chaque frappe.
  const searchTextOf = useMemo(
    () => new Map(founders.map((f) => [f.id, searchKey([f.name, ...f.hardSkills, ...f.industries, ...f.rolesICouldTake].join("\n"))])),
    [founders],
  );
  const visible = useMemo(() => {
    const q = searchKey(search);
    const list = founders.filter((f) => {
      if (filter !== "all" && f.profileCategory !== filter) return false;
      if (connectionFilter === "shortlisted" && !shortlisted.has(f.id)) return false;
      if (connectionFilter === "met" && !met.has(f.id)) return false;
      if (connectionFilter === "not_met" && (met.has(f.id) || f.id === myFounderId)) return false;
      return !q || searchTextOf.get(f.id)!.includes(q);
    });
    if (!byScore) return list;
    return [...list].sort((a, b) => (founderPerformance(b.id) ?? -1) - (founderPerformance(a.id) ?? -1));
  }, [founders, searchTextOf, search, filter, connectionFilter, shortlisted, met, myFounderId, byScore, founderPerformance]);
  // Grille : les profils complets d'abord, l'ordre choisi garde dans chaque groupe.
  // Complet = aucun champ obligatoire vide (le profil prive n'en porte aucun).
  // Sans annuaire (visiteur public), on ne sait pas : ordre inchange.
  const gridFounders = useMemo(() => {
    if (view !== "grid" || directoriesById.size === 0) return visible;
    const isComplete = new Map(visible.map((f) => [f.id, missingRequiredFields(f, directoriesById.get(f.id) ?? null, null).length === 0]));
    return [...visible.filter((f) => isComplete.get(f.id)), ...visible.filter((f) => !isComplete.get(f.id))];
  }, [view, visible, directoriesById]);

  if (isLoading) return <PageLoader />;

  /** Score (staff, investors), compte non rattache (staff) ou, pour un fondateur, « Shortlisted » / « Met », a droite de la ligne ou de la carte. */
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
    const marks = [shortlisted.has(founderId) && "Shortlisted", met.has(founderId) && "Met"].filter(Boolean);
    if (marks.length > 0) return <Text size="xs" c="dimmed">{marks.join(" · ")}</Text>;
    return undefined;
  };
  const startupNameOf = (startupId: string | null) => (startupId && startupsById.get(startupId)?.name) || null;

  return (
    <>
      {role === "public" && (
        <Text size="sm" c="dimmed" mb="md">
          Only founders who agreed to a public profile are listed.{" "}
          {firebaseUser ? (
            <>
              Your account is not linked to a profile of this batch:{" "}
              <Anchor component={Link} href={paths.claim()} inherit>
                find your profile
              </Anchor>
            </>
          ) : (
            <Anchor component={Link} href={paths.signIn(paths.founders(program.id, batch.id))} inherit>
              Sign in
            </Anchor>
          )}{" "}
          to see the whole batch.
        </Text>
      )}
      <Stack gap="sm" mb="xs">
        <TextInput
          placeholder="Search a name, skill or industry"
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setQuery(e.currentTarget.value.trim());
          }}
          type="search"
          {...searchCount(visible.length, founders.length)}
        />
        <SegmentedControl
          fullWidth
          value={filter}
          onChange={setFilter}
          data={[
            { value: "all", label: "All" },
            { value: "technical", label: "Tech" },
            { value: "business", label: "Business" },
            { value: "hybrid", label: "Hybrid" },
          ]}
        />
        {myFounderId && (
          <SegmentedControl
            fullWidth
            value={connectionFilter}
            onChange={setConnectionFilter}
            data={[
              { value: "all", label: "All" },
              { value: "shortlisted", label: "Shortlisted" },
              { value: "met", label: "Met" },
              { value: "not_met", label: "Not met" },
            ]}
          />
        )}
        <Group gap="xs">
          {canSeeScores && (
            <SegmentedControl
              size="xs"
              value={sort}
              onChange={setSort}
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
            onChange={setView}
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
                subtitle={f.trackRecordOneLiner || context || undefined}
                meta={metaOf(f.id, f.uid)}
              />
            );
          })}
        </RowList>
      )}
    </>
  );
}
