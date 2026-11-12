import type { Archivable, BatchScoped, DateISOString, Timestamps } from "./common";

// ----------------------------
// events/{eventId} et ses sous-collections
// ----------------------------
//   events/{eventId}                                   PioneersEvent  public
//     teams/{teamId}                                   EventTeam      public une fois publiee, staff + IC avant
//     submissions/{teamId}                             Submission     public (equipe ecrit)
//     evaluations/{evaluatorId}_{targetId}             Evaluation     staff + investors IC (+ le jure, les siennes)
//     judges/{judgeId}                                 Judge          staff seulement (empreinte du jeton)
//     attendance/{founderId}                           Attendance     staff + investors IC (+ le fondateur, la sienne)
//     peerRatings/{raterFounderId}_{rateeFounderId}    PeerRating     staff (+ l'auteur, les siens donnes) ; agregat dans founderStats
//
// UN SEUL MODELE POUR TOUS LES EXERCICES. Le SP26 avait une table par exercice
// (Edge drill, Hackathon, Discovery, Vibethon, Weekly pitch), chacune avec ses
// colonnes de notes. Ici, l'evenement declare sa grille (`criteria`) et chaque
// evaluation remplit `scores[critere]`.
//
// LE TYPE D'UN EVENEMENT EST SA MECANIQUE, pas son nom (retour du 11/11) :
// pitch day, Friday pitch, demo, Selection Day et IC sont tous des `pitch` ;
// seuls le nom, la date, la grille et l'etape changent. Le nom vit dans `name`,
// les reglages par defaut dans un MODELE (`templateKey`, voir
// shared/presets/eventTemplates.ts), et les jalons dans `stage`.

/**
 * Les mecaniques. Chacune dit ce que la plateforme fait de l'evenement
 * (`EVENT_KIND_FEATURES`).
 *   team_challenge  equipes tirees, soumissions, metriques, notes du jury, avis
 *                   entre pairs, leaderboard : hackathons, Edge drill, customer
 *                   discovery, Vibethon, workshop, customer day, sprint de traction
 *   pitch           des startups pitchent et sont notees sur la grille unique :
 *                   pitch day, Friday pitch, demo, Selection Day, Pre-IC, IC
 *   matching        groupes tires pour se rencontrer, sans note : lunch roulette,
 *                   speed dating, round tables
 *   session         presence et note en un geste, avec des intervenants :
 *                   masterclass, talk, theme session, annonce, evenement social
 *   meeting         rendez-vous d'une startup ou d'un fondateur avec le staff, un
 *                   mentor ou un expert, avec notes : office hours, visio de mentorat
 */
