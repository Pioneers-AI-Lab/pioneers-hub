import type { GeneratorMode } from "@shared/teamGenerator";

// Les mots des groupes d'un evenement, par mode de matching : communs a l'outil de
// tirage du staff (TEAM_TOOLS, components/admin/teamModes.ts) et a la page
// publique (components/event/PublicTeamsPage.tsx).

export type TeamLabels = {
  /** Un groupe, au singulier, pour l'interface. */
  groupWord: string;
  groupLabel: string;
  /** Rappel du role du leader, en tete de la liste (outil staff et page publique). */
  leaderReminder: string;
  /** Le mot de la fin de la page publique. */
  publicHint: string;
};

export const TEAM_LABELS: Record<GeneratorMode, TeamLabels> = {
  challenge: {
    groupWord: "team",
    groupLabel: "Team",
    leaderReminder:
      "Each team has a leader, drawn at random. The leader gathers the team at the start and makes sure the challenge runs smoothly until the end.",
    publicHint: "Find your teammates, introduce yourselves, and get started.",
  },
  matching: {
    groupWord: "table",
    groupLabel: "Table",
    leaderReminder:
      "Each table has a leader, drawn at random. The leader gathers the table and makes sure lunch runs smoothly, so everyone gets a chance to talk.",
    publicHint: "Sit with your table, introduce yourself, and enjoy lunch.",
  },
};
