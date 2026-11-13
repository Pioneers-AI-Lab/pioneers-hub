"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { eventMetrics, juryCriteria } from "@shared/forms";
import { absentFounderIds } from "@shared/attendance";
import { matchingOf } from "@shared/events";
import { byGroupOrder } from "@shared/teamGenerator";
import {
  isJuryForm,
  type Criterion,
  type Evaluation,
  type EventMatching,
  type EventMetric,
  type Form,
  type EventTeam,
  type JuryLink,
  type PioneersEvent,
  type Submission,
  type WithId,
} from "@shared/types";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener, useQueryListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { useAdmin } from "@/context/AdminContext";
import { LevelGate } from "@/components/ui/LevelGate";
import { PageLoader } from "@/components/ui/PageLoader";
import { BlockedState } from "@/components/ui/BlockedState";

// ----------------------------
// Admin : un evenement et tout ce qui lui est attache (SPECS §2) : son matching
// et ses groupes (publies ou non), leurs resultats, ses formulaires, son jury
// (lien partage, notes), sa presence
// ----------------------------
// Les metriques et la grille du jury sont les questions des formulaires de
// l'evenement : lues ici une fois pour toute la page. Monte par
// admin/events/[eventId]/layout.tsx (la page de l'evenement, son tirage, les
// resultats d'une equipe, la presence). Un evenement archive s'ouvre aussi (pour
// le restaurer). Un lien vers un evenement d'un autre batch bascule le batch de
// travail sur le sien : les participants et l'historique sont ceux de SON batch.

type AdminEventValue = {
  event: WithId<PioneersEvent>;
  /** Son matching (`matchingOf`), `null` sans tirage. */
  matching: EventMatching | null;
  teams: WithId<EventTeam>[];
  isTeamsLoading: boolean;
  /** Resultats saisis, par equipe (vide si la mecanique n'a pas de soumissions). */
  submissionsByTeamId: Map<string, WithId<Submission>>;
  /** Le lien partage du jury, `null` s'il n'est pas encore cree (ou sans jury). */
  juryLink: WithId<JuryLink> | null;
  /** Notes de l'evenement, par jure puis par cible (vide si la mecanique n'a pas de jury). */
  evaluations: WithId<Evaluation>[];
  /** Les formulaires de l'evenement, non archives (Debrief, jury, picks, feedback). */
  forms: WithId<Form>[];
  /** Les metriques de son Debrief et la grille de son formulaire de jury. */
  metrics: EventMetric[];
  criteria: Criterion[];
  /** Le formulaire de jury (lien partage), `null` s'il n'est pas encore cree. */
  juryForm: WithId<Form> | null;
  /** Les absents (Admin > Events > Attendance) : decoches du tirage. */
  absentIds: Set<string>;
};

const [AdminEventContextProvider, useAdminEvent] = createStrictContext<AdminEventValue>("AdminEvent");
export { useAdminEvent };

export function AdminEventProvider({ backHref, children }: { backHref: string; children: ReactNode }) {
  const { eventId } = useParamsTS<{ eventId: string }>();
  const { batch, batches, selectBatch, forms: batchForms } = useAdmin();
  const event = useDocListener(refs.event(eventId));
  // Ceux du batch de travail (deja ecoutes par Admin), le batch de l'evenement une fois bascule.
  const forms = useMemo(() => batchForms.filter((f) => f.eventId === eventId), [batchForms, eventId]);
  // N'ecoute que ce qui est attache : les soumissions avec un matching, le jury avec son formulaire.
  const hasMatching = event.data ? matchingOf(event.data) !== null : undefined;
  const hasJury = forms.some(isJuryForm);
  const teams = useQueryListener(queries.teamsOfEvent(eventId));
  const submissions = useQueryListener(hasMatching === undefined ? undefined : hasMatching ? queries.submissionsOfEvent(eventId) : null);
  const juryLink = useDocListener(hasJury ? refs.juryLink(eventId) : null);
  const evaluations = useQueryListener(hasJury ? queries.evaluationsOfEvent(eventId) : null);
  const attendance = useQueryListener(queries.attendanceOfEvent(eventId));
  const absentIds = useMemo(() => absentFounderIds(attendance.data), [attendance.data]);
  const eventBatchId = event.data?.batchId ?? null;
  useEffect(() => {
    if (eventBatchId && eventBatchId !== batch.id) selectBatch(eventBatchId);
  }, [eventBatchId, batch.id, selectBatch]);

  const value = useMemo<AdminEventValue | null>(() => {
    if (!event.data) return null;
    return {
      event: event.data,
      matching: matchingOf(event.data),
      teams: [...teams.data].sort(byGroupOrder),
      isTeamsLoading: teams.isLoading,
      submissionsByTeamId: new Map(submissions.data.map((s) => [s.id, s])),
      juryLink: juryLink.data,
      evaluations: [...evaluations.data].sort(
        (a, b) => a.evaluatorName.localeCompare(b.evaluatorName) || a.targetId.localeCompare(b.targetId),
      ),
      forms,
      metrics: eventMetrics(forms),
      criteria: juryCriteria(forms),
      juryForm: forms.find(isJuryForm) ?? null,
      absentIds,
    };
  }, [event.data, teams.data, teams.isLoading, submissions.data, juryLink.data, evaluations.data, forms, absentIds]);

  // Batch archive : hors de la liste de travail, l'outil ne s'y applique plus.
  if (eventBatchId && !batches.some((b) => b.id === eventBatchId)) return <BlockedState reason="not_found" backHref={backHref} />;
  if (eventBatchId && eventBatchId !== batch.id) return <PageLoader />;
  return (
    <LevelGate isLoading={event.isLoading || teams.isLoading || attendance.isLoading} found={value !== null} error={event.error ?? teams.error} backHref={backHref}>
      {value && <AdminEventContextProvider value={value}>{children}</AdminEventContextProvider>}
    </LevelGate>
  );
}
