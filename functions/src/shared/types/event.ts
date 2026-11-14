import type { Archivable, BatchScoped, DateISOString, Timestamps } from "./common";

// ----------------------------
// events/{eventId} et ses sous-collections
// ----------------------------
//   events/{eventId}                                   PioneersEvent  public
//     teams/{teamId}                                   EventTeam      public une fois publiee, staff + IC avant
//     submissions/{teamId}                             Submission     public (equipe ecrit)
//     evaluations/{evaluatorId}_{targetId}             Evaluation     staff + investors IC (le jury ecrit par callable)
//     judges/link                                      JuryLink       staff seulement (secret du lien partage du jury)
//     attendance/{founderId}                           Attendance     staff + investors IC (+ le fondateur, la sienne)
//     peerRatings/{raterFounderId}_{rateeFounderId}    PeerRating     staff (+ l'auteur, les siens donnes) ; agregat dans founderStats
//
// UN SEUL MODELE POUR TOUS LES EXERCICES (SPECS §2, decision du 12/11). Le SP26
// avait une table par exercice (Edge drill, Hackathon, Discovery, Vibethon,
// Weekly pitch), chacune avec ses colonnes de notes. Ici, un evenement est une
// entree d'agenda, avec un tirage de groupes (`teams`) et des FORMULAIRES
// (types/form.ts) : les metriques sont les questions de son Debrief
// (`submission.metrics.<cle>`), la grille celles de son formulaire de jury
// (`evaluation.scores.<cle>`, poids sur la question), les picks une question de
// son formulaire Picks. L'evenement ne garde que le reglage de son leaderboard.
//
// LE TYPE D'UN EVENEMENT EST SA MECANIQUE, pas son nom (retour du 11/11) :
// pitch day, Friday pitch, demo, Selection Day et IC sont tous des `pitch` ;
// seuls le nom, la date, la grille et l'etape changent. Le nom vit dans `name`,
// les reglages par defaut dans un MODELE (`templateKey`, voir
// shared/presets/eventTemplates.ts), et les jalons dans `stage`.

/**
 * Le TYPE d'un evenement : une ETIQUETTE (decision du 13/11), pour l'affichage
 * et les modeles. Les outils ne viennent plus du type mais de ce qui est
 * attache a l'evenement : un matching (`matching`) donne le tirage et les
 * equipes, un formulaire de jury le jury et le leaderboard, un Debrief les
 * resultats d'equipe (SPECS §2).
 *   team_challenge  hackathons, Edge drill, customer discovery, Vibethon, workshop
 *   pitch           pitch day, Friday pitch, demo, Selection Day, Pre-IC, IC
 *   matching        lunch roulette, speed dating, round tables
 *   session         masterclass, talk, theme session, annonce, evenement social
 *                   (et un evenement cree a blanc)
 *   meeting         office hours, visio de mentorat
 */
export const EVENT_KINDS = ["team_challenge", "pitch", "matching", "session", "meeting"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * Le mode d'un matching : ce que le generateur cherche (shared/teamGenerator.ts).
 *   challenge  des equipes de travail : jamais deux fois la meme paire en
 *              challenge, au moins un profil tech par equipe, un leader
 *   matching   des tables pour se rencontrer : jamais deux fois la meme paire
 *              a table, puis eviter les coequipiers de challenge
 */
export const MATCHING_MODES = ["challenge", "matching"] as const;
export type MatchingMode = (typeof MATCHING_MODES)[number];

/**
 * Le matching d'un evenement : 0 ou 1 (un tirage par evenement, decision du
 * 12/11). Ses groupes sont `events/{id}/teams`. Il rend possibles les
 * questions « son equipe » et « chaque coequipier » des formulaires, et le jury
 * note ses groupes.
 */
export type EventMatching = {
  mode: MatchingMode;
  /** Taille visee des groupes (2 a 5). */
  size: { min: number; max: number };
};

/**
 * Etapes de decision : des `pitch` qui portent une decision Go / No Go et
 * rythment le batch. Une demo ou un pitch day n'a pas d'etape.
 */
export const PITCH_STAGES = ["selection_day", "pre_ic", "ic"] as const;
export type PitchStage = (typeof PITCH_STAGES)[number];

/**
 * draft -> scheduled -> live -> locked -> completed. Les notes du jury ne
 * dependent pas du statut : elles sont ouvertes tant que le formulaire de jury
 * l'est (le verrouiller, c'est le fermer).
 */
export type EventStatus = "draft" | "scheduled" | "live" | "locked" | "completed";

/** Ce qu'on note : une equipe d'evenement, un fondateur, une startup, ou un mentor (evaluation dans les deux sens apres un rendez-vous de mentorat). */
export type EvaluationTargetType = "team" | "founder" | "startup" | "mentor";

/**
 * Une metrique d'equipe (Fall 2026 : chaque hackathon a les siennes : appels
 * passes, inscriptions, argent encaisse...). C'est une question du Debrief
 * reliee a `submission.metrics.<key>` ; cette forme sert aux modeles
 * (presets/eventTemplates.ts) et au leaderboard qui la nomme. Chaque valeur est
 * recopiee dans `metricSnapshots` pour le suivi dans le temps.
 */
export type EventMetric = {
  /** Cle stable. Ne se renomme jamais. */
  key: string;
  label: string;
  unit: string | null;
};

/**
 * Un critere de grille : une question de note du formulaire de jury reliee a
 * `evaluation.scores.<key>` (echelle de la question, poids `weight`). Cette
 * forme sert aux modeles et au leaderboard. Le score total est la moyenne
 * ponderee des scores ramenes a /10.
 */
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
     * Le matching de l'evenement, `null` sans tirage. Absent d'un evenement
     * d'avant le 13/11 : il se deduit de son type et de `teamSize`
     * (`matchingOf`, shared/events.ts).
     */
    matching?: EventMatching | null;
    /** @deprecated ancien : la cible du jury se deduit du matching (`juryTargetOf`). */
    evaluationTargetType?: EvaluationTargetType | null;
    /** @deprecated ancien : la taille est celle du matching (`matching.size`). */
    teamSize?: { min: number; max: number } | null;
    /** Revelation programmee du leaderboard en salle. */
    leaderboardRevealDateISOString: DateISOString | null;
    /**
     * Ce qui classe le leaderboard : `null` = les notes du jury (par defaut) ;
     * sinon la cle d'une metrique de son Debrief (`submission.metrics.<cle>` :
     * hackathons « Phone Agents » et « Agent Agency » : conversations, argent
     * encaisse). Absent des anciens documents.
     */
    rankingMetricKey?: string | null;
    /**
     * Le bareme du leaderboard (SPECS §4.2, decision du 13/11) : il remplace
     * `rankingMetricKey`. Absent : les notes du jury, ou la metrique choisie.
     */
    scoring?: EventScoring | null;
  };

