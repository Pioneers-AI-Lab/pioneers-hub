// ----------------------------
// URL de l'application
// ----------------------------
// Seul endroit ou s'ecrivent les chemins de route : l'arbre des dossiers de
// app/(app)/ et ces fonctions doivent rester le reflet l'un de l'autre.

const batchBase = (programId: string, batchId: string) => `/programs/${programId}/batches/${batchId}`;

export const paths = {
  home: () => "/",
  signIn: (next?: string) => (next ? `/signin?next=${encodeURIComponent(next)}` : "/signin"),
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
} as const;
