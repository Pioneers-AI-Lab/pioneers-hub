"use client";

import { useFormsToFill, type FormToFill } from "@/context/FormsToFillContext";

/**
 * Ce que le fondateur connecte a a faire (SPECS §3.1) : des formulaires, rien
 * d'autre (SPECS §2, modele standard), ranges comme il les lit : les picks, la
 * Submission et le Peer rating de chaque hackathon, puis les autres. Lu par « To do » (la liste
 * complete) et « Me » (le resume), sous (mine)/layout.tsx qui monte FormsToFill.
 */
export function useTodoItems() {
  const { items, isLoading } = useFormsToFill();
  const ofKind = (keep: (i: FormToFill) => boolean) => items.filter(keep);
  const isHackathon = (i: FormToFill) => i.form.kind === "debrief" || i.form.kind === "peer_feedback";
  return {
    picks: ofKind((i) => i.form.kind === "picks"),
    debriefs: ofKind(isHackathon),
    forms: ofKind((i) => i.form.kind !== "picks" && !isHackathon(i)),
    isLoading,
  };
}
