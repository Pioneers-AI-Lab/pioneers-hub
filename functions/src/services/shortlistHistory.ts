import { getFirestore } from "firebase-admin/firestore";
import { docPaths } from "../shared/collections";
import { ALREADY_EXISTS, shortlistRecordsToCreate } from "../shared/shortlistHistory";
import { readConnections, type Founder, type FounderConnections } from "../shared/types";

// ----------------------------
// services - l'historique des shortlists (Likability, docs/FONCTIONNALITES.md §3.1)
// ----------------------------
// Le declencheur `onConnectionsWritten` (founders/{id}/private/connections) cree un
// enregistrement `shortlistHistory/{founderId}_{targetId}` pour chaque fondateur de la
// shortlist qui n'en a pas encore : ajout seul, jamais modifie ni retire (retirer
// quelqu'un de sa shortlist n'efface pas qu'il l'a shortliste). Rien a faire si la
// shortlist n'a pas grandi (coche « Met », retrait) ; sinon toute la liste est recreee en
// `create` (un enregistrement existant est refuse, ALREADY_EXISTS, jamais remplace) :
// un declencheur manque se rattrape au prochain ajout.
// Etat d'avant le declencheur : scripts/backfill-shortlist-history.mjs.

const db = () => getFirestore();

export async function onConnectionsWritten(founderId: string, before: FounderConnections | null, after: FounderConnections | null): Promise<number> {
  const previous = new Set(readConnections(before).shortlistedFounderIds);
  const targets = readConnections(after).shortlistedFounderIds;
  if (!targets.some((id) => !previous.has(id))) return 0;
  const founder = (await db().doc(docPaths.founder(founderId)).get()).data() as Founder | undefined;
  if (!founder) return 0;
  const records = shortlistRecordsToCreate(
    { programId: founder.programId, batchId: founder.batchId, founderId },
    targets,
    new Set(),
    new Date().toISOString(),
  );
  // `create` : un enregistrement deja ecrit (avant, ou par un declencheur presque simultane) n'est jamais remplace.
  const results = await Promise.allSettled(records.map((r) => db().doc(r.path).create(r.data)));
  const failed = results.filter((r) => r.status === "rejected" && (r.reason as { code?: number })?.code !== ALREADY_EXISTS);
  if (failed.length) throw (failed[0] as PromiseRejectedResult).reason;
  return results.filter((r) => r.status === "fulfilled").length;
}
