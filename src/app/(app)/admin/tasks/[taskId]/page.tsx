"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Group } from "@mantine/core";
import type { Founder, WithId } from "@shared/types";
import { useAdminTasks } from "@/context/AdminTasksContext";
import { useAction } from "@/hooks/useAction";
import { useParamsTS } from "@/hooks/useParamsTS";
import { paths } from "@/lib/paths";
import { archiveTask, moveTask } from "@/lib/tasksAdmin";
import { ArchiveDialog } from "@/components/admin/ArchiveDialog";
import { CompletionProgress } from "@/components/admin/CompletionProgress";
import { TaskEditor } from "@/components/admin/TaskEditor";
import { BlockedState } from "@/components/ui/BlockedState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { ButtonRow, RowList } from "@/components/ui/Rows";
import { Section } from "@/components/ui/Section";

// ----------------------------
// Admin > Tasks > une tache : qui l'a faite, ses reglages, son rang, l'archiver
// ----------------------------
// Les retardataires d'abord (comme le suivi d'un formulaire), a copier dans
// Slack. Un profil sans compte ne peut pas cocher : « (no account) ».

const nameOf = (f: WithId<Founder>) => (f.uid === null ? `${f.name} (no account)` : f.name);

export default function AdminTaskPage() {
  const { taskId } = useParamsTS<{ taskId: string }>();
  const router = useRouter();
  const { tasks, progressOf, isLoading } = useAdminTasks();
  const { isBusy, run } = useAction();
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (isLoading) return <PageLoader />;
  const index = tasks.findIndex((t) => t.id === taskId);
  const task = tasks[index];
  // Archivee, ou d'un autre batch que celui de travail.
  if (!task) return <BlockedState reason="not_found" backHref={paths.adminTasks()} />;
  const progress = progressOf(task.id);

  // Vers la liste d'abord : archivee, la tache sort aussitot de l'ecouteur (cette page dirait « Not found »).
  function archive() {
    setConfirmArchive(false);
    router.push(paths.adminTasks());
    void run(() => archiveTask(task), "Task archived");
  }

  return (
    <>
      <PageHeader back={{ href: paths.adminTasks(), label: "Tasks" }} title={task.title} subtitle={task.description ?? undefined} />
      <Section title="Progress" help={task.check ? "Checked by the app, among the founders of the batch." : "Founders who ticked it, among the founders of the batch."}>
        <CompletionProgress
          doneNames={progress.done.map(nameOf)}
          missingNames={progress.missing.map(nameOf)}
          basisLabel="founders of the batch"
          missingTitle="Not done yet"
          doneTitle="Done"
        />
      </Section>
      {/* `key` : les champs repartent de la tache enregistree quand on change de tache. */}
      <TaskEditor key={task.id} task={task}>
        <Section title="Order" hint={`Position ${index + 1} of ${tasks.length} in the founders' checklist.`}>
          <Group gap="sm">
            <Button variant="default" size="md" disabled={isBusy || index === 0} onClick={() => void run(() => moveTask(tasks, index, -1), "Moved up")}>
              Move up
            </Button>
            <Button
              variant="default"
              size="md"
              disabled={isBusy || index === tasks.length - 1}
              onClick={() => void run(() => moveTask(tasks, index, 1), "Moved down")}
            >
              Move down
            </Button>
          </Group>
        </Section>
        <Section title="Archive">
          <RowList>
            <ButtonRow onClick={() => setConfirmArchive(true)} title="Archive this task" subtitle="Removes it from every founder's To do" />
          </RowList>
        </Section>
      </TaskEditor>

      <ArchiveDialog what="task" opened={confirmArchive} onClose={() => setConfirmArchive(false)} onArchive={archive}>
        It leaves the To do of every founder of the batch. Who ticked it is kept.
      </ArchiveDialog>
    </>
  );
}
