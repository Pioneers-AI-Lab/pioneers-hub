"use client";

import { useMemo, type ReactNode } from "react";
import { docIds } from "@shared/collections";
import { isBatchParticipant, type BatchTask, type Founder, type WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useBatchTasks } from "@/hooks/useBatchTasks";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useAdmin } from "@/context/AdminContext";

// ----------------------------
// Admin > Tasks : les taches du batch de travail et qui les a faites
// ----------------------------
// Monte par admin/tasks/layout.tsx. Attendus : les participants du batch
// (`isBatchParticipant`), comme le suivi d'un formulaire adresse au batch
// (`formAudience`, base « batch ») : rattaches ou non a un compte. Un profil
// sans compte ne peut pas cocher : il reste en retard, et le staff le relance
// aussi pour qu'il se rattache.

export type TaskProgress = {
  /** Attendus qui l'ont cochee, puis ceux qui ne l'ont pas fait (par nom). */
  done: WithId<Founder>[];
  missing: WithId<Founder>[];
};

type AdminTasksValue = {
  /** Non archivees, dans l'ordre du To do. */
  tasks: WithId<BatchTask>[];
  /** Par tache ; une tache sans coche : tous les attendus en retard. */
  progressOf: (taskId: string) => TaskProgress;
  isLoading: boolean;
};

const [AdminTasksContextProvider, useAdminTasks] = createStrictContext<AdminTasksValue>("AdminTasks");
export { useAdminTasks };

export function AdminTasksProvider({ children }: { children: ReactNode }) {
  const { batch, founders, isLoading: isAdminLoading } = useAdmin();
  const tasks = useBatchTasks(batch.id);
  const completions = useQueryListener(queries.taskCompletionsOfBatch(batch.id));

  const value = useMemo<AdminTasksValue>(() => {
    const expected = founders.filter((f) => isBatchParticipant(f, batch.id));
    // L'id d'une coche dit deja sa tache et son fondateur.
    const doneIds = new Set(completions.data.filter((c) => c.done).map((c) => c.id));
    const progress = new Map(
      tasks.tasks.map((t) => {
        const isDone = (f: WithId<Founder>) => doneIds.has(docIds.taskCompletion(t.id, f.id));
        return [t.id, { done: expected.filter(isDone), missing: expected.filter((f) => !isDone(f)) }];
      }),
    );
    return {
      tasks: tasks.tasks,
      progressOf: (taskId) => progress.get(taskId) ?? { done: [], missing: expected },
      isLoading: tasks.isLoading || completions.isLoading || isAdminLoading,
    };
  }, [batch.id, founders, tasks.tasks, tasks.isLoading, completions.data, completions.isLoading, isAdminLoading]);

  return <AdminTasksContextProvider value={value}>{children}</AdminTasksContextProvider>;
}
