"use client";

import { useMemo, type ReactNode } from "react";
import { isTaskDone, shortlistedCountOf } from "@shared/tasks";
import type { BatchTask, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useBatchTasks } from "@/hooks/useBatchTasks";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useBatch } from "@/context/BatchContext";
import { useFounders } from "@/context/FoundersContext";
import { useMyConnections } from "@/context/MyConnectionsContext";

// ----------------------------
// Les taches du batch et MES coches (checklist du To do, decision du 15/11)
// ----------------------------
// Monte UNE fois par le layout du batch : « To do », « Me » et SA fiche la lisent,
// l'ecouteur survit aux navigations. Cible `null` si le visiteur n'est pas
// fondateur du batch (`viewerFounderId`) : rien n'est ouvert. Les taches sont
// communes au batch (Admin > Tasks) ; chaque fondateur coche les siennes
// (`taskCompletions`, `lib/firestore/write.ts#setTaskDone`). Une tache archivee disparait.
// Une tache verifiee (`check`, 18/11) est faite selon SA donnee, sans coche : la
// shortlist (MyConnectionsContext et FoundersContext, montes au-dessus par le layout du batch).

/** `done` : sa coche, ou la verification de l'app (`task.check`) ; `doneDateISOString` : quand (sa coche, ou sa shortlist arrivee au minimum). */
type TaskItem = { task: WithId<BatchTask>; done: boolean; doneDateISOString: string | null };

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
  const { shortlisted, shortlistDoneDateISOString, isLoading: isConnectionsLoading } = useMyConnections();
  const { foundersById } = useFounders();
  // Le seul fait que lit une verification (un nombre : la liste peut changer sans lui).
  const shortlistedCount = useMemo(
    () => (viewerFounderId ? shortlistedCountOf(viewerFounderId, [...shortlisted], foundersById) : 0),
    [viewerFounderId, shortlisted, foundersById],
  );

  const value = useMemo<TasksValue>(() => {
    const tickedOn = new Map(completions.data.filter((c) => c.done).map((c) => [c.taskId, c.updatedDateISOString]));
    return {
      tasks: tasks.tasks.map((task) => {
        const done = isTaskDone(task, tickedOn.has(task.id), { shortlistedCount });
        return { task, done, doneDateISOString: !done ? null : task.check ? shortlistDoneDateISOString : (tickedOn.get(task.id) ?? null) };
      }),
      isLoading: tasks.isLoading || completions.isLoading || isConnectionsLoading,
    };
  }, [tasks.tasks, tasks.isLoading, completions.data, completions.isLoading, shortlistedCount, shortlistDoneDateISOString, isConnectionsLoading]);

  return <TasksContextProvider value={value}>{children}</TasksContextProvider>;
}
