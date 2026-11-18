import type { Criterion, EventKind, EventMatching, EventMetric, EventScoring, PitchStage } from "../types";
import type { FormTemplateKey } from "./formTemplates";
import { isOfferedTemplate } from "./offered";
import { PITCH_FAMILY_INFO, PITCH_RUBRIC, PITCH_SCORING } from "../pitchGrid";
import { scoringFrom } from "../scoringRules";
import { teamSizeFor } from "../teamGenerator";
import { standardEventMetric } from "./standardMetrics";

// ----------------------------
// Modeles d'evenements
// ----------------------------
// Un modele est un PACK (decision du 13/11) : l'evenement (etiquette `kind`,
// nom, duree, heure), son matching et ses formulaires, crees d'un coup depuis
// Admin > Events > New (ou `create_event`). Le type n'est qu'une etiquette :
// « Friday pitch » et « Demo day » sont deux modeles de l'etiquette `pitch`.
// La grille et les metriques d'un modele sont les REGLAGES PAR DEFAUT de ses
// formulaires (SPECS §2, modele standard) : le Debrief d'un hackathon cree une
// question par metrique, le formulaire de jury une question par critere (avec
// son poids). Elles sont COPIEES dans le formulaire : modifier un modele ne
// change donc jamais un evenement passe, et le staff ajuste chaque formulaire
// (ex. les metriques propres a chaque hackathon Twin de Fall 2026). Le staff
// peut aussi creer un evenement sans modele.
//
// UNE SEULE ECHELLE (brief du 11/11, SPECS §4.9) : pitch days, demos,
// Selection Day, Pre-IC et IC ont la grille Pitch (lot 5, shared/pitchGrid.ts) :
// les familles du Selection Day Spring 2026 (Team 40 / Speed of execution 40 /
// Market 20) detaillees en dix criteres de 0 a 5 avec leurs points, et leur
// bareme (Outstanding du staff a 100). Le score d'une startup se suit ainsi dans
// le temps. Un pack de pitch cree aussi le formulaire Pitch deck de la startup.
//
// GRILLES DE JURY (regle du 17/11) : chaque critere de 0 a 5 vaut des points,
// et les points d'une grille font 100 ; un departage vaut 0 point. Les packs
// retires gardent leurs anciennes grilles (lues par les evenements de Spring 2026).

export type EventTemplate = {
  label: string;
  /** Ce que cree le pack, en une ligne (choix du modele). */
  summary: string;
  kind: EventKind;
  /** Duree proposee, en minutes. */
  durationMinutes: number;
  /** Heure de debut proposee, a Paris (`HH:MM`). */
  startTime: string;
  /** Le matching du pack, `null` sans tirage. */
  matching: EventMatching | null;
  /** Les formulaires du pack (construits depuis l'evenement : `formTemplates.ts`, `build`). */
  forms: FormTemplateKey[];
  /** Pour un `pitch` qui porte une decision. */
  stage: PitchStage | null;
  /** Grille par defaut du formulaire de jury. */
  criteria: Criterion[];
  /** Bareme par defaut de l'evenement (grille Pitch : ses points, l'Outstanding a 100) ; absent : aucun. */
  scoring?: EventScoring;
  /** Metriques par defaut du Debrief. */
  metrics: EventMetric[];
  /** Type de session 2025 correspondant (`session_events.Type`), pour l'import de l'historique. */
  legacyType2025: string | null;
  /** Plus propose a la creation (decision du 17/11) : reste lu par les evenements qui le portent. */
  retired?: boolean;
  /**
   * Ce n'est pas une reunion (l'entree « Weekly Update Form » de l'agenda) : aucune presence,
   * ni relevee ni comptee ; ses formulaires vont a tout le batch, sans absent
   * (shared/attendance.ts#tracksAttendance), et comptent dans « Forms on time ».
   */
  withoutAttendance?: boolean;
};

const c = (key: string, label: string, max = 5, weight = 1, min = 1): Criterion => ({ key, label, min, max, weight });
const m = (key: string, label: string, unit: string | null = null): EventMetric => ({ key, label, unit });
/** Une metrique du dictionnaire standard : meme cle et meme libelle partout. */
const s = standardEventMetric;

