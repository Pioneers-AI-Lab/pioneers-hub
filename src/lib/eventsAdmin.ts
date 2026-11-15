import { doc, writeBatch } from "firebase/firestore";
import { eventFormDocs, eventFormsPlan, type EventMovePlan } from "@shared/eventForms";
import type { EventData } from "@shared/events";
import type { Form, PioneersEvent, WithId } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";
import { patchDoc } from "@/lib/firestore/write";

// ----------------------------
// Evenements d'un batch (staff) : creation, reglages, archivage (le matching : lib/teamsAdmin.ts)
// ----------------------------
// Ecriture directe (regle `events` : staff). Rien n'est supprime : on archive.
// Deplacer ou archiver entraine ses formulaires (dates, fermeture) dans le meme
// lot : c'est le seul chemin d'ecriture d'un horaire ou d'un archivage (aucun
// service serveur ne le fait) ; un futur outil MCP devra reprendre ces regles.

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

/**
 * Enregistre les reglages et, en un lot, ce que le nouvel horaire deplace
 * (`planEventMove`, shared/eventForms.ts) : le creneau Debrief accole et les
 * dates des formulaires. Seules les dates changent : aucune nouvelle version.
 */
/** Le plan d'un deplacement, sur les documents de l'admin. */
export type EventMove = EventMovePlan<WithId<Form>, WithId<PioneersEvent>>;

export async function saveEventMove(eventId: string, settings: Partial<EventSettings>, plan: EventMove) {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.set(refs.event(eventId), { ...settings, updatedDateISOString: now }, { merge: true });
  if (plan.linked?.isMoved) batch.set(refs.event(plan.linked.event.id), { ...plan.linked.to, updatedDateISOString: now }, { merge: true });
  for (const m of plan.moves) {
    batch.set(refs.form(m.form.id), { opensDateISOString: m.opensDateISOString, deadlineDateISOString: m.deadlineDateISOString, updatedDateISOString: now }, { merge: true });
  }
  await batch.commit();
}

/**
 * Les formulaires ouverts d'un evenement : l'archivage les ferme (ils sortent du
 * To do et ne prennent plus de reponse).
 */
export const formsClosedByArchive = (forms: readonly WithId<Form>[]) => forms.filter((f) => f.status === "open");

/**
 * Ceux que l'archivage a fermes, et que personne n'a touches depuis : ils
 * portent l'heure de l'archivage (meme lot). La restauration les rouvre.
 * Choix delibere, faute de marque sur le formulaire (aucun champ du type `Form`) :
 * un formulaire ferme puis retouche par le staff reste ferme a la restauration.
 */
export const formsReopenedByRestore = (event: Pick<PioneersEvent, "archivedDateISOString">, forms: readonly WithId<Form>[]) =>
  forms.filter((f) => f.status === "closed" && f.updatedDateISOString === event.archivedDateISOString);

/**
 * Archive (sort des listes, du calendrier et des pages des fondateurs, et ferme
 * ses formulaires ouverts) ou restaure (rouvre ceux que l'archivage a fermes).
 * `forms` : les formulaires de l'evenement.
 */
export async function setEventArchived(event: WithId<PioneersEvent>, archived: boolean, forms: readonly WithId<Form>[]) {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.set(refs.event(event.id), { archivedDateISOString: archived ? now : null, updatedDateISOString: now }, { merge: true });
  const touched = archived ? formsClosedByArchive(forms) : formsReopenedByRestore(event, forms);
  const status = archived ? "closed" : "open";
  for (const f of touched) batch.set(refs.form(f.id), { status, updatedDateISOString: now }, { merge: true });
  await batch.commit();
}
