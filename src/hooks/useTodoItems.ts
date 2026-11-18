"use client";

import { useMemo } from "react";
import { parisDay, parisToday } from "@shared/dates";
import { todoWindow } from "@shared/tasks";
import type { BatchTask, WithId } from "@shared/types";
import { useFormsToFill, type FormToFill } from "@/context/FormsToFillContext";
import { useFounder } from "@/context/FounderContext";
import { useTasks } from "@/context/TasksContext";
import { missingProfileFields, type MissingProfileField } from "@/lib/completeness";

/**
 * Une ligne du To do : une TACHE, jamais un evenement (decision du 18/11). `id` : la
 * cle de sa ligne ; ouverture et echeance pour la ranger.
 */
export type TodoItem = {
  id: string;
  done: boolean;
  /** Quand elle a ete faite (sa coche, son envoi, le profil complete, la shortlist au minimum) ; `null` : fait sans date, deja parti. */
  doneDateISOString: string | null;
  opensDateISOString: string | null;
  deadlineDateISOString: string | null;
} & (
  | { kind: "profile"; required: MissingProfileField[]; useful: MissingProfileField[] }
  | { kind: "task"; task: WithId<BatchTask> }
  | { kind: "form"; entry: FormToFill }
);

/** Echeance la plus proche d'abord, sans echeance a la fin ; a egalite, l'ordre des sources (profil, taches, formulaires). */
const byDeadline = (a: TodoItem, b: TodoItem) => (a.deadlineDateISOString ?? "9").localeCompare(b.deadlineDateISOString ?? "9");
const byOpening = (a: TodoItem, b: TodoItem) => (a.opensDateISOString ?? "").localeCompare(b.opensDateISOString ?? "");

/** Faite un jour d'avant (a Paris), ou sans date : elle a quitte le To do (decision du 18/11 : barree le jour meme, partie le lendemain). */
const isDoneBefore = ({ done, doneDateISOString }: Pick<TodoItem, "done" | "doneDateISOString">, today: string) =>
  done && (!doneDateISOString || parisDay(doneDateISOString) < today);

/**
 * Ce que le fondateur connecte a a faire (SPECS §3.1) : « Complete your profile »
 * (calcule sur le profil), les taches du batch (sa coche, ou la verification de
 * l'app : TasksContext) et ses formulaires (FormsToFillContext). `toDo` : ouvert,
 * par echeance ; une ligne faite y reste a sa place, barree, le jour meme (la liste
 * ne saute pas sous le doigt), puis disparait le lendemain. `comingUp` : ce qui ouvre
 * dans les 7 jours, par ouverture. Lu par « To do »
 * et le resume de « Me », sous `TodoProviders`.
 */
export function useTodoItems() {
  const { items: forms, isLoading } = useFormsToFill();
  const { tasks, isLoading: isTasksLoading } = useTasks();
  const { founder, directory, profile, isDetailsLoading } = useFounder();

  return useMemo(() => {
    const nowISO = new Date().toISOString();
    const today = parisToday();
    const missing = missingProfileFields(founder, directory, profile);
    const required = missing.filter((m) => m.required);
    const items: TodoItem[] = [
      {
        id: "profile",
        kind: "profile",
        done: required.length === 0,
        // Fait le jour ou « Mon profil » l'a complete (`profileCompletedDateISOString`).
        doneDateISOString: directory?.profileCompletedDateISOString ?? null,
        opensDateISOString: null,
        deadlineDateISOString: null,
        required,
        useful: missing.filter((m) => !m.required),
      },
      ...tasks.map(({ task, done, doneDateISOString }): TodoItem => ({
        id: task.id,
        kind: "task",
        task,
        done,
        doneDateISOString,
        opensDateISOString: task.opensDateISOString ?? null,
        deadlineDateISOString: task.deadlineDateISOString ?? null,
      })),
      ...forms.map((entry): TodoItem => ({
        id: entry.form.id,
        kind: "form",
        entry,
        done: entry.done,
        doneDateISOString: entry.doneDateISOString,
        opensDateISOString: entry.form.opensDateISOString,
        deadlineDateISOString: entry.form.deadlineDateISOString,
      })),
    ];
    const all = items.filter((i) => !isDoneBefore(i, today));
    // Une seule regle pour tout : ouvert, ouvre sous 7 jours, ou pas encore montre.
    const inWindow = (w: "open" | "coming_up") => all.filter((i) => todoWindow(i.opensDateISOString, nowISO) === w);
    return {
      toDo: inWindow("open").sort(byDeadline),
      comingUp: inWindow("coming_up").sort(byOpening),
      isLoading: isLoading || isTasksLoading || isDetailsLoading,
    };
  }, [forms, isLoading, tasks, isTasksLoading, founder, directory, profile, isDetailsLoading]);
}
