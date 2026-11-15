"use client";

import type { ReactNode } from "react";
import { Text } from "@mantine/core";
import dayjs from "dayjs";
import { useBatch } from "@/context/BatchContext";
import type { FormToFill } from "@/context/FormsToFillContext";
import { useFounder } from "@/context/FounderContext";
import { useProgram } from "@/context/ProgramContext";
import type { TaskItem } from "@/context/TasksContext";
import type { ChecklistItem } from "@/hooks/useTodoItems";
import { setTaskDone } from "@/lib/firestore/write";
import { formatDateTime, joinList } from "@/lib/format";
import { paths } from "@/lib/paths";
import { ActionRow, LinkRow } from "@/components/ui/Rows";
import { ToggleButton } from "@/components/ui/ToggleButton";
import { newQuestionsLabel } from "@/components/forms/formDrafts";

// ----------------------------
// Une ligne de « To do », reprise telle quelle par le resume de « Me »
// ----------------------------
// En bleu ce qui attend le fondateur (echeance a moins de 24 h, ou un
// formulaire d'evenement sans echeance), en gris le reste. Un formulaire
// d'evenement porte le nom de son evenement ; rempli (connexion), il reste
// modifiable tant qu'il est ouvert. Des questions ajoutees depuis la reponse du
// fondateur se signalent (« Updated: 1 new question »).

export function FormRow({ item: { form, done, closed, eventName, newQuestions } }: { item: FormToFill }) {
  const due = form.deadlineDateISOString;
  // Un formulaire d'evenement se lit par son evenement (« Hackathon 2 · Debrief »).
  const isEventForm = eventName !== null;
  // Une question obligatoire ajoutee (le formulaire n'est plus « fait ») attend le fondateur.
  const isUrgent = !done && (newQuestions > 0 || (due === null ? isEventForm : dayjs(due).diff(dayjs(), "hour") < 24));
  const updated = newQuestions > 0 ? `Updated: ${newQuestionsLabel(newQuestions)}` : null;
  const meta = closed ? "Closed" : (updated ?? (done ? "Done" : due ? `Due ${formatDateTime(due)}` : isEventForm ? "To do" : null));
  return (
    <LinkRow
      href={paths.form(form.id)}
      title={eventName ?? form.title}
      subtitle={(isEventForm ? form.title : form.description) ?? undefined}
      meta={
        meta ? (
          <Text size="sm" c={isUrgent ? "pioneers" : "dimmed"}>
            {meta}
          </Text>
        ) : undefined
      }
    />
  );
}

// ----------------------------
// La checklist : « Complete your profile » (calcule), puis les taches du batch
// ----------------------------
// Une tache faite RESTE a sa place, titre grise et barre, bouton « Done » : la
// liste ne saute pas sous le doigt, et un toucher par erreur se defait sur place.

export function ChecklistRow({ item }: { item: ChecklistItem }) {
  return item.kind === "profile" ? <ProfileRow item={item} /> : <TaskRow item={item} />;
}

const labels = (fields: { label: string }[]) => joinList(fields.map((m) => m.label));

function ProfileRow({ item: { done, required, useful } }: { item: Extract<ChecklistItem, { kind: "profile" }> }) {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founder } = useFounder();
  const subtitle =
    required.length > 0 ? `Required: ${labels(required)}` : useful.length > 0 ? `Also useful: ${labels(useful)}` : "All fields filled";
  return (
    <LinkRow
      href={paths.founderEdit(program.id, batch.id, founder.id)}
      title={<TaskTitle done={done}>Complete your profile</TaskTitle>}
      subtitle={subtitle}
      meta={
        <Text size="sm" c={done ? "dimmed" : "pioneers"}>
          {done ? "Done" : "To do"}
        </Text>
      }
    />
  );
}

function TaskTitle({ done, children }: { done: boolean; children: ReactNode }) {
  return done ? (
    <Text span inherit c="dimmed" td="line-through">
      {children}
    </Text>
  ) : (
    children
  );
}

/** Le corps de la ligne ouvre le lien de la tache (page de l'app, ou autre site dans un nouvel onglet). */
function TaskRow({ item: { task, done } }: { item: TaskItem }) {
  const { founder } = useFounder();
  return (
    <ActionRow
      href={task.linkUrl}
      title={<TaskTitle done={done}>{task.title}</TaskTitle>}
      subtitle={task.description ?? undefined}
      action={
        <ToggleButton size="md" on={done} onToggle={(next) => setTaskDone(task, founder.id, next)} style={{ flexShrink: 0 }}>
          {done ? "Done" : "Mark done"}
        </ToggleButton>
      }
    />
  );
}
