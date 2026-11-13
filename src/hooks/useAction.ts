"use client";

import { useState } from "react";
import { notifications } from "@mantine/notifications";
import { errorMessage } from "@/lib/errors";

/**
 * Une action d'ecriture depuis l'interface (callable) : `isBusy` pendant
 * l'appel, une notification au succes, une notification rouge a l'echec.
 * `run` rend le resultat de l'action, ou `undefined` si elle a echoue.
 * `key` : quel bouton tourne quand une page en a plusieurs (`busy`).
 */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  async function run<T>(action: () => Promise<T>, success: string, key = "action"): Promise<T | undefined> {
    setBusy(key);
    try {
      const result = await action();
      notifications.show({ message: success });
      return result;
    } catch (err) {
      notifications.show({ color: "red", message: errorMessage(err) });
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  return { isBusy: busy !== null, busy, run };
}
