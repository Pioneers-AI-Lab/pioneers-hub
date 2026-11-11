import type { Founder, FounderDirectory, FounderProfile, InvestorAccess, Person, Startup, User, UserRole } from "./types";

// ----------------------------
// Qui voit quoi : la regle, en logique pure (SPECS §6.2)
// ----------------------------
// MIROIR DE firestore.rules. Les regles sont la vraie barriere ; ces fonctions
// servent a ne pas OUVRIR un ecouteur que les regles refuseraient (un refus
// remonterait comme une erreur de connexion), et a afficher ou masquer les
// controles. Toute modification ici se reporte dans firestore.rules, et
// inversement (puis `npm run check:rules`).
//
// Roles dans un batch, du plus large au plus restreint :
//   staff               l'equipe Pioneers : tout, plus les outils
//   investor_ic         tout ce que voit le staff, en lecture (sauf avis des pairs
//                       individuels, mutual picks, cles d'API, jetons des jures)
//   investor_portfolio  annuaire, startups, KPIs et scores ; ni notes, ni
//                       appreciations, ni donnees personnelles
//   founder             un participant du batch, connecte et rattache a son profil
//                       (« membre » d'une startup : se calcule par startup)
//   public              n'importe qui, sans compte (ou connecte sans role)
// Mentor : pas d'acces en v1 (espace mentor en bonus), il est vu comme public.

export type Viewer = {
  uid: string;
  roles: UserRole[];
  investorAccess: InvestorAccess | null;
};

export function viewerFromUser(uid: string, user: Pick<User, "roles" | "investorAccess"> | null): Viewer {
  return { uid, roles: user?.roles ?? [], investorAccess: user?.investorAccess ?? null };
}

export const isStaffViewer = (viewer: Viewer | null): boolean => viewer?.roles.includes("staff") === true;

export type BatchRole = "staff" | "investor_ic" | "investor_portfolio" | "founder" | "public";

/**
 * Role du visiteur dans un batch : le plus large de ses roles.
 * @param viewerFounderId profil du visiteur dans CE batch (`null` s'il n'en a pas).
 */
export function roleInBatch(viewer: Viewer | null, viewerFounderId: string | null): BatchRole {
  if (!viewer) return "public";
  if (viewer.roles.includes("staff")) return "staff";
  if (viewer.roles.includes("investor") && viewer.investorAccess === "ic") return "investor_ic";
  if (viewer.roles.includes("investor") && viewer.investorAccess === "portfolio") return "investor_portfolio";
  if (viewerFounderId) return "founder";
  return "public";
}

/**
 * Les AUDIENCES. Chaque document est lisible par une audience (SPECS §6.2) ;
 * les fonctions ci-dessous en sont la traduction, et firestore.rules a les
 * memes (isInsider, isStaffOrInvestor, isMemberOf...).
 *
 *   batch                   fondateurs du batch, staff, investors
 *                           -> liste des fondateurs, private/directory, memberships
 *   self ou insider         le fondateur lui-meme, staff, investors IC
 *                           -> private/profile, founderWeeks, sessionRatings, people
 *   membres ou investors    membres de la startup, staff, investors
 *                           -> startups/private/profile, kpiSeries, checkins, metricSnapshots
 *   staff ou investors      -> scores
 *   insider                 staff, investors IC
 *                           -> private/internal, founderStats, scoreSignals, notes,
 *                              evaluations, presences, assessments validees, eloMatches,
 *                              mentors, investors, equipes non publiees
 *   staff                   -> avis entre pairs individuels, mutual picks des autres,
 *                              apiKeys, auditLogs, outils
 */

/** Staff et investors IC. */
export const isInsider = (role: BatchRole): boolean => role === "staff" || role === "investor_ic";

export const isInvestor = (role: BatchRole): boolean => role === "investor_ic" || role === "investor_portfolio";

export const isStaffOrInvestor = (role: BatchRole): boolean => role === "staff" || isInvestor(role);

export function isStartupMember(viewerFounderId: string | null, startup: Pick<Startup, "memberIds">): boolean {
  return viewerFounderId !== null && startup.memberIds.includes(viewerFounderId);
}

/** Audience « batch » : liste complete des fondateurs, `private/directory` (Profile Book), `memberships`. */
export const canReadFounderDirectory = (role: BatchRole): boolean => role !== "public";

/** Audience « self ou insider » : `private/profile`, `founderWeeks`, `sessionRatings`. */
export const canReadFounderProfile = (role: BatchRole, viewerFounderId: string | null, founderId: string): boolean =>
  isInsider(role) || viewerFounderId === founderId;

/** Audience « membres ou investors » : profil startup, `kpiSeries`, `checkins`, `metricSnapshots`. */
export const canReadStartupProfile = (
  role: BatchRole,
  viewerFounderId: string | null,
  startup: Pick<Startup, "memberIds">,
): boolean => isStaffOrInvestor(role) || isStartupMember(viewerFounderId, startup);


// ----------------------------
// Ce que le fondateur modifie lui-meme (« Mon profil », SPECS §3.1)
// ----------------------------
// MIROIR des regles `update` de firestore.rules (founders, private/directory,
// private/profile, people). Tout autre champ est ecrit par le staff, l'import
// ou l'API. Exclus : les champs generes (profileCategory, trackRecordOneLiner,
// trackRecord3Liners), le statut, le rattachement, et l'email (cle du
// rattachement de compte).
//
// WhatsApp et LinkedIn vivent dans `people` et sont COPIES dans
// `private/directory` : le fondateur ecrit les deux dans le meme lot, et la
// regle verifie que la copie egale l'original.

export const FOUNDER_SELF_EDITABLE = {
  founder: ["hardSkills", "industries", "rolesICouldTake", "publicProfileConsent"],
  founderDirectory: [
    "whatsapp",
    "linkedinUrl",
    "gender",
    "nationality",
    "country",
    "introduceYourself",
    "education",
    "degree",
    "fieldOfStudy",
    "yearsOfXP",
    "notableCompanies",
    "trackRecord",
    "interestedInWorkingOn",
    "hasExistingProject",
    "projectExplanation",
    "hasExistingCoFounders",
    "openToJoinAnotherProject",
    "mainStartup2025",
    "lookingForCoFounder",
    "coFounderTypeWanted",
    "coFounderSkillsWanted",
    "industriesToExplore",
  ],
  founderProfile: ["housingSupport", "tShirtSize"],
  person: ["phone", "whatsapp", "linkedinUrl"],
} as const satisfies {
  founder: readonly (keyof Founder)[];
  founderDirectory: readonly (keyof FounderDirectory)[];
  founderProfile: readonly (keyof FounderProfile)[];
  person: readonly (keyof Person)[];
};

/** Le visiteur est le fondateur `founderId` de ce batch (il peut modifier son profil). */
export const isViewerFounder = (viewerFounderId: string | null, founderId: string): boolean =>
  viewerFounderId !== null && viewerFounderId === founderId;
