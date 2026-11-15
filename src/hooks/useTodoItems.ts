"use client";

import { useMemo } from "react";
import { useFormsToFill, type FormToFill } from "@/context/FormsToFillContext";
import { useFounder } from "@/context/FounderContext";
import { useTasks, type TaskItem } from "@/context/TasksContext";
import { missingProfileFields, type MissingProfileField } from "@/lib/completeness";

/**
 * Un element de la checklist : « Complete your profile », CALCULE sur le profil
 * (fait quand aucun champ obligatoire ne manque), puis les taches du batch,
 * cochees par le fondateur lui-meme (TasksContext). `id` : la cle de sa ligne.
 */
export type ChecklistItem = { id: string } & (
  | { kind: "profile"; done: boolean; required: MissingProfileField[]; useful: MissingProfileField[] }
  | ({ kind: "task" } & TaskItem)
);

/**
 * Ce que le fondateur connecte a a faire (SPECS §3.1) : des formulaires (SPECS
 * §2, modele standard), ranges comme il les lit : les picks, la Submission et le
 * Peer rating de chaque hackathon, puis les autres ; et la checklist (profil,
 * taches du batch). Lu par « To do » (la liste complete) et « Me » (le resume),
 * sous `TodoProviders` (FormsToFill), monte par (mine)/layout.tsx et `SelfProviders` ;
 * les taches (TasksContext) viennent du layout du batch.
 */
export function useTodoItems() {
  const { items, isLoading } = useFormsToFill();
  const { tasks, isLoading: isTasksLoading } = useTasks();
  const { founder, directory, profile, isDetailsLoading } = useFounder();
  const ofKind = (keep: (i: FormToFill) => boolean) => items.filter(keep);
  const isHackathon = (i: FormToFill) => i.form.kind === "debrief" || i.form.kind === "peer_feedback";
  const checklist = useMemo<ChecklistItem[]>(() => {
    const missing = missingProfileFields(founder, directory, profile);
    const required = missing.filter((m) => m.required);
    return [
      { id: "profile", kind: "profile", done: required.length === 0, required, useful: missing.filter((m) => !m.required) },
      ...tasks.map((t) => ({ id: t.task.id, kind: "task" as const, ...t })),
    ];
  }, [founder, directory, profile, tasks]);
  return {
    picks: ofKind((i) => i.form.kind === "picks"),
    debriefs: ofKind(isHackathon),
    forms: ofKind((i) => i.form.kind !== "picks" && !isHackathon(i)),
    checklist,
    isLoading: isLoading || isTasksLoading || isDetailsLoading,
  };
}
