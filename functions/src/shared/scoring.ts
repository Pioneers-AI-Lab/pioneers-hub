import { isAttendanceOptional } from "./attendance";
import { BACKGROUND_CRITERIA, ratedBackgroundScore } from "./background";
import { EDGE_MAX_NOTE, edgeScore } from "./edge";
import { pitchMeans, PITCH_FAMILY_INFO, type PitchFamily, type PitchInput } from "./pitchGrid";
import {
  EXISTING_CO_FOUNDERS_LABELS,
  mean,
  roundTo,
  weightedMean,
  type DateISOString,
  type ExistingCoFounders,
  type FounderBackground,
  type FounderEdgeRating,
  type FounderPillar,
  type Form,
  type LeaderboardRow,
  type PioneersEvent,
  type ScoreMilestoneDueDates,
  type ScoreSignal,
  type StartupSubScore,
} from "./types";

// ----------------------------
// Les scores d'un fondateur et d'une startup, sur 100 (docs/FONCTIONNALITES.md §3)
// ----------------------------
// Logique pure, lue par `services/scores.ts` qui rassemble les donnees du batch.
// Poids en pourcentage de leur niveau (§3.1) ; « sans note, pas de poids » (§4.1) :
// un signal ou un sous-score sans donnee est retire, et les autres se partagent son
// poids en gardant leurs proportions. Un signal a 0 % est calcule et montre (suivi), jamais
// compte. Pas de plafond : l'Outstanding mention (hackathon, Background) fait passer un
// signal, un sous-score ou le score au-dessus de 100.
//
// Program Performance (fondateur, `programPerformance` : poids FOUNDER_PILLAR_WEIGHTS, 18/11) :
//   Engagement 10 %   presence aux evenements OBLIGATOIRES passes 50 %, formulaires remplis a temps 30 %,
//                     completude du profil 20 %
//   Execution 50 %    hackathons ou il etait present (moyenne des notes de son equipe, poids de
//                     l'evenement : H5 x4), fiabilite recue au peer rating ((note - 1) x 25), milestones
//                     dues : 1/3 chacun
//   Likability 30 %   fondateurs distincts qui l'ont shortliste (historique) rapportes a la moitie du
//                     batch, plafonne a 100, 50 % ; ressenti recu au peer rating ((note - 1) x 25) 50 %
//   Edge 10 %         la note du staff sur son Edge (shared/edge.ts), de 0 a 5 -> sur 100
//   Commitment 0 %    projet existant 50 %, cofondateurs existants 50 % (suivi)
//   Background 0 %    la grille Background du staff (suivi)
// Score startup (`startupScore` : Team 40, Execution 20, Traction 20, Market 20) :
//   Team         famille Team de ses pitchs (Team 20, Edge complementarity 10, Market edges 10) ;
//                Background moyen de ses fondateurs a 0 % (suivi)
//   Execution    moyenne de l'Execution de ses fondateurs
//   Traction     grille Weekly startup 50 % (lot 4), famille Speed of execution de ses pitchs 50 %
//   Market       famille Market de ses pitchs
// Une famille de ses pitchs (lot 5, shared/pitchGrid.ts) : sur 100 d'apres les points de ses criteres
// (120 avec l'Outstanding), moyenne des jures critere par critere a chaque pitch, puis moyenne des pitchs.

const sig = (label: string, raw: string, score: number, weight: number): ScoreSignal => ({
  label,
  raw,
  score: roundTo(Math.max(0, score), 1),
  weight,
});
/** Un signal oui / non : 100 ou 0. */
const yesNo = (label: string, value: boolean, weight: number) => sig(label, value ? "Yes" : "No", value ? 100 : 0, weight);
const meanOf = (signals: readonly ScoreSignal[]) => {
  const m = weightedMean(signals.map((s) => [s.score, s.weight] as const));
  return m === null ? null : roundTo(m, 1);
};
const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
const num = (v: number) => `${roundTo(v, 1)}`;

// ---- Conversions sur 100 (§3.3) --------------------------------------------------

/** Peer rating de 1 a 5 -> sur 100 : 1 = 0, 3 = 50, 5 = 100. */
export const peerRatingOn100 = (rating: number) => (rating - 1) * 25;

/** Likability : combien de fondateurs l'ont shortliste pour faire 100 (la moitie du batch). */
const shortlistersFor100 = (batchSize: number) => batchSize * 0.5;

