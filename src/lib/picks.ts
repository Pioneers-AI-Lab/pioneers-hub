import type { Picks } from "@shared/types";

/** Les choix reciproques (A a choisi B, B a choisi A), avec le rang donne par chacun : ils sont apparies en premier. */
export function mutualPairs(picks: readonly Pick<Picks, "founderId" | "pickedFounderIds">[]) {
  const byFounder = new Map(picks.map((p) => [p.founderId, p.pickedFounderIds]));
  return picks.flatMap((p) =>
    p.pickedFounderIds.flatMap((other, rank) => {
      const back = byFounder.get(other)?.indexOf(p.founderId) ?? -1;
      return back >= 0 && p.founderId < other ? [{ a: p.founderId, b: other, rankA: rank + 1, rankB: back + 1 }] : [];
    }),
  );
}
