/** Message lisible d'une erreur (callable, Firestore, reseau), sinon `fallback`. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
