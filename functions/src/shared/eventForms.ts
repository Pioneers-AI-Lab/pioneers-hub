import { docPaths } from "./collections";
import { setWrite, type DocWrite } from "./docWrites";
import { endAfter, eventEndOf as endOf, isUpcomingEvent, isWorkTeamEvent } from "./events";
import { firstPublication, newForm, type FormData } from "./forms";
import { eventTemplateOf } from "./presets/eventTemplates";
import {
  DEFAULT_FORM_TIMING,
  FORM_TEMPLATES,
  templateQuestions,
  type FormTemplate,
  type FormTemplateKey,
  type FormTiming,
  type RetroSession,
  type SubmissionFieldKey,
} from "./presets/formTemplates";
import type { Criterion, EventMetric, Form, FormVersion, PioneersEvent, WithId } from "./types";

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
> &
  Partial<Pick<PioneersEvent, "stage">>;

const shiftMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const msBetween = (from: string, to: string) => Date.parse(to) - Date.parse(from);
/** Le meme instant (ou deux dates vides), quel que soit le format ISO. */
export const sameTime = (a: string | null, b: string | null) => a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));

/** Le debut et la fin d'un evenement : tout ce dont dependent les dates de ses formulaires. */
export type EventTimes = Pick<PioneersEvent, "startDateISOString" | "endDateISOString">;

/** 15 minutes avant la fin, jamais avant le debut (un evenement tres court). */
const beforeEndOf = (e: EventTimes) => {
  const at = endAfter(endOf(e), -15);
  return at < e.startDateISOString ? e.startDateISOString : at;
};

/** `hours` avant le debut. */
const beforeStartOf = (e: EventTimes, hours: number) => endAfter(e.startDateISOString, -hours * 60);

/** Chaque reglage de `FormTiming`, en date (le Pitch deck : 48 h avant le pitch, echeance la veille). */
const OPENS: Record<FormTiming["opens"], (e: EventTimes) => string> = {
  start: (e) => e.startDateISOString,
  before_end: beforeEndOf,
  two_days_before: (e) => beforeStartOf(e, 48),
};
const DEADLINES: Record<FormTiming["deadline"], (e: EventTimes, opens: string) => string | null> = {
  before_end: beforeEndOf,
  day_after_opening: (_e, opens) => endAfter(opens, 24 * 60),
  day_before: (e) => beforeStartOf(e, 24),
  none: () => null,
};

/**
 * L'ouverture et l'echeance d'un formulaire dans son evenement, selon son modele
 * (`FormTiming` ; `DEFAULT_FORM_TIMING` sans modele), sauf dates donnees. A la
 * creation d'un pack comme par « Add a form » ou Admin > Forms > New form.
 */
export function eventFormDates(templateKey: FormTemplateKey | null, event: EventTimes, given: EventFormDates = {}) {
  const timing = (templateKey ? (FORM_TEMPLATES[templateKey] as FormTemplate).timing : null) ?? DEFAULT_FORM_TIMING;
  const opens = given.opensDateISOString ?? OPENS[timing.opens](event);
  // Une echeance donnee, meme `null` (sans echeance), passe avant celle du modele.
  const deadline = given.deadlineDateISOString !== undefined ? given.deadlineDateISOString : DEADLINES[timing.deadline](event, opens);
  return { opensDateISOString: opens, deadlineDateISOString: deadline };
}

/**
 * LE lien d'un hackathon a son creneau Debrief, deduit des heures (aucun champ ne
 * le porte) : l'evenement du batch, autre que `exceptId`, qui commence a `at`.
 * Un Peer rating s'ouvre a son debut. Rend la recherche (index par heure de debut).
 */
function debriefSlots<E extends WithId<EventTimes>>(events: readonly E[]) {
  const byStart = new Map<number, E[]>();
  for (const e of events) byStart.set(Date.parse(e.startDateISOString), [...(byStart.get(Date.parse(e.startDateISOString)) ?? []), e]);
  return (at: string | null, exceptId: string | null): E | null => (at ? (byStart.get(Date.parse(at))?.find((e) => e.id !== exceptId) ?? null) : null);
}

