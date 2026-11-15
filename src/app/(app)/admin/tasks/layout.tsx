import { AdminTasksProvider } from "@/context/AdminTasksContext";

// Admin > Tasks : les taches du batch de travail et les coches des fondateurs,
// lues une fois pour la liste et la page de chaque tache.
export default function AdminTasksLayout({ children }: LayoutProps<"/admin/tasks">) {
  return <AdminTasksProvider>{children}</AdminTasksProvider>;
}
