import { runTransaction } from "firebase/firestore";
import { parisToday } from "@shared/dates";
import { RuleError } from "@shared/docWrites";
import { normalizeDraft, startupCreationWrites, type StartupDraft } from "@shared/teamLocks";
import type { Batch, Startup, WithId } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";
import { addAuditedWrites } from "@/lib/firestore/write";

// ----------------------------
// Admin > Startups : creer les startups confirmees (staff)
// ----------------------------
// Le geste se calcule en logique pure (shared/teamLocks.ts#startupCreationWrites) :
// startups et profils, appartenances datees, `startupId` des fondateurs, EN UNE
// TRANSACTION (regles : staff seulement) qui relit les membres et les ids des startups :
// un fondateur mis dans une startup entre-temps, ou une startup creee au meme id (autre
// onglet, autre membre du staff), refuse tout. L'equipe se forme le jour de la confirmation (Paris).

export async function createStartups(batch: WithId<Batch>, drafts: readonly StartupDraft[], startups: readonly WithId<Startup>[]): Promise<string[]> {
  const memberIds = [...new Set(drafts.flatMap((d) => normalizeDraft(d).memberIds))];
  return runTransaction(db, async (tx) => {
    // Les membres tels qu'en base (`startupDraftsProblem` ne lit qu'eux) ; un fondateur introuvable est refuse.
    const members = (await Promise.all(memberIds.map((id) => tx.get(refs.founder(id))))).flatMap((snap) => (snap.exists() ? [snap.data()] : []));
    const { writes, startupIds } = startupCreationWrites({
      programId: batch.programId,
      batchId: batch.id,
      drafts,
      founders: members,
      existingStartupIds: new Set(startups.map((s) => s.id)),
      dayString: parisToday(),
      nowISO: new Date().toISOString(),
    });
    const taken = (await Promise.all(startupIds.map((id) => tx.get(refs.startup(id))))).find((snap) => snap.exists());
    if (taken) throw new RuleError("already_exists", `A startup was just created as \`${taken.id}\`: reload the page and confirm again.`, "name");
    addAuditedWrites(tx, "create_startups", writes);
    return startupIds;
  });
}
