import type { User as FirebaseUser } from "firebase/auth";
import { arrayUnion, getDoc, getDocs, query, where, writeBatch, type WriteBatch } from "firebase/firestore";
import type { Founder, WithId } from "@shared/types";
import { db } from "@/lib/firebase";
import { refs } from "@/lib/firestore/refs";

// ----------------------------
// Rattachement des comptes et acces (SPECS §3.1, §3.2 « Acces »)
// ----------------------------
// Toutes les ecritures sont en LOT : un rattachement modifie le fondateur, le
// lien `batchMemberships`, la personne et le compte d'un coup. Les regles
// verifient le lot entier (firestore.rules : rattachement automatique) ; un
// lot a moitie applique n'existe pas.

const nowISO = () => new Date().toISOString();

export type ClaimedProfile = { programId: string; batchId: string; founderId: string };

/**
 * LE rattachement d'un profil a un compte : le profil et le droit d'acces au
 * batch (`batchMemberships`, un par batch et par compte). Les regles verifient
 * ce lot tel quel (rattachement automatique, « c'est moi »).
 */
function addLinkWrites(batch: WriteBatch, founder: Pick<Founder, "programId" | "batchId">, founderId: string, uid: string, now: string) {
  batch.set(refs.founder(founderId), { uid, claimedDateISOString: now, updatedDateISOString: now }, { merge: true });
  batch.set(refs.membership(founder.batchId, uid), {
    id: "",
    programId: founder.programId,
    batchId: founder.batchId,
    uid,
    founderId,
    createdDateISOString: now,
  });
}

/**
 * Rattachement automatique : l'email VERIFIE du compte est celui d'une
 * personne importee. Rattache chacun de ses profils non reclames (un par batch).
 * Silencieux si rien ne correspond.
 */
export async function autoClaimByEmail(firebaseUser: FirebaseUser): Promise<ClaimedProfile[]> {
  const email = firebaseUser.email?.trim().toLowerCase();
  if (!email || !firebaseUser.emailVerified) return [];
  const people = await getDocs(query(refs.people(), where("email", "==", email)));
  const claimed: ClaimedProfile[] = [];

  for (const personSnap of people.docs) {
    const person = personSnap.data();
    // Personne deja rattachee a un AUTRE compte : le staff tranche.
    if (person.uid !== null && person.uid !== firebaseUser.uid) continue;

    for (const founderId of person.founderIds) {
      const founderSnap = await getDoc(refs.founder(founderId)).catch(() => null);
      const founder = founderSnap?.data();
      if (!founder || founder.uid !== null || founder.archivedDateISOString !== null) continue;
      // Un profil par batch (regles : `batchMemberships` se cree, ne se remplace pas).
      if (claimed.some((c) => c.batchId === founder.batchId)) continue;

      const now = nowISO();
      const batch = writeBatch(db);
      addLinkWrites(batch, founder, founderId, firebaseUser.uid, now);
      if (person.uid === null) {
        batch.set(refs.person(person.id), { uid: firebaseUser.uid, updatedDateISOString: now }, { merge: true });
      }
      batch.set(refs.user(firebaseUser.uid), { personId: person.id }, { merge: true });
      await batch.commit();
      person.uid = firebaseUser.uid;
      claimed.push({ programId: founder.programId, batchId: founder.batchId, founderId });
    }
  }
  return claimed;
}

/**
 * « C'est moi » (comme Tricount) : le compte reclame un profil non reclame,
 * choisi dans la liste du batch. Acces immediat ; le staff voit le
 * rattachement dans Admin > Founder profiles et peut delier.
 * La personne est rattachee dans le meme lot ; si elle l'est deja a un autre
 * compte (le compte ne peut pas le lire avant), on rattache le profil seul.
 * Un profil par batch : les regles refusent le lot si le compte y est deja
 * rattache ; le refus est alors traduit en message clair.
 */
