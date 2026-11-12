import type { ChallengeTask } from "@shared/callables";

/** Ce qui reste a faire dans un Debrief : coequipiers non notes, resultats absents. */
export function debriefStatus(task: ChallengeTask) {
  const toRate = task.team.teammateIds.filter((id) => !task.myRatings[id]).length;
  const resultsMissing = task.metrics.length > 0 && Object.keys(task.results?.metrics ?? {}).length === 0;
  return { toRate, resultsMissing, done: toRate === 0 && !resultsMissing };
}
