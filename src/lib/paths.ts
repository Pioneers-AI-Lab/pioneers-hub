// ----------------------------
// URL de l'application
// ----------------------------
// Seul endroit ou s'ecrivent les chemins de route : l'arbre des dossiers de
// app/(app)/ et ces fonctions doivent rester le reflet l'un de l'autre.

const batchBase = (programId: string, batchId: string) => `/programs/${programId}/batches/${batchId}`;

export const paths = {
  home: () => "/",
  signIn: (next?: string) => (next ? `/signin?next=${encodeURIComponent(next)}` : "/signin"),
  register: () => "/register",
  forgotPassword: () => "/forgot-password",
  /** Consentement OAuth du connecteur Claude. Le chemin est aussi ecrit par le serveur (functions/src/oauth/router.ts). */
  oauthConsent: (requestId: string) => `/oauth/consent?request=${encodeURIComponent(requestId)}`,
  /** Rattacher son compte a son profil de fondateur. */
  claim: () => "/claim",
  programs: () => "/programs",
  program: (programId: string) => `/programs/${programId}`,
  batch: batchBase,
  founders: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/founders`,
  founder: (programId: string, batchId: string, founderId: string) =>
    `${batchBase(programId, batchId)}/founders/${founderId}`,
  startups: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/startups`,
  startup: (programId: string, batchId: string, startupId: string) =>
    `${batchBase(programId, batchId)}/startups/${startupId}`,
  leaderboard: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/leaderboard`,
  todo: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/todo`,
  me: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/me`,
  meEdit: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/me/edit`,
  staff: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/staff`,
  staffImport: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/staff/import`,
  staffAccess: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/staff/access`,
  staffSettings: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/staff/settings`,
  /** Repartition publique d'une lunch roulette (lien partage, sans compte). */
  lunchRoulette: (eventId: string) => `/lunch-roulette/${eventId}`,
  /** Outils du staff, hors batch (le batch se choisit dans la page). */
  admin: () => "/admin",
  adminForms: () => "/admin/forms",
  adminForm: (formId: string) => `/admin/forms/${formId}`,
  adminChallengeTeams: () => "/admin/challenge-teams",
  adminChallengeTeamsEvent: (eventId: string) => `/admin/challenge-teams/${eventId}`,
  adminLunchRoulette: () => "/admin/lunch-roulette",
  adminLunchRouletteEvent: (eventId: string) => `/admin/lunch-roulette/${eventId}`,
} as const;

/** `?next=` interne uniquement (jamais une redirection vers un autre site). */
export function safeNext(value: string | null | undefined): string | null {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
}

/** Garde `?next=` en passant d'une page de connexion a l'autre. */
export const withNext = (path: string, next: string | null) =>
  next ? `${path}?next=${encodeURIComponent(next)}` : path;
