"use client";

import { Text } from "@mantine/core";
import dayjs from "dayjs";
import type { FormToFill } from "@/context/FormsToFillContext";
import { formatDateTime } from "@/lib/format";
import { paths } from "@/lib/paths";
import { LinkRow } from "@/components/ui/Rows";
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
