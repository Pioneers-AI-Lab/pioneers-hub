import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { docPaths } from "../shared/collections";
import { PICKS_LIMITS } from "../shared/callables";
import { PICKS_MAX, isPickable, openPicks, type EventPicks, type Founder, type Picks } from "../shared/types";
import { founderIdOf } from "../api/viewer";
import { writeUiAudit } from "./audit";
import { cleanId, cleanText } from "./clean";
import { loadEvent } from "./events";

// ----------------------------
// services - les choix prives d'un evenement (SPECS §4.1)
// ----------------------------
// Le staff ouvre une demande sur un evenement (`PioneersEvent.picks` : question,
// nombre de choix, cloture) ; chaque fondateur du batch y classe ses choix,
// relisibles par lui seul et par le staff (`picks/{eventId}_{founderId}`).
// L'audit ne recopie pas les choix : ils restent prives.

const db = () => getFirestore();

function cleanEventPicks(input: unknown): EventPicks | null {
  if (input === null || input === undefined) return null;
  const raw = input as Partial<EventPicks>;
  const question = cleanText(raw.question, PICKS_LIMITS.question, "question");
  if (!question) throw new HttpsError("invalid-argument", "`question` is required.");
  const max = Number.isInteger(raw.max) ? (raw.max as number) : 0;
  if (max < 1 || max > PICKS_MAX) throw new HttpsError("invalid-argument", `\`max\` is a whole number from 1 to ${PICKS_MAX}.`);
  const closes = raw.closesDateISOString ?? null;
  if (closes !== null && (typeof closes !== "string" || Number.isNaN(Date.parse(closes)))) {
    throw new HttpsError("invalid-argument", "`closesDateISOString` must be a date.");
  }
  return { question, max, closesDateISOString: closes === null ? null : new Date(closes).toISOString() };
}

/** Staff : ouvre, modifie ou ferme (`null`) la demande de choix d'un evenement. */
export async function setEventPicks(actorUid: string, eventIdRaw: unknown, input: unknown): Promise<void> {
  const eventId = cleanId(eventIdRaw, "eventId");
  const picks = cleanEventPicks(input);
  await db().runTransaction(async (tx) => {
    const event = await loadEvent(tx, eventId);
    const path = docPaths.event(eventId);
    tx.update(db().doc(path), { picks, updatedDateISOString: new Date().toISOString() });
    writeUiAudit(tx, actorUid, "event.setPicks", path, { before: event.picks ?? null, after: picks });
  });
}

/** Fondateur : ses choix classes pour la demande ouverte de l'evenement. Rejouable : remplace les precedents. */
export async function submitPicks(uid: string, eventIdRaw: unknown, pickedRaw: unknown): Promise<void> {
  const eventId = cleanId(eventIdRaw, "eventId");
  // L'entree se verifie avant toute lecture.
  if (!Array.isArray(pickedRaw) || pickedRaw.length === 0 || pickedRaw.length > PICKS_MAX) {
    throw new HttpsError("invalid-argument", "Pick at least one founder.");
  }
  const picked = pickedRaw.map((id, i) => cleanId(id, `pickedFounderIds[${i}]`));
  if (new Set(picked).size !== picked.length) throw new HttpsError("invalid-argument", "Each founder can be picked once.");

  const event = await loadEvent(null, eventId);
  const now = new Date().toISOString();
  const picks = openPicks(event, now);
  if (!picks) throw new HttpsError("failed-precondition", "Picks are closed for this event.");
  if (picked.length > picks.max) throw new HttpsError("invalid-argument", `Pick from 1 to ${picks.max} founders.`);
  const [founderId, founders] = await Promise.all([
    founderIdOf(uid, event.batchId),
    db().getAll(...picked.map((id) => db().doc(docPaths.founder(id)))),
  ]);
  if (!founderId) throw new HttpsError("permission-denied", "Only a founder of this batch can pick.");
  if (picked.includes(founderId)) throw new HttpsError("invalid-argument", "You cannot pick yourself.");
  if (founders.some((f) => !f.exists || !isPickable(f.data() as Founder, event.batchId))) {
    throw new HttpsError("invalid-argument", "You can only pick founders of your batch.");
  }

  const ref = db().doc(docPaths.picks(eventId, founderId));
  await db().runTransaction(async (tx) => {
    const doc: Picks = {
      programId: event.programId,
      batchId: event.batchId,
      eventId,
      founderId,
      pickedFounderIds: picked,
      submittedDateISOString: now,
    };
    tx.set(ref, doc);
    writeUiAudit(tx, uid, "picks.submit", ref.path, { eventId, founderId, count: picked.length });
  });
}
