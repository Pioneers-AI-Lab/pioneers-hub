import { isShortlistDone, SHORTLIST_DONE_MIN } from "./scoring";
import type { BatchTask, TaskCheck } from "./types";

// ----------------------------
// Le To do du fondateur : ce qui est ouvert, ce qui arrive, ce qui est fait (decision du 18/11)
// ----------------------------
// Des taches seulement (formulaires, profil, taches du batch), jamais un evenement.
// Lu par le To do et le resume de « Me » (useTodoItems, FormsToFillContext), par
// Admin > Tasks (qui l'a fait) et par l'API (`create_task`, `update_task`).

/** « Coming up » : ce qui ouvre dans les `COMING_UP_DAYS` prochains jours ; plus tard, rien n'est montre. */
export const COMING_UP_DAYS = 7;
const DAY_MS = 86_400_000;

/** `open` : a faire maintenant (sans ouverture, ou ouverture passee) ; `coming_up` : ouvre sous 7 jours ; `null` : plus tard. */
export function todoWindow(opensDateISOString: string | null | undefined, nowISO: string): "open" | "coming_up" | null {
  if (!opensDateISOString || opensDateISOString <= nowISO) return "open";
  return Date.parse(opensDateISOString) - Date.parse(nowISO) <= COMING_UP_DAYS * DAY_MS ? "coming_up" : null;
}

/** Ce que l'app lit d'un fondateur pour une tache verifiee. */
export type TaskCheckFacts = { shortlistedCount: number };

/** Chaque verification : son libelle (Admin > Tasks) et sa regle. */
export const TASK_CHECK_RULES: Record<TaskCheck, { label: string; isDone: (facts: TaskCheckFacts) => boolean }> = {
  shortlist: { label: `${SHORTLIST_DONE_MIN}+ founders in the shortlist`, isDone: (f) => isShortlistDone(f.shortlistedCount) },
};

/** Faite : la verification de l'app (`check`), sinon la coche du fondateur. */
export const isTaskDone = (task: Pick<BatchTask, "check">, ticked: boolean, facts: TaskCheckFacts): boolean =>
  task.check ? TASK_CHECK_RULES[task.check].isDone(facts) : ticked;

/**
 * Les autres fondateurs du batch dans sa shortlist ACTUELLE (le filtre de la milestone
 * Shortlist done, services/scores.ts). La milestone compte aussi l'historique
 * (`shortlistHistory`, staff seulement) : retirer quelqu'un de sa shortlist peut
 * defaire la tache, jamais la milestone.
 */
export const shortlistedCountOf = (founderId: string, shortlistedIds: readonly string[], batchFounderIds: { has(id: string): boolean }): number =>
  new Set(shortlistedIds.filter((id) => id !== founderId && batchFounderIds.has(id))).size;

/**
 * L'ajout de `targetId` amene la shortlist au minimum (compte de `shortlistedCountOf`,
 * celui de la tache) : il pose `shortlistDoneDateISOString`, la date du To do.
 */
export function reachesShortlistDone(founderId: string, shortlistedIds: readonly string[], targetId: string, batchFounderIds: { has(id: string): boolean }): boolean {
  const before = shortlistedCountOf(founderId, shortlistedIds, batchFounderIds);
  return !isShortlistDone(before) && isShortlistDone(shortlistedCountOf(founderId, [...shortlistedIds, targetId], batchFounderIds));
}
