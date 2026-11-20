import { doc } from "firebase/firestore";
import { eventArchiveWrites, eventSettingsWrites, eventTemplatePlan, eventTemplateWrites, type EventSettings } from "@shared/admin/events";
import { docPaths } from "@shared/collections";
import { setWrite } from "@shared/docWrites";
import { eventFormsPlan, eventFormWrites, type EventMovePlan } from "@shared/eventForms";
import type { EventData } from "@shared/events";
import type { EventTemplateKey } from "@shared/presets/eventTemplates";
import type { Form, PioneersEvent, WithId } from "@shared/types";
import { refs } from "@/lib/firestore/refs";
import { commitWrites } from "@/lib/firestore/write";

// ----------------------------
// Evenements d'un batch (staff) : creation, reglages, archivage (le matching : lib/teamsAdmin.ts)
// ----------------------------
// Ecriture directe (regle `events` : staff). Les gestes sont calcules par
// shared/admin/events.ts, comme pour l'API (`update_event`, `archive_event`,
// `apply_event_template`) : une seule regle, deux executants.

/**
 * Ecrit un nouvel evenement, construit par `newEvent` (shared/events.ts), et
 * les formulaires de son pack (shared/eventForms.ts) en un seul lot : publies
 * s'il est programme, en brouillon s'il l'est. Rend son id.
 */
export async function createEventPack(data: EventData): Promise<string> {
  const now = new Date().toISOString();
  const id = doc(refs.events()).id;
  await commitWrites("create_event", [
    // Id automatique : rien a verifier, un lot suffit.
    setWrite(docPaths.event(id), { ...data, createdDateISOString: now, updatedDateISOString: now }),
    ...eventFormsPlan(id, data, {}, now).flatMap((plan) => eventFormWrites(plan, now)),
  ]);
  return id;
}

/** Ce qu'apporte un modele a un evenement existant (shared/admin/events.ts#eventTemplatePlan). */
export function templatePlan(event: WithId<PioneersEvent>, templateKey: EventTemplateKey, eventForms: readonly WithId<Form>[], hasTeams: boolean) {
  const now = new Date().toISOString();
  return { ...eventTemplatePlan(event, templateKey, eventForms, hasTeams, now), now };
}

export const applyEventTemplate = (eventId: string, plan: ReturnType<typeof templatePlan>) => commitWrites("apply_event_template", eventTemplateWrites(eventId, plan, plan.now));

export type { EventSettings };

export const updateEvent = (event: WithId<PioneersEvent>, settings: Partial<EventSettings>) =>
  commitWrites("update_event", eventSettingsWrites(event, settings, null, new Date().toISOString()));

/** Le plan d'un deplacement, sur les documents de l'admin. */
export type EventMove = EventMovePlan<WithId<Form>, WithId<PioneersEvent>>;

/** Enregistre les reglages et, en un lot, ce que le nouvel horaire deplace (shared/admin/events.ts). */
export const saveEventMove = (event: WithId<PioneersEvent>, settings: Partial<EventSettings>, plan: EventMove) =>
  commitWrites("update_event", eventSettingsWrites(event, settings, plan, new Date().toISOString()));

/** Archive ou restaure, avec ses formulaires (shared/admin/events.ts#eventArchiveWrites). */
export const setEventArchived = (event: WithId<PioneersEvent>, archived: boolean, forms: readonly WithId<Form>[]) =>
  commitWrites("archive_event", eventArchiveWrites(event, archived, forms, new Date().toISOString()).writes);
