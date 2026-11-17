import { OUTSTANDING_BONUS_POINTS, tieBreakNote } from "@shared/scoringRules";
import type { Leaderboard, LeaderboardRow } from "@shared/types";
import { formatScore, metricValue } from "@/lib/format";

/**
 * Le texte d'une ligne de classement, le meme partout (page Leaderboard du batch,
 * Admin > Events) : la valeur a droite (note sur 100, metrique ou note sur 10) et la
 * ligne du dessous. Bareme (decision du 17/11) : la note sur 100, 120 avec
 * l'Outstanding mention ; dessous « Outstanding mention », « Late submission: 0 »,
 * puis `notes` (ce que l'appelant sait en plus) et le departage a egalite de total.
 */
export function rankedRowText(board: Pick<Leaderboard, "metric" | "scoring" | "rows">, row: LeaderboardRow, notes: readonly string[] = []) {
  if (board.scoring && row.total !== undefined) {
    const tieBreak = tieBreakNote(board.scoring, row, board.rows);
    const status = row.late ? ["Late submission: 0"] : row.outstanding ? [`Outstanding mention (+${OUTSTANDING_BONUS_POINTS})`] : [];
    return {
      value: `${Math.round(row.normalized ?? 0)} / 100`,
      subtitle: [...status, ...notes, ...(tieBreak ? [tieBreak] : [])].join(" · "),
    };
  }
  if (board.metric) return { value: metricValue(board.metric, row.score), subtitle: board.metric.label };
  return { value: formatScore(row.score, 10), subtitle: `${row.evaluationsCount} ${row.evaluationsCount === 1 ? "review" : "reviews"}` };
}