/** Fondateurs distincts qui l'ont shortliste, sur 100 : rapportes a la moitie du batch, plafonnes a 100. */
export const shortlistersOn100 = (shortlisters: number, batchSize: number): number =>
  batchSize > 0 ? Math.min(100, (shortlisters / shortlistersFor100(batchSize)) * 100) : 0;

const CO_FOUNDER_SCORES: Record<ExistingCoFounders, number> = { in_batch: 100, outside_batch: 50, none: 0 };

/** Le poids d'un hackathon dans le signal Hackathons : `hackathonWeight` de l'evenement, 1 par defaut. */
export const hackathonWeightOf = (event: Pick<PioneersEvent, "hackathonWeight">): number =>
  typeof event.hackathonWeight === "number" && event.hackathonWeight > 0 ? event.hackathonWeight : 1;

// ---- Les entrees, a partir des documents du batch (services/scores.ts) -------------------

/** Un hackathon dans le signal Hackathons d'un fondateur. */
export type HackathonInput = { name: string; score: number; weight: number };

/**
 * Le signal Hackathons de chaque fondateur : la note sur 100 (`normalized`) de son equipe
 * a chaque classement, avec le poids de l'evenement, dans l'ordre donne. Un absent n'est
 * ni classe ni compte (l'absence ne penalise qu'Engagement) ; une ligne sans note, rien.
 */
export function hackathonsByFounder(
  boards: readonly { rows: readonly Pick<LeaderboardRow, "memberIds" | "normalized">[]; event: Pick<PioneersEvent, "name" | "hackathonWeight">; absentIds: ReadonlySet<string> }[],
): Map<string, HackathonInput[]> {
  const out = new Map<string, HackathonInput[]>();
  for (const { rows, event, absentIds } of boards) {
    const weight = hackathonWeightOf(event);
    // « Hackathon 5: Zero to first customer » -> « H5 » (le detail du signal).
    const name = event.name.split(":")[0].trim().replace(/^Hackathon\s+/i, "H");
    for (const row of rows) {
      if (typeof row.normalized !== "number") continue;
      for (const id of row.memberIds) {
        if (absentIds.has(id)) continue;
        const list = out.get(id) ?? [];
        list.push({ name, score: row.normalized, weight });
        out.set(id, list);
      }
    }
  }
  return out;
}

/**
 * Likability : pour chaque fondateur, les fondateurs DISTINCTS qui l'ont shortliste un jour
 * (`shortlisted` : qui chacun a shortliste, historique et listes actuelles, deja filtre aux
 * fondateurs du batch). Une meme personne compte une fois ; jamais soi-meme.
 */
export function shortlistersOf(shortlisted: ReadonlyMap<string, ReadonlySet<string>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [from, targets] of shortlisted) {
    for (const to of targets) {
      if (to === from) continue;
      const set = out.get(to) ?? new Set<string>();
      set.add(from);
      out.set(to, set);
    }
  }
  return out;
}

/**
 * Un formulaire compte dans « Forms on time » : publie, non archive, echeance passee, et pas
 * d'un evenement optionnel. Les destinataires (ni absents, ni jures, ni anonymes) : `formAudience`.
 */
export const countsInFormsOnTime = (
  form: Pick<Form, "archivedDateISOString" | "status" | "deadlineDateISOString">,
  event: Pick<PioneersEvent, "attendanceOptional"> | null,
  nowISOString: DateISOString,
): boolean =>
  form.archivedDateISOString === null &&
  form.status !== "draft" &&
  !!form.deadlineDateISOString &&
  form.deadlineDateISOString <= nowISOString &&
  !(event && isAttendanceOptional(event));

// ---- Milestones (§3.2) -------------------------------------------------------------

export const MILESTONES = ["weekly_goal", "teamed_up", "problem_validated", "shortlist_done", "met"] as const;
export type MilestoneKey = (typeof MILESTONES)[number];

export const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  weekly_goal: "Weekly goal",
  teamed_up: "Teamed up",
  problem_validated: "Problem validated",
  shortlist_done: "Shortlist done",
  met: "Met",
};

