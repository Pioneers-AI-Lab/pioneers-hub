import {
  COMMITMENT_STATUS_LABELS,
  EXISTING_CO_FOUNDERS_LABELS,
  mean,
  roundTo,
  weightedMean,
  type CommitmentStatus,
  type ExistingCoFounders,
  type FounderPillar,
  type ScoreSignal,
  type StartupSubScore,
} from "./types";

// ----------------------------
// Les scores d'un fondateur et d'une startup (SPECS §5)
// ----------------------------
// Logique pure, lue par `services/scores.ts` qui rassemble les donnees du batch.
// Les sous-scores et leurs signaux sont ceux du dashboard Spring 2026
// (InvestorDashboard `lib/scoring.ts`, `lib/startup-scoring.ts`, seuils
// identiques) ; seules les sources changent (decision du 13/11) :
//   Engagement   presence 50 %, formulaires remplis a temps 30 %, completude du profil 20 % (decision du 14/11)
//   Execution    score normalise de son equipe a chaque hackathon (meilleure = 10)
//   Likability   interet recu (picks, interet et « je travaille avec »),
//                moyenne des peer ratings recus, « teamed up »
//   Commitment   statut d'engagement, idee claire, projet et cofondateurs existants
//   Achievements note des jures (sur 6), high potential, Elo du parcours
// Tout est sur 10. Un signal sans donnee est retire, et les autres se partagent
// son poids ; un sous-score sans signal vaut `null`.

const clamp = (v: number, min = 0, max = 10) => Math.min(max, Math.max(min, v));
const sig = (label: string, raw: string, score: number, weight = 1): ScoreSignal => ({ label, raw, score: roundTo(clamp(score), 1), weight });
/** Un signal oui / non : 10 ou 0. */
const yesNo = (label: string, value: boolean, weight = 1) => sig(label, value ? "Yes" : "No", value ? 10 : 0, weight);
const meanOf = (signals: readonly ScoreSignal[]) => {
  const m = weightedMean(signals.map((s) => [s.score, s.weight] as const));
  return m === null ? null : roundTo(m, 1);
};
const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** Elo du parcours ramene sur 10 : Elo 500 = 0, Elo 1 500 = 10 (SP26). */
export const eloOn10 = (elo: number) => clamp(((elo - 500) / 1000) * 10);

/** @source SP26 « Goal form » : le statut d'engagement, sur 10. */
export const COMMITMENT_STATUS_SCORES: Record<CommitmentStatus, number> = {
  committed: 10,
  on_a_project: 7,
  testing_relationships: 4,
  what_am_i_doing_here: 1,
};

const CO_FOUNDER_SCORES: Record<ExistingCoFounders, number> = { in_batch: 10, outside_batch: 7, none: 0 };

/** Ce que le calcul sait d'un fondateur. */
export type FounderScoreInputs = {
  attendance: { attended: number; total: number };
  /** Formulaires attendus dont l'echeance est passee, et ceux remplis avant. */
  formsOnTime: { onTime: number; expected: number };
  /** Part des champs obligatoires du profil remplis (0-1). */
  profileCompleteness: number;
  /** Score normalise (0-100) de son equipe a chaque hackathon publie. */
  hackathonScores: number[];
  /** Fondateurs distincts qui l'ont choisi (picks, interet, « je travaille avec »), et le maximum du batch. */
  interestReceived: number;
  batchMaxInterest: number;
  /** Moyenne des peer ratings recus (1-5), `null` sans avis. */
  peerAverage: number | null;
  peerCount: number;
  /** Sa startup a plus d'un cofondateur. */
  teamedUp: boolean;
  /** Le meilleur statut d'engagement declare. */
  commitmentStatus: CommitmentStatus | null;
  hasExistingProject: boolean | null;
  hasExistingCoFounders: ExistingCoFounders | null;
  /** Evaluation du staff et des jures sur sa startup : `null` sans startup. */
  startup: { clearIdea: boolean | null; highPotential: boolean | null; achievementsScore: number | null } | null;
  eloScore: number | null;
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
    engagement.push(sig("Attendance rate", `${pct(rate)} (${i.attendance.attended}/${i.attendance.total})`, rate * 10, 0.5));
  }
  if (i.formsOnTime.expected > 0) {
    const rate = i.formsOnTime.onTime / i.formsOnTime.expected;
    engagement.push(sig("Forms on time", `${i.formsOnTime.onTime}/${i.formsOnTime.expected}`, rate * 10, 0.3));
  }
  engagement.push(sig("Profile completeness", pct(i.profileCompleteness), i.profileCompleteness * 10, 0.2));

  const execution = i.hackathonScores.map((s, n) => sig(`Hackathon ${n + 1} (team, best = 100)`, `${Math.round(s)}/100`, s / 10));

  const likability: ScoreSignal[] = [
    sig(
      "Interest received",
      `${i.interestReceived} (batch max ${i.batchMaxInterest})`,
      Math.min(i.interestReceived / Math.max(i.batchMaxInterest, 1), 1) * 10,
    ),
  ];
  if (i.peerAverage !== null) likability.push(sig("Peer rating received", `${i.peerAverage.toFixed(1)}/5 (${i.peerCount})`, i.peerAverage * 2));
  if (i.teamedUp) likability.push(yesNo("Teamed up", true));

  const commitment: ScoreSignal[] = [];
  if (i.commitmentStatus) {
    commitment.push(sig("Commitment status", COMMITMENT_STATUS_LABELS[i.commitmentStatus], COMMITMENT_STATUS_SCORES[i.commitmentStatus]));
  }
  if (i.startup && i.startup.clearIdea !== null) commitment.push(yesNo("Clear idea", i.startup.clearIdea));
  if (i.hasExistingProject !== null) commitment.push(yesNo("Had existing project", i.hasExistingProject, 0.5));
  if (i.hasExistingCoFounders !== null) {
    commitment.push(sig("Had co-founders", EXISTING_CO_FOUNDERS_LABELS[i.hasExistingCoFounders], CO_FOUNDER_SCORES[i.hasExistingCoFounders], 0.5));
  }

  const achievements: ScoreSignal[] = [];
  const s = i.startup;
  if (s && s.achievementsScore !== null) achievements.push(sig("Achievements score", `${s.achievementsScore}/6`, (s.achievementsScore / 6) * 10));
  if (s && s.highPotential !== null) achievements.push(yesNo("High potential", s.highPotential, 0.25));
  if (i.eloScore !== null) achievements.push(sig("Background Elo", `${Math.round(i.eloScore)}`, eloOn10(i.eloScore)));

  return finish<FounderPillar>({ engagement, execution, likability, commitment, achievements });
}

