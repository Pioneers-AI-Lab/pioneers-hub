// ----------------------------
// Contrat des fonctions callable : nom -> { req, res }
// ----------------------------
// Le front appelle `call("health")` et TypeScript deduit la requete et la
// reponse ; la fonction serveur s'ecrit avec `onCallTyped("health", ...)`. Le
// nom et les types ne peuvent donc pas diverger. Ajouter une callable =
// ajouter une ligne ici, puis l'implementer dans functions/src.

import type {
  Criterion,
  EventMetric,
  EventPicks,
  FieldWriteStatus,
  FormAnswer,
  FormFieldType,
  FormIdentityCheck,
  FormResponseStatus,
  InvestorAccess,
  PickerEntity,
  SubmissionLink,
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
};

/**
 * Un formulaire vu SANS COMPTE (page /forms/[formId]). Les noms des fondateurs
 * ne sont pas publics (regles `founders`) : le serveur les rend en nom court
 * (`publicShortName`), juste assez pour se retrouver dans la liste.
 */
export type PublicForm = {
  formId: string;
  version: number;
  title: string;
  description: string | null;
  batchName: string;
  identityCheck: FormIdentityCheck;
  deadlineDateISOString: string | null;
  /** `draft` : seul le staff le voit, pour le relire ; il ne prend pas de reponse. */
  state: "open" | "not_open_yet" | "closed" | "draft";
  questions: PublicFormQuestion[];
  /** Les fondateurs du batch, pour « choisir son nom » (vide si le formulaire est anonyme). */
  respondents: PublicChoice[];
  /** Les listes des questions « choisir dans une liste », par objet. */
  choices: Partial<Record<PickerEntity, PublicChoice[]>>;
  /** Connecte et fondateur du batch : son profil, deja choisi. */
  viewerFounderId: string | null;
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
 * Un hackathon (mecanique `team_challenge`) commence, vu par un fondateur de
 * son equipe : ce qu'il doit encore saisir dans le Debrief.
 */
export type ChallengeTask = {
  eventId: string;
  eventName: string;
  startDateISOString: string;
  /** Metriques declarees par l'evenement : les compteurs que l'equipe renseigne. */
  metrics: EventMetric[];
  /** Noms et photos : le front les a deja (`FoundersContext`). */
  team: { id: string; name: string; teammateIds: string[] };
  /** Les avis que ce fondateur a deja donnes, par coequipier note. */
  myRatings: Record<string, { rating: number; comment: string | null }>;
  /** Les resultats deja saisis par l'equipe, `null` si rien encore. */
  results: TeamResults | null;
};

/** Les resultats d'une equipe a un hackathon (une soumission). */
export type TeamResults = {
  /** Cle de `EventMetric.key` -> valeur. */
  metrics: Record<string, number>;
  links: SubmissionLink[];
  productUrl: string | null;
  notes: string | null;
};

/** La feuille d'un jure (lien prive, sans compte) : la grille, les cibles, ses notes deja donnees. */
export type JudgeSheet = {
  judgeName: string;
  eventName: string;
  startDateISOString: string;
  /** Faux une fois l'evenement verrouille (`locked`, `completed`) : les notes sont figees. */
  canEdit: boolean;
  criteria: Criterion[];
  /** Les equipes publiees ou les startups de l'evenement, sauf celles dont le jure est exclu. */
  targets: { id: string; name: string; members: string[] }[];
  /** Ses notes par cible. */
  scores: Record<string, { scores: Record<string, number>; comment: string | null }>;
};

/** Limites du jury et des choix, verifiees par le serveur et reprises par les champs du front. */
export const JUDGE_LIMITS = { name: 80, comment: 1000 } as const;
export const PICKS_LIMITS = { question: 200 } as const;

/** Ce qui identifie un jure : l'evenement, son id, et le secret de son lien. */
export type JudgeKey = { eventId: string; judgeId: string; key: string };

/** La question des avis entre pairs (SPECS §4.3), de 1 a 5. */
export const PEER_QUESTION = "Would you start a company with this person?";

/** Limites du Debrief, verifiees par le serveur et reprises par les champs du front. */
export const DEBRIEF_LIMITS = { peerComment: 280, resultNotes: 2000, resultLinks: 20, linkLabel: 80 } as const;

/** Un avis entre pairs : `PEER_QUESTION`, de 1 a 5, et une phrase. */
export type PeerRatingInput = { rateeFounderId: string; rating: number; comment: string | null };

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
  /** Admin > Access (staff) : bloque ou debloque la connexion d'un compte. Journalise. */
  setAccountDisabled: {
    req: { uid: string; disabled: boolean };
    res: { ok: true };
  };
  /** Debrief : les hackathons commences du fondateur connecte dans ce batch, son equipe et ses saisies. */
  myChallengeTasks: {
    req: { batchId: string };
    res: { tasks: ChallengeTask[] };
  };
  /** Debrief : le fondateur note ses coequipiers. Rejouable : un nouvel avis remplace l'ancien. */
  submitPeerRatings: {
    req: { eventId: string; ratings: PeerRatingInput[] };
    res: { saved: number };
  };
  /** Debrief : les resultats de l'equipe (un membre ou le staff). Chaque metrique devient un releve date. */
  submitTeamResults: {
    req: { eventId: string; teamId: string } & TeamResults;
    res: { ok: true };
  };
  /** Formulaire public (sans compte) : questions, listes a choisir, noms courts du batch. */
  getPublicForm: {
    req: { formId: string };
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
      respondentFounderId: string | null;
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
   * Staff : un jure et son lien prive. Le secret n'est rendu qu'ICI, une fois
   * (seule son empreinte est stockee) ; le lien expire le lendemain de l'evenement.
   */
  createJudge: {
    req: { eventId: string; name: string; email: string | null; excludedTargetIds: string[] };
    res: { judgeId: string; key: string; expiresDateISOString: string };
  };
  /** Staff : le lien du jure ne marche plus. */
  revokeJudge: {
    req: { eventId: string; judgeId: string };
    res: { ok: true };
  };
  /** Jure (sans compte) : sa feuille de notes. */
  getJudgeSheet: {
    req: JudgeKey;
    res: JudgeSheet;
  };
  /** Jure : ses notes pour une cible, corrigeables jusqu'au verrouillage. Journalise, puis recalcul du leaderboard. */
  submitJudgeScores: {
    req: JudgeKey & { targetId: string; scores: Record<string, number>; comment: string | null };
    res: { ok: true };
  };
  /** Staff : ouvre, modifie ou ferme (`picks: null`) la demande de choix d'un evenement. Journalise. */
  setEventPicks: {
    req: { eventId: string; picks: EventPicks | null };
    res: { ok: true };
  };
  /** Fondateur : ses choix classes pour la demande ouverte d'un evenement. Prives (staff + lui). */
  submitPicks: {
    req: { eventId: string; pickedFounderIds: string[] };
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
