import { docPaths } from "./collections";
import { isUpcomingEvent, matchingOf } from "./events";
import { firstPublication, newForm, type FormData } from "./forms";
import { eventTemplateOf } from "./presets/eventTemplates";
import { FORM_TEMPLATES, templateQuestions, type FormTemplateKey } from "./presets/formTemplates";
import type { Criterion, EventMetric, FormVersion, PioneersEvent } from "./types";

// ----------------------------
// Les formulaires d'un evenement : ceux de son pack, et ceux d'un evenement d'avant
// ----------------------------
// SPECS §2 (decisions du 12/11 et du 13/11) : un modele d'evenement est un PACK
// (l'evenement, son matching, ses formulaires). Les formulaires naissent COMME
// L'EVENEMENT : cree « Scheduled », ils sont publies et s'ouvrent a son debut ;
// cree en brouillon, ils sont en brouillon (le staff les publie). Un evenement
// passe (migration) garde ses formulaires FERMES : sa grille et ses metriques
// restent lisibles (leaderboard, fiches).
//
// Ecrivains : Admin > Events > New (src/lib/eventsAdmin.ts), `create_event`
// (services/eventCreate.ts), `scripts/import-events.mjs`, et
// `scripts/migrate-standard-forms.mjs` qui part des anciens champs d'un
// evenement (`metrics`, `criteria`, `picks`) avant de les retirer.

/** Ce que portait un evenement d'avant le modele standard. */
export type LegacyEventSettings = {
  metrics?: EventMetric[] | null;
  criteria?: Criterion[] | null;
  picks?: { question: string; max: number; closesDateISOString: string | null } | null;
};

export type EventFormsOptions = {
  /** Les formulaires a creer ; par defaut ceux du pack du modele. */
  forms?: readonly FormTemplateKey[];
  /** Remplace les metriques du Debrief (import : celles du fichier). */
  metrics?: EventMetric[] | null;
  /** Les anciens champs (migration) : ils ajoutent leurs formulaires. */
  legacy?: LegacyEventSettings;
};

export type EventFormPlan = { id: string; templateKey: FormTemplateKey; form: FormData; version: FormVersion | null };

type EventForPlan = Pick<
  PioneersEvent,
  "programId" | "batchId" | "kind" | "templateKey" | "startDateISOString" | "endDateISOString" | "status" | "matching" | "teamSize"
>;

export function eventFormsPlan(eventId: string, event: EventForPlan, options: EventFormsOptions, nowISO: string): EventFormPlan[] {
  const legacy = options.legacy ?? {};
  const isPast = !isUpcomingEvent(event, nowISO);
  const preset = eventTemplateOf(event.templateKey);
  const hasTeams = matchingOf(event) !== null;
  const metrics = legacy.metrics ?? options.metrics ?? preset?.metrics ?? [];
  const criteria = legacy.criteria ?? preset?.criteria ?? [];

  // Un evenement passe : seulement ce que portaient ses anciens champs. A venir : le pack, et l'ancien en plus.
  const wanted = new Set<FormTemplateKey>(isPast ? [] : (options.forms ?? preset?.forms ?? []));
  if (legacy.metrics?.length) wanted.add("debrief");
  if (legacy.criteria?.length) wanted.add("jury");
  if (legacy.picks) wanted.add("picks");
  // Un Debrief parle de l'equipe : il faut un matching ; un jury, une grille.
  if (!hasTeams) wanted.delete("debrief");
  if (criteria.length === 0) wanted.delete("jury");

  // Comme l'evenement : publie (ouvert a son debut), en brouillon, ou ferme s'il est passe.
  const status = isPast ? "closed" : event.status === "draft" ? "draft" : "open";
  return [...wanted].map((templateKey) => {
    let extra: Parameters<typeof newForm>[1] = { opensDateISOString: status === "open" ? event.startDateISOString : null };
    if (templateKey === "picks" && legacy.picks) {
      // La question, le nombre de choix et la cloture de l'ancienne demande ; ouverte des maintenant.
      const { question, max, closesDateISOString } = legacy.picks;
      const questions = templateQuestions(FORM_TEMPLATES.picks, { eventKind: event.kind, metrics: [], criteria: [] }).map((q) => ({
        ...q,
        label: question,
        picker: { entity: "founder" as const, maxItems: max },
      }));
      extra = { questions, deadlineDateISOString: closesDateISOString, opensDateISOString: status === "open" ? nowISO : null };
    }
    const draft = newForm(
      { programId: event.programId, batchId: event.batchId, templateKey, eventId, event, defaults: { metrics, criteria } },
      extra,
    );
    const id = `${eventId}-${templateKey}`;
    if (status === "draft") return { id, templateKey, form: draft, version: null };
    const { form, version } = firstPublication(draft, nowISO);
    return { id, templateKey, form: { ...form, status }, version };
  });
}

/** Les documents a creer pour un plan : le formulaire, et sa version figee s'il est publie. */
export const eventFormDocs = (plan: EventFormPlan, nowISO: string): { path: string; data: object }[] => [
  { path: docPaths.form(plan.id), data: { ...plan.form, createdDateISOString: nowISO, updatedDateISOString: nowISO } },
  ...(plan.version ? [{ path: docPaths.formVersion(plan.id, plan.version.version), data: plan.version }] : []),
];
