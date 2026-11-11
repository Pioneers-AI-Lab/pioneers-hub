// ----------------------------
// Contrat des fonctions callable : nom -> { req, res }
// ----------------------------
// Le front appelle `call("health")` et TypeScript deduit la requete et la
// reponse ; la fonction serveur s'ecrit avec `onCallTyped("health", ...)`. Le
// nom et les types ne peuvent donc pas diverger. Ajouter une callable =
// ajouter une ligne ici, puis l'implementer dans functions/src.

export const FUNCTIONS_REGION = "europe-west4";

export type Callables = {
  /** Sonde : verifie que le front joint les Functions (region, emulateur). */
  health: {
    req: Record<string, never>;
    res: { ok: true; region: string; uid: string | null };
  };
};

export type CallableName = keyof Callables;
export type CallableRequest<K extends CallableName> = Callables[K]["req"];
export type CallableResponse<K extends CallableName> = Callables[K]["res"];
