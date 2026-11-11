import { writeBatch } from "firebase/firestore";
import { isSlackUserId } from "@shared/slackLinks";
import type { Founder, WithId } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";

// ----------------------------
// Id Slack d'un fondateur (staff)
// ----------------------------
// L'original vit dans `people/{personId}.slackUserId` ; sa copie dans
// `founders/{id}/private/directory` (PERSON_COPIES) est ce que lit le batch.
// Les deux s'ecrivent dans le meme lot. Seul le staff les ecrit (regles).

/** `null` efface l'id. */
export async function setFounderSlackUserId(founder: WithId<Founder>, slackUserId: string | null) {
  const value = slackUserId?.trim().toUpperCase() || null;
  if (value !== null && !isSlackUserId(value))
    throw new Error("A Slack member ID starts with U (or W) and looks like U0123ABCD. In Slack: profile, then Copy member ID.");
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.set(refs.person(founder.personId), { slackUserId: value, updatedDateISOString: now }, { merge: true });
  batch.set(refs.founderDirectory(founder.id), { slackUserId: value }, { merge: true });
  await batch.commit();
}
