"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Stack, TextInput, Textarea } from "@mantine/core";
import type { BatchTask, WithId } from "@shared/types";
import { useAdmin } from "@/context/AdminContext";
import { useAdminTasks } from "@/context/AdminTasksContext";
import { useAction } from "@/hooks/useAction";
import { paths } from "@/lib/paths";
import { createTask, parseTaskLink, updateTask, type TaskDraft } from "@/lib/tasksAdmin";
import { ActionBar } from "@/components/admin/ActionBar";
import { Section } from "@/components/ui/Section";
import { WithHelp } from "@/components/ui/Help";

// ----------------------------
// Les reglages d'une tache (Admin > Tasks) : titre, description, lien
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

  const linkUrl = parseTaskLink(link);
  const draft: TaskDraft = { title: title.trim(), description: description.trim() || null, linkUrl: linkUrl ?? null };
  const linkError = linkUrl === undefined ? "The link is not a web address or a page of the app." : null;
  const problem = !draft.title ? "Give the task a title." : linkError;
  const isDirty =
    !task || draft.title !== task.title || draft.description !== task.description || draft.linkUrl !== task.linkUrl;

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
