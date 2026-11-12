"use client";

import { TypeForm } from "@/components/forms/TypeForm";
import { usePublicForm } from "@/context/PublicFormContext";

export default function PublicFormPage() {
  const { form } = usePublicForm();
  return <TypeForm form={form} />;
}
