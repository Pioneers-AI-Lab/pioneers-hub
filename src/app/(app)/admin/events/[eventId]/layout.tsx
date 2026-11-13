import { AdminEventProvider } from "@/context/AdminEventContext";
import { EventAttendanceProvider } from "@/context/EventAttendanceContext";
import { paths } from "@/lib/paths";

// Un evenement et ce qui lui est attache (SPECS §2) : sa page, son tirage
// (`matching`), les resultats d'une equipe, sa presence.
export default function AdminEventLayout({ children }: LayoutProps<"/admin/events/[eventId]">) {
  return (
    <AdminEventProvider backHref={paths.adminEvents()}>
      <EventAttendanceProvider>{children}</EventAttendanceProvider>
    </AdminEventProvider>
  );
}
