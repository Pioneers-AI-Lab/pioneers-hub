import type { User as FirebaseUser } from "firebase/auth";
import { arrayUnion, getDoc, getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import type { Batch, ClaimRequest, InvestorAccess, UserRole, WithId } from "@shared/types";
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

      const now = nowISO();
      const batch = writeBatch(db);
      batch.set(refs.founder(founderId), { uid: firebaseUser.uid, claimedDateISOString: now, updatedDateISOString: now }, { merge: true });
      batch.set(refs.membership(founder.batchId, firebaseUser.uid), {
        id: "",
        programId: founder.programId,
        batchId: founder.batchId,
        uid: firebaseUser.uid,
        founderId,
        createdDateISOString: now,
      });
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

/** « C'est moi » : demande de rattachement, validee par le staff. Remplace une demande en attente. */
export async function requestClaim(firebaseUser: FirebaseUser, batch: WithId<Batch>, founderId: string) {
  await setDoc(refs.claimRequest(batch.id, firebaseUser.uid), {
    id: "",
    programId: batch.programId,
    batchId: batch.id,
    uid: firebaseUser.uid,
    founderId,
    email: firebaseUser.email?.toLowerCase() ?? "",
    displayName: firebaseUser.displayName,
    status: "pending",
    createdDateISOString: nowISO(),
    decidedByUid: null,
    decidedDateISOString: null,
  });
}

// ---- Staff ---------------------------------------------------------------------

/**
 * Valide une demande : rattache le profil au compte. Si la personne n'a pas
 * encore de compte, elle est rattachee aussi (et l'email du compte rejoint ses
 * `altEmails`) : le fondateur peut alors modifier WhatsApp et LinkedIn.
 */
export async function approveClaim(request: WithId<ClaimRequest>, staffUid: string) {
  const founder = (await getDoc(refs.founder(request.founderId))).data();
  if (!founder) throw new Error("This profile no longer exists.");
  if (founder.uid !== null && founder.uid !== request.uid) throw new Error("This profile is already linked to another account.");
  const person = (await getDoc(refs.person(founder.personId))).data();
  const user = (await getDoc(refs.user(request.uid))).data();

  const now = nowISO();
  const batch = writeBatch(db);
  batch.set(refs.founder(founder.id), { uid: request.uid, claimedDateISOString: now, updatedDateISOString: now }, { merge: true });
  batch.set(refs.membership(founder.batchId, request.uid), {
    id: "",
    programId: founder.programId,
    batchId: founder.batchId,
    uid: request.uid,
    founderId: founder.id,
    createdDateISOString: now,
  });
  batch.set(
    refs.claimRequest(request.batchId, request.uid),
    { status: "approved", decidedByUid: staffUid, decidedDateISOString: now },
    { merge: true },
  );
  if (person && person.uid === null) {
    batch.set(
      refs.person(person.id),
      {
        uid: request.uid,
        ...(request.email && request.email !== person.email ? { altEmails: arrayUnion(request.email) } : {}),
        updatedDateISOString: now,
      },
      { merge: true },
    );
    if (user && user.personId === null) batch.set(refs.user(request.uid), { personId: person.id }, { merge: true });
  }
  await batch.commit();
}

export async function rejectClaim(request: WithId<ClaimRequest>, staffUid: string) {
  await setDoc(
    refs.claimRequest(request.batchId, request.uid),
    { status: "rejected", decidedByUid: staffUid, decidedDateISOString: nowISO() },
    { merge: true },
  );
}

/**
 * Delie un profil de son compte : le compte perd l'acces au batch. Le lien
 * `batchMemberships` est SUPPRIME (c'est un droit d'acces, pas une donnee du
 * batch) ; le profil, lui, reste intact et redevient reclamable.
 */
export async function unlinkFounder(founder: { id: string; batchId: string; uid: string | null }) {
  if (!founder.uid) return;
  const now = nowISO();
  const batch = writeBatch(db);
  batch.set(refs.founder(founder.id), { uid: null, claimedDateISOString: null, updatedDateISOString: now }, { merge: true });
  batch.delete(refs.membership(founder.batchId, founder.uid));
  await batch.commit();
}

/** Roles d'un compte. `investorAccess` n'a de sens qu'avec le role `investor`. */
export async function setUserRoles(uid: string, roles: UserRole[], investorAccess: InvestorAccess | null) {
  await setDoc(
    refs.user(uid),
    { roles, investorAccess: roles.includes("investor") ? (investorAccess ?? "portfolio") : null },
    { merge: true },
  );
}
