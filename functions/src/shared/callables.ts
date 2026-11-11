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
  /**
   * Cle d'API nominative (staff). La cle en clair n'est rendue qu'ICI, une fois :
   * seule son empreinte est stockee (`apiKeys`). Droits : ceux du proprietaire.
   */
  createApiKey: {
    req: { name: string };
    res: { keyId: string; key: string; prefix: string };
  };
  /** Revoque une cle : elle est refusee des la requete suivante. */
  revokeApiKey: {
    req: { keyId: string };
    res: { ok: true };
  };
  /** Page de consentement OAuth : ce que demande le client (nom, adresse de retour). */
  oauthDescribeRequest: {
    req: { requestId: string };
    res: { clientName: string; redirectHost: string; canApprove: boolean; reason: string | null };
  };
  /** Page de consentement OAuth : accepter ou refuser. Rend l'adresse ou renvoyer le navigateur. */
  oauthDecide: {
    req: { requestId: string; approve: boolean };
    res: { redirectUrl: string };
  };
};

export type CallableName = keyof Callables;
export type CallableRequest<K extends CallableName> = Callables[K]["req"];
export type CallableResponse<K extends CallableName> = Callables[K]["res"];
