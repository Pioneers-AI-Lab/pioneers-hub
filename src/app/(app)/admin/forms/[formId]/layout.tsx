import { AdminFormProvider } from "@/context/AdminFormContext";

export default function AdminFormLayout({ children }: LayoutProps<"/admin/forms/[formId]">) {
  return <AdminFormProvider>{children}</AdminFormProvider>;
}
