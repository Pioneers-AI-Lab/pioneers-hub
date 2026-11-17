import { parisDay, parisMidnight } from "./dates";
import type { EventFormPlan } from "./eventForms";
import { endAfter } from "./events";
import { firstPublication, newForm } from "./forms";
import { FORM_TEMPLATES, type FormTemplateKey } from "./presets/formTemplates";
import type { Batch, WithId } from "./types";

// ----------------------------
// Les formulaires hebdomadaires d'un batch (lot 4, decision du 17/11)
// ----------------------------
// Chaque jeudi a 18:45 (heure de Paris), le Weekly update founder et le Weekly update startup
// de la semaine, publies, ouverts tout de suite, echeance 24 h apres (SPECS §4.4 : un formulaire
// par occurrence, ses reponses vont dans la semaine ou il ouvre). Pour un batch dont
// `settings.weeklyForms` est `{ enabled: true, startDayString }`, a partir de ce jour.
// Ids deterministes (`weeklyFormId`) : une relance le meme jour ne cree rien de plus.
// Logique pure : la fonction programmee `weeklyForms` (services/weeklyForms.ts) et
// scripts/create-weekly-forms.mjs (creation a la main, a blanc par defaut) suivent ce plan.

/** Les deux formulaires de la semaine, et le modele de chacun. */
const WEEKLY_FORM_TEMPLATES = { founder: "weekly_update_founder", startup: "weekly_update_startup" } as const satisfies Record<string, FormTemplateKey>;
type WeeklyFormKind = keyof typeof WEEKLY_FORM_TEMPLATES;

/** L'heure d'ouverture, a Paris. */
const OPENING = { hour: 18, minute: 45 } as const;
/** Le planning de la fonction programmee `weeklyForms` : chaque jeudi a l'heure d'ouverture (fuseau Europe/Paris). */
export const WEEKLY_FORMS_SCHEDULE = `${OPENING.minute} ${OPENING.hour} * * 4`;
/** L'echeance : 24 h apres l'ouverture. */
const DEADLINE_MINUTES = 24 * 60;

/** `fall-2026-weekly-founder-2026-11-26`. */
const weeklyFormId = (batchId: string, kind: WeeklyFormKind, dayString: string) => `${batchId}-weekly-${kind}-${dayString}`;

/** L'instant d'ouverture d'un jour donne (`--date` du script) : 18:45 a Paris. */
export const weeklyFormsOpening = (dayString: string) => endAfter(parisMidnight(dayString), OPENING.hour * 60 + OPENING.minute);

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", day: "numeric", month: "short" });

export type WeeklyFormsBatch = WithId<Pick<Batch, "programId" | "status" | "archivedDateISOString" | "endDayString" | "settings">>;

export type WeeklyFormsPlan = {
  batchId: string;
  /** Le jour d'ouverture, a Paris. */
  dayString: string;
  /** Pourquoi rien ne se cree ce jour-la ; `null` : les deux formulaires sont a creer. */
  skip: string | null;
  plans: EventFormPlan[];
};

/** Pourquoi ce batch n'a pas ses formulaires ce jour-la, `null` s'il les a. */
function skipReason(batch: WeeklyFormsBatch, dayString: string): string | null {
  const settings = batch.settings.weeklyForms;
  if (!settings?.enabled) return "weekly forms are not enabled (settings.weeklyForms)";
  if (batch.archivedDateISOString !== null || batch.status === "completed") return "the batch is archived or completed";
  if (dayString < settings.startDayString) return `before ${settings.startDayString}`;
  if (batch.endDayString && dayString > batch.endDayString) return `after the batch end (${batch.endDayString})`;
  return null;
}

/**
 * Les formulaires de la semaine pour ce batch, ouverts a `nowISO` : publies (version 1, ouverts),
 * echeance 24 h apres. Le titre porte le jour (« Weekly update · 26 Nov ») : une semaine se
 * retrouve dans Admin > Forms et dans le To do.
 */
export function weeklyFormsPlan(batch: WeeklyFormsBatch, nowISO: string): WeeklyFormsPlan {
  const dayString = parisDay(nowISO);
  const skip = skipReason(batch, dayString);
  if (skip) return { batchId: batch.id, dayString, skip, plans: [] };
  const deadline = endAfter(nowISO, DEADLINE_MINUTES);
  const plans = (Object.entries(WEEKLY_FORM_TEMPLATES) as [WeeklyFormKind, FormTemplateKey][]).map(([kind, templateKey]) => {
    const draft = newForm(
      { programId: batch.programId, batchId: batch.id, templateKey, eventId: null },
      { title: `${FORM_TEMPLATES[templateKey].title} · ${DAY_LABEL.format(new Date(nowISO))}`, opensDateISOString: nowISO, deadlineDateISOString: deadline },
    );
    const { form, version } = firstPublication(draft, nowISO);
    return { id: weeklyFormId(batch.id, kind, dayString), templateKey, form, version };
  });
  return { batchId: batch.id, dayString, skip: null, plans };
}
