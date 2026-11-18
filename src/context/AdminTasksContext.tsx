"use client";

import { useMemo, type ReactNode } from "react";
import { docIds } from "@shared/collections";
import { isTaskDone, shortlistedCountOf } from "@shared/tasks";
import { isBatchParticipant, readConnections, type BatchTask, type Founder, type WithId } from "@shared/types";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useBatchTasks } from "@/hooks/useBatchTasks";
import { useDocsListener, useQueryListener } from "@/hooks/useFirestoreListener";
import { useAdmin } from "@/context/AdminContext";

// ----------------------------
// Admin > Tasks : les taches du batch de travail et qui les a faites
// ----------------------------
// Monte par admin/tasks/layout.tsx. Attendus : les participants du batch
// (`isBatchParticipant`), comme le suivi d'un formulaire adresse au batch
// (`formAudience`, base « batch ») : rattaches ou non a un compte. Un profil
// sans compte ne peut pas cocher : il reste en retard, et le staff le relance
// aussi pour qu'il se rattache. Une tache verifiee par l'app (`check`) se lit dans
// sa donnee, comme au To do : la shortlist de chaque participant (ecoutee
// seulement s'il y a une telle tache).

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
  const expected = useMemo(() => founders.filter((f) => isBatchParticipant(f, batch.id)), [founders, batch.id]);
  const hasCheck = tasks.tasks.some((t) => t.check);
  const connections = useDocsListener(
    useMemo(() => (hasCheck ? expected.map((f) => [f.id, refs.founderConnections(f.id)] as const) : null), [hasCheck, expected]),
  );

  const { data: connectionsById, isLoading: isConnectionsLoading } = connections;

  const value = useMemo<AdminTasksValue>(() => {
    // L'id d'une coche dit deja sa tache et son fondateur.
    const doneIds = new Set(completions.data.filter((c) => c.done).map((c) => c.id));
    // Les faits d'une verification, une fois par fondateur (pas par tache).
    const batchIds = new Set(founders.map((f) => f.id));
    const factsOf = new Map(
      expected.map((f) => [f.id, { shortlistedCount: shortlistedCountOf(f.id, readConnections(connectionsById.get(f.id) ?? null).shortlistedFounderIds, batchIds) }]),
    );
    const progress = new Map(
      tasks.tasks.map((t) => {
        const isDone = (f: WithId<Founder>) => isTaskDone(t, doneIds.has(docIds.taskCompletion(t.id, f.id)), factsOf.get(f.id) ?? { shortlistedCount: 0 });
        return [t.id, { done: expected.filter(isDone), missing: expected.filter((f) => !isDone(f)) }];
      }),
    );
    return {
      tasks: tasks.tasks,
      progressOf: (taskId) => progress.get(taskId) ?? { done: [], missing: expected },
      isLoading: tasks.isLoading || completions.isLoading || isAdminLoading || (hasCheck && isConnectionsLoading),
    };
  }, [founders, expected, tasks.tasks, tasks.isLoading, completions.data, completions.isLoading, connectionsById, isConnectionsLoading, hasCheck, isAdminLoading]);

  return <AdminTasksContextProvider value={value}>{children}</AdminTasksContextProvider>;
}
