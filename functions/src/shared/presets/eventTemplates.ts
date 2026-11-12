import type { Criterion, EventKind, EventMetric, PitchStage } from "../types";

// ----------------------------
// Modeles d'evenements
// ----------------------------
// Un modele = une mecanique (`kind`) + un nom + des reglages par defaut. Le
// type d'un evenement est sa MECANIQUE (types/event.ts) : « Friday pitch » et
// « Demo day » sont deux modeles de la meme mecanique `pitch`.
// A la creation d'un evenement, la grille et les metriques du modele sont
// COPIEES : modifier un modele ne change donc jamais un evenement passe, et le
// staff ajuste chaque evenement (ex. les metriques propres a chaque hackathon
// Twin de Fall 2026). Le staff peut aussi creer un evenement sans modele.
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
  kind: EventKind;
  /** Pour un `pitch` qui porte une decision. */
  stage: PitchStage | null;
  criteria: Criterion[];
  metrics: EventMetric[];
  /** Type de session 2025 correspondant (`session_events.Type`), pour l'import de l'historique. */
  legacyType2025: string | null;
};

const c = (key: string, label: string, max = 5, weight = 1, min = 1): Criterion => ({ key, label, min, max, weight });
const m = (key: string, label: string, unit: string | null = null): EventMetric => ({ key, label, unit });

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

/** SP26 « Hackathon scorecard » (counts). Le staff les adapte a chaque hackathon. */
const HACKATHON_METRICS: EventMetric[] = [
  m("userInterviews", "User interviews"),
  m("coldCalls", "Cold calls"),
  m("bookedMeetings", "Booked meetings"),
  m("revenue", "Revenue", "EUR"),
  m("lois", "LOIs"),
  m("activeUsers", "Active users"),
  m("communityMembers", "Community members"),
  m("features", "Features"),
  m("promotionChannels", "Promotion channels"),
  m("emailSubscribers", "Email subscribers"),
];

type TemplateInput = Pick<EventTemplate, "label" | "kind"> & Partial<EventTemplate>;
const t = (input: TemplateInput): EventTemplate => ({
  stage: null,
  criteria: [],
  metrics: [],
  legacyType2025: null,
  ...input,
});

/** Les modeles, par cle (`PioneersEvent.templateKey`). */
export const EVENT_TEMPLATES = {
  // ---- team_challenge ----
  hackathon: t({
    label: "Hackathon",
    kind: "team_challenge",
    criteria: HACKATHON_CRITERIA,
    metrics: HACKATHON_METRICS,
    legacyType2025: "Group exercise",
  }),
  edge_drill: t({
    label: "Edge drill",
    kind: "team_challenge",
    // Documente : total /15 (« Total Star Review »), soit 3 criteres /5.
    criteria: [c("edgeArticulation", "Edge articulation"), c("execution", "Execution"), c("collaboration", "Collaboration")],
  }),
  customer_discovery: t({
    label: "Customer discovery challenge",
    kind: "team_challenge",
    // Documente : score /5. Echelle de chaque critere : TODO.
    criteria: [c("proofLevel", "Proof level"), c("insights", "Insights"), c("traction", "Traction"), c("execution", "Execution")],
    // SP26 « Discovery challenge evaluation » : score pondere 1, 3 et 10 points.
    metrics: [m("textOutreach", "Text outreach"), m("coldCalls", "Cold calls"), m("interviews", "Interviews")],
  }),
  vibethon: t({
    label: "Vibethon",
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
  workshop: t({ label: "Workshop or group exercise", kind: "team_challenge", legacyType2025: "Group exercise" }),
  customer_day: t({
    label: "Customer day",
    kind: "team_challenge",
    metrics: [m("conversations", "Customer conversations")],
  }),
  // Une metrique par equipe, avant / apres : le staff la declare a la creation.
  traction_sprint: t({ label: "48-hour traction sprint", kind: "team_challenge" }),

  // ---- pitch (grille unique) ----
  pitch_day: t({ label: "Pitch day", kind: "pitch", criteria: PIONEERS_RUBRIC }),
  friday_pitch: t({
    label: "Friday pitch",
    kind: "pitch",
    criteria: PIONEERS_RUBRIC,
    legacyType2025: "Friday Pitches",
  }),
  demo_day: t({ label: "Demo day", kind: "pitch", criteria: PIONEERS_RUBRIC }),
  selection_day: t({
    label: "Selection Day",
    kind: "pitch",
    stage: "selection_day",
    criteria: PIONEERS_RUBRIC,
    legacyType2025: "Selection Day",
  }),
  pre_ic: t({ label: "Pre-IC", kind: "pitch", stage: "pre_ic", criteria: PIONEERS_RUBRIC, legacyType2025: "Pre-IC" }),
  ic: t({ label: "Investment Committee", kind: "pitch", stage: "ic", criteria: PIONEERS_RUBRIC }),

  // ---- matching ----
  lunch_roulette: t({ label: "Lunch roulette", kind: "matching", legacyType2025: "Diner/lunch" }),
  speed_dating: t({ label: "Founder speed dating", kind: "matching" }),
  round_table: t({ label: "Round table (Pioneers Circles)", kind: "matching" }),

  // ---- session ----
  masterclass: t({ label: "Masterclass or talk", kind: "session", legacyType2025: "Masterclass" }),
  theme_session: t({ label: "Theme session", kind: "session", legacyType2025: "Theme session" }),
  announcement: t({ label: "Announcement", kind: "session", legacyType2025: "Announce/Organisation" }),
  social: t({ label: "Social event", kind: "session", legacyType2025: "Socials" }),

  // ---- meeting ----
  office_hours: t({ label: "Pioneers office hours", kind: "meeting", legacyType2025: "Office hours Pioneers" }),
  expert_office_hours: t({
    label: "Expert office hours",
    kind: "meeting",
    legacyType2025: "Office hours external",
  }),
  // Evaluation dans les deux sens (mentor -> startup, startup -> mentor) : bonus.
  mentor_session: t({ label: "Mentor session", kind: "meeting" }),
} satisfies Record<string, EventTemplate>;

export type EventTemplateKey = keyof typeof EVENT_TEMPLATES;

/**
 * La question par defaut d'une demande de choix (`PioneersEvent.picks`) :
 * apres un speed dating (`matching`), qui t'a marque ; sinon, les mutual picks
 * avant le hackathon de 3 jours.
 */
export const defaultPicksQuestion = (kind: EventKind): string =>
  kind === "matching" ? "Who stood out for you?" : "Who would you like to start a company with?";
