import type { AccountRow } from "@shared/callables";
import { formatDateTime } from "@/lib/format";

// Comment l'admin nomme un compte (Admin > Access, Admin > Founder profiles).

/** Invite : aucun fournisseur de connexion (badge « Invited »). Le serveur lui met une derniere connexion nulle. */
export const isInvited = (account: AccountRow) => account.providers.length === 0;

/** Ce que l'admin dit de la derniere connexion d'un compte. */
export function signInSummary(account: AccountRow): string {
  if (account.lastSignInDateISOString) return `Last sign-in ${formatDateTime(account.lastSignInDateISOString)}`;
  return isInvited(account) ? "Invited, never signed in" : "Never signed in";
}

/** Le nom d'un compte dans une liste a choix : nom et email, sinon ce qui existe. */
export const accountLabel = (account: AccountRow): string =>
  [account.displayName, account.email].filter(Boolean).join(" · ") || account.uid;
