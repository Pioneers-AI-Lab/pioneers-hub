import { docPaths } from "./collections";
import { isUpcomingEvent, isWorkTeamEvent } from "./events";
import { firstPublication, newForm, type FormData } from "./forms";
import { eventTemplateOf } from "./presets/eventTemplates";
import {
  DEFAULT_FORM_TIMING,
  FORM_TEMPLATES,
  templateQuestions,
  type FormTemplate,
  type FormTemplateKey,
  type RetroSession,
  type SubmissionFieldKey,
} from "./presets/formTemplates";
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

/**
 * L'ouverture et l'echeance d'un formulaire de l'evenement, si elles different
 * de son debut ; `draft` : il reste en brouillon meme si l'evenement est
 * programme (le staff le publiera s'il en veut).
 */
export type EventFormDates = { opensDateISOString?: string | null; deadlineDateISOString?: string | null; draft?: boolean };

export type EventFormsOptions = {
  /** Les formulaires a creer ; par defaut ceux du pack du modele. */
  forms?: readonly FormTemplateKey[];
  /** Remplace les metriques de la Submission (import : celles du fichier). */
  metrics?: EventMetric[] | null;
  /** Remplace la grille du jury du modele (import : celle du fichier). */
  criteria?: Criterion[] | null;
  /** Les champs d'equipe de la Submission (import). */
  submissionFields?: readonly SubmissionFieldKey[] | null;
  /** Les seances que la retro fait noter (import). */
  sessions?: readonly RetroSession[];
  /** Ouverture et echeance par formulaire : la Submission a son echeance, le Peer rating s'ouvre au debrief. */
  formDates?: Partial<Record<FormTemplateKey, EventFormDates>>;
  /** Les anciens champs (migration) : ils ajoutent leurs formulaires. */
  legacy?: LegacyEventSettings;
};

export type EventFormPlan = { id: string; templateKey: FormTemplateKey; form: FormData; version: FormVersion | null };

type EventForPlan = Pick<
  PioneersEvent,
  "programId" | "batchId" | "kind" | "templateKey" | "startDateISOString" | "endDateISOString" | "status" | "matching" | "teamSize"
>;

const MINUTE = 60_000;
const shift = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * MINUTE).toISOString();

/** L'ouverture et l'echeance d'un formulaire dans son evenement (`FormTiming`), sauf dates donnees. */
function formDatesOf(templateKey: FormTemplateKey, event: EventForPlan, given: EventFormDates) {
  const timing = (FORM_TEMPLATES[templateKey] as FormTemplate).timing ?? DEFAULT_FORM_TIMING;
  const end = event.endDateISOString ?? event.startDateISOString;
  // 15 minutes avant la fin, jamais avant le debut (un evenement tres court).
  const beforeEnd = shift(end, -15) < event.startDateISOString ? event.startDateISOString : shift(end, -15);
  const opens = given.opensDateISOString ?? (timing.opens === "start" ? event.startDateISOString : beforeEnd);
  const deadline =
    given.deadlineDateISOString !== undefined
      ? given.deadlineDateISOString
      : timing.deadline === "before_end"
        ? beforeEnd
        : timing.deadline === "day_after_opening"
          ? shift(opens, 24 * 60)
          : null;
  return { opens, deadline };
}

export function eventFormsPlan(eventId: string, event: EventForPlan, options: EventFormsOptions, nowISO: string): EventFormPlan[] {
  const legacy = options.legacy ?? {};
  const isPast = !isUpcomingEvent(event, nowISO);
  const preset = eventTemplateOf(event.templateKey);
  const hasWorkTeams = isWorkTeamEvent(event);
  const metrics = legacy.metrics ?? options.metrics ?? preset?.metrics ?? [];
  const criteria = legacy.criteria ?? options.criteria ?? preset?.criteria ?? [];

  // Un evenement passe : seulement ce que portaient ses anciens champs. A venir : le pack, et l'ancien en plus.
  const wanted = new Set<FormTemplateKey>(isPast ? [] : (options.forms ?? preset?.forms ?? []));
  if (legacy.metrics?.length) wanted.add("debrief");
  if (legacy.criteria?.length) wanted.add("jury");
  if (legacy.picks) wanted.add("picks");
  // Une Submission et un Peer rating parlent de l'equipe : il faut des equipes de travail ; un jury, une grille.
  if (!hasWorkTeams) for (const key of wanted) if ((FORM_TEMPLATES[key] as FormTemplate).needsWorkTeams) wanted.delete(key);
  if (criteria.length === 0) wanted.delete("jury");

  // Comme l'evenement : publie (ouvert a son debut), en brouillon, ou ferme s'il est passe.
  const eventStatus = isPast ? "closed" : event.status === "draft" ? "draft" : "open";
  return [...wanted].map((templateKey) => {
    const given = options.formDates?.[templateKey] ?? {};
    const status = given.draft && eventStatus === "open" ? "draft" : eventStatus;
    // Publie ou brouillon, il porte ses dates : publie plus tard, il s'ouvre a son heure (ou tout de suite si elle est passee).
    const { opens, deadline } = formDatesOf(templateKey, event, given);
    let extra: Parameters<typeof newForm>[1] = { opensDateISOString: opens, deadlineDateISOString: deadline };
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
      {
        programId: event.programId,
        batchId: event.batchId,
        templateKey,
        eventId,
        event,
        defaults: { metrics, criteria, submissionFields: options.submissionFields ?? null, sessions: options.sessions ?? [] },
      },
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
