import { attendanceOptionalWrite } from "@shared/admin/events";
import { commitWrites } from "@/lib/firestore/write";

// ----------------------------
// Presence optionnelle d'un evenement (staff, Admin > Events > Attendance)
// ----------------------------
// Ecriture directe du staff sur `events/{id}` (regle `update` : staff, hors champs de
// l'agenda Google), par shared/admin/events.ts comme l'API (`set_attendance_optional`). Optionnelle : la presence est relevee, mais ni elle ni les
// formulaires de l'evenement ne comptent dans Engagement (shared/attendance.ts#isAttendanceOptional).

export const setAttendanceOptional = (eventId: string, optional: boolean) =>
  commitWrites("set_attendance_optional", [attendanceOptionalWrite(eventId, optional, new Date().toISOString())]);
