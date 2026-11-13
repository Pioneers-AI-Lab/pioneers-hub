"use client";

import { usePrograms } from "@/context/ProgramsContext";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty } from "@/components/ui/Section";

export default function ProgramsPage() {
  const { programs, isLoading } = usePrograms();
  if (isLoading) return <PageLoader />;

  return (
    <>
      <PageHeader title="Programs" />
      {programs.length === 0 ? (
        <Empty>No program yet.</Empty>
      ) : (
        <RowList>
          {programs.map((program) => (
            <LinkRow key={program.id} href={paths.program(program.id)} title={program.name} subtitle={program.description} />
          ))}
        </RowList>
      )}
    </>
  );
}
