"use client";

import { useState } from "react";
import { Badge, TextInput } from "@mantine/core";
import type { AttendanceFounder, EventRoster } from "@shared/attendance";
import type { AttendanceStatus, PioneersEvent, WithId } from "@shared/types";
import { useAuth } from "@/context/AuthContext";
import { useEventAttendance } from "@/context/EventAttendanceContext";
import { useAction } from "@/hooks/useAction";
import { markAttendance } from "@/lib/attendanceAdmin";
import { formatDateTime, searchKey } from "@/lib/format";
import { paths } from "@/lib/paths";
import { ATTENDANCE_STYLE } from "@/components/event/eventLabels";
import { PageHeader } from "@/components/ui/PageHeader";
import { ButtonRow, LinkRow, RowList } from "@/components/ui/Rows";
import { Empty, Section } from "@/components/ui/Section";
import { PageLoader } from "@/components/ui/PageLoader";

// ----------------------------
// Admin > Events > un evenement > Attendance : qui est la (staff, sur place)
// ----------------------------
// Les attendus et la regle : `eventRoster` (shared/attendance.ts). Toucher un
// fondateur le marque absent, puis en retard, puis present.

/** Toucher un fondateur : present -> absent -> en retard -> present. */
const NEXT_STATUS: Record<AttendanceStatus, AttendanceStatus> = { present: "absent", absent: "late", late: "present", in_office: "present" };

/** « 28 present · 2 absent · 1 late », ou « Not taken yet ». */
function attendanceSummary({ rows, isTaken }: EventRoster<AttendanceFounder>): string {
  if (!isTaken) return `Not taken yet · ${rows.length} expected`;
  const count = (s: AttendanceStatus) => rows.filter((r) => r.status === s).length;
  const absent = count("absent");
  return [`${rows.length - absent} present`, `${absent} absent`, count("late") > 0 && `${count("late")} late`].filter(Boolean).join(" · ");
}

/** La ligne « Attendance » de la page d'un evenement, avec son resume. */
export function AttendanceLinkRow({ eventId }: { eventId: string }) {
  const { roster, isLoading } = useEventAttendance();
  return (
    <LinkRow
      href={paths.adminEventAttendance(eventId)}
      title="Attendance"
      subtitle={isLoading || !roster ? "…" : attendanceSummary(roster)}
    />
  );
}

export function AttendanceSheet({ event }: { event: WithId<PioneersEvent> }) {
  const { user } = useAuth();
  const { roster, isLoading } = useEventAttendance();
  const { isBusy, run } = useAction();
  const [search, setSearch] = useState("");

  if (isLoading || !roster) return <PageLoader />;
  const needle = searchKey(search.trim());
  const shown = needle ? roster.rows.filter((r) => searchKey(r.founder.name).includes(needle)) : roster.rows;

  const mark = (founderId: string, status: AttendanceStatus, name: string) => {
    if (!user) return;
    const next = NEXT_STATUS[status];
    void run(() => markAttendance(event.id, founderId, next, roster.unmarkedIds, user.id), `${name}: ${ATTENDANCE_STYLE[next].label.toLowerCase()}`);
  };

  return (
    <>
      <PageHeader
        back={{ href: paths.adminEvent(event.id), label: event.name }}
        title="Attendance"
        subtitle={[event.name, formatDateTime(event.startDateISOString)].join(" · ")}
      />

      <Section
        title={attendanceSummary(roster)}
        hint="Everyone is present until you mark them. Tap a founder once for absent, twice for late, three times for present again. Absent founders are left out of the draw, the event's forms and its picks: take attendance before them."
      >
        {roster.rows.length > 12 && (
          <TextInput mb="sm" maw={480} placeholder="Search a founder" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        )}
        {shown.length === 0 ? (
          <Empty>{roster.rows.length === 0 ? "No founder is expected at this event." : "No founder matches."}</Empty>
        ) : (
          <RowList>
            {shown.map(({ founder, status }) => (
              <ButtonRow
                key={founder.id}
                onClick={() => mark(founder.id, status, founder.name)}
                disabled={isBusy}
                avatar={{ name: founder.name, photoUrl: founder.photoUrl }}
                title={founder.name}
                meta={<Badge color={ATTENDANCE_STYLE[status].color}>{ATTENDANCE_STYLE[status].label}</Badge>}
              />
            ))}
          </RowList>
        )}
      </Section>
    </>
  );
}
