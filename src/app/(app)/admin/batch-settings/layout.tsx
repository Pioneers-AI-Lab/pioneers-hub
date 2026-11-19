import { AdminBatchResourcesProvider } from "@/context/BatchResourcesContext";

// Admin > Batch settings : les liens utiles du batch de travail (section Resources).
export default function AdminBatchSettingsLayout({ children }: LayoutProps<"/admin/batch-settings">) {
  return <AdminBatchResourcesProvider>{children}</AdminBatchResourcesProvider>;
}
