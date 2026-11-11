"use client";

import { useMemo, useState } from "react";
import { SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import type { ProfileCategory } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useCohort } from "@/context/CohortContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { PROFILE_CATEGORY_LABEL, score10 } from "@/lib/format";
import { paths } from "@/lib/paths";
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

  if (isLoading) return <PageLoader />;

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
        {canSeeScores && (
          <SegmentedControl
            size="xs"
            w="fit-content"
            value={sort}
            onChange={(v) => setSort(v as "score" | "name")}
            data={[
              { value: "score", label: "By score" },
              { value: "name", label: "By name" },
            ]}
          />
        )}
      </Stack>
      {visible.length === 0 ? (
        <Empty>{founders.length === 0 ? "No founder yet." : "No founder matches."}</Empty>
      ) : (
        <RowList>
          {visible.map((f) => {
            const startup = f.startupId ? startupsById.get(f.startupId)?.name : null;
            const category = f.profileCategory ? PROFILE_CATEGORY_LABEL[f.profileCategory] : null;
            const context = [category, startup ?? f.rolesICouldTake.slice(0, 2).join(", ")].filter(Boolean).join(" · ");
            return (
              <LinkRow
                key={f.id}
                href={paths.founder(program.id, batch.id, f.id)}
                avatar={{ name: f.name, photoUrl: f.photoUrl }}
                title={f.name}
                subtitle={context || undefined}
                meta={
                  canSeeScores ? (
                    <Text fw={600} className="num" c={founderPerformance(f.id) === null ? "dimmed" : undefined}>
                      {score10(founderPerformance(f.id))}
                    </Text>
                  ) : role === "staff" && !f.uid ? (
                    <Text size="xs" c="dimmed">Not linked</Text>
                  ) : undefined
                }
              />
            );
          })}
        </RowList>
      )}
    </>
  );
}
