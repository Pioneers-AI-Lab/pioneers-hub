"use client";

import type { ReactNode } from "react";
import { Box, Text } from "@mantine/core";
import { IconCircle, IconCircleCheckFilled } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useBatch } from "@/context/BatchContext";
import { useFounder } from "@/context/FounderContext";
import { useProgram } from "@/context/ProgramContext";
import type { TodoItem } from "@/hooks/useTodoItems";
import { setTaskDone } from "@/lib/firestore/write";
import { formatDateTime, joinList } from "@/lib/format";
import { paths } from "@/lib/paths";
import { ActionRow, Row } from "@/components/ui/Rows";
import { ToggleIcon } from "@/components/ui/ToggleButton";
import { newQuestionsLabel } from "@/components/forms/formDrafts";

// ----------------------------
// Une ligne de « To do », reprise telle quelle par le resume de « Me » (decision du 18/11)
// ----------------------------
// Le titre, une ligne de contexte (echeance, en bleu a moins de 24 h, puis le detail),
// et a droite un cercle : vert coche si c'est fait, vide sinon. Le fondateur coche
// lui-meme une tache manuelle en touchant le cercle ; une tache auto (formulaire
// envoye, profil, verification de l'app) se coche seule, et sa ligne, cliquable,
// porte `>` avant le cercle. Faite, la ligne est grisee et barree, a sa place, le
// jour meme ; elle a disparu le lendemain (useTodoItems).

const labels = (fields: { label: string }[]) => joinList(fields.map((m) => m.label));
const CIRCLE_SIZE = 26;
const CIRCLE_BOX = { width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 } as const;

/** Titre, detail et lien d'une ligne. Un formulaire d'evenement se lit par son evenement (« Hackathon 2 · Debrief »). */
function rowContent(item: TodoItem, profileHref: string): { title: string; detail: string | null; href: string | null } {
  switch (item.kind) {
    case "profile": {
      const { required, useful } = item;
      const detail = required.length > 0 ? `Required: ${labels(required)}` : useful.length > 0 ? `Also useful: ${labels(useful)}` : "All fields filled";
      return { title: "Complete your profile", detail, href: profileHref };
    }
    case "task":
      return { title: item.task.title, detail: item.task.description, href: item.task.linkUrl };
    case "form": {
      const { form, eventName, newQuestions } = item.entry;
      // Une question ajoutee depuis sa reponse est signalee (obligatoire, elle rend le formulaire « a faire »).
      const updated = newQuestions > 0 ? `Updated: ${newQuestionsLabel(newQuestions)}` : null;
      return { title: eventName ?? form.title, detail: updated ?? (eventName !== null ? form.title : form.description), href: paths.form(form.id) };
    }
  }
}

/** Le lien de « Complete your profile » : sa fiche en modification. */
function useProfileHref() {
  const { program } = useProgram();
  const { batch } = useBatch();
  const { founder } = useFounder();
  return paths.founderEdit(program.id, batch.id, founder.id);
}

/** Ouvre sous 7 jours : sa date d'ouverture, sans lien ni cercle. */
export function ComingUpRow({ item }: { item: TodoItem }) {
  const { title, detail } = rowContent(item, useProfileHref());
  return (
    <Row
      title={title}
      subtitle={detail ?? undefined}
      meta={
        <Text size="sm" c="dimmed">
          Opens {formatDateTime(item.opensDateISOString)}
        </Text>
      }
    />
  );
}

const circleIcon = (done: boolean) =>
  done ? (
    <IconCircleCheckFilled size={CIRCLE_SIZE} color="var(--mantine-color-green-6)" />
  ) : (
    <IconCircle size={CIRCLE_SIZE} stroke={1.5} color="var(--mantine-color-dimmed)" />
  );

/** Une ligne ouverte : le corps mene a la tache (`>` ou `↗`), le cercle a droite (a toucher pour une tache manuelle). */
export function TodoRow({ item }: { item: TodoItem }) {
  const { founder } = useFounder();
  const { title, detail, href } = rowContent(item, useProfileHref());
  const due = item.deadlineDateISOString && !item.done ? item.deadlineDateISOString : null;
  const subtitle =
    due || detail ? (
      <>
        {due && (
          <Text span inherit c={dayjs(due).diff(dayjs(), "hour") < 24 ? "pioneers" : undefined}>
            Due {formatDateTime(due)}
          </Text>
        )}
        {due && detail && " · "}
        {detail}
      </>
    ) : undefined;
  const circle =
    item.kind === "task" && !item.task.check ? (
      <ToggleIcon bare on={item.done} label={item.done ? "Mark as not done" : "Mark as done"} onToggle={(next) => setTaskDone(item.task, founder.id, next)}>
        {circleIcon(item.done)}
      </ToggleIcon>
    ) : (
      <Box style={CIRCLE_BOX} role="img" aria-label={item.done ? "Done" : "Not done yet"}>
        {circleIcon(item.done)}
      </Box>
    );
  return <ActionRow href={href} title={<DoneTitle done={item.done}>{title}</DoneTitle>} subtitle={subtitle} action={circle} />;
}

function DoneTitle({ done, children }: { done: boolean; children: ReactNode }) {
  return done ? (
    <Text span inherit c="dimmed" td="line-through">
      {children}
    </Text>
  ) : (
    children
  );
}
