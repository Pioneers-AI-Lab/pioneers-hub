import { notifications } from "@mantine/notifications";

/** Un message de refus, sans le code HTTP que le SDK des callables ajoute en fin (« … [400] ») : on lit une phrase, pas un code. */
const withoutHttpStatus = (message: string) => message.replace(/\s*\[\d{3}\]$/, "");

/** Message lisible d'une erreur (callable, Firestore, reseau), sans code HTTP, sinon `fallback`. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  return err instanceof Error && err.message ? withoutHttpStatus(err.message) : fallback;
}

/** Une erreur en notification rouge (ecriture refusee, appel en echec). */
export function notifyError(err: unknown): void {
  notifications.show({ color: "red", message: errorMessage(err) });
}
