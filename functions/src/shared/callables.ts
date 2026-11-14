// ----------------------------
// Contrat des fonctions callable : nom -> { req, res }
// ----------------------------
// Le front appelle `call("health")` et TypeScript deduit la requete et la
// reponse ; la fonction serveur s'ecrit avec `onCallTyped("health", ...)`. Le
// nom et les types ne peuvent donc pas diverger. Ajouter une callable =
// ajouter une ligne ici, puis l'implementer dans functions/src.

import type {
  FieldWriteStatus,
  FormAnswer,
  FormFieldType,
  FormIdentityCheck,
  FormKind,
  FormResponseStatus,
  InvestorAccess,
  PickerEntity,
  QuestionScope,
  ScoringItemInput,
  UserRole,
} from "./types";

export const FUNCTIONS_REGION = "europe-west4";

/** Un element a choisir sur un formulaire public : fondateur, startup, evenement, equipe, mentor ou option. */
export type PublicChoice = { value: string; label: string; hint: string | null };

/** Une question telle que le repondant la voit : options et listes deja resolues par le serveur. */
export type PublicFormQuestion = {
  id: string;
  type: FormFieldType;
  label: string;
  description: string | null;
  required: boolean;
  /** Choix unique ou multiple : options fixes, ou celles de la liste fermee du champ cible. */
  options: PublicChoice[] | null;
  scale: { min: number; max: number } | null;
  picker: { entity: PickerEntity; maxItems: number } | null;
  /** De quoi parle la reponse : le repondant, son equipe, chaque coequipier, chaque equipe notee. */
  scope: QuestionScope;
};

/**
 * Qui repond, quand la page doit le dire au serveur : un fondateur choisi dans
 * la liste, un jure de la liste (`judgeId`), ou un nom saisi par un jure
 * exterieur. Un compte connecte et rattache n'en a pas besoin.
 */
export type RespondentInput = { founderId: string } | { judgeId: string } | { name: string };

/** Le repondant reconnu par le serveur. */
export type PublicRespondent = { founderId: string | null; judgeId: string | null; label: string };

/**
 * Un formulaire vu SANS COMPTE (page /forms/[formId]). Les noms des fondateurs
 * ne sont pas publics (regles `founders`) : le serveur les rend en nom court
 * (`publicShortName`), juste assez pour se retrouver dans la liste.
 */
export type PublicForm = {
  formId: string;
  version: number;
  kind: FormKind;
  /** L'evenement du formulaire, pour revenir a sa page (un compte connecte du batch). */
  event: { id: string; name: string; programId: string; batchId: string } | null;
  title: string;
  description: string | null;
  batchName: string;
  identityCheck: FormIdentityCheck;
  deadlineDateISOString: string | null;
  /** `draft` : seul le staff le voit, pour le relire ; il ne prend pas de reponse. */
  state: "open" | "not_open_yet" | "closed" | "draft";
  questions: PublicFormQuestion[];
  /**
   * Les noms a choisir : les fondateurs du batch (« choisir son nom »), ou pour
   * un jury les invites, les noms deja venus noter et les fondateurs (nom court).
   * Vide si le formulaire est anonyme.
   */
  respondents: PublicChoice[];
  /** Un jure exterieur peut saisir son nom (lien de jury). */
  allowTypedName: boolean;
  /** Les listes des questions « choisir dans une liste », par objet. */
  choices: Partial<Record<PickerEntity, PublicChoice[]>>;
  /** Connecte et fondateur du batch : son profil, deja choisi. */
  viewerFounderId: string | null;
  /**
   * Le repondant reconnu (compte connecte, ou `respondent` de la requete) ;
   * `null` tant qu'il n'est pas choisi. Les cibles et les reponses deja
   * donnees en dependent.
   */
  respondent: PublicRespondent | null;
  /** Son equipe publiee a l'evenement du formulaire, pour les questions « son equipe ». */
  team: { id: string; name: string } | null;
  /** Les cibles des questions par cible : ses coequipiers, les equipes (ou startups) a noter sauf la sienne. */
  targets: Record<"each_teammate" | "each_target", PublicChoice[]>;
  /**
   * Les reponses deja donnees, par `answerKey` : seulement pour une identite
   * prouvee (compte, lien de jury). Le formulaire se relit et se corrige.
   */
  prefill: Record<string, FormAnswer>;
  /** Le formulaire se renvoie (identite prouvee, formulaire ouvert) : chaque envoi remplace les valeurs. */
  canResubmit: boolean;
};

/** Un compte vu par Admin > Access : identite Firebase Auth et droits (`users/{uid}`). */
export type AccountRow = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
  /** Connexion bloquee (Firebase Auth `disabled`). */
  disabled: boolean;
  emailVerified: boolean;
  /** Fournisseurs de connexion : `google.com`, `password`. Vide = invite, jamais connecte. */
  providers: string[];
  createdDateISOString: string;
  /** `null` = jamais connecte (toujours `null` sans fournisseur : un compte invite ne s'est pas connecte). */
  lastSignInDateISOString: string | null;
  roles: UserRole[];
  investorAccess: InvestorAccess | null;
  personId: string | null;
  /** Batchs dont le compte est fondateur (`batchMemberships`). */
  founderOf: { programId: string; batchId: string; founderId: string }[];
};

