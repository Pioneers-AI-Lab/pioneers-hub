"use client";

import { useMemo, useState } from "react";
import { SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import type { ProfileCategory } from "@shared/types";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { PROFILE_CATEGORY_LABEL } from "@/lib/format";
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return founders.filter((f) => {
      if (filter !== "all" && f.profileCategory !== filter) return false;
      if (!q) return true;
      return [f.name, ...f.hardSkills, ...f.industries, ...f.rolesICouldTake].some((v) => v.toLowerCase().includes(q));
    });
  }, [founders, search, filter]);

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
                meta={role === "staff" && !f.uid ? <Text size="xs" c="dimmed">Not linked</Text> : undefined}
              />
            );
          })}
        </RowList>
      )}
    </>
  );
}
