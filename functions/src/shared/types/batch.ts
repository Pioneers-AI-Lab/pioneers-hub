import { PITCH_STAGES } from "./event";
import type { Archivable, DateISOString, DayString, Timestamps } from "./common";

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

export type BatchSettings = {
  leaderboardVisibility: LeaderboardVisibility;
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
   * Les formulaires hebdomadaires (lot 4, shared/weeklyForms.ts) : chaque jeudi a 18:45, la fonction
   * `weeklyForms` cree le Weekly update founder et le Weekly update startup de la semaine, publies,
   * echeance 24 h apres, a partir de `startDayString`. Absent ou `enabled: false` : rien n'est cree.
   */
  weeklyForms?: WeeklyFormsSettings | null;
};

/** La creation automatique des formulaires hebdomadaires d'un batch (fa26 : a partir du jeudi 26/11). */
export type WeeklyFormsSettings = {
  enabled: boolean;
  /** Premier jeudi (`YYYY-MM-DD`, a Paris) ou les formulaires se creent. */
  startDayString: DayString;
};

/**
 * Echeance de chaque milestone (ISO complet). Une milestone sans echeance ne compte pas.
 * fa26 : Shortlist done et Met a la fin du debrief du H4, Teamed up au kickoff du H5,
 * Problem validated le jour du Selection Day ; Weekly goal (lot 4) chaque semaine a partir de `weeklyGoalFrom`.
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
  skillsDistribution: Record<string, number>;
  nationalities: Record<string, number>;
  /** Part des fondateurs dans une startup (0-1). */
  teamFormationRate: number | null;
  /** Taux de reponse aux formulaires (0-1). */
  formResponseRate: number | null;
  computedDateISOString: DateISOString;
};