/**
 * Un element du bareme :
 *   - `per_unit` : `pointsPerUnit` points par unite d'une metrique de la Submission ;
 *   - `proportional` : la meilleure equipe a `maxPoints` sur cette metrique, les autres en proportion ;
 *   - `criterion` : la moyenne des jures sur un critere, ramenee a `maxPoints` (sinon la note telle quelle).
 * `tieBreakOnly` : il departage sans compter dans le total.
 */
export type ScoringItem = {
  key: string;
  label: string;
  mode: "per_unit" | "proportional" | "criterion";
  /** La cle de la metrique (`submission.metrics.<cle>`) ou du critere (`evaluation.scores.<cle>`). */
  sourceKey: string;
  pointsPerUnit?: number | null;
  maxPoints?: number | null;
  tieBreakOnly?: boolean;
};

/** Un element tel que le staff le regle : sa cle est celle de sa variable (`setEventScoring`). */
export type ScoringItemInput = Omit<ScoringItem, "key">;

/** Le bareme d'un evenement : ses elements, puis les cles d'element qui departagent, dans l'ordre. */
export type EventScoring = { items: ScoringItem[]; tieBreaks: string[] };

/** Le bareme de l'evenement, `null` s'il n'en a pas (ou un bareme vide). */
export const scoringOf = (event: { scoring?: EventScoring | null }): EventScoring | null => (event.scoring?.items.length ? event.scoring : null);

/**
 * Les fondateurs invites a un evenement a audience restreinte : les invites
 * nommes et les membres des startups concernees. `null` : tout le batch est
 * invite (`audience: "batch"`).
 */
export function invitedFounderIds(
  event: Pick<PioneersEvent, "audience" | "guestFounderIds" | "startupIds">,
  founders: { id: string; startupId: string | null }[],
): Set<string> | null {
  if (event.audience === "batch") return null;
  const startups = new Set(event.startupIds);
  return new Set([...event.guestFounderIds, ...founders.filter((f) => f.startupId !== null && startups.has(f.startupId)).map((f) => f.id)]);
}

// ---- teams/{teamId} ----------------------------------------------------------

/**
 * Roles dans l'equipe. @source SP26 « Vibethon » (Tech lead, Presenter, Deck maker).
 * `leader` : un par groupe (challenge ou lunch roulette), tire au sort au tirage
 * (`pickLeader`, shared/teamGenerator.ts) ; il rassemble le groupe et veille au deroulement.
 */
export type TeamRole = "tech_lead" | "presenter" | "deck_maker" | "leader";

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

