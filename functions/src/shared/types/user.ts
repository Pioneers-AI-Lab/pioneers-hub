import type { BatchScoped, DateISOString } from "./common";

// ----------------------------
// users/{uid}
// ----------------------------
// Un compte Firebase Auth. Roles (SPECS §1 « Roles ») :
//   founder   NE se stocke PAS ici : un compte est fondateur d'un batch quand
//             `batchMemberships/{batchId}_{uid}` existe (rattachement par email,
//             sinon choix du profil dans la liste des profils non reclames).
//             Un meme compte peut ainsi etre fondateur de plusieurs batchs.
//   staff     l'equipe Pioneers : outils et administration.
//   investor  associes du fonds (Founding / Venture Partners, IC) et, sur
//             invitation, investisseurs externes. Deux niveaux d'acces.
//   mentor    mentors et experts. Pas d'espace en v1 (bonus).
// Les roles se cumulent (un mentor qui investit). Ils sont ecrits uniquement
// par le staff ou le SDK admin : les regles refusent qu'un compte se les accorde.

export const USER_ROLES = ["staff", "investor", "mentor"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Niveau d'acces d'un investor (SPECS §3.3).
 *   ic         tout ce que voit le staff, en lecture, et il saisit ses evaluations.
 *   portfolio  startups, KPIs et scores, sans avis des pairs, notes internes,
 *              appreciations ni donnees personnelles.
 */
export type InvestorAccess = "ic" | "portfolio";

/**
 * Le compte de connexion : UNIQUEMENT l'acces. Tout ce qui decrit la personne
 * (nom, emails, telephone, photo, Slack, fiches mentor et investor) vit dans
 * `people/{personId}`, une seule fois. L'email de connexion vient du jeton
 * Firebase Auth : il n'est pas recopie ici.
 * Ce document existe parce que les regles Firestore ne connaissent que l'uid
 * du visiteur : `users/{uid}` est l'index qui leur donne ses droits.
 */
export type User = {
  /** Personne reclamee par ce compte (`null` tant que le rattachement n'est pas fait). */
  personId: string | null;
  roles: UserRole[];
  /** Renseigne si `roles` contient `investor`, `null` sinon. */
  investorAccess: InvestorAccess | null;
  /** Signal d'activite bon marche (repris de flow). */
  loginCount: number;
  createdDateISOString: DateISOString;
  lastSeenDateISOString: DateISOString;
};

// ----------------------------
// batchMemberships/{batchId}_{uid}
// ----------------------------
// Le lien « ce compte est le fondateur X de ce batch », a id deterministe.
// C'est lui que lisent les regles (`exists()` sur un chemin connu : une regle
// ne peut pas faire de requete) et le BatchContext pour connaitre le role du
// visiteur. Ecrit au rattachement du compte, par le serveur ou le staff.

export type BatchMembership = BatchScoped & {
  uid: string;
  founderId: string;
  createdDateISOString: DateISOString;
};

// ----------------------------
// claimRequests/{batchId}_{uid}  (le compte lui-meme + staff)
// ----------------------------
// Rattachement d'un compte a un profil (SPECS §3.1) :
//   1. l'email du compte (ou un `altEmails`) correspond a `people.email` :
//      rattachement immediat, sans demande ;
//   2. sinon le compte CHOISIT son profil dans la liste des profils non
//      reclames, et cette demande attend la validation du staff. Un
//      rattachement ouvre le Profile Book du batch (emails, WhatsApp) : il ne
//      s'accorde pas d'un clic a n'importe quel compte Google.
// Une demande par compte et par batch (id deterministe) : choisir un autre
// profil remplace la demande en attente.

export type ClaimRequestStatus = "pending" | "approved" | "rejected";

export type ClaimRequest = BatchScoped & {
  uid: string;
  founderId: string;
  /** Email du compte Google, pour que le staff reconnaisse la personne. */
  email: string;
  displayName: string | null;
  status: ClaimRequestStatus;
  createdDateISOString: DateISOString;
  decidedByUid: string | null;
  decidedDateISOString: DateISOString | null;
};