/** « Met » reciproques d'un fondateur : ceux qu'il a marques et qui l'ont marque (milestone Met, Admin > Reviews). */
export const reciprocalMetCount = (founderId: string, metOf: ReadonlyMap<string, ReadonlySet<string>>): number =>
  [...(metOf.get(founderId) ?? [])].filter((id) => id !== founderId && metOf.get(id)?.has(founderId)).length;

/** Shortlist done : au moins 3 fondateurs shortlistes (historique compris). */
export const SHORTLIST_DONE_MIN = 3;
/** Met : au moins 50 % des autres fondateurs du batch en « Met » reciproque. */
export const MET_SHARE_MIN = 0.5;

/**
 * Le champ de `settings.scoreMilestoneDueDates` (types/batch.ts) qui porte l'echeance de
 * chaque milestone. Weekly goal (a partir de `weeklyGoalFrom`, l'echeance du deuxieme Weekly update) et Problem validated
 * viennent de la grille Weekly founder (lot 4, shared/weeklyReviews.ts) : sans revue, pas de poids.
 */
const DUE_DATE_FIELD: Record<MilestoneKey, keyof ScoreMilestoneDueDates> = {
  weekly_goal: "weeklyGoalFrom",
  teamed_up: "teamedUp",
  problem_validated: "problemValidated",
  shortlist_done: "shortlistDone",
  met: "met",
};

/**
 * Une milestone d'un fondateur : `achieved` oui / non (100 ou 0), ou une note sur 100 (Weekly goal :
 * la moyenne des semaines notees) ; `null` = pas de donnee (pas de poids, meme due).
 */
export type MilestoneInput = { key: MilestoneKey; dueDateISOString: DateISOString; achieved: boolean | number | null };

/** La valeur sur 100 d'une milestone renseignee. */
export const milestoneValue = (m: Pick<MilestoneInput, "achieved">): number => (typeof m.achieved === "number" ? m.achieved : m.achieved ? 100 : 0);

/** Ce que les milestones lisent d'un fondateur ; `null` = pas encore de donnee (aucune revue). */
export type MilestoneFacts = {
  /** Fondateurs distincts du batch qu'il a shortlistes un jour. */
  shortlistedCount: number;
  /** Fondateurs du batch avec qui le « Met » est reciproque. */
  reciprocalMetCount: number;
  /** Fondateurs du batch, lui compris. */
  batchSize: number;
  /** Fondateurs du batch dans sa startup, lui compris (0 sans startup). */
  startupFounderCount: number;
  /** Problem validated (grille Weekly founder : `weeklyReviews.ts#problemValidatedOf`). */
  problemValidated: boolean | null;
  /** Weekly goal sur 100 (grille Weekly founder : `weeklyReviews.ts#weeklyGoalScore`). */
  weeklyGoal: number | null;
};

/**
 * Les milestones du batch pour ce fondateur, avec leur echeance (`settings.scoreMilestoneDueDates`
 * du batch). Une milestone ne compte qu'une fois due ; sans echeance, elle n'existe pas (pas de poids).
 */
export function founderMilestones(dueDates: ScoreMilestoneDueDates | null | undefined, facts: MilestoneFacts): MilestoneInput[] {
  const achieved: Record<MilestoneKey, boolean | number | null> = {
    // La grille Weekly founder : la moyenne des semaines notees, sur 100.
    weekly_goal: facts.weeklyGoal,
    teamed_up: facts.startupFounderCount >= 2,
    problem_validated: facts.problemValidated,
    shortlist_done: facts.shortlistedCount >= SHORTLIST_DONE_MIN,
    met: facts.batchSize > 1 && facts.reciprocalMetCount >= MET_SHARE_MIN * (facts.batchSize - 1),
  };
  return MILESTONES.flatMap((key) => {
    const due = dueDates?.[DUE_DATE_FIELD[key]];
    return due ? [{ key, dueDateISOString: due, achieved: achieved[key] }] : [];
  });
}

/** Les milestones qui comptent : dues a `nowISOString`, avec une donnee. */
export const dueMilestones = (milestones: readonly MilestoneInput[], nowISOString: DateISOString) =>
  milestones.filter((m) => m.dueDateISOString <= nowISOString && m.achieved !== null);

// ---- Program Performance ------------------------------------------------------------

