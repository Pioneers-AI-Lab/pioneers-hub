import { attendanceWrites } from "@shared/admin/batch";
import type { AttendanceStatus } from "@shared/types";
import { commitWrites } from "@/lib/firestore/write";

// ----------------------------
// Presence a un evenement (staff, Admin > Events > Attendance)
// ----------------------------
// Ecriture directe (regle `attendance` : staff). La regle (present par defaut,
// premier geste) : shared/attendance.ts ; les ecritures : shared/admin/batch.ts,
// comme pour l'API (`mark_attendance`).

/** Donne `status` a un fondateur, et enregistre presents les attendus sans document (`eventRoster().unmarkedIds`). */
export const markAttendance = (eventId: string, founderId: string, status: AttendanceStatus, unmarkedIds: string[], markedByUid: string) =>
  commitWrites("mark_attendance", attendanceWrites(eventId, [{ founderId, status }], unmarkedIds, markedByUid, new Date().toISOString()));
