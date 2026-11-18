"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SegmentedControl, Stack, TextInput, Textarea } from "@mantine/core";
import { taskDraftOf, taskScheduleProblem } from "@shared/admin/batch";
import { COMING_UP_DAYS, TASK_CHECK_RULES } from "@shared/tasks";
import type { BatchTask, TaskCheck, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminTasks } from "@/context/AdminTasksContext";
import { useAction } from "@/hooks/useAction";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { paths } from "@/lib/paths";
import { createTask, parseTaskLink, updateTask, type TaskDraft } from "@/lib/tasksAdmin";
import { ActionBar } from "@/components/admin/ActionBar";
import { Section } from "@/components/ui/Section";
import { WithHelp } from "@/components/ui/Help";

// ----------------------------
// Les reglages d'une tache (Admin > Tasks) : titre, description, lien, dates, verification
// ----------------------------
// Nouvelle tache (`task` absent) : « Create », puis la page de la tache.
// Existante : « Save » quand quelque chose a change. `children` : les sections
// de la page placees avant la barre d'enregistrement (toujours en dernier).

export function TaskEditor({ task, children }: { task?: WithId<BatchTask>; children?: ReactNode }) {
  const router = useRouter();
  const { batch } = useAdmin();
  const { tasks } = useAdminTasks();
  const { isBusy, run } = useAction();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [link, setLink] = useState(task?.linkUrl ?? "");
  const [opens, setOpens] = useState(task?.opensDateISOString ?? null);
  const [deadline, setDeadline] = useState(task?.deadlineDateISOString ?? null);
  const [check, setCheck] = useState<TaskCheck | null>(task?.check ?? null);

  const linkUrl = parseTaskLink(link);
  const draft: TaskDraft = {
    title: title.trim(),
    description: description.trim() || null,
    linkUrl: linkUrl ?? null,
    opensDateISOString: opens,
    deadlineDateISOString: deadline,
    check,
  };
  const linkError = linkUrl === undefined ? "The link is not a web address or a page of the app." : null;
  const scheduleError = taskScheduleProblem(draft);
  const problem = !draft.title ? "Give the task a title." : (linkError ?? scheduleError);
  const saved = task ? taskDraftOf(task) : null;
  const isDirty = !saved || (Object.keys(draft) as (keyof TaskDraft)[]).some((k) => draft[k] !== saved[k]);

  async function save() {
    if (task) {
      await run(() => updateTask(task, draft), "Task saved");
      return;
    }
    const id = await run(() => createTask(batch, draft, tasks), "Task created");
    if (id) router.replace(paths.adminTask(id));
  }

  return (
    <>
      <Section title="Task">
        <Stack gap="sm">
          <TextInput label="Title" required value={title} onChange={(e) => setTitle(e.currentTarget.value)} placeholder="Introduce yourself on Slack" />
          <WithHelp label="Description" help="One short sentence, under the title.">
            {(field) => (
              <Textarea
                {...field}
                autosize
                minRows={2}
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
              />
            )}
          </WithHelp>
          <WithHelp label="Link" help="A web address (Slack, LinkedIn…), or a page of the app starting with /programs/…">
            {(field) => (
              <TextInput
                {...field}
                value={link}
                onChange={(e) => setLink(e.currentTarget.value)}
                error={linkError}
              />
            )}
          </WithHelp>
        </Stack>
      </Section>
      <Section title="Schedule" help={`Founders see it under Coming up ${COMING_UP_DAYS} days before it opens. Empty: open now, no deadline.`}>
        <Stack>
          <TextInput label="Opens" type="datetime-local" value={toLocalInput(opens)} onChange={(e) => setOpens(fromLocalInput(e.currentTarget.value))} />
          <TextInput
            label="Deadline"
            type="datetime-local"
            value={toLocalInput(deadline)}
            onChange={(e) => setDeadline(fromLocalInput(e.currentTarget.value))}
            error={scheduleError}
          />
        </Stack>
      </Section>
      <Section title="Done when" help="The app checks some tasks itself: founders then get no Mark done button.">
        <SegmentedControl
          fullWidth
          value={check ?? "tick"}
          onChange={(v) => setCheck(v === "tick" ? null : (v as TaskCheck))}
          data={[{ value: "tick", label: "Founder ticks it" }, ...Object.entries(TASK_CHECK_RULES).map(([value, { label }]) => ({ value, label }))]}
        />
      </Section>
      {children}
      <ActionBar
        label={task ? (isDirty ? "Save" : "No changes") : "Create"}
        loading={isBusy}
        disabled={!isDirty || problem !== null}
        problem={isDirty ? problem : null}
        onClick={() => void save()}
      />
    </>
  );
}