/**
 * La grille unique des pitchs (lot 5, shared/pitchGrid.ts) et son bareme. L'ancienne (SP26
 * « Selection Day evaluation », Notion « Pioneers IC Criteria » : `teamQuality`,
 * `speedOfExecution`, `marketPotential`, de 1 a 5) reste lue par les evenements qui la portent ;
 * ses cles sont les familles de la nouvelle, sur 5 (`legacyPitchScores`).
 */
const pitch = { kind: "pitch", criteria: PITCH_RUBRIC, scoring: PITCH_SCORING } as const;

/**
 * La grille par defaut d'un hackathon (regle du 17/11, docs/FONCTIONNALITES.md §2) :
 * des criteres de 0 a 5 dont les points font 100, l'Outstanding mention seulement a 100 (bareme).
 * Un DEFAUT MINIMAL que le staff ajuste a chaque hackathon (Admin > Events > Leaderboard : criteres,
 * points, departages ; « Copy scoring from… ») : le critere principal est le chiffre que publie le
 * calendrier (5 = la meilleure equipe), puis la qualite des livrables (Quality of output).
 */
const HACKATHON_GRID = [
  { key: "result", label: "Result (5 = the best team)", points: 90 },
  { key: "outputQuality", label: "Quality of output", points: 10 },
] as const;
const HACKATHON_CRITERIA: Criterion[] = HACKATHON_GRID.map((g) => c(g.key, g.label, 5, g.points, 0));
const HACKATHON_SCORING = scoringFrom(HACKATHON_GRID.map((g) => ({ label: g.label, mode: "criterion" as const, sourceKey: g.key, maxPoints: g.points })))!;

/**
 * SP26 « Hackathon scorecard » (counts), en cles standard (standardMetrics.ts) :
 * comptes sur la duree du hackathon. Le staff les adapte a chaque hackathon.
 */
const HACKATHON_METRICS: EventMetric[] = [
  s("conversationsDone"),
  s("callsMade"),
  s("meetingsBooked"),
  s("amountPaid"),
  s("loisSigned"),
  s("activeUsers"),
  m("communityMembers", "Community members"),
  s("featuresShipped"),
  m("promotionChannels", "Promotion channels"),
  m("emailSubscribers", "Email subscribers"),
];

/** Des equipes de travail (challenge) ou des tables (rencontres), et leur taille visee. */
const teams = (max: number): EventMatching => ({ mode: "challenge", size: teamSizeFor(max) });
const tables = (max: number): EventMatching => ({ mode: "matching", size: teamSizeFor(max) });

/** Ce que chaque etiquette propose par defaut : le pack s'en ecarte au besoin. */
const DEFAULTS: Record<EventKind, Pick<EventTemplate, "durationMinutes" | "startTime" | "matching" | "forms">> = {
  team_challenge: { durationMinutes: 150, startTime: "09:30", matching: teams(3), forms: ["debrief", "peer_rating", "jury"] },
  // La startup envoie son Pitch deck avant (48 h avant, echeance la veille), le jury la note.
  pitch: { durationMinutes: 120, startTime: "14:00", matching: null, forms: ["pitch_deck", "jury"] },
  matching: { durationMinutes: 60, startTime: "12:30", matching: tables(4), forms: [] },
  // Une seance n'a pas de formulaire : les seances se notent a la retro de fin de semaine (decision du 13/11, 17/11).
  session: { durationMinutes: 60, startTime: "10:00", matching: null, forms: [] },
  meeting: { durationMinutes: 30, startTime: "10:00", matching: null, forms: [] },
};

type TemplateInput = Pick<EventTemplate, "label" | "kind" | "summary"> & Partial<EventTemplate>;
const t = (input: TemplateInput): EventTemplate => {
  const pack: EventTemplate = { stage: null, criteria: [], metrics: [], legacyType2025: null, ...DEFAULTS[input.kind], ...input };
  // Pas de grille : pas de formulaire de jury.
  return { ...pack, forms: pack.criteria.length > 0 ? pack.forms : pack.forms.filter((f) => f !== "jury") };
};