export async function claimProfile(firebaseUser: FirebaseUser, founder: WithId<Founder>) {
  const write = (withIdentity: boolean) => {
    const now = nowISO();
    const batch = writeBatch(db);
    addLinkWrites(batch, founder, founder.id, firebaseUser.uid, now);
    if (withIdentity) {
      batch.set(refs.person(founder.personId), { uid: firebaseUser.uid, updatedDateISOString: now }, { merge: true });
      batch.set(refs.user(firebaseUser.uid), { personId: founder.personId }, { merge: true });
    }
    return batch.commit();
  };
  try {
    await write(true);
  } catch (err) {
    if ((err as { code?: string }).code !== "permission-denied") throw err;
    if ((await getDoc(refs.membership(founder.batchId, firebaseUser.uid))).exists()) {
      throw new Error("Your account is already linked to a profile in this batch.");
    }
    await write(false);
  }
}

// ---- Staff (Admin > Founder profiles) -------------------------------------------

/**
 * Le staff rattache lui-meme un profil a un compte. Un profil par batch et par
 * compte : refuse si le compte en a deja un dans ce batch. Si la personne n'a
 * pas encore de compte, elle est rattachee aussi (l'email du compte rejoint ses
 * `altEmails`) : le fondateur peut alors modifier WhatsApp et LinkedIn.
 */
export async function linkFounder(founder: WithId<Founder>, account: { uid: string; email: string | null }) {
  const { uid } = account;
  const email = account.email?.toLowerCase() ?? null;
  const [current, membership, person, user] = await Promise.all([
    getDoc(refs.founder(founder.id)),
    getDoc(refs.membership(founder.batchId, uid)),
    getDoc(refs.person(founder.personId)),
    getDoc(refs.user(uid)),
  ]);
  if (!current.exists()) throw new Error("This profile no longer exists.");
  if (current.data().uid !== null) throw new Error("This profile is already linked to an account.");
  if (membership.exists()) throw new Error("This account is already linked to a profile in this batch.");

  const now = nowISO();
  const batch = writeBatch(db);
  addLinkWrites(batch, founder, founder.id, uid, now);
  const p = person.data();
  if (p && p.uid === null) {
    batch.set(
      refs.person(p.id),
      { uid, ...(email && email !== p.email ? { altEmails: arrayUnion(email) } : {}), updatedDateISOString: now },
      { merge: true },
    );
    if (user.data()?.personId === null) batch.set(refs.user(uid), { personId: p.id }, { merge: true });
  }
  await batch.commit();
}

/**
 * Delie un profil de son compte : le compte perd l'acces au batch. Le lien
 * `batchMemberships` est SUPPRIME (c'est un droit d'acces, pas une donnee du
 * batch) ; le profil, lui, reste intact et redevient reclamable. Si le compte
 * ne tient plus rien de cette personne (aucun autre profil fondateur, ni fiche
 * mentor ou investor, que les regles lisent par `users.personId`), la personne
 * et le compte sont detaches aussi : sinon le rattachement automatique par
 * email d'un autre compte ignorerait cette personne, vue comme deja prise.
 */
export async function unlinkFounder(founder: { id: string; batchId: string; personId: string; uid: string | null }) {
  if (!founder.uid) return;
  const uid = founder.uid;
  const [sameAccount, person, user] = await Promise.all([
    getDocs(query(refs.founders(), where("personId", "==", founder.personId), where("uid", "==", uid))),
    getDoc(refs.person(founder.personId)),
    getDoc(refs.user(uid)),
  ]);
  const p = person.data();
  const keepsPerson = sameAccount.docs.some((d) => d.id !== founder.id) || Boolean(p?.mentorId || p?.investorId);
  const now = nowISO();
  const batch = writeBatch(db);
  batch.set(refs.founder(founder.id), { uid: null, claimedDateISOString: null, updatedDateISOString: now }, { merge: true });
  batch.delete(refs.membership(founder.batchId, uid));
  if (!keepsPerson) {
    if (p?.uid === uid) batch.set(refs.person(founder.personId), { uid: null, updatedDateISOString: now }, { merge: true });
    if (user.data()?.personId === founder.personId) batch.set(refs.user(uid), { personId: null }, { merge: true });
  }
  await batch.commit();
}
