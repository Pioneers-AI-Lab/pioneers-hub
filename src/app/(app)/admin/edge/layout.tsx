import { AdminBackgroundProvider } from "@/context/AdminBackgroundContext";

// Admin > Edge : l'annuaire et la note de chaque fondateur du batch (meme lecture qu'Admin > Background).
export default function AdminEdgeLayout({ children }: LayoutProps<"/admin/edge">) {
  return <AdminBackgroundProvider>{children}</AdminBackgroundProvider>;
}
