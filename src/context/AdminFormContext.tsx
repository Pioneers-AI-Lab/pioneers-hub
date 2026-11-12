"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import type { Attendance, EventTeam, Form, FormResponse, WithId } from "@shared/types";
import { queries, refs } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useDocListener, useQueryListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { useAdmin } from "@/context/AdminContext";
import { LevelGate } from "@/components/ui/LevelGate";
import { PageLoader } from "@/components/ui/PageLoader";
import { BlockedState } from "@/components/ui/BlockedState";
import { paths } from "@/lib/paths";

// ----------------------------
// Admin : un formulaire (editeur et reponses)
// ----------------------------
// Monte par admin/forms/[formId]/layout.tsx. Comme pour les evenements, un
// formulaire d'un autre batch bascule le batch de travail sur le sien (la
// liste des evenements a rattacher est celle de son batch).
//
// Les reponses, et pour un formulaire rattache a un evenement ses presences et
// ses equipes : c'est ce qui dit QUI devait repondre (`formAudience`).

type AdminFormValue = {
  form: WithId<Form>;
  /** Plus recentes d'abord. */
  responses: WithId<FormResponse>[];
  /** Presences et equipes de l'evenement du formulaire (vides sans evenement). */
  attendance: WithId<Attendance>[];
  teams: WithId<EventTeam>[];
  isResponsesLoading: boolean;
};

const [AdminFormContextProvider, useAdminForm] = createStrictContext<AdminFormValue>("AdminForm");
export { useAdminForm };

export function AdminFormProvider({ children }: { children: ReactNode }) {
  const { formId } = useParamsTS<{ formId: string }>();
  const { batch, batches, selectBatch } = useAdmin();
  const form = useDocListener(refs.form(formId));
  const responses = useQueryListener(queries.responsesOfForm(formId));
  const eventId = form.data ? form.data.eventId : undefined;
  const attendance = useQueryListener(eventId === undefined ? undefined : eventId ? queries.attendanceOfEvent(eventId) : null);
  const teams = useQueryListener(eventId === undefined ? undefined : eventId ? queries.teamsOfEvent(eventId) : null);

  const formBatchId = form.data?.batchId ?? null;
  useEffect(() => {
    if (formBatchId && formBatchId !== batch.id) selectBatch(formBatchId);
  }, [formBatchId, batch.id, selectBatch]);

  const value = useMemo<AdminFormValue | null>(
    () =>
      form.data
        ? {
            form: form.data,
            responses: [...responses.data].sort((a, b) => b.submittedDateISOString.localeCompare(a.submittedDateISOString)),
            attendance: attendance.data,
            teams: teams.data,
            isResponsesLoading: responses.isLoading || attendance.isLoading || teams.isLoading,
          }
        : null,
    [form.data, responses.data, responses.isLoading, attendance.data, attendance.isLoading, teams.data, teams.isLoading],
  );

  // Batch archive : hors de la liste de travail, l'outil ne s'y applique plus.
  if (formBatchId && !batches.some((b) => b.id === formBatchId)) return <BlockedState reason="not_found" backHref={paths.adminForms()} />;
  if (formBatchId && formBatchId !== batch.id) return <PageLoader />;
  return (
    <LevelGate isLoading={form.isLoading} found={value !== null} error={form.error} backHref={paths.adminForms()}>
      {value && <AdminFormContextProvider value={value}>{children}</AdminFormContextProvider>}
    </LevelGate>
  );
}
