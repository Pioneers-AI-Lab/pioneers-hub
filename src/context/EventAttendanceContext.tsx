"use client";

import { useMemo, type ReactNode } from "react";
import { eventRoster, type EventRoster } from "@shared/attendance";
import type { Founder, WithId } from "@shared/types";
import { queries } from "@/lib/firestore/refs";
import { createStrictContext } from "@/lib/createStrictContext";
import { useQueryListener } from "@/hooks/useFirestoreListener";
import { useParamsTS } from "@/hooks/useParamsTS";
import { useAdmin } from "@/context/AdminContext";

// ----------------------------
// Admin > Events > un evenement : ses attendus et leur presence (staff)
// ----------------------------
// Monte par admin/events/[eventId]/layout.tsx : la page de l'evenement en
// montre le resume, sa page Attendance la saisit. La regle : `eventRoster`
// (shared/attendance.ts).

type EventAttendanceValue = {
  /** `null` : evenement hors du batch de travail ou archive. */
  roster: EventRoster<WithId<Founder>> | null;
  isLoading: boolean;
};

const [EventAttendanceContextProvider, useEventAttendance] = createStrictContext<EventAttendanceValue>("EventAttendance");
export { useEventAttendance };

export function EventAttendanceProvider({ children }: { children: ReactNode }) {
  const { eventId } = useParamsTS<{ eventId: string }>();
  const { eventsById, founders } = useAdmin();
  const event = eventsById.get(eventId);
  const attendance = useQueryListener(event ? queries.attendanceOfEvent(eventId) : null);
  const value = useMemo<EventAttendanceValue>(
    () => ({ roster: event ? eventRoster(event.batchId, event, founders, attendance.data) : null, isLoading: attendance.isLoading }),
    [event, founders, attendance.data, attendance.isLoading],
  );
  return <EventAttendanceContextProvider value={value}>{children}</EventAttendanceContextProvider>;
}
