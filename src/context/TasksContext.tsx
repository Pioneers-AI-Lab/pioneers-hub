"use client";

import { useMemo, type ReactNode } from "react";
import type { BatchTask, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useBatchTasks } from "@/hooks/useBatchTasks";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";

// ----------------------------
// Les taches du batch et MES coches (checklist du To do, decision du 15/11)
// ----------------------------
// Monte UNE fois par le layout du batch : « To do », « Me » et SA fiche la lisent,
// l'ecouteur survit aux navigations. Cible `null` si le visiteur n'est pas
// fondateur du batch (`viewerFounderId`) : rien n'est ouvert. Les taches sont
// communes au batch (Admin > Tasks) ; chaque fondateur coche les siennes
// (`taskCompletions`, `lib/firestore/write.ts#setTaskDone`). Une tache archivee disparait.

export type TaskItem = { task: WithId<BatchTask>; done: boolean };

type TasksValue = {
  /** Dans l'ordre du staff ; faites ou non (une tache faite reste a sa place). */
  tasks: TaskItem[];
  isLoading: boolean;
};

const [TasksContextProvider, useTasks] = createStrictContext<TasksValue>("Tasks");
export { useTasks };

export function TasksProvider({ children }: { children: ReactNode }) {
  const { batch, viewerFounderId } = useBatch();
  const tasks = useBatchTasks(viewerFounderId ? batch.id : null);
  const completions = useQueryListener(viewerFounderId ? queries.myTaskCompletions(batch.id, viewerFounderId) : null);

  const value = useMemo<TasksValue>(() => {
    const done = new Set(completions.data.filter((c) => c.done).map((c) => c.taskId));
    return {
      tasks: tasks.tasks.map((task) => ({ task, done: done.has(task.id) })),
      isLoading: tasks.isLoading || completions.isLoading,
    };
  }, [tasks.tasks, tasks.isLoading, completions.data, completions.isLoading]);

  return <TasksContextProvider value={value}>{children}</TasksContextProvider>;
}
