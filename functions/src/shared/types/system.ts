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
