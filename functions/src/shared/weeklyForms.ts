import { eventTemplatePlan, type EventTemplatePlan, type TemplatedEvent, type TemplatedEventForm } from "./admin/events";
import { eventFormDates } from "./eventForms";
import type { EventTemplateKey } from "./presets/eventTemplates";
import { nameKey } from "./text";
import type { Batch, PioneersEvent } from "./types";

// ----------------------------
// Les formulaires hebdomadaires d'un batch (lot 4 ; decision du 18/11 : le Hub suit l'agenda)
// ----------------------------
// Ils naissent sur chaque entree « Weekly Update Form » de l'agenda Google du batch (fa26 : jeudis
// 03/12 et 10/12, 18:00) : la synchro (shared/calendarSync.ts) lui donne le template
// `weekly_update` (presets/eventTemplates.ts), dont le pack cree le Weekly update founder et le
// Weekly update startup, rattaches a l'entree, publies, ouverts a son debut, echeance 24 h apres
// (`FormTiming`), ids `<evenement>-<modele>`. Deplacee ou annulee dans l'agenda, l'entree emmene
// ses formulaires (`planEventMove`, `formsClosedByArchive`). Le staff peut aussi appliquer ce
// template a la main a tout evenement. Le reglage du batch `settings.weeklyForms.enabled` est
// l'interrupteur de la synchro. Sans presence (`withoutAttendance`) : ils vont a tout le batch.
// Rattrapage des entrees deja synchronisees : scripts/attach-weekly-forms.mjs.

const WEEKLY_UPDATE_TEMPLATE = "weekly_update" as const satisfies EventTemplateKey;

/** Le nom de l'entree de l'agenda, compare sans casse, accents ni espaces en trop (`nameKey`). */
const WEEKLY_UPDATE_ENTRY_KEY = nameKey("Weekly Update Form");

/** La synchro accroche les formulaires hebdomadaires aux entrees de l'agenda (`settings.weeklyForms.enabled`). */
export const weeklyFormsEnabled = (batch: Pick<Batch, "settings">) => batch.settings.weeklyForms?.enabled === true;

type WeeklyEvent = Pick<PioneersEvent, "name" | "templateKey">;

/** Un evenement du Weekly update : son template, ou, pas encore pose, l'entree de l'agenda de ce nom. */
export const isWeeklyUpdateEvent = (event: WeeklyEvent) =>
  event.templateKey === WEEKLY_UPDATE_TEMPLATE || (event.templateKey === null && nameKey(event.name) === WEEKLY_UPDATE_ENTRY_KEY);

/**
 * Ce que la synchro (ou le rattrapage) apporte a un evenement de l'agenda : sur une entree
 * « Weekly Update Form » sans template, le template `weekly_update` (`patch`) ; sur un evenement de
 * ce template, ses formulaires manquants (`forms`). Rien pour les autres, ni pour un evenement
 * masque ; rien non plus si le batch n'a pas `settings.weeklyForms.enabled`.
 */
export function weeklyFormsPlan(
  batch: Pick<Batch, "settings">,
  event: TemplatedEvent & Pick<PioneersEvent, "name" | "archivedDateISOString">,
  eventForms: readonly TemplatedEventForm[],
  nowISO: string,
): EventTemplatePlan {
  const none = { patch: {}, forms: [] };
  if (!weeklyFormsEnabled(batch) || event.archivedDateISOString !== null || !isWeeklyUpdateEvent(event)) return none;
  const plan = eventTemplatePlan(event, WEEKLY_UPDATE_TEMPLATE, eventForms, false, nowISO);
  return { patch: event.templateKey === null ? plan.patch : {}, forms: plan.forms };
}

/**
 * La date « Weekly goal » des milestones (`scoreMilestoneDueDates.weeklyGoalFrom`) : l'echeance du
 * Weekly update founder du DEUXIEME Weekly update du batch (le premier objectif est donne au premier,
 * juge au suivant). `null` avec moins de deux entrees.
 */
export function weeklyGoalFromOf(events: readonly (WeeklyEvent & Pick<PioneersEvent, "startDateISOString" | "endDateISOString" | "archivedDateISOString">)[]): string | null {
  const second = events
    .filter((e) => e.archivedDateISOString === null && isWeeklyUpdateEvent(e))
    .sort((a, b) => a.startDateISOString.localeCompare(b.startDateISOString))[1];
  return second ? eventFormDates("weekly_update_founder", second).deadlineDateISOString : null;
}
