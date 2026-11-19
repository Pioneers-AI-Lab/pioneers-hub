import { PITCH_STAGES } from "./event";
import type { Archivable, BatchScoped, DateISOString, DayString, Timestamps } from "./common";
import type { FounderPillarKey, StartupSubScore } from "./score";

// ----------------------------
// batches/{batchId}
// ----------------------------
// Une promotion d'un programme (Fall 2026). L'id est un slug (`fall-2026`).
// Public : nom, dates, leaderboard. Le reste des reglages est lu par tous mais
// ecrit par le staff seulement.

export type BatchStatus = "upcoming" | "active" | "completed";

/** Jalons qui rythment le batch et alimentent le compte a rebours du cockpit. */
export const BATCH_MILESTONE_KEYS = ["kickoff", ...PITCH_STAGES, "demo_day"] as const;
export type BatchMilestoneKey = (typeof BATCH_MILESTONE_KEYS)[number];

export type BatchMilestone = {
  key: BatchMilestoneKey;
  label: string;
  dayString: DayString | null;
};

/**
 * Interrupteur admin. Par defaut visible pendant les hackathons de la semaine
 * 1, masque de l'ouverture des mutual picks jusqu'a la formation des equipes.
 */
export type LeaderboardVisibility = "visible" | "hidden";

/**
 * Qui voit une partie du batch (Admin > Batch settings, decision du 18/11) : `none` personne,
 * `staff` le staff et les investors, `founders` aussi les fondateurs (shared/access.ts#canSeeAudience).
 * Regle d'AFFICHAGE : les documents restent lisibles (firestore.rules).
 */
export const BATCH_AUDIENCES = ["none", "staff", "founders"] as const;
export type BatchAudience = (typeof BATCH_AUDIENCES)[number];

/**
 * Qui voit chaque sous-score (18/11), dans le bloc des scores (`scoresVisibility` decide du bloc ;
 * le score global reste). Un sous-score absent suit `scoresVisibility`.
 */
export type SubScoreKeys = { founder: FounderPillarKey; startup: StartupSubScore };
/** `null` (ou absent) : le sous-score suit les scores. Ecrit en entier (`fullSubScores`) : une ecriture en `merge` garde sinon une cle retiree. */
export type SubScoreVisibility = { [T in keyof SubScoreKeys]?: Partial<Record<SubScoreKeys[T], BatchAudience | null>> };

export type BatchSettings = {
  leaderboardVisibility: LeaderboardVisibility;
  /** L'onglet Startups et la tuile de l'accueil. Absent : `none` (les startups naissent le 25/11). */
  startupsVisibility?: BatchAudience;
  /** Les scores (Program Performance, score des startups) et leurs signaux. Absent : `staff`. */
  scoresVisibility?: BatchAudience;
  /** Chaque sous-score, dans ce bloc. Absent (ou un sous-score absent) : comme `scoresVisibility`. */
  subScoreVisibility?: SubScoreVisibility;
  /** Channel general du batch (`#fall26-general`), cible des annonces. */
  slackChannelId: string | null;
  /**
   * Espace de travail Slack du batch (`T…`). Un batch n'est pas forcement dans
   * le meme espace qu'un autre : c'est la « base » des liens Slack du batch,
   * l'id du membre (`people.slackUserId`) en est le suffixe (shared/slackLinks.ts).
   * Absent des batchs plus anciens.
   */
  slackTeamId?: string | null;
  /**
   * D'ou viennent les scores (`scores`, `scoreSignals`, `founderStats`) : `hub` =
   * calcules par le Hub (SPECS §5.5, par defaut) ; `imported` = recopies d'un
   * ancien outil (Spring 2026) : le calcul n'y touche jamais.
   */
  scoresSource?: "hub" | "imported";
  /**
   * L'agenda Google du batch (decision du 16/11, SPECS §2) : son id
   * (`…@group.calendar.google.com`). Ses evenements de la periode du batch
   * deviennent les evenements du Hub (shared/calendarSync.ts). Plusieurs batchs
   * peuvent partager un agenda. Absent ou `null` : les evenements se creent dans le Hub.
   */
  googleCalendarId?: string | null;
  /**
   * Les echeances des milestones du score (Execution, shared/scoring.ts#founderMilestones),
   * reglees par batch (scripts/set-milestone-dates.mjs). Absent : aucune milestone due.
   */
  scoreMilestoneDueDates?: ScoreMilestoneDueDates | null;
  /**
   * Les formulaires hebdomadaires (lot 4, decision du 18/11, shared/weeklyForms.ts) : avec `enabled`,
   * la synchro de l'agenda donne le template `weekly_update` a chaque entree « Weekly Update Form »
   * et lui cree le Weekly update founder et le Weekly update startup. Absent ou `enabled: false` :
   * rien n'est accroche (le template s'applique encore a la main).
   */
  weeklyForms?: WeeklyFormsSettings | null;
};