/** Les modeles, par cle (`PioneersEvent.templateKey`). */
export const EVENT_TEMPLATES = {
  // ---- team_challenge ----
  hackathon: t({
    label: "Hackathon",
    summary: "Teams of 3, submission, peer rating, jury (default grid to adjust)",
    kind: "team_challenge",
    criteria: HACKATHON_CRITERIA,
    scoring: HACKATHON_SCORING,
    metrics: HACKATHON_METRICS,
    legacyType2025: "Group exercise",
  }),
  // Packs Spring 2026 absents du document du 17/11 : retires, lus par les evenements qui les portent.
  edge_drill: t({
    label: "Edge drill",
    summary: "Teams of 3, submission, peer rating, jury",
    kind: "team_challenge",
    criteria: [c("edgeArticulation", "Edge articulation"), c("execution", "Execution"), c("collaboration", "Collaboration")],
    retired: true,
  }),
  customer_discovery: t({
    label: "Customer discovery challenge",
    summary: "Teams of 3, submission with outreach numbers, peer rating, jury",
    kind: "team_challenge",
    criteria: [c("proofLevel", "Proof level"), c("insights", "Insights"), c("traction", "Traction"), c("execution", "Execution")],
    metrics: [s("messagesSent"), s("callsMade"), s("conversationsDone")],
    retired: true,
  }),
  vibethon: t({
    label: "Vibethon",
    summary: "Teams of 3, submission, peer rating, jury",
    kind: "team_challenge",
    criteria: [
      c("problemDefinition", "Problem definition"),
      c("solution", "Solution"),
      c("deck", "Deck"),
      c("presentation", "Presentation"),
      c("execution", "Execution"),
    ],
    retired: true,
  }),
  workshop: t({ label: "Workshop or group exercise", summary: "Teams of 3, submission, peer rating", kind: "team_challenge", legacyType2025: "Group exercise" }),
  // Customer Day et 48-hour traction sprint (document §1, §4.7) : l'equipe est la startup, aucun
  // tirage ; formulaires et grille restent a definir (le staff les ajoute a l'evenement).
  customer_day: t({
    label: "Customer day",
    summary: "The team is the startup: no draw; forms and jury to define",
    kind: "team_challenge",
    durationMinutes: 480,
    matching: null,
    forms: [],
  }),
  traction_sprint: t({
    label: "48-hour traction sprint",
    summary: "The team is the startup: no draw; forms and jury to define",
    kind: "team_challenge",
    durationMinutes: 2880,
    matching: null,
    forms: [],
  }),

  // ---- pitch (grille unique, lot 5) ----
  pitch_day: t({ ...pitch, label: "Pitch day", summary: "Pitch deck, jury on the startups (40 / 40 / 20)" }),
  friday_pitch: t({ ...pitch, label: "Friday pitch", summary: "Pitch deck, jury on the startups (40 / 40 / 20)", legacyType2025: "Friday Pitches" }),
  demo_day: t({ ...pitch, label: "Demo day", summary: "Pitch deck, jury on the startups (40 / 40 / 20)" }),
  selection_day: t({ ...pitch, label: "Selection Day", summary: "Pitch deck, jury on the startups, Go / No Go", stage: "selection_day", legacyType2025: "Selection Day" }),
  pre_ic: t({ ...pitch, label: "Pre-IC", summary: "Pitch deck, jury on the startups, Go / No Go", stage: "pre_ic", legacyType2025: "Pre-IC" }),
  ic: t({ ...pitch, label: "Investment Committee", summary: "Pitch deck, jury on the startups, Go / No Go", stage: "ic" }),

  // ---- matching ----
  lunch_roulette: t({ label: "Lunch roulette", summary: "Tables of 4, drawn so founders meet new people", kind: "matching", legacyType2025: "Diner/lunch" }),
  // Plus de picks (decision du 17/11) : la Shortlist des fiches les remplace.
  speed_dating: t({ label: "Founder speed dating", summary: "Pairs: founders meet one to one", kind: "matching", startTime: "14:00", matching: tables(2), forms: [] }),
  round_table: t({ label: "Round table (Pioneers Circles)", summary: "Tables of 5", kind: "matching", startTime: "18:00", matching: tables(5) }),

  // ---- session ----
  masterclass: t({ label: "Masterclass or talk", summary: "Nothing to fill in: sessions are rated at the week retro", kind: "session", legacyType2025: "Masterclass" }),
  theme_session: t({ label: "Theme session", summary: "Nothing to fill in: sessions are rated at the week retro", kind: "session", durationMinutes: 90, legacyType2025: "Theme session" }),
  // Retire le 17/11 : la presentation est dans Mon profil, les fondateurs a rencontrer dans la Shortlist.
  founder_introductions: t({
    label: "Founder introductions",
    summary: "Introduce yourself, who you want to meet, goal of the week",
    kind: "session",
    forms: ["founder_introductions"],
    retired: true,
  }),
  announcement: t({ label: "Announcement", summary: "Nothing to fill in", kind: "session", durationMinutes: 30, forms: [], legacyType2025: "Announce/Organisation" }),
  social: t({ label: "Social event", summary: "Nothing to fill in", kind: "session", startTime: "19:00", durationMinutes: 180, forms: [], legacyType2025: "Socials" }),
  // Lot 4, decision du 18/11 (le Hub suit l'agenda) : pose par la synchro sur chaque entree « Weekly Update Form »
  // (shared/weeklyForms.ts), ou a la main. Les deux formulaires s'ouvrent a son debut, echeance 24 h apres.
  weekly_update: t({
    label: "Weekly update",
    summary: "Weekly update founder and startup, open 24 h, for the whole batch",
    kind: "session",
    startTime: "19:00",
    durationMinutes: 30,
    forms: ["weekly_update_founder", "weekly_update_startup"],
    withoutAttendance: true,
  }),

  // ---- meeting ----
  office_hours: t({ label: "Pioneers office hours", summary: "A slot with a startup or a founder", kind: "meeting", legacyType2025: "Office hours Pioneers" }),
  expert_office_hours: t({
    label: "Expert office hours",
    summary: "A slot with an expert",
    kind: "meeting",
    legacyType2025: "Office hours external",
  }),
  // Evaluation dans les deux sens (mentor -> startup, startup -> mentor) : bonus.
  mentor_session: t({ label: "Mentor session", summary: "A call with a mentor", kind: "meeting" }),
} satisfies Record<string, EventTemplate>;

