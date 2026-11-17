import { AdminBackgroundProvider } from "@/context/AdminBackgroundContext";

// Admin > Background : l'annuaire et la note de chaque fondateur du batch, lus une
// fois pour la liste et la page de chaque fondateur.
export default function AdminBackgroundLayout({ children }: LayoutProps<"/admin/background">) {
  return <AdminBackgroundProvider>{children}</AdminBackgroundProvider>;
}
