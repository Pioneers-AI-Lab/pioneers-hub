import type { WriteBatch } from "firebase/firestore";
import { slackUserIdWrites } from "@shared/admin/founders";
import type { Founder, WithId } from "@shared/types";
import { addWrites } from "@/lib/firestore/write";

// ----------------------------
// Id Slack d'un fondateur (staff)
// ----------------------------
// L'original vit dans `people/{personId}.slackUserId` ; sa copie dans
// `founders/{id}/private/directory` (PERSON_COPIES) est ce que lit le batch.
// Les deux s'ecrivent dans le lot de l'appelant (l'edition du profil, lib/profile.ts),
// par LA regle partagee avec l'API (`set_founder_staff_fields`). Seul le staff les ecrit (regles).

/** Ajoute au lot l'id Slack et sa copie sur cette fiche ; `null` (ou vide) efface l'id. */
export function addSlackUserIdWrites(batch: WriteBatch, founder: WithId<Founder>, slackUserId: string | null, now: string) {
  addWrites(batch, slackUserIdWrites(founder.personId, [founder.id], slackUserId, now));
}
