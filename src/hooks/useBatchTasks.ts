"use client";

import { useMemo } from "react";
import { byTaskOrder, type BatchTask, type WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { useQueryListener } from "@/hooks/useFirestoreListener";

/**
 * Les taches non archivees d'un batch, dans l'ordre du To do (`byTaskOrder`) :
 * lues par TasksContext (fondateur) et AdminTasksContext (staff). `null` : rien
 * a ouvrir (le visiteur n'y a pas droit).
 */
export function useBatchTasks(batchId: string | null): { tasks: WithId<BatchTask>[]; isLoading: boolean } {
  const tasks = useQueryListener(batchId ? queries.tasksOfBatch(batchId) : null);
  const sorted = useMemo(() => [...tasks.data].sort(byTaskOrder), [tasks.data]);
  return { tasks: sorted, isLoading: tasks.isLoading };
}
