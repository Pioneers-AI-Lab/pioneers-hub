// ----------------------------
// Contrat des fonctions callable : nom -> { req, res }
// ----------------------------
// Le front appelle `call("health")` et TypeScript deduit la requete et la
// reponse ; la fonction serveur s'ecrit avec `onCallTyped("health", ...)`. Le
// nom et les types ne peuvent donc pas diverger. Ajouter une callable =
// ajouter une ligne ici, puis l'implementer dans functions/src.

import type { InvestorAccess, UserRole } from "./types";

export const FUNCTIONS_REGION = "europe-west4";

/** Un compte vu par Admin > Access : identite Firebase Auth et droits (`users/{uid}`). */
export type AccountRow = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
  /** Connexion bloquee (Firebase Auth `disabled`). */
  disabled: boolean;
  emailVerified: boolean;
  /** Fournisseurs de connexion : `google.com`, `password`. Vide = invite, jamais connecte. */
  providers: string[];
  createdDateISOString: string;
  lastSignInDateISOString: string | null;
  roles: UserRole[];
  investorAccess: InvestorAccess | null;
  personId: string | null;
  /** Batchs dont le compte est fondateur (`batchMemberships`). */
  founderOf: { programId: string; batchId: string; founderId: string }[];
};

/** Droits d'un compte. `investorAccess` est requis avec le role `investor`, `null` sinon. */
export type AccountAccess = { roles: UserRole[]; investorAccess: InvestorAccess | null };

export type Callables = {
  /** Sonde : verifie que le front joint les Functions (region, emulateur). */
  health: {
    req: Record<string, never>;
    res: { ok: true; region: string; uid: string | null };
  };
  /**
   * Cle d'API nominative (staff). La cle en clair n'est rendue qu'ICI, une fois :
   * seule son empreinte est stockee (`apiKeys`). Droits : ceux du proprietaire.
   */
  createApiKey: {
    req: { name: string };
    res: { keyId: string; key: string; prefix: string };
  };
  /** Revoque une cle : elle est refusee des la requete suivante. */
  revokeApiKey: {
    req: { keyId: string };
    res: { ok: true };
  };
  /** Admin > Access (staff) : tous les comptes et leurs droits. */
  listAccounts: {
    req: Record<string, never>;
    res: { accounts: AccountRow[] };
  };
  /** Admin > Access (staff) : change les roles d'un compte. Journalise. */
  setAccountAccess: {
    req: { uid: string } & AccountAccess;
    res: { ok: true };
  };
  /**
   * Admin > Access (staff) : invite par email. Cree le compte s'il n'existe pas ;
   * a sa premiere connexion Google avec la meme adresse, la personne a deja ses
   * droits. Journalise.
   */
  inviteAccount: {
    req: { email: string } & AccountAccess;
    res: { uid: string; created: boolean };
  };
  /** Admin > Access (staff) : bloque ou debloque la connexion d'un compte. Journalise. */
  setAccountDisabled: {
    req: { uid: string; disabled: boolean };
    res: { ok: true };
  };
  /** Page de consentement OAuth : ce que demande le client (nom, adresse de retour). */
  oauthDescribeRequest: {
    req: { requestId: string };
    res: { clientName: string; redirectHost: string; canApprove: boolean; reason: string | null };
  };
  /** Page de consentement OAuth : accepter ou refuser. Rend l'adresse ou renvoyer le navigateur. */
  oauthDecide: {
    req: { requestId: string; approve: boolean };
    res: { redirectUrl: string };
  };
};

export type CallableName = keyof Callables;
export type CallableRequest<K extends CallableName> = Callables[K]["req"];
export type CallableResponse<K extends CallableName> = Callables[K]["res"];
