import { CALENDAR_FIELDS, isFromCalendar, withoutCalendarFields } from "../calendarSync";
import { docPaths } from "../collections";
import { archiveWrite, mergeWrite, type DocWrite } from "../docWrites";
import {
  eventFormId,
  eventFormsPlan,
  eventFormWrites,
  formsClosedByArchive,
  formsReopenedByRestore,
  sameTime,
  type EventForPlan,
  type EventFormPlan,
  type EventMovePlan,
  type EventTimes,
} from "../eventForms";
import { matchingOf } from "../events";
import { EVENT_TEMPLATES, type EventTemplateKey } from "../presets/eventTemplates";
import { FORM_TEMPLATES } from "../presets/formTemplates";
import { scoringOf, type Form, type PioneersEvent, type WithId } from "../types";

// ----------------------------
// Admin > Events : regler, deplacer, archiver un evenement, lui appliquer un modele
// ----------------------------
// Les gestes de la page d'un evenement, en logique pure (shared/docWrites.ts) :
// le front (lib/eventsAdmin.ts) et l'API (services/admin/events.ts) ecrivent
// les memes documents. Rien n'est supprime : on archive. Deplacer ou archiver
// entraine ses formulaires (dates, fermeture) dans le meme lot.

/** Les reglages modifiables depuis la page de l'evenement. */
export const EVENT_SETTINGS_KEYS = [
  "name",
  "topic",
  "startDateISOString",
  "endDateISOString",
  "location",
  "isMilestone",
  "status",
  "signUpUrl",
  "resourceUrl",
  "videoCallUrl",
  "audience",
  "guests",
  "guestFounderIds",
  "mentorIds",
  "startupIds",
] as const satisfies readonly (keyof PioneersEvent)[];

export type EventSettings = Pick<PioneersEvent, (typeof EVENT_SETTINGS_KEYS)[number]>;

/**
 * Les champs d'agenda donnes pour un evenement venu de l'agenda Google : ils ne
 * s'ecrivent que par la synchro (la regle refuserait tout le lot). L'API les
 * refuse en le disant ; l'editeur les retire (`editableSettings`).
 */
export const lockedSettingKeys = (event: Pick<PioneersEvent, "calendarSource">, settings: Partial<EventSettings>): string[] =>
  isFromCalendar(event) ? CALENDAR_FIELDS.filter((k) => settings[k] !== undefined) : [];

export const editableSettings = (event: Pick<PioneersEvent, "calendarSource">, settings: Partial<EventSettings>): Partial<EventSettings> =>
  isFromCalendar(event) ? withoutCalendarFields(settings) : settings;

/** Le nouvel horaire deplace l'evenement (meme instant ecrit autrement : non). */
export const isEventMoved = (event: EventTimes, next: EventTimes) =>
  !sameTime(event.startDateISOString, next.startDateISOString) || !sameTime(event.endDateISOString, next.endDateISOString);

/**
 * Les reglages et, s'il est deplace, ce que le nouvel horaire entraine
 * (`planEventMove`, shared/eventForms.ts) : le creneau Debrief accole et les
 * dates des formulaires. Seules les dates changent : aucune nouvelle version.
 */
export function eventSettingsWrites(
  event: WithId<Pick<PioneersEvent, "calendarSource">>,
  settings: Partial<EventSettings>,
  move: EventMovePlan<WithId<unknown>, WithId<unknown>> | null,
  now: string,
): DocWrite[] {
  const writes = [mergeWrite(docPaths.event(event.id), { ...editableSettings(event, settings), updatedDateISOString: now })];
  if (move?.linked?.isMoved) writes.push(mergeWrite(docPaths.event(move.linked.event.id), { ...move.linked.to, updatedDateISOString: now }));
  for (const m of move?.moves ?? []) {
    writes.push(mergeWrite(docPaths.form(m.form.id), { opensDateISOString: m.opensDateISOString, deadlineDateISOString: m.deadlineDateISOString, updatedDateISOString: now }));
  }
  return writes;
}

