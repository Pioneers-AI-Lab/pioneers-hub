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
