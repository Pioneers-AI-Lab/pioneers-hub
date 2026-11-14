import type { WriteBatch } from "firebase/firestore";
import { isSlackUserId, normalizeSlackId } from "@shared/slackLinks";
import type { Founder, WithId } from "@shared/types";
import { refs } from "@/lib/firestore/refs";

// ----------------------------
// Id Slack d'un fondateur (staff)
// ----------------------------
// L'original vit dans `people/{personId}.slackUserId` ; sa copie dans
// `founders/{id}/private/directory` (PERSON_COPIES) est ce que lit le batch.
// Les deux s'ecrivent dans le lot de l'appelant (l'edition du profil, lib/profile.ts).
// Seul le staff les ecrit (regles).

/** Ajoute au lot l'id Slack et sa copie ; `null` (ou vide) efface l'id. */
export function addSlackUserIdWrites(batch: WriteBatch, founder: WithId<Founder>, slackUserId: string | null, now: string) {
  const value = slackUserId === null ? null : normalizeSlackId(slackUserId);
  if (value !== null && !isSlackUserId(value))
    throw new Error("A Slack member ID starts with U (or W) and looks like U0123ABCD. In Slack: profile, then Copy member ID.");
  batch.set(refs.person(founder.personId), { slackUserId: value, updatedDateISOString: now }, { merge: true });
  batch.set(refs.founderDirectory(founder.id), { slackUserId: value }, { merge: true });
}
