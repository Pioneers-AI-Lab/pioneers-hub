"use client";

import { useMemo, type ReactNode } from "react";
import { matchingOf } from "@shared/events";
import { byGroupOrder } from "@shared/teamGenerator";
import type { EventMatching, EventTeam, Form, FormCompletion, PioneersEvent, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { useBatch } from "@/context/BatchContext";
import { useProgram } from "@/context/ProgramContext";
import { useEvents } from "@/context/EventsContext";
import { LevelGate } from "@/components/ui/LevelGate";
import { paths } from "@/lib/paths";

// ----------------------------
// La page d'un evenement, pour tous les roles du batch (decision du 13/11)
// ----------------------------
// Monte par .../batches/[batchId]/events/[eventId]/layout.tsx. L'evenement est
// celui que le visiteur voit dans le batch (`useEvents` : publie et destine a
// lui ; le staff les voit tous, brouillons compris). Ce qui lui est attache :
// ses formulaires (publics par la regle `forms`), ses groupes publies, et pour
// un fondateur ce qu'il a deja rempli (`formCompletions`, les siens).

type EventPageValue = {
  event: WithId<PioneersEvent>;
  matching: EventMatching | null;
  /** Non archives. */
  forms: WithId<Form>[];
  /** Groupes publies du matching. */
  groups: WithId<EventTeam>[];
  /** Les formulaires deja remplis par le fondateur connecte. */
  doneFormIds: Set<string>;
};

const [EventPageContextProvider, useEventPage] = createStrictContext<EventPageValue>("EventPage");
export { useEventPage };

export function EventPageProvider({ children }: { children: ReactNode }) {
  const { eventId } = useParamsTS<{ eventId: string }>();
  const { program } = useProgram();
  const { batch, role, viewerFounderId } = useBatch();
  const { eventsById, allEventsById, isLoading } = useEvents();
  const event = role === "staff" ? allEventsById.get(eventId) : eventsById.get(eventId);
  const forms = useQueryListener(queries.formsOfEvent(eventId));
  // Sans matching, pas de groupes a lire.
  const groups = useQueryListener(event && matchingOf(event) ? queries.publishedTeamsOfEvent(eventId) : null);
  const completions = useQueryListener(viewerFounderId ? queries.myFormCompletions(batch.id, viewerFounderId) : null);

  const value = useMemo<EventPageValue | null>(() => {
    if (!event || event.archivedDateISOString !== null) return null;
    return {
      event,
      matching: matchingOf(event),
      forms: forms.data.filter((f) => f.archivedDateISOString === null),
      groups: [...groups.data].sort(byGroupOrder),
      doneFormIds: new Set(completions.data.map((c: WithId<FormCompletion>) => c.formId)),
    };
  }, [event, forms.data, groups.data, completions.data]);

  return (
    <LevelGate
      isLoading={isLoading || forms.isLoading || groups.isLoading}
      found={value !== null}
      error={forms.error}
      backHref={paths.batch(program.id, batch.id)}
    >
      {value && <EventPageContextProvider value={value}>{children}</EventPageContextProvider>}
    </LevelGate>
  );
}
