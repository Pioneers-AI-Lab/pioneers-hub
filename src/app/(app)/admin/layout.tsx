import { AdminProvider } from "@/context/AdminContext";

// Garde de /admin : AdminProvider refuse tout compte sans role `staff`, et
// porte le batch de travail et ses listes pour tous les outils.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminProvider>{children}</AdminProvider>;
}
