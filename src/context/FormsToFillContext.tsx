"use client";

import { useMemo, type ReactNode } from "react";
import { formConcernsFounder, isFormStillDone, questionsAddedSince } from "@shared/formRules";
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
//   - ouvert (`formState`, la regle de submitFormResponse) et non archive, ou publie
//     et pas encore ouvert (`useTodoItems` n'en garde que ce qui ouvre sous 7 jours :
//     « Coming up » du To do, 18/11) ;
//   - destine au fondateur (`formConcernsFounder` : le batch, ou l'audience de
//     son evenement : invites, equipes, jamais un absent ; un evenement en
//     brouillon ou a audience restreinte en decide aussi, d'ou `allEventsById`) ;
//   - sans reponse de sa part : `formCompletions` (ecrit par submitFormResponse,
//     le fondateur ne lit pas `formResponses`), ou, pour un formulaire anonyme,
//     le souvenir de ce navigateur (`useAnonymousFormsDone`).
// Un formulaire par occurrence (decision du 12/11) : l'update de la semaine
// prochaine est un autre formulaire, il reapparait donc chaque semaine.
//
// La Submission d'un hackathon et son Peer rating (SPECS §2, modele standard) sont des
// formulaires comme les autres. Un formulaire a identite prouvee (connexion)
// deja rempli reste dans la liste tant qu'il est ouvert (`done`) : le fondateur
// y retrouve ses reponses et les corrige (choix des cofondateurs, resultats).
// Une question ajoutee depuis sa reponse (`questionsAddedSince`) est signalee ;
// obligatoire, elle rend le formulaire de nouveau « a faire ».

/** `newQuestions` : questions ajoutees depuis sa reponse ; `doneDateISOString` : sa derniere reponse, si le formulaire est fait. */
export type FormToFill = { form: WithId<Form>; done: boolean; doneDateISOString: string | null; eventName: string | null; newQuestions: number };

type FormsToFillValue = {
  /** A remplir, les remplis encore modifiables et ceux pas encore ouverts (ranges par `useTodoItems`). */
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
  const completions = useQueryListener(queries.myFormCompletions(batch.id, founder.id));
  const anonymousDone = useAnonymousFormsDone(founder.id);

  const value = useMemo<FormsToFillValue>(() => {
    const nowISO = new Date().toISOString();
    const completionOf = new Map(completions.data.map((c) => [c.formId, c]));
    const teamEventIds = new Set(teamMemberships.map((m) => m.eventId));
    const attendanceByEventId = new Map(attendance.map((a) => [a.parentId, a]));
    const items = forms.data.flatMap((f): FormToFill[] => {
      const state = formState(f, nowISO);
      if (f.archivedDateISOString !== null || (state !== "open" && state !== "not_open_yet")) return [];
      const completion = completionOf.get(f.id);
      const added = questionsAddedSince(f, completion);
      const isDone = isFormStillDone(f, completion, f.identityCheck === "anonymous" ? anonymousDone.has(f.id) : completion !== undefined);
      if (isDone && !isProvenIdentity(f.identityCheck)) return [];
      const event = f.eventId ? (allEventsById.get(f.eventId) ?? null) : null;
      const isTeamMember = f.eventId !== null && teamEventIds.has(f.eventId);
      if (!formConcernsFounder(f, founder, event, isTeamMember, f.eventId ? attendanceByEventId.get(f.eventId) : undefined)) return [];
      const doneDateISOString = isDone ? (completion?.completedDateISOString ?? null) : null;
      return [{ form: f, done: isDone, doneDateISOString, eventName: event?.name ?? null, newQuestions: added.length }];
    });
    return {
      items,
      isLoading: forms.isLoading || completions.isLoading || isEventsLoading,
    };
  }, [forms.data, forms.isLoading, completions.data, completions.isLoading, allEventsById, isEventsLoading, anonymousDone, teamMemberships, attendance, founder]);

  return <FormsToFillContextProvider value={value}>{children}</FormsToFillContextProvider>;
}
