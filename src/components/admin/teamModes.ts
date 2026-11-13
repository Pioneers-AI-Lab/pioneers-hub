import type { GeneratorMode } from "@shared/teamGenerator";
import { TEAM_LABELS, type TeamLabels } from "@/components/event/teamLabels";

// Ce qui distingue les deux modes de matching dans l'outil de tirage : les mots
// affiches (TEAM_LABELS, partages avec la page publique) et ses regles. Le
// moteur est le meme (shared/teamGenerator.ts). Le mode est celui du matching
// de l'evenement (`matchingOf(event).mode`), plus son type.

export type TeamToolMode = GeneratorMode;

export const TEAM_TOOLS: Record<TeamToolMode, TeamLabels & { title: string; summary: string; rulesHint: string }> = {
  challenge: {
    ...TEAM_LABELS.challenge,
    title: "Teams",
    summary: "Work teams: a leader, at least one technical profile each",
    rulesHint:
      "Rules, strictest first: never the same pair twice in a challenge; at least one technical profile per team (hybrid counts); avoid pairs who already met at a lunch roulette.",
  },
  matching: {
    ...TEAM_LABELS.matching,
    title: "Tables",
    summary: "Tables to meet new people",
    rulesHint: "Rules, strictest first: never the same pair twice at a lunch roulette; then avoid pairs who already teamed up in a challenge.",
  },
};