export const EVENT_KINDS = ["team_challenge", "pitch", "matching", "session", "meeting"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * Ce que note un jury dans cette mecanique : une equipe (hackathon) ou une
 * startup (pitch). `null` : pas de jury ni de leaderboard du jury.
 */
export function juryTarget(kind: EventKind): "team" | "startup" | null {
  const target = EVENT_KIND_FEATURES[kind].evaluationTarget;
  return target === "team" || target === "startup" ? target : null;
}

/** Ce que chaque mecanique active. L'interface et l'API s'en servent ; la donnee ne depend que de ca. */
export const EVENT_KIND_FEATURES: Record<
  EventKind,
  {
    /** Equipes generees (`teams`) et appartenances datees. */
    teams: boolean;
    /** Soumissions d'equipe et metriques de l'evenement. */
    submissions: boolean;
    /** Ce que notent les evaluateurs, `null` si rien. */
    evaluationTarget: EvaluationTargetType | null;
    /** Avis entre pairs apres l'evenement. */
    peerRatings: boolean;
    leaderboard: boolean;
    /** Note en un geste par les participants. */
    sessionRating: boolean;
    /** Presence attendue de chaque participant (champ manquant sinon). */
    attendance: boolean;
  }
> = {
  team_challenge: {
    teams: true,
    submissions: true,
    evaluationTarget: "team",
    peerRatings: true,
    leaderboard: true,
    sessionRating: false,
    attendance: true,
  },
  pitch: {
    teams: false,
    submissions: false,
    evaluationTarget: "startup",
    peerRatings: false,
    leaderboard: true,
    sessionRating: false,
    attendance: false,
  },
  matching: {
    teams: true,
    submissions: false,
    evaluationTarget: null,
    peerRatings: false,
    leaderboard: false,
    sessionRating: false,
    attendance: false,
  },
  session: {
    teams: false,
    submissions: false,
    evaluationTarget: null,
    peerRatings: false,
    leaderboard: false,
    sessionRating: true,
    attendance: true,
  },
  meeting: {
    teams: false,
    submissions: false,
    evaluationTarget: "startup",
    peerRatings: false,
    leaderboard: false,
    sessionRating: true,
    attendance: true,
  },
};

/**
 * Etapes de decision : des `pitch` qui portent une decision Go / No Go et
 * rythment le batch. Une demo ou un pitch day n'a pas d'etape.
 */
export const PITCH_STAGES = ["selection_day", "pre_ic", "ic"] as const;
export type PitchStage = (typeof PITCH_STAGES)[number];

/**
 * draft -> scheduled -> live (notes ouvertes) -> locked (notes figees) -> completed.
 * Un jure peut corriger ses notes jusqu'a `locked`.
 */
export type EventStatus = "draft" | "scheduled" | "live" | "locked" | "completed";

/** Ce qu'on note : une equipe d'evenement, un fondateur, une startup, ou un mentor (evaluation dans les deux sens apres un rendez-vous de mentorat). */
export type EvaluationTargetType = "team" | "founder" | "startup" | "mentor";

/**
 * Une metrique que l'evenement collecte (Fall 2026 : chaque hackathon a les
 * siennes : appels passes, inscriptions, argent encaisse...). Declaree par
 * l'evenement comme sa grille, remplie dans `Submission.metrics`, et recopiee
 * dans `metricSnapshots` pour le suivi dans le temps.
 */
export type EventMetric = {
  /** Cle stable. Ne se renomme jamais. */
  key: string;
  label: string;
  unit: string | null;
};

/** Un critere de grille. Le score total est la moyenne ponderee des scores ramenes a /10. */
export type Criterion = {
  /** Cle stable, utilisee dans `Evaluation.scores`. Ne se renomme jamais. */
  key: string;
  label: string;
  min: number;
  max: number;
  /** Poids relatif (40 / 40 / 20 pour l'IC). */
  weight: number;
};

/** Role d'un invite dans l'evenement. */
export type EventGuestRole = "founder" | "mentor" | "investor" | "staff" | "speaker" | "judge" | "guest";

/**
 * Un invite (brouillon du 11/11 : `events { date, guests }`) : fondateur,
 * mentor, investor, speaker de masterclass, expert. @source 2025 « Guest ».
 */
export type EventGuest = {
  name: string;
  role: EventGuestRole;
  /** Identite, si la personne est connue (`people/{id}`). */
  personId: string | null;
  founderId: string | null;
  mentorId: string | null;
  /** @source intra « guest_intro » */
  intro: string | null;
};

/**
 * Qui voit l'evenement sur sa page : tout le batch (hackathon, masterclass),
 * ou seulement les invites et les startups concernees (office hours, visio
 * de mentorat).
 */
export type EventAudience = "batch" | "guests";

export type PioneersEvent = BatchScoped &
  Timestamps &
  Archivable & {
    kind: EventKind;
    /** Le nom affiche : « Hackathon 2 : Phone Agents », « Friday pitch », « Selection Day ». */
    name: string;
    /**
     * Modele dont l'evenement a ete cree (`vibethon`, `friday_pitch`...), pour
     * retrouver tous les evenements du meme format d'un batch a l'autre.
     * Sa grille et ses metriques ont ete COPIEES : modifier le modele ne
     * change pas un evenement passe.
     */
    templateKey: string | null;
    /** Etape de decision, pour un `pitch` : Selection Day, Pre-IC, IC. */
    stage: PitchStage | null;
    /** @source intra « topic » */
    topic: string | null;
    startDateISOString: DateISOString;
    endDateISOString: DateISOString | null;
    location: string | null;
    /** Semaine du programme (`Week 0` ... `Week 15 - Post IC`, liste `lists/programWeeks`). */
    programWeek: string | null;
    /** Jalon du batch (Selection Day, IC...) : signale dans les resumes Slack. */
    isMilestone: boolean;
    audience: EventAudience;
    guests: EventGuest[];
    /** Ids des fondateurs invites, recopies de `guests` : requete `array-contains` de la page fondateur. */
    guestFounderIds: string[];
    /** Ids des mentors invites, recopies de `guests` (comme `guestFounderIds`), pour les requetes. */
    mentorIds: string[];
    /** Startups concernees (visio de mentorat, pitch session, IC). Leurs membres voient l'evenement. */
    startupIds: string[];
    /** @source intra « event_sign_up_link », « external_resource_link » */
    signUpUrl: string | null;
    resourceUrl: string | null;
    status: EventStatus;
    /**
     * Grille de notation ; vide pour les evenements sans evaluation. UNE SEULE
     * ECHELLE (brief du 11/11) : pitch days, demos, Selection Day, Pre-IC et IC
     * reprennent la grille Team 40 / Speed 40 / Market 20 (presets/eventTemplates.ts).
     */
    criteria: Criterion[];
    /** Metriques collectees par l'evenement (hackathons). Vide sinon. */
    metrics: EventMetric[];
    evaluationTargetType: EvaluationTargetType | null;
    /** Taille des equipes (Twin : 3 max, a confirmer). `null` si pas d'equipes. */
    teamSize: { min: number; max: number } | null;
    /** Revelation programmee du leaderboard en salle. */
    leaderboardRevealDateISOString: DateISOString | null;
    /**
     * Ce qui classe le leaderboard : `null` = les notes du jury (par defaut) ;
     * sinon la cle d'une de ses `metrics` (hackathons « Phone Agents » et
     * « Agent Agency » : conversations, argent encaisse). Absent des anciens documents.
     */
    rankingMetricKey?: string | null;
    /** Les choix prives que l'evenement recueille (`picks/{eventId}_{founderId}`), `null` sinon. Absent des anciens documents. */
    picks?: EventPicks | null;
  };

/**
 * Une demande de choix (mutual picks, « qui t'a marque » d'un speed dating).
 * Ouverte tant que `closesDateISOString` n'est pas passee (`null` : jusqu'a
 * ce que le staff la ferme).
 */
export type EventPicks = {
  question: string;
  /** Nombre de choix au plus (top 3 le 23/11). */
  max: number;
  closesDateISOString: DateISOString | null;
};

/** Au plus 5 choix par demande. */
export const PICKS_MAX = 5;

/** La demande de choix de l'evenement, si elle est ouverte a cet instant. */
export function openPicks(event: Pick<PioneersEvent, "picks" | "archivedDateISOString">, nowISO: string): EventPicks | null {
  const picks = event.picks ?? null;
  if (!picks || event.archivedDateISOString !== null) return null;
  return picks.closesDateISOString === null || picks.closesDateISOString > nowISO ? picks : null;
}

// ---- teams/{teamId} ----------------------------------------------------------

/** Roles dans l'equipe. @source SP26 « Vibethon » (Tech lead, Presenter, Deck maker). */
export type TeamRole = "tech_lead" | "presenter" | "deck_maker";

export type EventTeam = {
  /** @source SP26 « Team Name » / « Group Name » */
  name: string;
  /** @source SP26 « Team Members » */
  memberIds: string[];
  /**
   * Noms affiches sur la page publique (sans compte), dans l'ordre de
   * `memberIds` : prenom + initiale (`publicShortName`, shared/access.ts), le
   * nom complet d'un fondateur n'etant public qu'avec son consentement.
   * Ecrits a la publication ; `null` avant, ou pour une equipe publiee avant
   * l'existence de la page (absent des anciens documents).
   */
  memberNames?: string[] | null;
  roles: Partial<Record<string, TeamRole[]>>;
  /** Verrouillee : le generateur ne la modifie plus. */
  locked: boolean;
  publishedDateISOString: DateISOString | null;
  /** Rempli si l'equipe devient (ou est deja) une startup. */
  startupId: string | null;
};

// ---- submissions/{teamId} ----------------------------------------------------

/** @source SP26 « Hackathon » (deliverables) */
export const DELIVERABLES = [
  "figma_prototype",
  "working_mvp",
  "landing_page",
  "elevator_pitch",
  "six_slide_pitch",
  "logo",
  "linkedin_page",
  "user_onboarding_flow",
] as const;
export type Deliverable = (typeof DELIVERABLES)[number];

/** Une preuve jointe a une soumission (transcripts d'appels, liste de 30 clients potentiels, creatives...). */
export type SubmissionLink = { label: string; url: string };

export type Submission = {
  teamId: string;
  title: string | null;
  pitchOneLine: string | null;
  /** Lien Loom. */
  videoUrl: string | null;
  /** Repo GitHub : README, contributeurs et commits recuperes automatiquement (P1). */
  repoUrl: string | null;
  /** @source SP26 « Slide Deck » (Edge drill) */
  slideUrl: string | null;
  deliverables: Partial<Record<Deliverable, boolean>>;
  /** Cle de `PioneersEvent.metrics` -> valeur. Chaque valeur est aussi un `metricSnapshot`. */
  metrics: Record<string, number>;
  /** @source Fall 2026 « Build freeze » : URL du produit et fonctionnalites. */
  productUrl: string | null;
  links: SubmissionLink[];
  /** Precisions libres de l'equipe (ex. le type de client du hackathon Agent Agency). */
  notes: string | null;
  submittedDateISOString: DateISOString | null;
};

/** Une soumission vide : la base de ses deux ecrivains (Debrief, et formulaires / API via le registre). */
export const emptySubmission = (teamId: string): Submission => ({
  teamId,
  title: null,
  pitchOneLine: null,
  videoUrl: null,
  repoUrl: null,
  slideUrl: null,
  deliverables: {},
  metrics: {},
  productUrl: null,
  links: [],
  notes: null,
  submittedDateISOString: null,
});

// ---- evaluations/{evaluatorId}_{targetId} ------------------------------------

/**
 * Qui note : un jure par lien prive, un membre du staff, un investor (niveau
 * IC), un invite (feedback avant l'IC), un mentor ou un fondateur (evaluation
 * dans les deux sens apres un rendez-vous de mentorat).
 */
export type EvaluatorKind = "judge" | "staff" | "investor" | "guest" | "mentor" | "founder";

/** @source 2025 « Startup Evaluation » « Go / No Go / Maybe » */
export type EvaluationDecision = "go" | "no_go" | "maybe";

/** @source 2025 « Startup Evaluation » « Final Decision » (Go, No Go) */
export type FinalDecision = "go" | "no_go";

export type Evaluation = {
  evaluatorKind: EvaluatorKind;
  /** `judgeId` pour un jure, `uid` sinon. */
  evaluatorId: string;
  evaluatorName: string;
  /** @source SP26 « Weekly pitch » (External, a confirmer) */
  isExternal: boolean;
  targetType: EvaluationTargetType;
  targetId: string;
  /** Critere -> note, sur l'echelle declaree par `PioneersEvent.criteria`. */
  scores: Record<string, number>;
  /** @source 2025 « Overall Score » (grille IC) : note globale saisie, distincte de la moyenne ponderee. */
  overallScore: number | null;
  /** @source SP26 « Internal pitch feedback » : « Would you invest? » */
  wouldInvest: boolean | null;
  /**
   * @source SP26 « Internal pitch feedback » : « How likely is this the one team
   * you'd bet on? ». Echelle a confirmer (0-10 par defaut).
   */
  betLikelihood: number | null;
  /** @source SP26 mentorat : « wants to continue » (dans les deux sens). */
  wantsToContinue: boolean | null;
  comment: string | null;
  /** Recommandation de l'evaluateur (Selection Day, Pre-IC, IC). */
  decision: EvaluationDecision | null;
  /** Decision finale, saisie une fois par startup et par etape (par le staff). */
  finalDecision: FinalDecision | null;
  updatedDateISOString: DateISOString;
};

// ---- judges/{judgeId} --------------------------------------------------------

/** Un jure, sans compte : un lien prive et personnel par evenement. */
export type Judge = {
  name: string;
  email: string | null;
  createdByUid: string;
  createdDateISOString: DateISOString;
  /** Empreinte du jeton du lien ; le jeton en clair n'est jamais stocke. */
  tokenHash: string;
  /** Le lien expire le lendemain de l'evenement. */
  expiresDateISOString: DateISOString;
  revokedDateISOString: DateISOString | null;
  /** Un jure ne note pas sa propre equipe. */
  excludedTargetIds: string[];
};

/** L'etat du lien d'un jure a cet instant : le serveur le refuse s'il n'est pas `active`. */
export function judgeLinkState(judge: Pick<Judge, "revokedDateISOString" | "expiresDateISOString">, nowISO: string) {
  if (judge.revokedDateISOString !== null) return "revoked" as const;
  return judge.expiresDateISOString < nowISO ? ("expired" as const) : ("active" as const);
}

// ---- attendance/{founderId} --------------------------------------------------

/** @source SP26 « Founders (attendance) », une colonne par session. */
export const ATTENDANCE_STATUSES = ["present", "late", "in_office", "absent"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  late: "Late",
  in_office: "In office",
  absent: "Absent",
};

export type Attendance = {
  founderId: string;
  status: AttendanceStatus;
  markedByUid: string;
  markedDateISOString: DateISOString;
};

// ---- peerRatings/{raterFounderId}_{rateeFounderId} ---------------------------

/**
 * Apres chaque hackathon (brief du 11/11) : « Would you start a company with
 * this person? », une note (1-5) et une phrase. Prive : staff seulement,
 * l'auteur relit les siens. Jamais montre au fondateur note.
 */
export type PeerRating = BatchScoped & {
  raterFounderId: string;
  rateeFounderId: string;
  teamId: string;
  rating: number;
  comment: string | null;
  submittedDateISOString: DateISOString;
};

// ----------------------------
// leaderboards/{eventId}  (agregat public, recalcule par Cloud Functions)
// ----------------------------
// Scores du jury UNIQUEMENT : moyenne ponderee des criteres, moyennee entre
// jures. Les avis entre pairs n'y entrent jamais.

export type LeaderboardRow = {
  targetId: string;
  name: string;
  memberIds: string[];
  /** Ce qui classe : la note du jury sur 10, ou la valeur de la metrique (`Leaderboard.metric`). */
  score: number;
  rank: number;
  /** Variation de rang par rapport a l'evenement precedent du meme type. */
  rankDelta: number | null;
  criteriaScores: Record<string, number>;
  evaluationsCount: number;
};

/**
 * Lisible par tous tant que `batches.settings.leaderboardVisibility` vaut
 * `visible` ; sinon staff et investors seulement (masque pendant les mutual
 * picks : la regle l'impose, pas seulement l'interface).
 */
export type Leaderboard = BatchScoped & {
  eventId: string;
  /** La metrique qui classe, `null` (ou absent) : les notes du jury. */
  metric?: EventMetric | null;
  rows: LeaderboardRow[];
  computedDateISOString: DateISOString;
};

// ----------------------------
// sessionRatings/{eventId}_{founderId}  (staff + investors IC ; l'auteur, la sienne)
// ----------------------------
// La note « en un geste » apres chaque seance (brief du 11/11, SP26 « Session
// log » : note moyenne par seance). Nominative, pour la relier a la presence ;
// les retours libres et sensibles passent par un formulaire anonyme.

export type SessionRating = BatchScoped & {
  eventId: string;
  founderId: string;
  /** 1-5. */
  rating: number;
  comment: string | null;
  submittedDateISOString: DateISOString;
};

// ----------------------------
// eventStats/{eventId}  (agregat staff + investors IC, recalcule par Cloud Functions)
// ----------------------------

export type EventStats = BatchScoped & {
  eventId: string;
  attendees: number;
  invited: number;
  ratingAverage: number | null;
  ratingsCount: number;
  computedDateISOString: DateISOString;
};

