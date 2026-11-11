import type { Archivable, BatchScoped, DateISOString, StartupScoped, Timestamps } from "./common";

// ----------------------------
// Mentors (SPECS §3.4, modele de MentorStrategy.md, docs/repos/ROLES.md)
// ----------------------------
//   mentors/{mentorId}                       Mentor             staff + investors IC
//   mentorPicks/{batchId}_{mentorId}         MentorPicks        staff + le mentor            (bonus)
//   startupMentorPicks/{startupId}           StartupMentorPicks staff + membres              (bonus)
//   mentorships/{startupId}_{mentorId}       Mentorship         staff + investors IC + membres + le mentor (bonus)
//   mentorFeedback/{eventId}_{founderId}     MentorFeedback     staff seulement              (bonus)
//
// v1 : le staff gere les fiches et cree les seances comme des evenements
// (`expert_office_hours`, `mentor_session`, avec `mentorIds`). L'espace mentor
// et le matching sont en bonus, mais les collections existent des la v1.
// Un mentor n'est pas rattache a un batch : il traverse les programmes.

/** Un domaine d'excellence (« superpower »). @source MentorStrategy.md §2 */
export const MENTOR_SUPERPOWERS = [
  "product",
  "go_to_market",
  "engineering",
  "fundraising",
  "scaling",
  "hiring_org_design",
  "enterprise_sales",
  "market_expansion",
] as const;
export type MentorSuperpower = (typeof MENTOR_SUPERPOWERS)[number];

/**
 * @source MentorStrategy.md §3
 *   1  « Mentor (Half Active) » : appels ponctuels approuves, communaute, pas d'affectation.
 *   2  « Active Mentor » : affecte a des startups pendant la phase Pre-IC, expert au Pre-IC.
 */
export type MentorLevel = 1 | 2;

/** @source MentorStrategy.md §2 : A licornes, B operateurs 30-50 M€ ARR, C exits et scale-ups. */
export type MentorTier = "A" | "B" | "C";

export type MentorStatus = "prospect" | "contacted" | "active" | "alumni";

/** @source MentorStrategy.md §4 : bon fit (`true`), mauvais fit (`false`), inconnu (`null`). */
export type MentorFit = {
  expertise: boolean | null;
  mindset: boolean | null;
  drive: boolean | null;
  reliability: boolean | null;
};

/**
 * Le profil de mentor. L'identite (nom, emails, LinkedIn, photo, compte) est
 * dans `people/{personId}`, comme pour un fondateur : elle n'est pas recopiee ici.
 */
export type Mentor = Timestamps &
  Archivable & {
    personId: string;
    company: string | null;
    title: string | null;
    bio: string | null;
    superpowers: MentorSuperpower[];
    level: MentorLevel | null;
    tier: MentorTier | null;
    fit: MentorFit;
    /** Nombre maximum de startups suivies en meme temps (matching, bonus). */
    capacity: number | null;
    status: MentorStatus;
    /** Programmes ou il intervient. */
    programIds: string[];
  };

/** @source InvestorDashboard SP26 : base « Mentors », champs `Pick1` ... `Pick5`. */
export type MentorPicks = BatchScoped & {
  mentorId: string;
  /** Classees, top 5. */
  startupIds: string[];
  confirmedDateISOString: DateISOString | null;
};

export type StartupMentorPicks = BatchScoped & {
  startupId: string;
  /** Classes. */
  mentorIds: string[];
  confirmedDateISOString: DateISOString | null;
};

export type MentorshipStatus = "proposed" | "active" | "ended";

export type Mentorship = StartupScoped &
  Timestamps & {
    mentorId: string;
    status: MentorshipStatus;
    /** `mutual` : choix reciproque ; `assigned` : complete par le staff. */
    source: "mutual" | "assigned";
    startDayString: string | null;
    endDayString: string | null;
    /** Ex. « toutes les 2 semaines ». */
    cadence: string | null;
  };

/** Retour d'un fondateur sur une seance de mentorat. Jamais montre au mentor nominativement. */
export type MentorFeedback = BatchScoped & {
  eventId: string;
  mentorId: string;
  founderId: string;
  /** 1-5. */
  rating: number;
  comment: string | null;
  submittedDateISOString: DateISOString;
};
