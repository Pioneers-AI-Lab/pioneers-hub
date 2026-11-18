"use client";

import { Text } from "@mantine/core";
import { useAdmin } from "@/context/AdminContext";
import { useAdminTasks } from "@/context/AdminTasksContext";
import { paths } from "@/lib/paths";
import { ActionBar } from "@/components/admin/ActionBar";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";

// ----------------------------
// Admin > Tasks : la checklist du To do de tous les fondateurs du batch
// ----------------------------
// Une ligne par tache, dans l'ordre du To do, avec « N / M done » parmi les
// participants du batch (AdminTasksContext). Une ligne ouvre la tache
// (modifier, ordre, retardataires, archiver) ; « + New task » en cree une.

export default function AdminTasksPage() {
  const { batch } = useAdmin();
  const { tasks, progressOf, isLoading } = useAdminTasks();

  return (
    <>
      <PageHeader
        back={{ href: paths.admin(), label: "Admin" }}
        title="Tasks"
        help="The tasks in every founder's To do, with their dates. Each founder ticks a task once done, unless the app checks it (shortlist)."
      />
      <BatchPicker />
      {isLoading ? (
        <PageLoader />
      ) : (
        <Section title={`Tasks · ${tasks.length}`}>
          {tasks.length === 0 ? (
            <Empty>No task in {batch.name} yet. Founders only see “Complete your profile”.</Empty>
          ) : (
            <RowList>
              {tasks.map((t) => {
                const { done, missing } = progressOf(t.id);
                return (
                  <LinkRow
                    key={t.id}
                    href={paths.adminTask(t.id)}
                    title={t.title}
                    subtitle={t.description ?? undefined}
                    meta={
                      <Text size="sm" c="dimmed" className="num">
                        {done.length} / {done.length + missing.length} done
                      </Text>
                    }
                  />
                );
              })}
            </RowList>
          )}
        </Section>
      )}
      <ActionBar label="+ New task" href={paths.adminTaskNew()} />
    </>
  );
}
