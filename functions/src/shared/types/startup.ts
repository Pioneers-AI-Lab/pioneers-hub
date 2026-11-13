import type { Archivable, BatchScoped, DateISOString, DayString, RangeEstimate, StartupScoped, Timestamps } from "./common";
import type { MetricKey } from "./form";
import type { CheckinGoalKey, CheckinMetricKey } from "../presets/standardMetrics";

// ----------------------------
// Startup : trois documents, trois publics (SPECS §6.2)
// ----------------------------
//   startups/{startupId}                   Startup          public
//   startups/{startupId}/private/profile   StartupProfile   membres + staff + investors
//   startups/{startupId}/private/internal  StartupInternal  staff + investors IC
//   checkins/{startupId}_{weekStart}_{founderId}  Checkin    membres + staff + investors
//
// Comme pour le fondateur, le « tracking » du brouillon (revenu, utilisateurs...)
// n'est pas un objet dans la fiche : il vit dans `checkins` (un document par
// update du jeudi), resume par Cloud Functions dans `kpiSeries`.
//
// Une startup nait quand une equipe se declare (apres les mutual picks et le
// hackathon de 3 jours). Les fondateurs la creent et la rejoignent eux-memes.
// `@source` : tables SP26 « Startup tracker », « Selection Day startups » et
// « Pitch summary » (SPECS annexe B).

/** @source 2025 (Lucie) : `active`, `dead`, `Selection Day No Go`. */
export const STARTUP_STATUSES = ["active", "dead", "selection_day_no_go"] as const;
export type StartupStatus = (typeof STARTUP_STATUSES)[number];

// ---- startups/{startupId} ----------------------------------------------------

/** Un membre et son titre (brouillon du 11/11 : `founders: { id, title }`). */
export type StartupMember = {
  founderId: string;
  /** Ex. « CEO », « CTO ». @source SP26 « CEO Name », « CTO Name » */
  title: string | null;
};

export type StartupPublicStats = {
  /** Rang au leaderboard du batch (1 = premier). */
  rank: number | null;
};

export type Startup = BatchScoped &
  Timestamps &
  Archivable & {
    /** @source SP26 « Name » / « Startup » */
    name: string;
    /** @source SP26 « Logo » / « Startup Logo » */
    logoUrl: string | null;
    /** @source SP26 « Website » / « Landing Page » */
    websiteUrl: string | null;
    /** @source SP26 « One-liner » */
    ideaOneLine: string | null;
    /** @source SP26 « Vertical » */
    vertical: string | null;
    status: StartupStatus;
    /** Membres et leur titre. @source SP26 « Final Team » */
    members: StartupMember[];
    /**
     * Ids des membres, recopies de `members` : les regles et les requetes
     * (`array-contains`) ne savent pas lire l'interieur d'un tableau d'objets.
     */
    memberIds: string[];
    stats: StartupPublicStats | null;
  };

// ---- startups/{startupId}/private/profile ------------------------------------

/** @source SP26 table « Competitors » */
export type Competitor = {
  name: string;
  description: string | null;
  domain: string | null;
  stage: string | null;
  raised: string | null;
};

/**
 * Analyse de marche generee. @source SP26 « Selection Day startups » (colonnes
 * AI et marche). Visible des investors des deux niveaux (fiche startup, §3.3) :
 * elle n'est pas sensible, elle vit donc avec le profil et non avec l'evaluation.
 */
export type MarketAnalysis = {
  aiSummaryProblem: string | null;
  aiSummarySolution: string | null;
  aiSummaryTiming: string | null;
  icpOneLiner: string | null;
  problemOneLiner: string | null;
  solutionOneLiner: string | null;
  whyNowOneLiner: string | null;
  tam: RangeEstimate & { reasoning: string | null };
  sam: RangeEstimate & { reasoning: string | null };
  som: RangeEstimate & { reasoning: string | null };
  /** Taux de croissance annuel (0,4 = 40 %). */
  cagr: RangeEstimate;
  competitors: Competitor[];
  sources: string[];
  /** Version du prompt qui l'a produite (cache des sorties IA). */
  promptVersion: string | null;
  generatedDateISOString: DateISOString;
};

