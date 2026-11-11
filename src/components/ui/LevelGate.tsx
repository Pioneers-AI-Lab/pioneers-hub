import type { ReactNode } from "react";
import type { FirestoreError } from "firebase/firestore";
import { PageLoader } from "./PageLoader";
import { BlockedState, reasonFromError } from "./BlockedState";

/**
 * La porte d'un niveau : rien ne s'affiche sous un Provider tant que son
 * document n'est pas lu, et s'il manque ou est refuse, on le dit. Les enfants
 * peuvent donc compter sur un document NON NUL.
 */
export function LevelGate({
  isLoading,
  found,
  error,
  backHref,
  children,
}: {
  isLoading: boolean;
  found: boolean;
  error: FirestoreError | null;
  backHref: string;
  children: ReactNode;
}) {
  if (isLoading) return <PageLoader />;
  if (!found) return <BlockedState reason={reasonFromError(error)} backHref={backHref} />;
  return <>{children}</>;
}
