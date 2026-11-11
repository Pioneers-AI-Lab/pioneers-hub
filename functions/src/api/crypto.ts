import { createHash, randomBytes } from "node:crypto";

/** Empreinte hexadecimale : cles d'API, codes et jetons OAuth, cles d'idempotence, requetes. */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Un secret neuf (256 bits), avec son prefixe lisible : `ph_live_`, `pha_`, `phr_`, ou aucun pour un code. */
export const secret = (prefix = "") => `${prefix}${randomBytes(32).toString("base64url")}`;
