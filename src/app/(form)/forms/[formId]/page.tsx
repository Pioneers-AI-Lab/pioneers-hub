"use client";

import { FormSheet } from "@/components/forms/FormSheet";
import { TypeForm } from "@/components/forms/TypeForm";
import { isJuryForm } from "@shared/types";
import { usePublicForm } from "@/context/PublicFormContext";

// Une question par ecran (`TypeForm`), equipe et coequipiers compris (18/11 : la meme UX pour tout
// formulaire de fondateur ; un volet par coequipier). Le jury, qui compare les equipes a noter, tient
// sur une page (`FormSheet`).
export default function PublicFormPage() {
  const { form } = usePublicForm();
  return isJuryForm(form) ? <FormSheet /> : <TypeForm form={form} />;
}
