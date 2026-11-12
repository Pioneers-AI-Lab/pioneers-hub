import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { docPaths, eventCollectionPaths } from "../shared/collections";
import type { EventTeam, PioneersEvent, Startup } from "../shared/types";

// ----------------------------
// services - lectures communes d'un evenement
// ----------------------------
// Dans une transaction (`tx`) ou hors transaction (`null`) : le leaderboard lit
// en transaction, la feuille d'un jure non.

const db = () => getFirestore();

/** L'evenement, ou `not-found`. */
export async function loadEvent(tx: Transaction | null, eventId: string): Promise<PioneersEvent> {
  const ref = db().doc(docPaths.event(eventId));
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "No such event.");
  return snap.data() as PioneersEvent;
}

/** Une cible notable : une equipe publiee, ou une startup de l'evenement. */
export type ScoredTarget = { id: string; name: string; memberIds: string[]; memberNames: string[] | null };

/**
 * Ce que le jury note et que le leaderboard classe : LA meme liste pour les
 * deux (les equipes publiees, ou les startups de l'evenement).
 */
export async function scoredTargets(
  tx: Transaction | null,
  eventId: string,
  event: PioneersEvent,
  target: "team" | "startup",
): Promise<ScoredTarget[]> {
  if (target === "startup") {
    const refs = event.startupIds.map((id) => db().doc(docPaths.startup(id)));
    const snaps = refs.length ? await (tx ? tx.getAll(...refs) : db().getAll(...refs)) : [];
    return snaps.flatMap((s) => {
      const st = s.data() as Startup | undefined;
      return st ? [{ id: s.id, name: st.name, memberIds: st.memberIds, memberNames: null }] : [];
    });
  }
  const query = db().collection(eventCollectionPaths.teams(eventId));
  const teams = tx ? await tx.get(query) : await query.get();
  return teams.docs.flatMap((d) => {
    const t = d.data() as EventTeam;
    return t.publishedDateISOString !== null ? [{ id: d.id, name: t.name, memberIds: t.memberIds, memberNames: t.memberNames ?? null }] : [];
  });
}
