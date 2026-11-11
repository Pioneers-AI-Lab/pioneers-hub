import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { COL } from "../shared/collections";
import { canUseApi } from "../shared/access";
import type { OAuthCode, OAuthRequest } from "../shared/types";
import { secret, sha256 } from "../api/crypto";
import { loadViewer } from "../api/viewer";
import { TTL, isExpired, isoIn, redirectWith } from "./store";

// ----------------------------
// oauth - le consentement
// ----------------------------
// La page `/oauth/consent` du front (la personne y est deja connectee avec son
// compte Google) appelle ces deux callables : decrire la demande, puis la
// trancher. Accepter emet un code a usage unique et rend l'adresse de retour
// du client ; refuser y renvoie `access_denied`.
//
// Qui peut accepter : `canUseApi` (shared/access.ts), la regle de l'API elle-meme.
// Le refus est dit a l'ecran, avant tout clic.

const CANNOT_USE = "Claude access to Pioneers Hub is open to staff accounts only for now.";

function requestRef(requestId: string) {
  if (!requestId || requestId.includes("/")) throw new HttpsError("invalid-argument", "`requestId` is required.");
  return getFirestore().doc(`${COL.oauthRequests}/${requestId}`);
}

/** La demande, si elle attend encore une reponse. */
function assertPending(request: OAuthRequest | undefined): OAuthRequest {
  if (!request) throw new HttpsError("not-found", "This authorization request does not exist. Start the connection again from Claude.");
  if (request.status !== "pending") throw new HttpsError("failed-precondition", "This authorization request was already answered.");
  if (isExpired(request.expiresDateISOString)) {
    throw new HttpsError("deadline-exceeded", "This authorization request has expired. Start the connection again from Claude.");
  }
  return request;
}

export async function describeRequest(uid: string, requestId: string) {
  const ref = requestRef(requestId);
  const [snap, viewer] = await Promise.all([ref.get(), loadViewer(uid)]);
  const request = assertPending(snap.data() as OAuthRequest | undefined);
  const canApprove = canUseApi(viewer);
  return { clientName: request.clientName, redirectHost: new URL(request.redirectUri).host, canApprove, reason: canApprove ? null : CANNOT_USE };
}

export async function decideRequest(uid: string, requestId: string, approve: boolean): Promise<{ redirectUrl: string }> {
  const ref = requestRef(requestId);
  if (approve && !canUseApi(await loadViewer(uid))) throw new HttpsError("permission-denied", CANNOT_USE);

  const db = getFirestore();
  const code = secret();
  // Lire, verifier et repondre dans la meme transaction : une demande n'est tranchee qu'une fois.
  const request = await db.runTransaction(async (tx) => {
    const pending = assertPending((await tx.get(ref)).data() as OAuthRequest | undefined);
    tx.update(ref, { status: approve ? "approved" : "denied", uid });
    if (approve) {
      const doc: OAuthCode = {
        requestId,
        uid,
        clientId: pending.clientId,
        clientName: pending.clientName,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        resource: pending.resource,
        grantId: null,
        usedDateISOString: null,
        expiresDateISOString: isoIn(TTL.code),
      };
      tx.create(db.doc(`${COL.oauthCodes}/${sha256(code)}`), doc);
    }
    return pending;
  });

  return {
    redirectUrl: approve
      ? redirectWith(request.redirectUri, request.state, { code })
      : redirectWith(request.redirectUri, request.state, { error: "access_denied", error_description: "The user declined." }),
  };
}