/**
 * Les dates par defaut d'un formulaire ajoute a un evenement existant (« Add a
 * form », Admin > Forms > New form, `create_form`) : celles de son modele ; un
 * Peer rating s'ouvre au debut du creneau Debrief, l'evenement du batch qui
 * commence a la fin de celui-ci (`events`), s'il y en a un.
 */
export function addedFormDates(
  templateKey: FormTemplateKey | null,
  event: WithId<EventTimes>,
  events: readonly WithId<EventTimes>[] = [],
  given: EventFormDates = {},
) {
  const slot = templateKey === "peer_rating" ? debriefSlots(events)(endOf(event), event.id) : null;
  return eventFormDates(templateKey, event, slot && given.opensDateISOString === undefined ? { ...given, opensDateISOString: slot.startDateISOString } : given);
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
    let extra: Parameters<typeof newForm>[1] = eventFormDates(templateKey, event, given);
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

/** Les memes documents, en ecritures (shared/docWrites.ts) : le front et l'API les executent. */
export const eventFormWrites = (plan: EventFormPlan, nowISO: string): DocWrite[] => eventFormDocs(plan, nowISO).map((d) => setWrite(d.path, d.data));

// ----------------------------
// Deplacer un evenement : ses formulaires suivent (Admin > Events, piste 7.3)
// ----------------------------
// Chaque date garde sa place dans l'evenement :
//   - une date qui suit la regle de creation (au debut, 15 min avant la fin) la suit encore ;
//   - une date fixee a la main garde sa distance au bord le plus proche (debut ou fin) ;
//   - une echeance apres la fin garde sa distance a l'ouverture (24 h apres, par defaut).
// Un formulaire ferme, ou dont l'echeance est passee, garde ses dates (ses reponses
// et leur retard sont acquis). Une date vide reste vide.
// Le Peer rating d'un hackathon s'ouvre au debut de son creneau Debrief (un autre
// evenement) : il suit ce creneau, pas le hackathon. Deplacer la fin d'un hackathon
// propose de decaler d'autant le Debrief qui le suit (`linked`).
// Seules les dates changent : aucune nouvelle version (`versionedSnapshot`).

type MovableForm = WithId<Pick<Form, "eventId" | "kind" | "title" | "status" | "archivedDateISOString" | "opensDateISOString" | "deadlineDateISOString">>;
type MovableEvent = WithId<EventTimes & Pick<PioneersEvent, "name" | "calendarSource">>;

export type FormMove<F> = { form: F; opensDateISOString: string | null; deadlineDateISOString: string | null };
/** Garde ses dates : ferme, echeance passee, ou lie a un creneau Debrief qui ne bouge pas (`tiedTo`). */
export type FormKept<F> = { form: F; reason: "closed" | "past_deadline" | "tied"; tiedTo: string | null };
export type EventMovePlan<F, E> = {
  /** Le creneau Debrief accole, s'il peut suivre la fin ; `isMoved` : il est decale avec. */
  linked: { event: E; to: EventTimes; isMoved: boolean } | null;
  moves: FormMove<F>[];
  kept: FormKept<F>[];
};

const shiftTimes = (e: EventTimes, ms: number): EventTimes => ({
  startDateISOString: shiftMs(e.startDateISOString, ms),
  endDateISOString: e.endDateISOString && shiftMs(e.endDateISOString, ms),
});

/** Une date de l'evenement `from`, a la meme place dans `to`. */
function followDate(date: string, from: EventTimes, to: EventTimes): string {
  if (sameTime(date, from.startDateISOString)) return to.startDateISOString;
  if (sameTime(date, beforeEndOf(from))) return beforeEndOf(to);
  const fromStart = msBetween(from.startDateISOString, date);
  const fromEnd = msBetween(endOf(from), date);
  return Math.abs(fromStart) <= Math.abs(fromEnd) ? shiftMs(to.startDateISOString, fromStart) : shiftMs(endOf(to), fromEnd);
}

function followForm(form: MovableForm, from: EventTimes, to: EventTimes) {
  const { opensDateISOString: opens, deadlineDateISOString: deadline } = form;
  const nextOpens = opens && followDate(opens, from, to);
  // Une echeance apres la fin garde sa distance a l'ouverture.
  if (opens && nextOpens && deadline && Date.parse(deadline) > Date.parse(endOf(from))) {
    return { opensDateISOString: nextOpens, deadlineDateISOString: shiftMs(nextOpens, msBetween(opens, deadline)) };
  }
  return { opensDateISOString: nextOpens, deadlineDateISOString: deadline && followDate(deadline, from, to) };
}

/**
 * Ce que devient chaque formulaire quand `event` passe a l'horaire `next` :
 * les siens, et les Peer rating qui s'ouvrent a son debut (il est un creneau
 * Debrief). `events` et `forms` : ceux du batch.
 */
export function planEventMove<F extends MovableForm, E extends MovableEvent>(input: {
  event: E;
  next: EventTimes;
  events: readonly E[];
  forms: readonly F[];
  moveLinked: boolean;
  nowISO: string;
}): EventMovePlan<F, E> {
  const { event, next, events, nowISO } = input;
  const forms = input.forms.filter((f) => f.archivedDateISOString === null);
  const slotOf = debriefSlots(events);
  const tiedSlot = new Map(forms.map((f) => [f.id, f.kind === "peer_feedback" ? slotOf(f.opensDateISOString, f.eventId) : null]));

  // Le Debrief accole (il commence a la fin) auquel s'ouvre un Peer rating de l'evenement.
  const endShift = msBetween(endOf(event), endOf(next));
  const slot = endShift === 0 ? null : slotOf(endOf(event), event.id);
  const isLinked = slot !== null && forms.some((f) => f.eventId === event.id && tiedSlot.get(f.id) === slot);
  // Un creneau venu de l'agenda Google suit son propre horaire : le Hub ne le deplace pas.
  const linked = isLinked ? { event: slot, to: shiftTimes(slot, endShift), isMoved: input.moveLinked && !slot.calendarSource } : null;

  const moved = new Map<string, { from: EventTimes; to: EventTimes }>([[event.id, { from: event, to: next }]]);
  if (linked?.isMoved) moved.set(linked.event.id, { from: linked.event, to: linked.to });

  const plan: EventMovePlan<F, E> = { linked, moves: [], kept: [] };
  for (const form of forms) {
    const tied = tiedSlot.get(form.id);
    const anchor = moved.get(tied?.id ?? form.eventId ?? "");
    if (!anchor) {
      if (tied && form.eventId && moved.has(form.eventId)) plan.kept.push({ form, reason: "tied", tiedTo: tied.name });
      continue;
    }
    if (form.status === "closed") plan.kept.push({ form, reason: "closed", tiedTo: null });
    else if (form.deadlineDateISOString && form.deadlineDateISOString < nowISO) plan.kept.push({ form, reason: "past_deadline", tiedTo: null });
    else {
      const to = followForm(form, anchor.from, anchor.to);
      if (!sameTime(to.opensDateISOString, form.opensDateISOString) || !sameTime(to.deadlineDateISOString, form.deadlineDateISOString)) plan.moves.push({ form, ...to });
    }
  }
  return plan;
}

// ----------------------------
// Archiver un evenement : ses formulaires ouverts se ferment (Admin > Events, synchro de l'agenda)
// ----------------------------

type ArchivableForm = Pick<Form, "status" | "updatedDateISOString">;

/** Les formulaires ouverts d'un evenement : l'archivage les ferme (ils sortent du To do et ne prennent plus de reponse). */
export const formsClosedByArchive = <F extends ArchivableForm>(forms: readonly F[]) => forms.filter((f) => f.status === "open");

/**
 * Ceux que l'archivage a fermes, et que personne n'a touches depuis : ils
 * portent l'heure de l'archivage (meme lot). La restauration les rouvre.
 * Choix delibere, faute de marque sur le formulaire (aucun champ du type `Form`) :
 * un formulaire ferme puis retouche par le staff reste ferme a la restauration.
 */
export const formsReopenedByRestore = <F extends ArchivableForm>(event: Pick<PioneersEvent, "archivedDateISOString">, forms: readonly F[]) =>
  forms.filter((f) => f.status === "closed" && f.updatedDateISOString === event.archivedDateISOString);
