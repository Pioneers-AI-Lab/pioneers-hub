import type { DateISOString } from "./common";

// ----------------------------
// apiKeys/{keyId}  (staff seulement, ecrit par callable)
// ----------------------------
// Cles d'API nominatives et revocables, pour les scripts et les integrations
// (n8n, Zapier, Airtable). SPECS §4.7. Les droits sont ceux du proprietaire.

export type ApiKey = {
  ownerUid: string;
  name: string;
  /** Debut de la cle, affiche pour la reconnaitre (`ph_live_ab12`). */
  prefix: string;
  /** Empreinte de la cle ; la cle en clair n'est montree qu'une fois. */
  keyHash: string;
  createdDateISOString: DateISOString;
  lastUsedDateISOString: DateISOString | null;
  revokedDateISOString: DateISOString | null;
};

// ----------------------------
// lists/{listKey}  (public en lecture, staff en ecriture)
// ----------------------------
// Listes fermees (SPECS §6.1) : 13 categories de competences (avec leur cote
// tech / business), 66 secteurs, 9 Position Fit, diplomes, 12 types de
// session, semaines du programme, statuts d'engagement, statuts de startup.

export const LIST_KEYS = [
  "hardSkills",
  "industries",
  "positionFit",
  "degrees",
  "sessionTypes",
  "programWeeks",
  "commitmentStatuses",
  "startupStatuses",
  "acquisitionChannels",
] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export type ListItem = {
  value: string;
  label: string;
  /** Ex. `technical` / `business` pour les competences. */
  group: string | null;
  archived: boolean;
};

export type ClosedList = {
  key: ListKey;
  label: string;
  items: ListItem[];
  updatedDateISOString: DateISOString;
};

// ----------------------------
// auditLogs/{logId}  (staff seulement, ecrit par Cloud Functions)
// ----------------------------
// Chaque ecriture, quelle que soit sa source (SPECS §4.7) : qui, quoi, quand.

export type AuditSource = "ui" | "api" | "mcp" | "import" | "function";

export type AuditLog = {
  actorUid: string;
  /** Cle d'API utilisee, si la source est `api`. */
  apiKeyId: string | null;
  via: AuditSource;
  action: string;
  targetPath: string;
  payload: Record<string, unknown> | null;
  /** Cle d'idempotence de la requete, pour reconnaitre un rejeu. */
  idempotencyKey: string | null;
  dateISOString: DateISOString;
};

// ----------------------------
// writePlans/{planId}  (serveur seulement : aucune regle client)
// ----------------------------
// La CONFIRMATION du MCP (SPECS §4.8 « toute action qui ecrit est confirmee »).
// Un outil d'ecriture appele sans `planId` calcule ce qu'il ferait, le stocke
// ici et le montre ; rappele avec le `planId`, il recalcule, verifie que rien
// n'a change depuis l'apercu, puis ecrit. Un plan ne s'applique qu'une fois :
// le rejouer rend le meme resultat (idempotence cote MCP).

export type WritePlanStatus = "previewed" | "applied";

export type WritePlan = {
  ownerUid: string;
  operation: string;
  input: Record<string, unknown>;
  preview: unknown;
  result: unknown;
  status: WritePlanStatus;
  createdDateISOString: DateISOString;
  /** Une heure apres l'apercu : au-dela, on recalcule un apercu. */
  expiresDateISOString: DateISOString;
  appliedDateISOString: DateISOString | null;
};

// ----------------------------
// idempotencyKeys/{sha256(appelant + cle)}  (serveur seulement)
// ----------------------------
// En-tete `Idempotency-Key` de /v1 (SPECS §4.7 : un import relance ne cree pas
// de doublons). Meme cle et meme requete : la reponse est rejouee ; meme cle et
// requete differente : refus. Portee par l'appelant, jamais globale.

export type IdempotencyRecord = {
  ownerUid: string;
  operation: string;
  /** Empreinte stable de l'entree. */
  requestHash: string;
  result: unknown;
  createdDateISOString: DateISOString;
  /** 24 h. */
  expiresDateISOString: DateISOString;
};

// ----------------------------
// OAuth 2.1 du connecteur Claude  (serveur seulement : aucune regle client)
// ----------------------------
// SPECS §4.8 : « aucune cle d'acces stockee sur les ordinateurs ». Claude se
// connecte en OAuth : la personne colle l'adresse du serveur MCP, se connecte
// avec son compte Pioneers Hub et accepte. Les secrets (codes, jetons) ne sont
// stockes que par leur empreinte (id du document = sha256 du secret).

/** oauthClients/{clientId} : un client enregistre dynamiquement (RFC 7591). */
export type OAuthClient = {
  clientName: string;
  redirectUris: string[];
  createdDateISOString: DateISOString;
};

/** oauthRequests/{requestId} : une demande d'autorisation en attente du consentement (10 min). */
export type OAuthRequest = {
  clientId: string;
  /** Recopie du client a la demande : l'ecran de consentement et l'autorisation l'affichent sans le relire. */
  clientName: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  resource: string;
  status: "pending" | "approved" | "denied";
  uid: string | null;
  createdDateISOString: DateISOString;
  expiresDateISOString: DateISOString;
};

/** oauthCodes/{sha256(code)} : un code a usage unique (5 min). Rejoue, il revoque l'autorisation qu'il a creee. */
export type OAuthCode = {
  requestId: string;
  uid: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  grantId: string | null;
  usedDateISOString: DateISOString | null;
  expiresDateISOString: DateISOString;
};

/** oauthGrants/{grantId} : l'autorisation d'un client pour un compte. La revoquer coupe tous ses jetons. */
export type OAuthGrant = {
  uid: string;
  clientId: string;
  clientName: string;
  resource: string;
  createdDateISOString: DateISOString;
  lastUsedDateISOString: DateISOString | null;
  revokedDateISOString: DateISOString | null;
};

/** oauthTokens/{sha256(token)} : jeton d'acces (1 h) ou de rafraichissement (30 jours, rotation a chaque usage). */
export type OAuthToken = {
  kind: "access" | "refresh";
  grantId: string;
  uid: string;
  clientId: string;
  resource: string;
  /** Rafraichissement deja echange : un second usage est un vol, l'autorisation est revoquee. */
  usedDateISOString: DateISOString | null;
  createdDateISOString: DateISOString;
  expiresDateISOString: DateISOString;
};
