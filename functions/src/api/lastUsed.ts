import type { DocumentReference } from "firebase-admin/firestore";

// La date de derniere utilisation (cle d'API, autorisation OAuth) s'ecrit au
// plus une fois par heure : une ecriture par requete doublerait le cout d'un
// import en masse. Sans attente : elle ne doit jamais ralentir la requete.
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

export function touchLastUsed(ref: DocumentReference, lastUsedDateISOString: string | null): void {
  const lastUsed = lastUsedDateISOString ? Date.parse(lastUsedDateISOString) : 0;
  if (Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
    ref.update({ lastUsedDateISOString: new Date().toISOString() }).catch(() => {});
  }
}