/** D'ou vient le probleme d'une equipe (Fall 2026, H2 et H3). */
export const PROBLEM_SOURCES = ["pain_library", "own_idea"] as const;
export type ProblemSource = (typeof PROBLEM_SOURCES)[number];
export const PROBLEM_SOURCE_LABELS: Record<ProblemSource, string> = { pain_library: "From the pain library", own_idea: "Our own idea" };

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
  /**
   * Cle de metrique -> valeur : questions du Debrief reliees a
   * `submission.metrics.<cle>`. Chaque valeur est aussi un `metricSnapshot`
   * (declencheur `onSubmissionWritten`).
   */
  metrics: Record<string, number>;
  /** @source Fall 2026 « Build freeze » : URL du produit et fonctionnalites. */
  productUrl: string | null;
  /** Liens de preuve (transcripts d'appels, liste de 30 clients potentiels, creatives...). */
  proofUrls: string[];
  /** Precisions libres de l'equipe (ex. le type de client du hackathon Agent Agency). */
  notes: string | null;
  /** Fall 2026 : le probleme en une phrase (H1), sa source (H2, H3), les apprentissages (H2), le dossier Drive des preuves. */
  painSentence: string | null;
  problemSource: ProblemSource | null;
  learnings: string | null;
  driveFolderUrl: string | null;
  submittedDateISOString: DateISOString | null;
  /**
   * Dernier envoi par le formulaire APRES son echeance (SPECS §4.2) : le bareme
   * lui donne 0, sauf si le staff leve le retard (`lateWaived`). Seul un envoi
   * par formulaire le recalcule ; une correction du staff le laisse.
   */
  late: boolean;
  lateWaived: boolean;
  /** Elements du bareme mis a 0 par le staff (une fausse preuve), par cle d'element. */
  zeroedItemKeys: string[];
  /** Dernier ecrivain : le repondant du Debrief, ou le staff qui corrige. Source des releves. */
  recordedByUid: string | null;
  recordedSource: "self_reported" | "staff" | null;
};

/** Ce que tout ecrivain d'une soumission pose : la source des releves de metriques (`onSubmissionWritten`). */
export const submissionStamp = (uid: string, source: "self_reported" | "staff", now: string, deadline?: DateISOString | null) => ({
  submittedDateISOString: now,
  recordedByUid: uid,
  recordedSource: source,
  // Un envoi par formulaire connait l'echeance : il dit s'il est en retard.
  ...(deadline !== undefined ? { late: deadline !== null && now > deadline } : {}),
});

/** Envoyee apres l'echeance et sans exception du staff : le bareme lui donne 0. */
export const isLateUnwaived = (s: Pick<Submission, "late" | "lateWaived"> | null | undefined): boolean => s?.late === true && s.lateWaived !== true;

/** Une soumission vide : la base de tout ecrivain (Debrief, staff, API, via le registre). */
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
  proofUrls: [],
  notes: null,
  painSentence: null,
  problemSource: null,
  learnings: null,
  driveFolderUrl: null,
  submittedDateISOString: null,
  late: false,
  lateWaived: false,
  zeroedItemKeys: [],
  recordedByUid: null,
  recordedSource: null,
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
  /**
   * Un jure du lien partage : `founder-{founderId}` (un fondateur du batch) ou
   * `jury-{empreinte du nom}` (un nom saisi) ; l'id d'un ancien document `judges`
   * pour les liens par jure d'avant le 12/11. `uid` pour un autre evaluateur.
   */
  evaluatorId: string;
  evaluatorName: string;
  /** @source SP26 « Weekly pitch » (External, a confirmer) */
  isExternal: boolean;
  targetType: EvaluationTargetType;
  targetId: string;
  /** Critere -> note, sur l'echelle de la question du formulaire de jury (`evaluation.scores.<critere>`). */
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

// ---- judges/link -------------------------------------------------------------

/**
 * Le lien partage du jury d'un evenement (`/forms/{formId du jury}#secret`), un seul
 * par evenement : qui l'a peut noter, sans compte, en choisissant ou saisissant
 * son nom. Staff seulement (regle `judges`), jamais lu par l'API (SPECS §4.8).
 * Le secret est garde EN CLAIR pour que le staff recopie le lien a tout moment :
 * il ne donne que le droit de noter cet evenement, que le staff a deja.
 * Le staff le remplace (l'ancien cesse de marcher). Les autres documents de
 * `judges` sont les liens par jure d'avant le 12/11 : plus lus.
 */
export type JuryLink = {
  secret: string;
  createdByUid: string;
  createdDateISOString: DateISOString;
};

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
  /** Bareme : les points de chaque element, leur total, et la soumission en retard (0). */
  points?: Record<string, number>;
  total?: number;
  late?: boolean;
  /** Le score ramene a la meilleure equipe = 100 : il s'additionne d'un hackathon a l'autre (classement cumule). */
  normalized?: number;
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
  /** Le bareme qui classe (prioritaire sur `metric`). */
  scoring?: EventScoring | null;
  /**
   * Publie : visible des fondateurs (avec la visibilite du batch). Un evenement a
   * bareme l'est quand le staff publie son classement, apres la verification des
   * preuves ; sans bareme, toujours.
   */
  published?: boolean;
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