/** L'accroche des formulaires hebdomadaires aux entrees de l'agenda du batch. */
export type WeeklyFormsSettings = { enabled: boolean };

/**
 * Echeance de chaque milestone (ISO complet). Une milestone sans echeance ne compte pas.
 * fa26 : Shortlist done et Met a la fin du debrief du H4, Teamed up au kickoff du H5,
 * Problem validated le jour du Selection Day ; Weekly goal (lot 4) a partir de `weeklyGoalFrom`, l'echeance du deuxieme Weekly update (`weeklyGoalFromOf`).
 */
export type ScoreMilestoneDueDates = {
  shortlistDone?: DateISOString | null;
  met?: DateISOString | null;
  teamedUp?: DateISOString | null;
  problemValidated?: DateISOString | null;
  weeklyGoalFrom?: DateISOString | null;
};

export type Batch = Timestamps &
  Archivable & {
    programId: string;
    name: string;
    startDayString: DayString;
    endDayString: DayString | null;
    status: BatchStatus;
    milestones: BatchMilestone[];
    settings: BatchSettings;
  };

// ----------------------------
// batchResources/{batchId}  (fondateurs du batch + staff + investors ; ecrit par le staff)
// ----------------------------
// Les liens utiles du batch (19/11) : section « Resources » en bas de l'accueil,
// reglee dans Admin > Batch settings (ou `update_batch`). A part du batch, qui est
// public : un visiteur ne les lit pas. Regle pure : shared/admin/batch.ts#batchResourcesWrite.

export type BatchResource = {
  label: string;
  /** Depliee au (?) de la ligne ; `null` : pas de (?). */
  description: string | null;
  /** Adresse web (`https://…`, nouvel onglet) ou page de l'app (chemin commencant par `/`). */
  url: string;
};

export type BatchResources = BatchScoped & {
  /** Dans l'ordre de l'accueil. */
  items: BatchResource[];
  updatedDateISOString: DateISOString;
};

// ----------------------------
// batchStats/{batchId}  (agregat, recalcule par Cloud Functions, public)
// ----------------------------
// Batch · already collected (SP26 · Computed) et recommended additions.

export type BatchStats = {
  programId: string;
  founders: number;
  avgYearsOfXP: number | null;
  /** Part des fondateurs ayant deja fonde une entreprise (0-1). */
  repeatFounders: number | null;
  profileDistribution: Record<string, number>;
  /** Fondateurs par valeur de `founder.hardSkills` (card « Profile distribution » de l'accueil). */
  skillsDistribution: Record<string, number>;
  /**
   * Idem pour `founder.industries` et `founder.rolesICouldTake` (19/11). Absents
   * des documents plus anciens (l'accueil les lit `?? {}`).
   */
  industriesDistribution?: Record<string, number>;
  rolesDistribution?: Record<string, number>;
  nationalities: Record<string, number>;
  /** Part des fondateurs dans une startup (0-1). */
  teamFormationRate: number | null;
  /** Taux de reponse aux formulaires (0-1). */
  formResponseRate: number | null;
  computedDateISOString: DateISOString;
};