/** Ce que le calcul sait d'un fondateur. */
export type FounderScoreInputs = {
  nowISOString: DateISOString;
  /** Evenements OBLIGATOIRES passes ou il etait attendu, et ceux ou il etait la. */
  attendance: { attended: number; total: number };
  /** Formulaires attendus (hors evenements optionnels) dont l'echeance est passee, et ceux remplis avant. */
  formsOnTime: { onTime: number; expected: number };
  /** Part des champs obligatoires du profil remplis (0-1). */
  profileCompleteness: number;
  /** La note sur 100 (120 avec l'Outstanding mention) de son equipe a chaque hackathon publie ou il etait present. */
  hackathons: HackathonInput[];
  /** La fiabilite recue des coequipiers (peer rating `reliability`, 1-5). */
  peerReliability: number[];
  milestones: MilestoneInput[];
  /** Fondateurs distincts qui l'ont shortliste un jour, et la taille du batch (participants). */
  shortlisters: number;
  batchSize: number;
  /** Le ressenti recu des coequipiers (peer rating `likability`, 1-5). */
  peerLikability: number[];
  /** La note du staff sur son Edge : `null` sans note. */
  edge: FounderEdgeRating | null;
  hasExistingProject: boolean | null;
  hasExistingCoFounders: ExistingCoFounders | null;
  background: FounderBackground | null;
};

export type ComputedScore<K extends string> = {
  subScores: Record<K, number | null>;
  signals: Partial<Record<K, ScoreSignal[]>>;
  /** Part des sous-scores disponibles (0-1). */
  dataCompleteness: number;
};

const finish = <K extends string>(signals: Record<K, ScoreSignal[]>): ComputedScore<K> => {
  const keys = Object.keys(signals) as K[];
  const subScores = Object.fromEntries(keys.map((k) => [k, meanOf(signals[k])])) as Record<K, number | null>;
  const available = keys.filter((k) => subScores[k] !== null).length;
  return { subScores, signals, dataCompleteness: keys.length ? available / keys.length : 0 };
};

export function computeFounderScore(i: FounderScoreInputs): ComputedScore<FounderPillar> {
  const engagement: ScoreSignal[] = [];
  if (i.attendance.total > 0) {
    const rate = i.attendance.attended / i.attendance.total;
    engagement.push(sig(`Attendance (${i.attendance.total})`, `${pct(rate)} (${i.attendance.attended}/${i.attendance.total} mandatory)`, rate * 100, 50));
  }
  if (i.formsOnTime.expected > 0) {
    const rate = i.formsOnTime.onTime / i.formsOnTime.expected;
    engagement.push(sig(`Forms on time (${i.formsOnTime.expected})`, `${i.formsOnTime.onTime}/${i.formsOnTime.expected}`, rate * 100, 30));
  }
  engagement.push(sig("Profile completeness", pct(i.profileCompleteness), i.profileCompleteness * 100, 20));

  // Trois signaux a poids egal (33,3 %), chacun retire sans donnee.
  const execution: ScoreSignal[] = [];
  const hackathonMean = weightedMean(i.hackathons.map((h) => [h.score, h.weight] as const));
  if (hackathonMean !== null) {
    const raw = i.hackathons.map((h) => `${h.name} ${num(h.score)}${h.weight !== 1 ? ` (x${h.weight})` : ""}`).join(" · ");
    execution.push(sig(`Hackathons (${i.hackathons.length})`, raw, hackathonMean, 1));
  }
  const peerAverage = mean(i.peerReliability);
  if (peerAverage !== null) {
    execution.push(sig(`Peer reliability (${i.peerReliability.length})`, `${peerAverage.toFixed(1)}/5 on average`, peerRatingOn100(peerAverage), 1));
  }
  const due = dueMilestones(i.milestones, i.nowISOString);
  if (due.length > 0) {
    const values = due.map(milestoneValue);
    const reached = values.filter((v) => v >= 100).length;
    const raw = due.map((m) => `${MILESTONE_LABELS[m.key]}: ${typeof m.achieved === "number" ? num(m.achieved) : m.achieved ? "yes" : "no"}`).join(" · ");
    execution.push(sig(`Milestones (${reached}/${due.length})`, raw, mean(values) ?? 0, 1));
  }

  const likability: ScoreSignal[] = [];
  if (i.batchSize > 0) {
    likability.push(sig(`Shortlisted by (${i.shortlisters})`, `${i.shortlisters} founders, ${num(shortlistersFor100(i.batchSize))} for 100`, shortlistersOn100(i.shortlisters, i.batchSize), 50));
  }
  const feeling = mean(i.peerLikability);
  if (feeling !== null) {
    likability.push(sig(`Peer feeling (${i.peerLikability.length})`, `${feeling.toFixed(1)}/5 on average`, peerRatingOn100(feeling), 50));
  }

  const edge: ScoreSignal[] = [];
  if (i.edge) edge.push(sig("Edge", `${i.edge.score}/${EDGE_MAX_NOTE}`, edgeScore(i.edge) ?? 0, 100));

  const commitment: ScoreSignal[] = [];
  if (i.hasExistingProject !== null) commitment.push(yesNo("Existing project", i.hasExistingProject, 50));
  if (i.hasExistingCoFounders !== null) {
    commitment.push(sig("Existing co-founders", EXISTING_CO_FOUNDERS_LABELS[i.hasExistingCoFounders], CO_FOUNDER_SCORES[i.hasExistingCoFounders], 50));
  }

  // La note validee du staff seulement (shared/background.ts) : une proposition de Claude ne compte pas.
  const background: ScoreSignal[] = [];
  const note = ratedBackgroundScore(i.background);
  if (note !== null) {
    const scores = i.background?.scores ?? {};
    const raw = BACKGROUND_CRITERIA.filter((c) => typeof scores[c.key] === "number")
      .map((c) => `${c.label} ${scores[c.key]}/5`)
      .concat(note > 100 ? ["Outstanding"] : [])
      .join(" · ");
    background.push(sig("Background grid", raw, note, 100));
  }

  return finish<FounderPillar>({ engagement, execution, likability, edge, commitment, background });
}

