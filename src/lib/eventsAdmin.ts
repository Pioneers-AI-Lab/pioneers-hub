import { doc, writeBatch } from "firebase/firestore";
import { eventFormDocs, eventFormsPlan } from "@shared/eventForms";
import type { EventData } from "@shared/events";
import type { EventMatching, PioneersEvent } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";
import { patchDoc } from "@/lib/firestore/write";

// ----------------------------
// Evenements d'un batch (staff) : creation, reglages, matching, archivage
// ----------------------------
// Ecriture directe (regle `events` : staff). Rien n'est supprime : on archive.

/**
 * Ecrit un nouvel evenement, construit par `newEvent` (shared/events.ts), et
 * les formulaires de son pack (shared/eventForms.ts) en un seul lot : publies
 * s'il est programme, en brouillon s'il l'est. Rend son id.
 */
export async function createEventPack(data: EventData): Promise<string> {
  const now = new Date().toISOString();
  const ref = doc(refs.events());
  const batch = writeBatch(db);
  // Le convertisseur des references retire l'id : le document s'ecrit tel quel.
  batch.set(ref, { ...data, id: ref.id, createdDateISOString: now, updatedDateISOString: now } as PioneersEvent & { id: string });
  for (const plan of eventFormsPlan(ref.id, data, {}, now)) {
    for (const d of eventFormDocs(plan, now)) batch.set(doc(db, d.path), d.data);
  }
  await batch.commit();
  return ref.id;
}

/** Les reglages modifiables depuis la page de l'evenement (Admin > Events). */
export type EventSettings = Pick<
  PioneersEvent,
  | "name"
  | "topic"
  | "startDateISOString"
  | "endDateISOString"
  | "location"
  | "isMilestone"
  | "status"
  | "signUpUrl"
  | "resourceUrl"
  | "audience"
  | "guests"
  | "guestFounderIds"
  | "mentorIds"
  | "startupIds"
>;

export const updateEvent = (eventId: string, settings: Partial<EventSettings>) => patchDoc<PioneersEvent>(refs.event(eventId), settings);

/** Ajoute, change ou retire (`null`) le matching de l'evenement. */
export const setEventMatching = (eventId: string, matching: EventMatching | null) => patchDoc<PioneersEvent>(refs.event(eventId), { matching });

/** Archive (sort des listes, du calendrier et des pages des fondateurs) ou restaure. */
export const setEventArchived = (eventId: string, archived: boolean) =>
  patchDoc<PioneersEvent>(refs.event(eventId), { archivedDateISOString: archived ? new Date().toISOString() : null });
