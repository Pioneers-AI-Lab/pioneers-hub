"use client";

import { useState } from "react";
import { notifications } from "@mantine/notifications";
import { errorMessage } from "@/lib/errors";

/**
 * Une action d'ecriture depuis l'interface (callable) : `isBusy` pendant
 * l'appel, une notification au succes, une notification rouge a l'echec.
 * `run` rend le resultat de l'action, ou `undefined` si elle a echoue.
 */
export function useAction() {
  const [isBusy, setBusy] = useState(false);
  async function run<T>(action: () => Promise<T>, success: string): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await action();
      notifications.show({ message: success });
      return result;
    } catch (err) {
      notifications.show({ color: "red", message: errorMessage(err) });
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { isBusy, run };
}
