"use client";

import { useMemo, useState } from "react";
import { Text, TextInput } from "@mantine/core";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";
import { useProgram } from "@/context/ProgramContext";
import { useStartups } from "@/context/StartupsContext";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty } from "@/components/ui/Section";

export default function StartupsPage() {
  const { program } = useProgram();
  const { batch, viewerFounderId } = useBatch();
  const { startups, isLoading } = useStartups();
  const { foundersById } = useFounders();
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return startups;
    return startups.filter((s) => [s.name, s.ideaOneLine ?? "", s.vertical ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [startups, search]);

  if (isLoading) return <PageLoader />;

  return (
    <>
      <PageHeader title="Startups" right={<Text c="dimmed" className="num">{startups.length}</Text>} />
      {startups.length > 6 && (
        <TextInput placeholder="Search a startup" value={search} onChange={(e) => setSearch(e.currentTarget.value)} type="search" mb="xs" />
      )}
      {visible.length === 0 ? (
        <Empty>
          {startups.length === 0
            ? "No startup yet. Teams form after the mutual picks; each startup appears here once declared."
            : "No startup matches."}
        </Empty>
      ) : (
        <RowList>
          {visible.map((s) => {
            const members = s.memberIds.map((id) => foundersById.get(id)?.name).filter(Boolean);
            return (
              <LinkRow
                key={s.id}
                href={paths.startup(program.id, batch.id, s.id)}
                avatar={{ name: s.name, photoUrl: s.logoUrl }}
                title={s.name}
                subtitle={s.ideaOneLine ?? (members.join(", ") || undefined)}
                meta={viewerFounderId && s.memberIds.includes(viewerFounderId) ? <Text size="xs" c="pioneers">Yours</Text> : undefined}
              />
            );
          })}
        </RowList>
      )}
    </>
  );
}
