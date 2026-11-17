import { AdminTeamLocksProvider } from "@/context/AdminTeamLocksContext";

// Admin > Startups : les reponses a Lock my team du batch de travail, lues une fois.
export default function AdminStartupsLayout({ children }: LayoutProps<"/admin/startups">) {
  return <AdminTeamLocksProvider>{children}</AdminTeamLocksProvider>;
}
