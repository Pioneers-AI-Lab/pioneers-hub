import { GENERATOR_PRESETS, type GeneratorMode } from "@shared/teamGenerator";
import { EVENT_TEMPLATES, type EventTemplateKey } from "@shared/presets/eventTemplates";
import type { EventKind } from "@shared/types";
import { paths } from "@/lib/paths";

// Ce qui distingue les deux outils de tirage : la mecanique d'evenement, les
// mots affiches et les reglages par defaut. Le moteur est le meme
// (shared/teamGenerator.ts).

export type TeamToolMode = GeneratorMode;

export const TEAM_TOOLS: Record<
  TeamToolMode,
  {
    kind: EventKind;
    title: string;
    subtitle: string;
    /** Un groupe, au singulier, pour l'interface. */
    groupWord: string;
    groupLabel: string;
    defaultTemplate: EventTemplateKey;
    defaultSize: number;
    listHref: () => string;
    eventHref: (eventId: string) => string;
    rulesHint: string;
  }
> = {
  challenge: {
    kind: "team_challenge",
    title: "Challenge teams",
    subtitle: "Draw teams for a hackathon or an exercise",
    groupWord: "team",
    groupLabel: "Team",
    defaultTemplate: "hackathon",
    defaultSize: GENERATOR_PRESETS.challenge.defaultSize,
    listHref: paths.adminChallengeTeams,
    eventHref: paths.adminChallengeTeamsEvent,
    rulesHint:
      "Rules, strictest first: never the same pair twice in a challenge; at least one technical profile per team (hybrid counts); avoid pairs who already met at a lunch roulette.",
  },
  matching: {
    kind: "matching",
    title: "Lunch roulette",
    subtitle: "Draw lunch tables so founders meet new people",
    groupWord: "table",
    groupLabel: "Table",
    defaultTemplate: "lunch_roulette",
    defaultSize: GENERATOR_PRESETS.matching.defaultSize,
    listHref: paths.adminLunchRoulette,
    eventHref: paths.adminLunchRouletteEvent,
    rulesHint: "Rules, strictest first: never the same pair twice at a lunch roulette; then avoid pairs who already teamed up in a challenge.",
  },
};

/** Les modeles d'evenement de la mecanique de l'outil. */
export const templatesOfMode = (mode: TeamToolMode) =>
  (Object.keys(EVENT_TEMPLATES) as EventTemplateKey[])
    .filter((key) => EVENT_TEMPLATES[key].kind === TEAM_TOOLS[mode].kind)
    .map((key) => ({ value: key, label: EVENT_TEMPLATES[key].label }));
