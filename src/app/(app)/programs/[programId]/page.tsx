"use client";

import { Text } from "@mantine/core";
import { isStaffViewer } from "@shared/access";
import type { BatchStatus } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useProgram } from "@/context/ProgramContext";
import { formatPeriod } from "@/lib/format";
import { paths } from "@/lib/paths";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty } from "@/components/ui/Section";
import { CreateBatchButton } from "@/components/staff/CreateDialogs";

const STATUS_LABEL: Record<BatchStatus, string> = { upcoming: "Upcoming", active: "Live", completed: "Completed" };

export default function ProgramPage() {
  const { viewer } = useAuth();
  const { program, batches, isBatchesLoading } = useProgram();

  return (
    <>
      <PageHeader
        back={{ href: paths.programs(), label: "Programs" }}
        title={program.name}
        subtitle={program.description}
        right={isStaffViewer(viewer) ? <CreateBatchButton programId={program.id} /> : undefined}
      />
      {isBatchesLoading ? (
        <PageLoader />
      ) : batches.length === 0 ? (
        <Empty>No batch yet.</Empty>
      ) : (
        <RowList>
          {batches.map((batch) => (
            <LinkRow
              key={batch.id}
              href={paths.batch(program.id, batch.id)}
              title={batch.name}
              subtitle={
                <span className="num">{formatPeriod(batch.startDayString, batch.endDayString)}</span>
              }
              meta={
                <Text size="sm" c={batch.status === "active" ? "pioneers" : "dimmed"}>
                  {STATUS_LABEL[batch.status]}
                </Text>
              }
            />
          ))}
        </RowList>
      )}
    </>
  );
}
