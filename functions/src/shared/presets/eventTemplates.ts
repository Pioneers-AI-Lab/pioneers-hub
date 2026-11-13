import type { Criterion, EventKind, EventMatching, EventMetric, PitchStage } from "../types";
import type { FormTemplateKey } from "./formTemplates";
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
// Selection Day, Pre-IC et IC reprennent la grille du Selection Day Spring
// 2026, Team quality 40 / Speed of execution 40 / Market potential 20, notee
// de 1 a 5. Le score d'une equipe se suit ainsi dans le temps.
//
// ECHELLES : seules celles marquees « documente » viennent de SPECS.md ; les
// autres sont une hypothese a confirmer avec le staff avant le premier
// exercice (TODO).

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
  /** Metriques par defaut du Debrief. */
  metrics: EventMetric[];
  /** Type de session 2025 correspondant (`session_events.Type`), pour l'import de l'historique. */
  legacyType2025: string | null;
};

const c = (key: string, label: string, max = 5, weight = 1, min = 1): Criterion => ({ key, label, min, max, weight });
const m = (key: string, label: string, unit: string | null = null): EventMetric => ({ key, label, unit });
/** Une metrique du dictionnaire standard : meme cle et meme libelle partout. */
const s = standardEventMetric;

/**
 * Documente : la grille unique (SP26 « Selection Day evaluation », Notion
 * « Pioneers IC Criteria »). A l'import de 2025, `Quality of Team`,
 * `Execution Capacity / Traction` et `Market Potential` se rangent sous ces cles.
 */
export const PIONEERS_RUBRIC: Criterion[] = [
  c("teamQuality", "Team quality", 5, 40),
  c("speedOfExecution", "Speed of execution", 5, 40),
  c("marketPotential", "Market potential", 5, 20),
];

