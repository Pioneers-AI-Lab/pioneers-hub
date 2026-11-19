"use client";

import { useMemo, type ReactNode } from "react";
import { matchingOf } from "@shared/events";
import { isFormStillDone } from "@shared/formRules";
import { byGroupOrder, visibleTeams } from "@shared/teamGenerator";
import type { Attendance, EventMatching, EventTeam, Form, FormCompletion, PioneersEvent, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useAnonymousFormsDone } from "@/hooks/useAnonymousFormsDone";
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
// un fondateur ce qu'il a deja rempli (`formCompletions`, les siens) et sa
// presence (la sienne, regle `isOwnFounder`) : un absent ne recoit pas les
// formulaires de l'evenement (`formConcernsFounder`), comme dans son To do.

type EventPageValue = {
  event: WithId<PioneersEvent>;
  matching: EventMatching | null;
  /** Non archives. */
  forms: WithId<Form>[];
  /** Groupes publies du matching. */
  groups: WithId<EventTeam>[];
  /** Les formulaires deja remplis par le fondateur connecte (sans question obligatoire ajoutee depuis). */
  doneFormIds: Set<string>;
  /** Sa presence a l'evenement, absente si elle n'a pas ete relevee (ou sans fondateur connecte). */
  myAttendance: Attendance | undefined;
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
  const attendance = useQueryListener(viewerFounderId ? queries.attendanceOfFounder(viewerFounderId) : null);
  const anonymousDone = useAnonymousFormsDone(viewerFounderId ?? "");

  const value = useMemo<EventPageValue | null>(() => {
    if (!event || event.archivedDateISOString !== null) return null;
    const live = forms.data.filter((f) => f.archivedDateISOString === null);
    const completionOf = new Map(completions.data.map((c: WithId<FormCompletion>) => [c.formId, c]));
    return {
      event,
      matching: matchingOf(event),
      forms: live,
      // Sans les membres marques absents (masques, 19/11).
      groups: visibleTeams([...groups.data].sort(byGroupOrder)),
      doneFormIds: new Set(
        live
          .filter((f) => {
            const completion = completionOf.get(f.id);
            return isFormStillDone(f, completion, f.identityCheck === "anonymous" ? anonymousDone.has(f.id) : completion !== undefined);
          })
          .map((f) => f.id),
      ),
      myAttendance: attendance.data.find((a) => a.parentId === eventId),
    };
  }, [event, eventId, forms.data, groups.data, completions.data, attendance.data, anonymousDone]);

  return (
    <LevelGate
      isLoading={isLoading || forms.isLoading || groups.isLoading || attendance.isLoading}
      found={value !== null}
      error={forms.error}
      backHref={paths.batch(program.id, batch.id)}
    >
      {value && <EventPageContextProvider value={value}>{children}</EventPageContextProvider>}
    </LevelGate>
  );
}
