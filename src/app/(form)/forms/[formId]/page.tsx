"use client";

import { FormSheet } from "@/components/forms/FormSheet";
import { TypeForm } from "@/components/forms/TypeForm";
import { usePublicForm } from "@/context/PublicFormContext";

// Une question par ecran (`TypeForm`) ; un formulaire qui parle de l'equipe, des
// coequipiers ou des equipes a noter (Debrief, jury : toutes ses questions le
// sont, `formProblems`) tient sur une page (`FormSheet`).
export default function PublicFormPage() {
  const { form } = usePublicForm();
  return form.questions.some((q) => q.scope !== "self") ? <FormSheet /> : <TypeForm form={form} />;
}