// ---- Score startup --------------------------------------------------------------------

/** Ce que le calcul sait d'une startup (notes sur 100 ; `null` : pas encore de grille). */
export type StartupScoreInputs = {
  /** Note Background de chacun de ses fondateurs notes. */
  founderBackgrounds: number[];
  /** Execution (sous-score) de chacun de ses fondateurs qui en a une. */
  founderExecutions: number[];
  /** La moyenne des notes de ses Weekly updates, sur 100 (120 avec l'Outstanding) : `weeklyReviews.ts#weeklyTractionOf`. */
  weeklyTraction: number | null;
  /** Ses pitchs notes (grille Pitch), dans l'ordre : les familles Team, Speed of execution et Market. */
  pitches: readonly PitchInput[];
};

/** Le signal d'une famille de ses pitchs : la moyenne des pitchs (`means`), et la note de chacun. */
function pitchSignal(pitches: readonly PitchInput[], means: ReturnType<typeof pitchMeans>, family: PitchFamily, weight: number): ScoreSignal[] {
  const value = means[family];
  if (value === null) return [];
  const rated = pitches.filter((p) => p.grid.families[family] !== null);
  const raw = rated.map((p) => `${p.name} ${num(p.grid.families[family]!)}`).join(" · ");
  return [sig(`Pitches (${rated.length}): ${PITCH_FAMILY_INFO[family].label}`, raw, value, weight)];
}

export function computeStartupScore(i: StartupScoreInputs): ComputedScore<StartupSubScore> {
  // Team : la famille Team de ses pitchs ; le Background de ses fondateurs a 0 % (suivi, jamais compte).
  const team: ScoreSignal[] = [];
  const pitch = pitchMeans(i.pitches);
  team.push(...pitchSignal(i.pitches, pitch, "team", 100));
  const bg = mean(i.founderBackgrounds);
  if (bg !== null) team.push(sig(`Founders' Background (${i.founderBackgrounds.length})`, i.founderBackgrounds.map(num).join(" · "), bg, 0));

  const execution: ScoreSignal[] = [];
  const exec = mean(i.founderExecutions);
  if (exec !== null) execution.push(sig(`Founders' Execution (${i.founderExecutions.length})`, i.founderExecutions.map(num).join(" · "), exec, 100));

  const traction: ScoreSignal[] = [];
  if (i.weeklyTraction !== null) traction.push(sig("Weekly updates", num(i.weeklyTraction), i.weeklyTraction, 50));
  traction.push(...pitchSignal(i.pitches, pitch, "speed", 50));

  const market = pitchSignal(i.pitches, pitch, "market", 100);

  return finish<StartupSubScore>({ market, team, execution, traction });
}
