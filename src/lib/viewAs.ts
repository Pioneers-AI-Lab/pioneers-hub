import { useSyncExternalStore } from "react";
import type { BatchRole } from "@shared/access";

// ----------------------------
// « View as » : le staff voit un batch avec le role d'un autre (demande du 16/11)
// ----------------------------
// Etat d'affichage seulement, en memoire : garde d'une page a l'autre, remis a
// Staff au rechargement (rien a oublier). BatchContext l'applique au role et au
// profil du visiteur, si son VRAI role est staff ; tout ce qui lit `useBatch()`
// suit. Les regles Firestore, elles, voient toujours le compte staff : un apercu
// montre ce que l'ecran affiche a ce role, il ne teste pas les regles (check:rules).
// « Public » = visiteur NON connecte. L'apercu s'arrete aux pages du batch : les
// pages publiques des groupes (PublicTeamsContext) restent en vue staff.
// BatchContext est le seul lecteur ; l'ecran ne fait qu'ecrire (`setViewAs`).

export type ViewAsRole = Exclude<BatchRole, "staff">;

/** `founderId` : le fondateur incarne, dans `batchId` (vue Founder) ; `null` tant qu'il n'est pas choisi. */
export type ViewAs = { role: ViewAsRole; batchId: string; founderId: string | null };

let current: ViewAs | null = null;
const listeners = new Set<() => void>();

export function setViewAs(next: ViewAs | null) {
  if (next?.role === current?.role && next?.batchId === current?.batchId && next?.founderId === current?.founderId) return;
  current = next;
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

export const useViewAs = () => useSyncExternalStore(subscribe, () => current, () => null);
