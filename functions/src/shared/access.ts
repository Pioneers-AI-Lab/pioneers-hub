import type { BatchAudience, BatchSettings, Founder, FounderDirectory, FounderProfile, InvestorAccess, PioneersEvent, Person, Startup, SubScoreKeys, SubScoreVisibility, User, UserRole } from "./types";
import { FOUNDER_PILLARS, STARTUP_SUBSCORES } from "./types/score";

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
 *                           -> liste des fondateurs, private/directory, memberships, batchTasks
 *   self ou insider         le fondateur lui-meme, staff, investors IC
 *                           -> private/profile, private/connections, founderWeeks, sessionRatings, people
 *   self ou staff           le fondateur lui-meme, staff -> picks, formCompletions, taskCompletions,
 *                              teamLocks (Lock my team, SPECS §6.2)
 *   membres ou investors    membres de la startup, staff, investors
 *                           -> startups/private/profile, kpiSeries, checkins, metricSnapshots
 *   tous                    -> scores, scoreSignals (open data, 18/11) ; l'ecran suit
 *                              `settings.scoresVisibility` (canSeeScores)
 *   insider                 staff, investors IC
 *                           -> private/internal, founderStats, notes,
 *                              evaluations, presences, assessments validees, eloMatches,
 *                              mentors, investors, equipes non publiees
 *   staff                   -> avis entre pairs individuels, picks des autres, shortlistHistory,
 *                              founderReviews et startupReviews (revue des Weekly updates, lot 4),
 *                              apiKeys, auditLogs, outils
 */

/** Staff et investors IC. */
export const isInsider = (role: BatchRole): boolean => role === "staff" || role === "investor_ic";

/** Insider quel que soit le batch (staff, investor IC) : notes internes, presences, donnees internes. */
export const isInsiderViewer = (viewer: Viewer | null): boolean => isInsider(roleInBatch(viewer, null));

export const isInvestor = (role: BatchRole): boolean => role === "investor_ic" || role === "investor_portfolio";

export const isStaffOrInvestor = (role: BatchRole): boolean => role === "staff" || isInvestor(role);

/**
 * Les reglages « qui voit » du batch (types/batch.ts#BatchAudience), avec leur valeur par defaut :
 * l'onglet Startups masque a tous (les startups naissent le 25/11), les scores au staff et aux investors.
 */
export const batchAudiencesOf = (settings: Pick<BatchSettings, "startupsVisibility" | "scoresVisibility">) => ({
  startups: settings.startupsVisibility ?? "none",
  scores: settings.scoresVisibility ?? "staff",
});

/** `founders` = tout compte du batch (l'audience « batch »), pas un visiteur public. */
const canSeeAudience = (role: BatchRole, audience: BatchAudience): boolean =>
  audience === "founders" ? canReadFounderDirectory(role) : audience === "staff" && isStaffOrInvestor(role);

/** L'onglet Startups et sa tuile (`settings.startupsVisibility`). */
export const canSeeStartupsTab = (role: BatchRole, settings: Pick<BatchSettings, "startupsVisibility">): boolean =>
  canSeeAudience(role, batchAudiencesOf(settings).startups);

/** Les scores et leurs signaux (`settings.scoresVisibility`). */
export const canSeeScores = (role: BatchRole, settings: Pick<BatchSettings, "scoresVisibility">): boolean =>
  canSeeAudience(role, batchAudiencesOf(settings).scores);

/**
 * Un sous-score (Edge d'un fondateur, Team d'une startup...) : dans le bloc des scores seulement
 * (`scoresVisibility`, le premier interrupteur), puis son reglage (`subScoreVisibility`) ; sans
 * reglage, il suit les scores.
 */
export const canSeeSubScore = <T extends keyof SubScoreKeys>(
  role: BatchRole,
  settings: Pick<BatchSettings, "scoresVisibility" | "subScoreVisibility">,
  target: T,
  key: SubScoreKeys[T],
): boolean => canSeeScores(role, settings) && canSeeAudience(role, settings.subScoreVisibility?.[target]?.[key] ?? batchAudiencesOf(settings).scores);

/**
 * Le reglage d'un sous-score change (`null` : retour au reglage des scores), sous une forme canonique
 * (cles triees, sans liste vide) : l'Admin et `update_batch` ecrivent la meme chose.
 */
export function withSubScoreAudience<T extends keyof SubScoreKeys>(
  visibility: SubScoreVisibility,
  target: T,
  key: SubScoreKeys[T],
  audience: BatchAudience | null,
): SubScoreVisibility {
  // TypeScript ne relie pas `visibility[target]` a `SubScoreKeys[T]` (type indexe generique).
  const own = { ...visibility[target] } as Partial<Record<SubScoreKeys[T], BatchAudience | null>>;
  if (audience) own[key] = audience;
  else delete own[key];
  return canonicalSubScores({ ...visibility, [target]: own });
}

