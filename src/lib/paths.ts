// ----------------------------
// URL de l'application
// ----------------------------
// Seul endroit ou s'ecrivent les chemins de route : l'arbre des dossiers de
// app/(app)/ et ces fonctions doivent rester le reflet l'un de l'autre.

const batchBase = (programId: string, batchId: string) => `/programs/${programId}/batches/${batchId}`;

/** `draw` : la page d'un tirage tire les groupes a l'ouverture (apres « Create and draw »). */

export const paths = {
  home: () => "/",
  signIn: (next?: string) => (next ? `/signin?next=${encodeURIComponent(next)}` : "/signin"),
  register: () => "/register",
  /** `email` : prerempli (celui deja tape sur la page de connexion). */
  forgotPassword: (email?: string) => (email ? `/forgot-password?email=${encodeURIComponent(email)}` : "/forgot-password"),
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
  /** Edition d'un profil fondateur par le staff (le fondateur, lui, passe par `meEdit`). */
  founderEdit: (programId: string, batchId: string, founderId: string) =>
    `${batchBase(programId, batchId)}/founders/${founderId}/edit`,
  startups: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/startups`,
  startup: (programId: string, batchId: string, startupId: string) =>
    `${batchBase(programId, batchId)}/startups/${startupId}`,
  /** `eventId` : ouvre le classement de cet evenement (ancre de sa section). */
  leaderboard: (programId: string, batchId: string, eventId?: string) =>
    `${batchBase(programId, batchId)}/leaderboard${eventId ? `#${encodeURIComponent(eventId)}` : ""}`,
  todo: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/todo`,
  me: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/me`,
  meEdit: (programId: string, batchId: string) => `${batchBase(programId, batchId)}/me/edit`,
  /** La page d'un evenement, pour tous les roles du batch : infos, mon groupe, formulaires, leaderboard. */
  event: (programId: string, batchId: string, eventId: string) => `${batchBase(programId, batchId)}/events/${eventId}`,
  /**
   * Repartition publique des groupes du matching d'un evenement (lien partage,
   * sans compte). `/lunch-roulette/{id}` et `/challenge-teams/{id}` (liens deja
   * partages) y menent aussi.
   */
  groups: (eventId: string) => `/groups/${eventId}`,
  /** Le lien partage d'un formulaire de jury : le secret suit en fragment (jamais envoye au serveur web). */
  juryForm: (formId: string, secret: string) => `/forms/${formId}#${secret}`,
  /** Formulaire public, une question par ecran (lien partage, sans compte). */
  form: (formId: string) => `/forms/${formId}`,
  /** Outils du staff, hors batch (le batch se choisit dans la page). Tout outil du staff vit ici. */
  admin: () => "/admin",
  /** Les comptes : roles, invitation, blocage (aucun batch). */
  adminAccess: () => "/admin/access",
  /** Les profils fondateurs du batch et le compte rattache a chacun : lier, delier, demandes. */
  adminProfiles: () => "/admin/profiles",
  adminImport: () => "/admin/import",
  adminBatchSettings: () => "/admin/batch-settings",
  adminForms: () => "/admin/forms",
  adminForm: (formId: string) => `/admin/forms/${formId}`,
  adminFormNew: () => "/admin/forms/new",
  adminEvents: () => "/admin/events",
  /** `template` : le pack choisi d'avance (raccourcis « New lunch roulette »...). */
  adminEventNew: (template?: string) => `/admin/events/new${template ? `?template=${encodeURIComponent(template)}` : ""}`,
  adminEvent: (eventId: string) => `/admin/events/${eventId}`,
  adminEventAttendance: (eventId: string) => `/admin/events/${eventId}/attendance`,
  /** Le tirage du matching de l'evenement. */
  adminEventMatching: (eventId: string) => `/admin/events/${eventId}/matching`,
  /** Le staff voit et corrige les resultats d'une equipe. */
  adminEventTeam: (eventId: string, teamId: string) => `/admin/events/${eventId}/teams/${teamId}`,
  /** Brancher Claude (MCP), cles d'API et reference de l'API (staff). */
  apiDocs: () => "/api-docs",
} as const;

/** `?next=` interne uniquement (jamais une redirection vers un autre site). */
export function safeNext(value: string | null | undefined): string | null {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
}

/** Garde `?next=` en passant d'une page de connexion a l'autre. */
export const withNext = (path: string, next: string | null) =>
  next ? `${path}?next=${encodeURIComponent(next)}` : path;
