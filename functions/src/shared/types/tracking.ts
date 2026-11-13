import type { BatchScoped, DateISOString, DayString } from "./common";

// ----------------------------
// Suivi dans le temps (brief du 11/11 « Core data model »)
// ----------------------------
//   metricSnapshots/{snapshotId}   MetricSnapshot  membres + staff + investors (equipe d'evenement : batch)
//   memberships/{membershipId}     Membership      fondateurs du batch + staff + investors
//
// Deux problemes de Spring 2026 que ces collections reglent :
//   - « Metrics are self-reported with no proof » : chaque valeur porte sa
//     source et son lien de preuve.
//   - « Team membership is a snapshot, not a history » : chaque appartenance a
//     une equipe porte ses dates, son role et l'evenement qui l'a produite.

// ---- metricSnapshots ---------------------------------------------------------

/** A qui se rapporte la valeur. */
export type MetricSubjectType = "startup" | "event_team" | "founder";

/**
 * D'ou vient la valeur. `self_reported` = declaree dans un formulaire ;
 * les sources externes (Twin, Stripe, analytics) arrivent par l'API.
 */
export type MetricSource =
  | "self_reported"
  | "staff"
  | "jury"
  | "twin"
  | "stripe"
  | "analytics"
  | "calendar"
  | "import";

/**
 * Une valeur de metrique a une date. LA serie temporelle de reference : les
 * updates du jeudi, les compteurs de hackathon, le sprint de traction de 48 h,
 * les demos et l'usage de Twin y ecrivent tous ; `kpiSeries` en est le resume.
 */
export type MetricSnapshot = BatchScoped & {
  subjectType: MetricSubjectType;
  /** `startupId`, id d'equipe d'evenement ou `founderId`. */
  subjectId: string;
  /** Copie des membres concernes, pour les regles et la fiche fondateur. */
  founderIds: string[];
  /** Evenement d'origine (hackathon, sprint de traction, demo), sinon `null`. */
  eventId: string | null;
  /** Cle de metrique : `MetricKey` (form.ts) ou cle declaree par l'evenement (`EventMetric.key`). */
  metric: string;
  value: number;
  /** Jour auquel la valeur s'applique. */
  dayString: DayString;
  /** Pour un avant / apres (sprint de traction) : `before`, `after`. */
  phase: "before" | "after" | null;
  source: MetricSource;
  /** Lien de preuve (capture, export Stripe, transcript...). */
  proofUrl: string | null;
  /** Document qui a produit la valeur (update du jeudi, soumission, reponse). */
  sourcePath: string | null;
  recordedByUid: string | null;
  recordedDateISOString: DateISOString;
};

// ---- memberships -------------------------------------------------------------

/** Equipe d'un hackathon ou d'un exercice, ou startup. */
export type MembershipKind = "event_team" | "startup";

/**
 * Un fondateur dans une equipe, avec ses dates. Rattache a l'evenement qui l'a
 * produit : le hackathon pour une equipe d'evenement, l'evenement ou l'equipe
 * s'est formee (ex. kickoff du hackathon 5) pour une startup. On reconstitue
 * ainsi « qui a travaille avec qui, quand, a quelle occasion ».
 * `EventTeam.memberIds` et `Startup.members` restent la photo du moment ;
 * cette collection est l'historique.
 */
export type Membership = BatchScoped & {
  founderId: string;
  kind: MembershipKind;
  /** Id de l'equipe d'evenement, ou `startupId`. */
  teamId: string;
  /** Evenement d'origine ; `null` pour une startup formee hors evenement. */
  eventId: string | null;
  /**
   * Role : `tech_lead`, `presenter`, `deck_maker`, `leader` (equipe d'evenement), titre (startup).
   * `leader` sert a la rotation des leaders (`buildLeaderCounts`).
   */
  role: string | null;
  startDayString: DayString;
  /** `null` tant que le fondateur est dans l'equipe. */
  endDayString: DayString | null;
  /** Raison du depart (equipe qui se separe, fondateur qui quitte le programme). */
  endReason: string | null;
};
