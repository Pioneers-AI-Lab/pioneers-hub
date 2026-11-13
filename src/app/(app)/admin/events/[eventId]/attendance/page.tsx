"use client";

import { useAdmin } from "@/context/AdminContext";
import { useParamsTS } from "@/hooks/useParamsTS";
import { paths } from "@/lib/paths";
import { AttendanceSheet } from "@/components/admin/AttendanceSheet";
import { BlockedState } from "@/components/ui/BlockedState";

// Admin > Events > un evenement > Attendance (evenement actif du batch de travail).
export default function AdminEventAttendancePage() {
  const { eventId } = useParamsTS<{ eventId: string }>();
  const { eventsById } = useAdmin();
  const event = eventsById.get(eventId);
  if (!event) return <BlockedState reason="not_found" backHref={paths.adminEvents()} />;
  return <AttendanceSheet event={event} />;
}
