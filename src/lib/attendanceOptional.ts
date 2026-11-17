import { refs } from "@/lib/firestore/refs";
import { patchDoc } from "@/lib/firestore/write";

// ----------------------------
// Presence optionnelle d'un evenement (staff, Admin > Events > Attendance)
// ----------------------------
// Ecriture directe du staff sur `events/{id}` (regle `update` : staff, hors champs de
// l'agenda Google). Optionnelle : la presence est relevee, mais ni elle ni les
// formulaires de l'evenement ne comptent dans Engagement (shared/attendance.ts#isAttendanceOptional).

export const setAttendanceOptional = (eventId: string, optional: boolean) =>
  patchDoc(refs.event(eventId), { attendanceOptional: optional });
