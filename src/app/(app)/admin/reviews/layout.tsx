import { AdminReviewsProvider } from "@/context/AdminReviewsContext";

// Admin > Reviews : les Weekly updates du batch et leurs revues, lus une fois pour la liste
// des semaines, la file d'une semaine et la page de chaque update.
export default function AdminReviewsLayout({ children }: LayoutProps<"/admin/reviews">) {
  return <AdminReviewsProvider>{children}</AdminReviewsProvider>;
}
