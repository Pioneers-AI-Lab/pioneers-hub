"use client";

import { useMemo, type ReactNode } from "react";
import { formConcernsFounder } from "@shared/formRules";
import { formState } from "@shared/forms";
import { isProvenIdentity, type Form, type WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useAnonymousFormsDone } from "@/hooks/useAnonymousFormsDone";
import { useBatch } from "@/context/BatchContext";
import { useEvents } from "@/context/EventsContext";
import { useFounder } from "@/context/FounderContext";

// ----------------------------
// Les formulaires que le fondateur connecte doit encore remplir (SPECS §3.1)
// ----------------------------
// Monte sous MeGate (le fondateur est rattache, `useFounder()` est le sien) :
// (mine)/layout.tsx (« To do » et « Me »). Un formulaire est « a remplir » s'il est :
//   - ouvert (`formState`, la regle de submitFormResponse) et non archive ;
//   - destine au fondateur (`formConcernsFounder` : le batch, ou l'audience de
//     son evenement : invites, equipes, jamais un absent ; un evenement en
//     brouillon ou a audience restreinte en decide aussi, d'ou `allEventsById`) ;
//   - sans reponse de sa part : `formCompletions` (ecrit par submitFormResponse,
//     le fondateur ne lit pas `formResponses`), ou, pour un formulaire anonyme,
//     le souvenir de ce navigateur (`useAnonymousFormsDone`).
// Un formulaire par occurrence (decision du 12/11) : l'update de la semaine
// prochaine est un autre formulaire, il reapparait donc chaque semaine.
//
// Le Debrief d'un hackathon et les picks (SPECS §2, modele standard) sont des
// formulaires comme les autres. Un formulaire a identite prouvee (connexion)
// deja rempli reste dans la liste tant qu'il est ouvert (`done`) : le fondateur
// y retrouve ses reponses et les corrige (choix des cofondateurs, resultats).

/** `closed` : des picks clos que le fondateur a donnes : il y relit ses choix. */
export type FormToFill = { form: WithId<Form>; done: boolean; closed: boolean; eventName: string | null };

type FormsToFillValue = {
  /** A remplir (puis les remplis encore modifiables), echeance la plus proche d'abord, sans echeance a la fin. */
  items: FormToFill[];
  isLoading: boolean;
};

const [FormsToFillContextProvider, useFormsToFill] = createStrictContext<FormsToFillValue>("FormsToFill");
export { useFormsToFill };

export function FormsToFillProvider({ children }: { children: ReactNode }) {
  const { batch } = useBatch();
  const { allEventsById, isLoading: isEventsLoading } = useEvents();
  const { founder, teamMemberships, attendance } = useFounder();
  const forms = useQueryListener(queries.openFormsOfBatch(batch.id));
  const closedPicks = useQueryListener(queries.closedPicksOfBatch(batch.id));
  const completions = useQueryListener(queries.myFormCompletions(batch.id, founder.id));
  const anonymousDone = useAnonymousFormsDone(founder.id);

  const value = useMemo<FormsToFillValue>(() => {
    const nowISO = new Date().toISOString();
    const done = new Set(completions.data.map((c) => c.formId));
    const teamEventIds = new Set(teamMemberships.map((m) => m.eventId));
    const attendanceByEventId = new Map(attendance.map((a) => [a.parentId, a]));
    const items = forms.data.flatMap((f): FormToFill[] => {
      if (f.archivedDateISOString !== null || formState(f, nowISO) !== "open") return [];
      const isDone = (f.identityCheck === "anonymous" ? anonymousDone : done).has(f.id);
      if (isDone && !isProvenIdentity(f.identityCheck)) return [];
      const event = f.eventId ? (allEventsById.get(f.eventId) ?? null) : null;
      const isTeamMember = f.eventId !== null && teamEventIds.has(f.eventId);
      if (!formConcernsFounder(f, founder, event, isTeamMember, f.eventId ? attendanceByEventId.get(f.eventId) : undefined)) return [];
      return [{ form: f, done: isDone, closed: false, eventName: event?.name ?? null }];
    });
    // Des picks clos restent lisibles par qui les a donnes (son choix de cofondateurs).
    for (const f of closedPicks.data) {
      if (f.archivedDateISOString !== null || !done.has(f.id)) continue;
      items.push({ form: f, done: true, closed: true, eventName: f.eventId ? (allEventsById.get(f.eventId)?.name ?? null) : null });
    }
    const due = (i: FormToFill) => i.form.deadlineDateISOString ?? "9";
    return {
      items: items.sort((a, b) => Number(a.done) - Number(b.done) || Number(a.closed) - Number(b.closed) || due(a).localeCompare(due(b))),
      isLoading: forms.isLoading || completions.isLoading || isEventsLoading,
    };
  }, [forms.data, forms.isLoading, closedPicks.data, completions.data, completions.isLoading, allEventsById, isEventsLoading, anonymousDone, teamMemberships, attendance, founder]);

  return <FormsToFillContextProvider value={value}>{children}</FormsToFillContextProvider>;
}