/** SP26 « Hackathon scorecard ». Documente : Depth of execution /5. Le reste : TODO echelle. */
const HACKATHON_CRITERIA: Criterion[] = [
  c("clarityOfProblem", "Clarity of problem"),
  c("strengthOfEvidence", "Strength of evidence"),
  c("depthOfExecution", "Depth of execution"),
  c("strategicPrioritization", "Strategic prioritization"),
  c("teamCoherence", "Team coherence"),
  c("actualValidation", "Actual validation"),
  // TODO : « Factor quality » et « Final Score » (/2 500) sont un multiplicateur
  // et un total dans le SP26 ; leur formule exacte est a relire avant de les
  // modeliser comme criteres.
];

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
  pitch: { durationMinutes: 120, startTime: "14:00", matching: null, forms: ["jury"] },
  matching: { durationMinutes: 60, startTime: "12:30", matching: tables(4), forms: [] },
  session: { durationMinutes: 60, startTime: "10:00", matching: null, forms: ["session_feedback"] },
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
    summary: "Teams of 3, submission, peer rating, jury",
    kind: "team_challenge",
    criteria: HACKATHON_CRITERIA,
    metrics: HACKATHON_METRICS,
    legacyType2025: "Group exercise",
  }),
  edge_drill: t({
    label: "Edge drill",
    summary: "Teams of 3, submission, peer rating, jury",
    kind: "team_challenge",
    // Documente : total /15 (« Total Star Review »), soit 3 criteres /5.
    criteria: [c("edgeArticulation", "Edge articulation"), c("execution", "Execution"), c("collaboration", "Collaboration")],
  }),
  customer_discovery: t({
    label: "Customer discovery challenge",
    summary: "Teams of 3, submission with outreach numbers, peer rating, jury",
    kind: "team_challenge",
    // Documente : score /5. Echelle de chaque critere : TODO.
    criteria: [c("proofLevel", "Proof level"), c("insights", "Insights"), c("traction", "Traction"), c("execution", "Execution")],
    // SP26 « Discovery challenge evaluation » : score pondere 1, 3 et 10 points.
    metrics: [s("messagesSent"), s("callsMade"), s("conversationsDone")],
  }),
  vibethon: t({
    label: "Vibethon",
    summary: "Teams of 3, submission, peer rating, jury",
    kind: "team_challenge",
    // Documente : score /5.
    criteria: [
      c("problemDefinition", "Problem definition"),
      c("solution", "Solution"),
      c("deck", "Deck"),
      c("presentation", "Presentation"),
      c("execution", "Execution"),
    ],
  }),
  workshop: t({ label: "Workshop or group exercise", summary: "Teams of 3, submission, peer rating", kind: "team_challenge", legacyType2025: "Group exercise" }),
  customer_day: t({
    label: "Customer day",
    summary: "Teams of 3, submission with conversations, peer rating",
    kind: "team_challenge",
    durationMinutes: 480,
    metrics: [s("conversationsDone")],
  }),
  // Une metrique par equipe, avant / apres : le staff la declare a la creation.
  traction_sprint: t({ label: "48-hour traction sprint", summary: "Teams of 3, submission, peer rating", kind: "team_challenge", durationMinutes: 2880 }),

  // ---- pitch (grille unique) ----
  pitch_day: t({ label: "Pitch day", summary: "Jury on the startups (40 / 40 / 20)", kind: "pitch", criteria: PIONEERS_RUBRIC }),
  friday_pitch: t({
    label: "Friday pitch",
    summary: "Jury on the startups (40 / 40 / 20)",
    kind: "pitch",
    criteria: PIONEERS_RUBRIC,
    legacyType2025: "Friday Pitches",
  }),
  demo_day: t({ label: "Demo day", summary: "Jury on the startups (40 / 40 / 20)", kind: "pitch", criteria: PIONEERS_RUBRIC }),
  selection_day: t({
    label: "Selection Day",
    summary: "Jury on the startups, Go / No Go",
    kind: "pitch",
    stage: "selection_day",
    criteria: PIONEERS_RUBRIC,
    legacyType2025: "Selection Day",
  }),
  pre_ic: t({ label: "Pre-IC", summary: "Jury on the startups, Go / No Go", kind: "pitch", stage: "pre_ic", criteria: PIONEERS_RUBRIC, legacyType2025: "Pre-IC" }),
  ic: t({ label: "Investment Committee", summary: "Jury on the startups, Go / No Go", kind: "pitch", stage: "ic", criteria: PIONEERS_RUBRIC }),

  // ---- matching ----
  lunch_roulette: t({ label: "Lunch roulette", summary: "Tables of 4, drawn so founders meet new people", kind: "matching", legacyType2025: "Diner/lunch" }),
  speed_dating: t({ label: "Founder speed dating", summary: "Pairs, then picks: who stood out", kind: "matching", startTime: "14:00", matching: tables(2), forms: ["picks"] }),
  round_table: t({ label: "Round table (Pioneers Circles)", summary: "Tables of 5", kind: "matching", startTime: "18:00", matching: tables(5) }),

  // ---- session ----
  masterclass: t({ label: "Masterclass or talk", summary: "Session feedback", kind: "session", legacyType2025: "Masterclass" }),
  theme_session: t({ label: "Theme session", summary: "Session feedback", kind: "session", durationMinutes: 90, legacyType2025: "Theme session" }),
  founder_introductions: t({
    label: "Founder introductions",
    summary: "Introduce yourself, who you want to meet, goal of the week",
    kind: "session",
    forms: ["founder_introductions"],
  }),
  announcement: t({ label: "Announcement", summary: "Nothing to fill in", kind: "session", durationMinutes: 30, forms: [], legacyType2025: "Announce/Organisation" }),
  social: t({ label: "Social event", summary: "Nothing to fill in", kind: "session", startTime: "19:00", durationMinutes: 180, forms: [], legacyType2025: "Socials" }),

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

/** Les modeles d'une etiquette, dans l'ordre du catalogue. */
export const templatesOfKind = (kind: EventKind): EventTemplateKey[] =>
  (Object.keys(EVENT_TEMPLATES) as EventTemplateKey[]).filter((key) => EVENT_TEMPLATES[key].kind === kind);

/** Le modele d'une cle (`PioneersEvent.templateKey`), `null` si inconnue ou absente. */
export const eventTemplateOf = (key: string | null): EventTemplate | null =>
  key && key in EVENT_TEMPLATES ? EVENT_TEMPLATES[key as EventTemplateKey] : null;

/** Le libelle d'un critere connu des modeles (fiches, anciens evenements), sinon sa cle. */
export function criterionLabel(key: string): string {
  for (const t of Object.values(EVENT_TEMPLATES) as EventTemplate[]) {
    const hit = t.criteria.find((c) => c.key === key);
    if (hit) return hit.label;
  }
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/**
 * La question par defaut d'un formulaire Picks :
 * apres un speed dating (`matching`), qui t'a marque ; sinon, les mutual picks
 * avant le hackathon de 3 jours.
 */
export const defaultPicksQuestion = (kind: EventKind): string =>
  kind === "matching" ? "Who stood out for you?" : "Who would you like to start a company with?";
