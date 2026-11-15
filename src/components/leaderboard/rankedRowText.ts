import { tieBreakNote } from "@shared/scoringRules";
import type { Leaderboard, LeaderboardRow } from "@shared/types";
import { metricValue, score10 } from "@/lib/format";

/**
 * Le texte d'une ligne de classement, le meme partout (page Leaderboard du batch,
 * Admin > Events) : la valeur a droite (points, metrique ou note sur 10) et la
 * ligne du dessous. Bareme : « 96 / 100 » ou « Late submission: 0 », puis `notes`
 * (ce que l'appelant sait en plus) et le departage a egalite de total.
 */
export function rankedRowText(board: Pick<Leaderboard, "metric" | "scoring" | "rows">, row: LeaderboardRow, notes: readonly string[] = []) {
  if (board.scoring && row.total !== undefined) {
    const tieBreak = tieBreakNote(board.scoring, row, board.rows);
    return {
      value: metricValue({ unit: "pts" }, row.total),
      subtitle: [row.late ? "Late submission: 0" : `${Math.round(row.normalized ?? 0)} / 100`, ...notes, ...(tieBreak ? [tieBreak] : [])].join(" · "),
    };
  }
  if (board.metric) return { value: metricValue(board.metric, row.score), subtitle: board.metric.label };
  return { value: score10(row.score), subtitle: `${row.evaluationsCount} ${row.evaluationsCount === 1 ? "review" : "reviews"}` };
}
