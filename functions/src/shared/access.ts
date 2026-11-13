import type { Founder, FounderDirectory, FounderProfile, InvestorAccess, PioneersEvent, Person, Startup, User, UserRole } from "./types";

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

/**
 * Qui peut se servir de l'API et du connecteur Claude (MCP) : tout compte
 * connecte (decision du 11/11 : chacun pilote son compte). Ce que chacun y
 * voit et ecrit, ce sont SES droits : l'API applique les fonctions de ce
 * fichier a chaque objet rendu et a chaque ecriture, parce que l'Admin SDK
 * ignore firestore.rules. Lue par l'API ET par l'ecran de consentement OAuth.
 */
export const canUseApi = (viewer: Viewer | null): boolean => viewer !== null;

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
 *   self ou staff           le fondateur lui-meme, staff -> picks, formCompletions
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

/** Insider quel que soit le batch (staff, investor IC) : notes internes, presences, donnees internes. */
export const isInsiderViewer = (viewer: Viewer | null): boolean => isInsider(roleInBatch(viewer, null));

export const isInvestor = (role: BatchRole): boolean => role === "investor_ic" || role === "investor_portfolio";

export const isStaffOrInvestor = (role: BatchRole): boolean => role === "staff" || isInvestor(role);

/**
 * Un evenement a audience restreinte (`audience: "guests"` : office hours, visio
 * de mentorat) ne se montre qu'a ses invites et aux membres des startups
 * concernees (meme regle qu'`invitedFounderIds`, types/event.ts) ; le staff et
 * les investors voient tout. Regle d'AFFICHAGE, appliquee par l'interface
 * (`EventsContext`), l'API (`services/read.ts`) et le calendrier : les documents
 * `events` restent lisibles de tous (firestore.rules).
 */
export function canSeeEvent(
  role: BatchRole,
  viewerFounderId: string | null,
  viewerStartupId: string | null,
  event: Pick<PioneersEvent, "audience" | "guestFounderIds" | "startupIds">,
): boolean {
  if (event.audience === "batch" || isStaffOrInvestor(role)) return true;
  return (
    (viewerFounderId !== null && event.guestFounderIds.includes(viewerFounderId)) ||
    (viewerStartupId !== null && event.startupIds.includes(viewerStartupId))
  );
}

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
// WhatsApp, LinkedIn et le telephone vivent dans `people` et sont COPIES dans
// `private/directory` : le fondateur ecrit les deux dans le meme lot, et la
// regle verifie que la copie egale l'original.

export const FOUNDER_SELF_EDITABLE = {
  founder: ["hardSkills", "industries", "rolesICouldTake", "publicProfileConsent"],
  founderDirectory: [
    "whatsapp",
    "linkedinUrl",
    "phone",
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

/**
 * Photo deposee depuis « Mon profil », par les regles seulement (miroir des
 * regles `people` et `founders` « Photo ») : la vignette (`photoUrl`, data URL
 * JPEG, recopiee sur la fiche) et la grande photo (`coverPhotoUrl`, URL Storage
 * de `founders/{id}/photo-*.jpg`). Hors de FOUNDER_SELF_EDITABLE : l'API ne
 * laisse pas un fondateur pointer sa photo vers une URL quelconque.
 */
export const FOUNDER_PHOTO_FIELDS = {
  person: ["photoUrl"],
  founder: ["photoUrl", "coverPhotoUrl"],
} as const satisfies { person: readonly (keyof Person)[]; founder: readonly (keyof Founder)[] };

/**
 * La carte d'un fondateur (`founders/{id}`) : le batch, le staff et les investors ;
 * sinon seulement si elle est publique (consentement) ou pas encore reclamee
 * (liste « choisir mon profil »). Regle `founders` read.
 */
export const canReadFounderCard = (role: BatchRole, founder: Pick<Founder, "publicProfileConsent" | "uid">): boolean =>
  role !== "public" || founder.publicProfileConsent === true || founder.uid === null;

/** `people/{id}` : la personne elle-meme (compte rattache), le staff et les investors IC. */
export const canReadPerson = (role: BatchRole, viewerUid: string | null, person: Pick<Person, "uid">): boolean =>
  isInsider(role) || (viewerUid !== null && person.uid === viewerUid);

/** Une equipe d'evenement n'est visible qu'une fois publiee, sauf pour les insiders. */
export const canReadTeam = (role: BatchRole, team: { publishedDateISOString: string | null }): boolean =>
  team.publishedDateISOString !== null || isInsider(role);

/** Le champ `field` du document `kind` fait partie de « Mon profil » (`FOUNDER_SELF_EDITABLE`). */
export function isSelfEditable(kind: string, field: string): boolean {
  const fields = (FOUNDER_SELF_EDITABLE as Record<string, readonly string[]>)[kind];
  return fields !== undefined && fields.includes(field);
}

/** Le visiteur est le fondateur `founderId` de ce batch (il peut modifier son profil). */
export const isViewerFounder = (viewerFounderId: string | null, founderId: string): boolean =>
  viewerFounderId !== null && viewerFounderId === founderId;

/**
 * Modifier le profil d'un fondateur : le staff (regles : `allow write: if isStaff()`)
 * ou le fondateur lui-meme, sur « Mon profil » (FOUNDER_SELF_EDITABLE).
 */
export const canEditFounderProfile = (role: BatchRole, viewerFounderId: string | null, founderId: string): boolean =>
  role === "staff" || isViewerFounder(viewerFounderId, founderId);


// ----------------------------
// Nom affiche sans compte
// ----------------------------
// Le nom complet d'un fondateur n'est public qu'avec `publicProfileConsent`.
// Une page publique qui doit nommer tout le monde (repartition d'une lunch
// roulette) affiche le prenom et l'initiale du nom : assez pour se retrouver,
// sans exposer l'identite complete.

/** « Ada Lovelace » -> « Ada L. » ; un nom d'un seul mot reste tel quel. */
export function publicShortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}