/** Cles triees, sans `null` ni liste vide : deux reglages identiques s'ecrivent pareil. */
export const canonicalSubScores = (visibility: SubScoreVisibility | undefined): SubScoreVisibility =>
  Object.fromEntries(
    Object.entries(visibility ?? {})
      .map(([target, own]) => [target, Object.fromEntries(Object.entries(own ?? {}).filter(([, a]) => a).sort(([a], [b]) => a.localeCompare(b)))] as const)
      .filter(([, own]) => Object.keys(own).length > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/**
 * La forme a ECRIRE : chaque sous-score de l'echelle sur 100, `null` pour « suit les scores ». Les
 * ecritures du batch sont en `merge` (cartes fusionnees) : une cle absente garderait l'ancienne valeur.
 */
export const fullSubScores = (visibility: SubScoreVisibility | undefined): SubScoreVisibility => ({
  founder: Object.fromEntries(FOUNDER_PILLARS.map((p) => [p, visibility?.founder?.[p] ?? null])),
  startup: Object.fromEntries(STARTUP_SUBSCORES.map((k) => [k, visibility?.startup?.[k] ?? null])),
});

/**
 * Le detail d'un score (decision du 18/11) : poids des sous-scores, donnee brute des signaux, mention
 * « not counted ». Staff et investors ; un fondateur voit les notes et des signaux simplifies.
 */
export const canSeeScoreDetails = (role: BatchRole): boolean => isStaffOrInvestor(role);

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

/**
 * Audience « self ou insider » : `private/profile`, `private/connections` (shortlist et rencontres ; ecrites par
 * le fondateur lui-meme seulement, jamais le staff : regle `private/{docId}`), `founderWeeks`, `sessionRatings`.
 */
export const canReadFounderProfile = (role: BatchRole, viewerFounderId: string | null, founderId: string): boolean =>
  isInsider(role) || viewerFounderId === founderId;

/**
 * Audience « self ou staff » : `teamLocks` (Lock my team, lot 2 : ecrite par le formulaire
 * `submitFormResponse`, corrigee par le staff ; SPECS §6.2 : ni les investors IC, ni les autres fondateurs).
 */
export const canReadTeamLock = (role: BatchRole, viewerFounderId: string | null, founderId: string): boolean => canEditFounderProfile(role, viewerFounderId, founderId);

/**
 * Audience « staff » (SPECS §6.2) : la revue des Weekly updates (`founderReviews`, `startupReviews`, lot 4,
 * shared/weeklyReviews.ts), ecrite par le staff seul (Admin > Reviews), et l'historique des shortlists
 * (`shortlistHistory`, ecrit par le serveur). Ni les investors IC, ni les fondateurs : ils ne remontent que par les scores.
 */
export const canReadWeeklyReviews = (role: BatchRole): boolean => role === "staff";

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
// ou l'API. Exclus : les champs generes (profileCategory, trackRecord3Liners),
// le one-liner de la grille (`trackRecordOneLiner`, staff seul : « Staff only »
// de l'editeur, decision du 16/11), le statut, le rattachement, et l'email (cle
// du rattachement de compte).
//
// WhatsApp, LinkedIn et le telephone vivent dans `people` et sont COPIES dans
// `private/directory` : le fondateur ecrit les deux dans le meme lot, et la
// regle verifie que la copie egale l'original.
//
// Aussi permises par les regles, hors de cette liste (aucune API ne les ecrit) : les dates
// du To do que le fondateur pose lui-meme, `private/directory.profileCompletedDateISOString`
// et `private/connections.shortlistDoneDateISOString` (decision du 18/11).

export const FOUNDER_SELF_EDITABLE = {
  founder: ["hardSkills", "industries", "rolesICouldTake"],
  founderDirectory: [
    "whatsapp",
    "linkedinUrl",
    "phone",
    "gender",
    "nationality",
    "country",
    "introduceYourself",
    "edge",
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
    "repeatFounder",
    "lookingForCoFounder",
    "coFounderTypeWanted",
    "coFounderSkillsWanted",
    "industriesToExplore",
    "anythingElse",
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
// Une page publique qui doit nommer tout le monde (repartition d'une lunch
// roulette, choix du nom d'un formulaire) affiche le prenom et l'initiale du
// nom : assez pour se retrouver, sans exposer l'identite complete.

/** « Ada Lovelace » -> « Ada L. » ; un nom d'un seul mot reste tel quel. */
export function publicShortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}