export type StartupProfile = {
  /** @source SP26 « ICP » */
  icp: string | null;
  /** @source SP26 « Problem » */
  problem: string | null;
  /** @source SP26 « Solution Summary » */
  solution: string | null;
  /** @source SP26 « Why now? » */
  whyNow: string | null;
  /** @source SP26 « Current status? » (texte libre) */
  currentStatus: string | null;
  /** @source SP26 « Anything else » */
  anythingElse: string | null;
  /** @source SP26 « Pitch Deck » */
  pitchDeckUrl: string | null;
  /** @source SP26 « Selection Day registration » « Drive folder » */
  driveFolderUrl: string | null;
  /** @source SP26 « Selection Day registration » « product » */
  product: string | null;
  /** @source SP26 « Pre-IC registration » « technology » */
  technology: string | null;
  /** @source SP26 « Selection Day registration » : objectifs annonces. */
  usersGoal: number | null;
  revenueGoal: number | null;
  /** @source SP26 « Sprint phase registration » « planned milestones » */
  plannedMilestones: string | null;
  /** @source SP26 « Pre-IC registration » « date the team formed » */
  teamFormedDayString: DayString | null;
  marketAnalysis: MarketAnalysis | null;
};

// ---- startups/{startupId}/private/internal -----------------------------------

/**
 * Evaluation du staff. @source SP26 « Pitch summary » et « Selection Day startups ».
 * A plat (pas d'objet imbrique) : chaque champ a ainsi une adresse dans le
 * registre des champs (`startupInternal.go`) pour les formulaires et le MCP.
 */
export type StartupInternal = {
  /** @source SP26 « Go » */
  go: boolean | null;
  /** @source SP26 « Clear Idea » */
  clearIdea: boolean | null;
  /** @source SP26 « High Potential » */
  highPotential: boolean | null;
  /** @source SP26 « Slide Quality (Subjective) » */
  slideQuality: number | null;
  /** @source SP26 « Achievements » */
  achievements: string | null;
  /** @source SP26 « Achievements Score » (sur 6) */
  achievementsScore: number | null;
  /** @source SP26 « Risks » */
  risks: string | null;
  /** @source SP26 « Notes » */
  notes: string | null;
  /** @source SP26 « Traction Notes » */
  tractionNotes: string | null;
};

// ----------------------------
// checkins/{startupId}_{weekStartDayString}_{founderId}  (membres + staff + investors)
// ----------------------------
// L'update du jeudi (SP26 « Weekly wrap-up », 2025 « Weekly forms »). Un
// document par fondateur et par semaine : plusieurs membres d'une startup
// peuvent chacun remplir le leur, les agregats prennent le maximum (SPECS §5.3).

/**
 * Les chiffres de toute la startup (presets/standardMetrics.ts) : pipeline de la
 * semaine (flux), totaux a date et objectifs de la semaine suivante. `null` :
 * pas repondu. Un update de Spring 2026 n'a que `conversationsDone` (ses
 * « Interviews »), `totalUsers` et `activeUsers`.
 */
type CheckinNumbers = Record<CheckinMetricKey | CheckinGoalKey, number | null>;

export type Checkin = StartupScoped &
  CheckinNumbers & {
    founderId: string;
    /** Lundi de la semaine. */
    weekStartDayString: DayString;
    /** @source SP26 « Moral » (1-10) */
    moral: number | null;
    /**
     * @deprecated Historique Spring 2026 (« Revenue » de la semaine, « Total revenue ») :
     * encaisse, facture ou recurrent, on ne sait pas. Plus demande ; remplace par
     * `totalAmountPaid` et `mrr`.
     */
    revenue: number | null;
    /** @deprecated Voir `revenue`. */
    totalRevenue: number | null;
    /** @source SP26 « Goals » */
    goals: string | null;
    /** @source SP26 « Obstacle » */
    obstacle: string | null;
    /** @source SP26 « Learned » */
    learned: string | null;
    /** @source SP26 « Achievement » */
    achievement: string | null;
    /** @source 2025 « How can we help you ? » */
    helpNeeded: string | null;
    /** @source 2025 « Any document you would like to share ? » */
    attachmentUrls: string[];
    updatedDateISOString: DateISOString;
  };

// ----------------------------
// kpiSeries/{startupId}  (agregat membres + staff + investors, recalcule par Cloud Functions)
// ----------------------------
// Courbes tracees a partir de `checkins` (et des autres champs marques
// `indicator` dans le registre des champs, fieldRegistry.ts).

export type KpiPoint = { weekStartDayString: DayString; value: number };

/** Id du document = `startupId`. */
export type KpiSeries = StartupScoped & {
  series: Partial<Record<MetricKey, KpiPoint[]>>;
  computedDateISOString: DateISOString;
};