export type EventTemplateKey = keyof typeof EVENT_TEMPLATES;

/**
 * Les modeles encore proposes (ni retires, `isOfferedTemplate`), dans l'ordre du catalogue :
 * Admin > Events (New, Template), `create_event` et `apply_event_template` (enum : un modele retire est refuse).
 */
export const OFFERED_EVENT_TEMPLATE_KEYS = (Object.keys(EVENT_TEMPLATES) as EventTemplateKey[]).filter((key) => isOfferedTemplate(EVENT_TEMPLATES[key])) as [
  EventTemplateKey,
  ...EventTemplateKey[],
];

/** Les modeles proposes d'une etiquette, dans l'ordre du catalogue. */
export const templatesOfKind = (kind: EventKind): EventTemplateKey[] => OFFERED_EVENT_TEMPLATE_KEYS.filter((key) => EVENT_TEMPLATES[key].kind === kind);

/** Le modele d'une cle (`PioneersEvent.templateKey`), `null` si inconnue ou absente. */
export const eventTemplateOf = (key: string | null): EventTemplate | null =>
  key && key in EVENT_TEMPLATES ? EVENT_TEMPLATES[key as EventTemplateKey] : null;

/** Les libelles de l'ancienne grille des pitchs (Spring 2026), que plus aucun modele ne porte. */
const LEGACY_PITCH_LABELS = new Map(Object.values(PITCH_FAMILY_INFO).map((f) => [f.legacyKey, f.legacyLabel]));

/** Le libelle d'un critere connu des modeles (fiches, anciens evenements), sinon sa cle. */
export function criterionLabel(key: string): string {
  for (const t of Object.values(EVENT_TEMPLATES) as EventTemplate[]) {
    const hit = t.criteria.find((c) => c.key === key);
    if (hit) return hit.label;
  }
  const legacy = LEGACY_PITCH_LABELS.get(key);
  if (legacy) return legacy;
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/**
 * La question par defaut d'un formulaire Picks :
 * apres un speed dating (`matching`), qui t'a marque ; sinon, les mutual picks
 * avant le hackathon de 3 jours.
 */
export const defaultPicksQuestion = (kind: EventKind): string =>
  kind === "matching" ? "Who stood out for you?" : "Who would you like to start a company with?";
