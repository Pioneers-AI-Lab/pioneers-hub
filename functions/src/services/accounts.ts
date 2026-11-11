import { HttpsError } from "firebase-functions/v2/https";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import { COL } from "../shared/collections";
import type { AccountAccess, AccountRow } from "../shared/callables";
import { USER_ROLES, type AuditLog, type BatchMembership, type User, type UserRole } from "../shared/types";

// ----------------------------
// services - les comptes (Admin > Access)
// ----------------------------
// Reserve au staff (verifie par l'appelant, functions/src/index.ts). Firebase
// Auth porte l'identite de connexion (email, fournisseurs, blocage) ; `users/{uid}`
// porte les droits. Chaque changement laisse une ligne `auditLogs` (via `ui`).
//
// Garde-fous : on ne retire pas son propre role staff, on ne bloque pas son
// propre compte, et il reste toujours au moins un compte staff.

const db = () => getFirestore();

/** Ligne d'audit : dans la transaction `tx` si elle est fournie, sinon ecrite seule. */
function audit(
  tx: Transaction | null,
  actorUid: string,
  action: string,
  targetPath: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const log: AuditLog = {
    actorUid,
    apiKeyId: null,
    via: "ui",
    action,
    targetPath,
    payload,
    idempotencyKey: null,
    dateISOString: new Date().toISOString(),
  };
  const ref = db().collection(COL.auditLogs).doc();
  if (!tx) return ref.create(log);
  tx.create(ref, log);
  return Promise.resolve();
}

/** Valide et normalise des droits recus du client. */
export function parseAccess(input: { roles?: unknown; investorAccess?: unknown }): AccountAccess {
  if (!Array.isArray(input.roles) || !input.roles.every((r) => (USER_ROLES as readonly unknown[]).includes(r))) {
    throw new HttpsError("invalid-argument", `\`roles\` must be a list of ${USER_ROLES.join(", ")}.`);
  }
  const roles = [...new Set(input.roles as UserRole[])];
  if (!roles.includes("investor")) return { roles, investorAccess: null };
  if (input.investorAccess !== "ic" && input.investorAccess !== "portfolio") {
    throw new HttpsError("invalid-argument", "An investor needs an access level: `ic` or `portfolio`.");
  }
  return { roles, investorAccess: input.investorAccess };
}

function newUserDoc(now: string, access: AccountAccess): User {
  return { personId: null, ...access, loginCount: 0, createdDateISOString: now, lastSeenDateISOString: now };
}

/** Refuse un changement qui laisserait la plateforme sans staff, ou qui retire son propre acces. */
async function assertKeepsStaff(tx: Transaction, actorUid: string, targetUid: string, losesStaff: boolean) {
  if (!losesStaff) return;
  if (targetUid === actorUid) throw new HttpsError("failed-precondition", "You cannot remove your own staff access.");
  const staff = await tx.get(db().collection(COL.users).where("roles", "array-contains", "staff"));
  if (staff.docs.every((d) => d.id === targetUid)) {
    throw new HttpsError("failed-precondition", "At least one staff account must remain.");
  }
}

export async function listAccounts(): Promise<AccountRow[]> {
  const authUsers: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    authUsers.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  const [userDocs, memberships] = await Promise.all([
    authUsers.length ? db().getAll(...authUsers.map((u) => db().doc(`${COL.users}/${u.uid}`))) : Promise.resolve([]),
    db().collection(COL.batchMemberships).get(),
  ]);
  const usersById = new Map(userDocs.filter((d) => d.exists).map((d) => [d.id, d.data() as User]));
  const founderOf = new Map<string, AccountRow["founderOf"]>();
  for (const doc of memberships.docs) {
    const m = doc.data() as BatchMembership;
    founderOf.set(m.uid, [...(founderOf.get(m.uid) ?? []), { programId: m.programId, batchId: m.batchId, founderId: m.founderId }]);
  }

  return authUsers
    .map((u): AccountRow => {
      const user = usersById.get(u.uid);
      return {
        uid: u.uid,
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        photoUrl: u.photoURL ?? null,
        disabled: u.disabled,
        emailVerified: u.emailVerified,
        providers: u.providerData.map((p) => p.providerId),
        createdDateISOString: new Date(u.metadata.creationTime).toISOString(),
        lastSignInDateISOString: u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null,
        roles: user?.roles ?? [],
        investorAccess: user?.investorAccess ?? null,
        personId: user?.personId ?? null,
        founderOf: founderOf.get(u.uid) ?? [],
      };
    })
    .sort((a, b) => (a.email ?? a.uid).localeCompare(b.email ?? b.uid));
}

export async function setAccountAccess(actorUid: string, uid: string, access: AccountAccess): Promise<void> {
  await getAuth()
    .getUser(uid)
    .catch(() => {
      throw new HttpsError("not-found", "No such account.");
    });
  const ref = db().doc(`${COL.users}/${uid}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists ? (snap.data() as User) : null;
    await assertKeepsStaff(tx, actorUid, uid, Boolean(before?.roles.includes("staff")) && !access.roles.includes("staff"));
    if (before) tx.update(ref, { ...access });
    else tx.create(ref, newUserDoc(new Date().toISOString(), access));
    audit(tx, actorUid, "account.setAccess", ref.path, {
      before: before ? { roles: before.roles, investorAccess: before.investorAccess } : null,
      after: access,
    });
  });
}

export async function inviteAccount(actorUid: string, rawEmail: string, access: AccountAccess) {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument", "A valid email is required.");
  let created = false;
  const user = await getAuth()
    .getUserByEmail(email)
    .catch(async (err: { code?: string }) => {
      if (err.code !== "auth/user-not-found") throw err;
      created = true;
      return getAuth().createUser({ email });
    });
  const ref = db().doc(`${COL.users}/${user.uid}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists ? (snap.data() as User) : null;
    await assertKeepsStaff(tx, actorUid, user.uid, Boolean(before?.roles.includes("staff")) && !access.roles.includes("staff"));
    if (before) tx.update(ref, { ...access });
    else tx.create(ref, newUserDoc(new Date().toISOString(), access));
    audit(tx, actorUid, "account.invite", ref.path, { email, created, after: access });
  });
  return { uid: user.uid, created };
}

export async function setAccountDisabled(actorUid: string, uid: string, disabled: boolean): Promise<void> {
  if (disabled && uid === actorUid) throw new HttpsError("failed-precondition", "You cannot block your own account.");
  await getAuth()
    .updateUser(uid, { disabled })
    .catch(() => {
      throw new HttpsError("not-found", "No such account.");
    });
  // Bloque : les sessions en cours tombent au prochain rafraichissement du jeton.
  if (disabled) await getAuth().revokeRefreshTokens(uid);
  await audit(null, actorUid, disabled ? "account.disable" : "account.enable", `${COL.users}/${uid}`, { disabled });
}
