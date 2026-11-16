import { doc, writeBatch } from "firebase/firestore";
import { eventFormDocs, eventFormsPlan, formsClosedByArchive, formsReopenedByRestore, type EventMovePlan } from "@shared/eventForms";
import { isFromCalendar, withoutCalendarFields } from "@shared/calendarSync";
import { matchingOf, type EventData } from "@shared/events";
import { EVENT_TEMPLATES, type EventTemplateKey } from "@shared/presets/eventTemplates";
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

/**
 * Ce qu'apporte un template a un evenement existant (venu de l'agenda Google,
 * SPECS §2, 16/11) : son etiquette, son matching s'il n'en a pas (et qu'aucun
 * groupe n'est tire), et les formulaires du pack qu'il n'a pas encore, publies
 * comme a la creation (shared/eventForms.ts). `applyEventTemplate` l'ecrit.
 */
export function templatePlan(event: WithId<PioneersEvent>, templateKey: EventTemplateKey, eventForms: readonly WithId<Form>[], hasTeams: boolean) {
  const t = EVENT_TEMPLATES[templateKey];
  const patch: Partial<PioneersEvent> = { templateKey, kind: t.kind, stage: t.stage };
  if (!matchingOf(event) && !hasTeams && t.matching) patch.matching = t.matching;
  const now = new Date().toISOString();
  const kinds = new Set(eventForms.filter((f) => f.archivedDateISOString === null).map((f) => f.kind));
  const ids = new Set(eventForms.map((f) => f.id));
  const forms = eventFormsPlan(event.id, { ...event, ...patch }, {}, now).filter((p) => !ids.has(p.id) && !kinds.has(p.form.kind));
  return { patch, forms, now };
}

export async function applyEventTemplate(eventId: string, plan: ReturnType<typeof templatePlan>) {
  const batch = writeBatch(db);
  batch.set(refs.event(eventId), { ...plan.patch, updatedDateISOString: plan.now }, { merge: true });
  for (const p of plan.forms) for (const d of eventFormDocs(p, plan.now)) batch.set(doc(db, d.path), d.data);
  await batch.commit();
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

/** Un evenement venu de l'agenda Google garde ses champs d'agenda : ils ne s'ecrivent pas (la regle refuserait tout le lot). */
const editable = (event: Pick<PioneersEvent, "calendarSource">, settings: Partial<EventSettings>) =>
  isFromCalendar(event) ? withoutCalendarFields(settings) : settings;

export const updateEvent = (event: WithId<PioneersEvent>, settings: Partial<EventSettings>) =>
  patchDoc<PioneersEvent>(refs.event(event.id), editable(event, settings));

/**
 * Enregistre les reglages et, en un lot, ce que le nouvel horaire deplace
 * (`planEventMove`, shared/eventForms.ts) : le creneau Debrief accole et les
 * dates des formulaires. Seules les dates changent : aucune nouvelle version.
 */
/** Le plan d'un deplacement, sur les documents de l'admin. */
export type EventMove = EventMovePlan<WithId<Form>, WithId<PioneersEvent>>;

export async function saveEventMove(event: WithId<PioneersEvent>, settings: Partial<EventSettings>, plan: EventMove) {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.set(refs.event(event.id), { ...editable(event, settings), updatedDateISOString: now }, { merge: true });
  if (plan.linked?.isMoved) batch.set(refs.event(plan.linked.event.id), { ...plan.linked.to, updatedDateISOString: now }, { merge: true });
  for (const m of plan.moves) {
    batch.set(refs.form(m.form.id), { opensDateISOString: m.opensDateISOString, deadlineDateISOString: m.deadlineDateISOString, updatedDateISOString: now }, { merge: true });
  }
  await batch.commit();
}

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
