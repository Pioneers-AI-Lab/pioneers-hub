"use client";

import { paths } from "@/lib/paths";
import { BatchPicker } from "@/components/admin/BatchPicker";
import { TaskEditor } from "@/components/admin/TaskEditor";
import { PageHeader } from "@/components/ui/PageHeader";

// Admin > Tasks > New : une tache de plus dans le To do de chaque fondateur du batch, en fin de liste.
export default function AdminTaskNewPage() {
  return (
    <>
      <PageHeader back={{ href: paths.adminTasks(), label: "Tasks" }} title="New task" help="It shows up at once in every founder's To do." />
      <BatchPicker />
      <TaskEditor />
    </>
  );
}
