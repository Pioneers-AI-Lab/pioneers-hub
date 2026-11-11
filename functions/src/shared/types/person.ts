import type { Archivable, Timestamps } from "./common";

// ----------------------------
// people/{personId}  (la personne elle-meme + staff + investors IC)
// ----------------------------
// L'IDENTITE d'une personne, quel que soit son role : fondatrice dans deux
// batchs, mentor, investor... C'est le « users » du brouillon (prenom, nom,
// telephone, email, roles cumulables), mais separe du compte de connexion :
// une personne existe AVANT d'avoir un compte (import CSV des fondateurs,
// fiche mentor creee par le staff). Le compte (`users/{uid}`) la reclame
// ensuite, par email, sinon par choix du profil.
//
// `users/{uid}` ne porte que l'acces (roles, niveau investor) : aucun champ
// n'est en double entre les deux.
//
// Les champs que d'autres doivent voir sont COPIES par Cloud Functions dans
// les documents lisibles par eux (nom et photo sur `founders/{id}`, email,
// WhatsApp et LinkedIn sur `founders/{id}/private/directory`). On les ecrit
// toujours ici, jamais dans la copie.

export type Person = Timestamps &
  Archivable & {
    firstName: string;
    lastName: string;
    /** Nom affiche (`Prenom Nom` par defaut). */
    displayName: string;
    /** Email principal, en minuscules : cle du rattachement de compte. Unique. */
    email: string;
    /** Autres emails connus (compte Google different de l'email d'onboarding). */
    altEmails: string[];
    phone: string | null;
    /** @source Onboarding 2026 « Whatsapp » */
    whatsapp: string | null;
    /** @source SP26 « LinkedIn » */
    linkedinUrl: string | null;
    /** @source SP26 « Your photo » */
    photoUrl: string | null;
    slackUserId: string | null;
    /** Compte rattache, `null` tant que la personne n'a pas reclame son profil. */
    uid: string | null;
    /** Profils de role tenus par cette personne. */
    founderIds: string[];
    mentorId: string | null;
    investorId: string | null;
  };