/** Ce que le calcul sait d'une startup. */
export type StartupScoreInputs = {
  /** Analyse de marche : SAM median (EUR), CAGR median (0,4 = 40 %), concurrents. `null` sans analyse. */
  market: { samMid: number | null; cagrMid: number | null; competitors: number } | null;
  clearIdea: boolean | null;
  highPotential: boolean | null;
  achievementsScore: number | null;
  /** Elo et Program Performance (sur 10) de ses fondateurs du batch. */
  founderElos: number[];
  founderPerformances: number[];
  /** Updates du jeudi : meilleure hausse hebdomadaire de l'encaisse, meilleurs utilisateurs actifs, total des conversations. */
  traction: { bestWeeklyCash: number; bestActiveUsers: number; totalConversations: number } | null;
};

const stepScore = (value: number, steps: readonly (readonly [threshold: number, score: number])[]) => {
  for (const [threshold, score] of steps) if (value > threshold) return score;
  return 0;
};

export function computeStartupScore(i: StartupScoreInputs): ComputedScore<StartupSubScore> {
  const market: ScoreSignal[] = [];
  if (i.market && i.market.samMid !== null && i.market.cagrMid !== null) {
    const samM = i.market.samMid / 1_000_000;
    const n = i.market.competitors;
    market.push(sig("Market size (SAM)", `${Math.round(samM)}M`, (Math.log10(Math.max(samM, 1)) / 5) * 10, 0.35));
    market.push(sig("Growth (CAGR)", pct(i.market.cagrMid), ((i.market.cagrMid * 100) / 40) * 10, 0.3));
    market.push(sig("Competitors", `${n}`, n === 0 ? 2 : n <= 3 ? 6 : n <= 8 ? 9 : 7, 0.2));
    const edge = 5 + (i.clearIdea ? 2 : 0) + (i.highPotential ? 2 : 0) + (i.achievementsScore !== null ? Math.min(i.achievementsScore / 6, 1) : 0);
    market.push(sig("Differentiation", `${roundTo(clamp(edge), 1)}`, edge, 0.15));
  }
  const teamAvg = mean(i.founderElos.map(eloOn10));
  const team = teamAvg === null ? [] : [sig("Founders' Elo", `${i.founderElos.length} founder(s)`, teamAvg)];
  const execAvg = mean(i.founderPerformances);
  const execution = execAvg === null ? [] : [sig("Founders' Program Performance", `${i.founderPerformances.length} founder(s)`, execAvg)];
  const traction: ScoreSignal[] = [];
  if (i.traction) {
    const t = i.traction;
    traction.push(sig("Best week of cash", `${Math.round(t.bestWeeklyCash)} EUR`, stepScore(t.bestWeeklyCash, [[10000, 10], [1000, 8], [100, 6], [0, 4]]), 0.4));
    traction.push(sig("Best active users", `${t.bestActiveUsers}`, stepScore(t.bestActiveUsers, [[200, 9], [50, 7], [10, 5], [0, 3]]), 0.35));
    traction.push(sig("Conversations", `${t.totalConversations}`, stepScore(t.totalConversations, [[30, 9], [15, 7], [5, 5], [0, 3]]), 0.25));
  }
  return finish<StartupSubScore>({ market, team, execution, traction });
}
