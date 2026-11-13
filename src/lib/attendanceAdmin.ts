import { writeBatch } from "firebase/firestore";
import type { AttendanceStatus } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";

// ----------------------------
// Presence a un evenement (staff, Admin > Events > Attendance)
// ----------------------------
// Ecriture directe (regle `attendance` : staff). La regle (present par defaut,
// premier geste) : shared/attendance.ts.

/** Donne `status` a un fondateur, et enregistre presents les attendus sans document (`eventRoster().unmarkedIds`). */
export async function markAttendance(eventId: string, founderId: string, status: AttendanceStatus, unmarkedIds: string[], markedByUid: string) {
  const batch = writeBatch(db);
  const markedDateISOString = new Date().toISOString();
  const put = (id: string, s: AttendanceStatus) =>
    batch.set(refs.attendance(eventId, id), { id, founderId: id, status: s, markedByUid, markedDateISOString });
  for (const id of unmarkedIds) if (id !== founderId) put(id, "present");
  put(founderId, status);
  await batch.commit();
}