/** Droits d'un compte. `investorAccess` est requis avec le role `investor`, `null` sinon. */
export type AccountAccess = { roles: UserRole[]; investorAccess: InvestorAccess | null };

/**
 * Qui note, sur le lien partage du jury : un nom de la liste (`judgeId`) ou un
 * nom saisi (un exterieur sans compte).
 */
export type JuryIdentity = Exclude<RespondentInput, { founderId: string }>;

/** Limites du lien de jury, verifiees par le serveur et reprises par les champs du front. */
export const JUDGE_LIMITS = { name: 80 } as const;

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
  /** Admin > Access (staff) : tous les comptes et leurs droits. */
  listAccounts: {
    req: Record<string, never>;
    res: { accounts: AccountRow[] };
  };
  /** Admin > Access (staff) : change les roles d'un compte. Journalise. */
  setAccountAccess: {
    req: { uid: string } & AccountAccess;
    res: { ok: true };
  };
  /**
   * Admin > Access (staff) : invite par email. Cree le compte s'il n'existe pas ;
   * a sa premiere connexion Google avec la meme adresse, la personne a deja ses
   * droits. Journalise.
   */
  inviteAccount: {
    req: { email: string } & AccountAccess;
    res: { uid: string; created: boolean };
  };
  /**
   * Admin > Access (staff) : lien pour choisir son mot de passe (Firebase, valable
   * une heure, une fois), a transmettre a un compte qui ne s'est jamais connecte
   * (invite). Retour sur /signin. Journalise, sans le lien.
   */
  createSetPasswordLink: {
    req: { uid: string };
    res: { link: string };
  };
  /** Admin > Access (staff) : bloque ou debloque la connexion d'un compte. Journalise. */
  setAccountDisabled: {
    req: { uid: string; disabled: boolean };
    res: { ok: true };
  };
  /**
   * Formulaire public : questions, listes a choisir, noms courts du batch. Avec
   * `respondent` (ou un compte connecte), ses cibles et, pour une identite
   * prouvee, ses reponses deja donnees. `key` : le secret d'un lien de jury.
   */
  getPublicForm: {
    req: { formId: string; key?: string | null; respondent?: RespondentInput | null };
    res: PublicForm;
  };
  /**
   * Repond a un formulaire public. `submissionId` est tire une fois par ouverture
   * de la page : un second envoi (double appui, reseau qui rejoue) rend la meme
   * reponse au lieu d'en creer une autre. `version` : celle que le repondant a
   * lue ; refus si le formulaire a change depuis.
   */
  submitFormResponse: {
    req: {
      formId: string;
      version: number;
      submissionId: string;
      /** Qui repond, comme pour `getPublicForm` (inutile pour un compte connecte et rattache). */
      respondent?: RespondentInput | null;
      /** Le secret d'un lien de jury. */
      key?: string | null;
      /** Par `answerKey` (question, ou question et cible). */
      answers: Record<string, FormAnswer>;
    };
    res: { responseId: string; status: FormResponseStatus };
  };
  /** Staff : ce qui classe le leaderboard d'un evenement (`null` = notes du jury), puis recalcul. Journalise. */
  setEventRanking: {
    req: { eventId: string; metricKey: string | null };
    res: { ok: true };
  };
  /**
   * Staff : publie (ou retire, `publish: false`) le classement d'un evenement a
   * bareme, apres la verification des preuves, puis recalcule les scores du
   * batch. Journalise.
   */
  publishEventRanking: {
    req: { eventId: string; publish: boolean };
    res: { ok: true };
  };
  /**
   * Staff : le bareme d'un evenement (elements et departages), verifie contre
   * les variables de ses formulaires ; `items` vide le retire. Journalise, puis
   * recalcul du classement (et des scores du batch s'il est publie).
   */
  setEventScoring: {
    req: { eventId: string; scoring: { items: ScoringItemInput[] } };
    res: { ok: true };
  };
  /** Staff : recalcule les scores du batch (SPECS §5.5), comme chaque nuit. */
  recomputeBatchScores: {
    req: { batchId: string };
    res: { founders: number; startups: number; computedDateISOString: string };
  };
  /** Staff : cree ou remplace le lien partage du jury (l'ancien cesse de marcher). Journalise. */
  resetJuryLink: {
    req: { eventId: string };
    res: { ok: true };
  };
  /** Staff : supprime une note du jury saisie par erreur (gardee entiere dans l'audit), puis recalcul du leaderboard. */
  deleteJuryScore: {
    req: { eventId: string; evaluationId: string };
    res: { ok: true };
  };
  /** Staff : valide (ecrit) ou refuse une valeur en attente d'une reponse de formulaire. Journalise. */
  decideFormWrite: {
    req: { responseId: string; writeIndex: number; approve: boolean };
    res: { status: FieldWriteStatus };
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