/**
 * Archiver : l'evenement sort des listes, du calendrier et des pages des
 * fondateurs, et ses formulaires ouverts se ferment. Restaurer rouvre ceux que
 * l'archivage a fermes. `forms` : les formulaires de l'evenement.
 */
export function eventArchiveWrites<F extends WithId<Pick<Form, "status" | "updatedDateISOString">>>(
  event: WithId<Pick<PioneersEvent, "archivedDateISOString">>,
  archived: boolean,
  forms: readonly F[],
  now: string,
): { writes: DocWrite[]; touchedForms: F[] } {
  const touchedForms = archived ? formsClosedByArchive(forms) : formsReopenedByRestore(event, forms);
  const status = archived ? "closed" : "open";
  return {
    writes: [archiveWrite(docPaths.event(event.id), archived, now), ...touchedForms.map((f) => mergeWrite(docPaths.form(f.id), { status, updatedDateISOString: now }))],
    touchedForms,
  };
}

export type EventTemplatePlan = { patch: Partial<PioneersEvent>; forms: EventFormPlan[] };

/** Un evenement existant auquel s'applique un modele, et ses formulaires (archives compris). */
export type TemplatedEvent = WithId<EventForPlan & Pick<PioneersEvent, "scoring">>;
export type TemplatedEventForm = WithId<Pick<Form, "kind" | "archivedDateISOString">>;

/**
 * LE planificateur « appliquer un modele » a un evenement existant (venu de
 * l'agenda Google, SPECS §2) : son etiquette, son matching s'il n'en a pas (et
 * qu'aucun groupe n'est tire), son bareme s'il n'en a pas (grille Pitch), et
 * les formulaires du pack qu'il n'a pas encore (ni meme id, ni meme type parmi
 * ses formulaires actifs), publies comme a la creation (shared/eventForms.ts).
 * Admin > Events (TemplateField, lib/eventsAdmin.ts), `apply_event_template`
 * (services/admin/events.ts), et le Weekly update de la synchro de l'agenda et
 * de scripts/attach-weekly-forms.mjs (shared/weeklyForms.ts#weeklyFormsPlan).
 */
export function eventTemplatePlan(
  event: TemplatedEvent,
  templateKey: EventTemplateKey,
  eventForms: readonly TemplatedEventForm[],
  hasTeams: boolean,
  now: string,
): EventTemplatePlan {
  const t = EVENT_TEMPLATES[templateKey];
  const patch: Partial<PioneersEvent> = { templateKey, kind: t.kind, stage: t.stage };
  if (!matchingOf(event) && !hasTeams && t.matching) patch.matching = t.matching;
  if (!scoringOf(event) && t.scoring) patch.scoring = t.scoring;
  // Seulement les formulaires du pack qui manquent (ni meme id, ni meme type actif) : rien a construire pour le reste.
  const kinds = new Set(eventForms.filter((f) => f.archivedDateISOString === null).map((f) => f.kind));
  const ids = new Set(eventForms.map((f) => f.id));
  const missing = t.forms.filter((key) => !ids.has(eventFormId(event.id, key)) && !kinds.has(FORM_TEMPLATES[key].kind));
  return { patch, forms: missing.length ? eventFormsPlan(event.id, { ...event, ...patch }, { forms: missing }, now) : [] };
}

export const eventTemplateWrites = (eventId: string, plan: EventTemplatePlan, now: string): DocWrite[] => [
  mergeWrite(docPaths.event(eventId), { ...plan.patch, updatedDateISOString: now }),
  ...plan.forms.flatMap((p) => eventFormWrites(p, now)),
];

/**
 * Presence optionnelle (Admin > Events > Attendance) : relevee, mais ni elle ni les
 * formulaires de l'evenement ne comptent dans Engagement (shared/attendance.ts#isAttendanceOptional).
 */
export const attendanceOptionalWrite = (eventId: string, optional: boolean, now: string): DocWrite =>
  mergeWrite(docPaths.event(eventId), { attendanceOptional: optional, updatedDateISOString: now });
