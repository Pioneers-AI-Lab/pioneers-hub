"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import type { Attendance, Form, FormResponse, WithId } from "@shared/types";
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
// Une fois le formulaire publie : ses reponses, et ce qui dit QUI devait
// repondre (`formAudience`) : les presences de son evenement quand elles
// comptent. Les equipes publiees viennent de `useAdmin().teamMemberships`.

type AdminFormValue = {
  form: WithId<Form>;
  /** Plus recentes d'abord (vide tant que le formulaire n'est pas publie). */
  responses: WithId<FormResponse>[];
  /** Presences de l'evenement du formulaire (vide sans evenement a presence, ou formulaire anonyme). */
  attendance: WithId<Attendance>[];
  isResponsesLoading: boolean;
};

const [AdminFormContextProvider, useAdminForm] = createStrictContext<AdminFormValue>("AdminForm");
export { useAdminForm };

export function AdminFormProvider({ children }: { children: ReactNode }) {
  const { formId } = useParamsTS<{ formId: string }>();
  const { batch, batches, selectBatch, eventsById } = useAdmin();
  const form = useDocListener(refs.form(formId));

  // `undefined` : on attend le formulaire ; `null` : rien a ecouter.
  const f = form.data;
  const event = f?.eventId ? eventsById.get(f.eventId) : undefined;
  // Les absents ne sont pas attendus (`formAudience`), quelle que soit la mecanique.
  const needsAttendance = f && f.identityCheck !== "anonymous" && event;
  const responses = useQueryListener(f === null ? undefined : f.version > 0 ? queries.responsesOfForm(formId) : null);
  // Lue par le suivi des reponses, donc pour un formulaire publie seulement.
  const attendance = useQueryListener(f === null ? undefined : f.version > 0 && needsAttendance ? queries.attendanceOfEvent(event.id) : null);

  const formBatchId = f?.batchId ?? null;
  useEffect(() => {
    if (formBatchId && formBatchId !== batch.id) selectBatch(formBatchId);
  }, [formBatchId, batch.id, selectBatch]);

  const value = useMemo<AdminFormValue | null>(
    () =>
      f
        ? {
            form: f,
            responses: [...responses.data].sort((a, b) => b.submittedDateISOString.localeCompare(a.submittedDateISOString)),
            attendance: attendance.data,
            isResponsesLoading: responses.isLoading || attendance.isLoading,
          }
        : null,
    [f, responses.data, responses.isLoading, attendance.data, attendance.isLoading],
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
