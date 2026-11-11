// ----------------------------
// Verification des regles Firestore, role par role (emulateurs + seed)
// ----------------------------
// npm run check:rules  (lance les emulateurs, le seed, puis ce script)
//
// Chaque cas dit ce qu'un role DOIT pouvoir lire et ce qu'il NE DOIT PAS. Code
// de sortie 1 au premier ecart.

import { initializeApp as initAdmin } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithCustomToken } from "firebase/auth";
import {
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const PROJECT_ID = "demo-pioneers-hub";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9199";
initAdmin({ projectId: PROJECT_ID });

// Adresses des emulateurs : celles que `firebase emulators:exec` fournit, sinon
// les ports de firebase.json. Permet de verifier sur une suite neuve a ports
// decales (.firebase-check.json) sans arreter les emulateurs de dev.
const hostPort = (value, fallbackPort) => {
  const [host, port] = (value ?? `127.0.0.1:${fallbackPort}`).split(":");
  return { host, port: Number(port) };
};
const AUTH_EMU = hostPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, 9199);
const FIRESTORE_EMU = hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8180);
const FUNCTIONS_EMU = hostPort(process.env.FUNCTIONS_EMULATOR_HOST, 5101);

let failures = 0;
async function expectOk(label, fn) {
  try {
    const result = await fn();
    console.log(`  ok    ${label}${result !== undefined ? ` (${result})` : ""}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${label}: expected success, got ${err.code ?? err.message}`);
  }
}
async function expectDenied(label, fn) {
  try {
    await fn();
    failures++;
    console.log(`  FAIL  ${label}: expected permission-denied, got success`);
  } catch (err) {
    if (err.code === "permission-denied") console.log(`  ok    ${label} (denied)`);
    else {
      failures++;
      console.log(`  FAIL  ${label}: expected permission-denied, got ${err.code ?? err.message}`);
    }
  }
}

async function clientAs(uid) {
  const app = initializeApp({ projectId: PROJECT_ID, apiKey: "demo-key" }, `client-${uid ?? "public"}-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_EMU.host}:${AUTH_EMU.port}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FIRESTORE_EMU.host, FIRESTORE_EMU.port);
  const functions = getFunctions(app, "europe-west4");
  connectFunctionsEmulator(functions, FUNCTIONS_EMU.host, FUNCTIONS_EMU.port);
  if (uid) await signInWithCustomToken(auth, await getAdminAuth().createCustomToken(uid));
  return { app, db, functions };
}

const foundersOfBatch = (db) => query(collection(db, "founders"), where("batchId", "==", "fall-2026"));
const publicFounders = (db) =>
  query(collection(db, "founders"), where("batchId", "==", "fall-2026"), where("publicProfileConsent", "==", true));
const count = async (q) => (await getDocs(q)).size;
const read = async (ref) => {
  const snap = await getDoc(ref);
  return snap.exists() ? "exists" : "missing";
};

const weeklyResponses = (db) =>
  query(collection(db, "formResponses"), where("formKind", "==", "weekly_update"));

// ---- Public -----------------------------------------------------------------
console.log("public (not signed in)");
{
  const { app, db } = await clientAs(null);
  await expectOk("read program", () => read(doc(db, "programs/accelerator")));
  await expectOk("list consenting founders", () => count(publicFounders(db)));
  await expectDenied("list ALL founders", () => count(foundersOfBatch(db)));
  await expectDenied("read non-consenting founder", () => read(doc(db, "founders/eva-private")));
  await expectDenied("read a founder directory", () => read(doc(db, "founders/ada-example/private/directory")));
  await expectDenied("read a founder private profile", () => read(doc(db, "founders/ada-example/private/profile")));
  await expectOk("read startup", () => read(doc(db, "startups/lumen")));
  await expectDenied("read startup profile", () => read(doc(db, "startups/lumen/private/profile")));
  await expectDenied("read scores", () => read(doc(db, "scores/founder_ada-example")));
  await expectOk("list leaderboards of the batch (visible)", () =>
    count(query(collection(db, "leaderboards"), where("batchId", "==", "fall-2026"))),
  );
  await expectOk("list open forms of the batch", () =>
    count(query(collection(db, "forms"), where("batchId", "==", "fall-2026"), where("status", "==", "open"))),
  );
  await expectOk("list active batches", () => count(query(collection(db, "batches"), where("archivedDateISOString", "==", null))));
  await expectDenied("list unclaimed profiles (signed out)", () =>
    count(query(collection(db, "founders"), where("batchId", "==", "fall-2026"), where("uid", "==", null))),
  );
  await deleteApp(app);
}

// ---- Fondatrice rattachee ---------------------------------------------------
console.log("founder (ada, member of lumen)");
{
  const { app, db } = await clientAs("ada-1");
  await expectOk("read own membership", () => read(doc(db, "batchMemberships/fall-2026_ada-1")));
  await expectOk("list ALL founders of her batch", () => count(foundersOfBatch(db)));
  await expectOk("read non-consenting founder", () => read(doc(db, "founders/eva-private")));
  await expectOk("read ANOTHER founder directory (profile book)", () =>
    read(doc(db, "founders/ben-sample/private/directory")),
  );
  await expectOk("read OWN private profile", () => read(doc(db, "founders/ada-example/private/profile")));
  await expectDenied("read another founder private profile", () => read(doc(db, "founders/ben-sample/private/profile")));
  await expectDenied("read own internal record", () => read(doc(db, "founders/ada-example/private/internal")));
  await expectOk("read her startup profile", () => read(doc(db, "startups/lumen/private/profile")));
  await expectOk("read her startup KPIs", () => read(doc(db, "kpiSeries/lumen")));
  await expectOk("read her startup weekly update", () => read(doc(db, "checkins/lumen_2026-11-16_ada-example")));
  await expectOk("read her startup metric snapshot", () => read(doc(db, "metricSnapshots/lumen_revenue_2026-11-16")));
  await expectOk("read dated team memberships", () => read(doc(db, "memberships/lumen_ada-example_2026-11-25")));
  await expectOk("read her own identity", () => read(doc(db, "people/person-ada-example")));
  await expectDenied("read another founder identity", () => read(doc(db, "people/person-ben-sample")));
  await expectDenied("read another founder weekly tracking", () => read(doc(db, "founderWeeks/ben-sample_2026-11-16")));
  await expectDenied("read startup internal record", () => read(doc(db, "startups/lumen/private/internal")));
  await expectDenied("read scores", () => read(doc(db, "scores/founder_ada-example")));
  await expectDenied("read notes", () => read(doc(db, "notes/demo-note")));
  await expectDenied("query attendance across sessions", () =>
    count(query(collectionGroup(db, "attendance"), where("founderId", "==", "ada-example"))),
  );
  await expectOk("update her own last visit", () =>
    setDoc(doc(db, "users/ada-1"), { lastSeenDateISOString: new Date().toISOString() }, { merge: true }),
  );
  await expectDenied("grant herself staff", () => setDoc(doc(db, "users/ada-1"), { roles: ["staff"] }, { merge: true }));
  await expectDenied("grant herself IC access", () =>
    setDoc(doc(db, "users/ada-1"), { investorAccess: "ic" }, { merge: true }),
  );
  await expectDenied("write a founder", () => setDoc(doc(db, "founders/ada-example"), { name: "x" }, { merge: true }));
  await expectOk("list her teams (dated memberships)", () =>
    count(query(collection(db, "memberships"), where("batchId", "==", "fall-2026"), where("founderId", "==", "ada-example"))),
  );
  await expectOk("list her own memberships", () =>
    count(query(collection(db, "batchMemberships"), where("uid", "==", "ada-1"))),
  );
  await expectOk("edit her own skills", () =>
    setDoc(doc(db, "founders/ada-example"), { hardSkills: ["Backend"], updatedDateISOString: new Date().toISOString() }, { merge: true }),
  );
  await expectDenied("change her own status", () =>
    setDoc(doc(db, "founders/ada-example"), { status: "alumni" }, { merge: true }),
  );
  await expectDenied("edit another founder's skills", () =>
    setDoc(doc(db, "founders/ben-sample"), { hardSkills: ["Sales"] }, { merge: true }),
  );
  await expectOk("edit her own introduction", () =>
    setDoc(doc(db, "founders/ada-example/private/directory"), { introduceYourself: "Hello" }, { merge: true }),
  );
  await expectDenied("edit her own directory email (account key)", () =>
    setDoc(doc(db, "founders/ada-example/private/directory"), { email: "x@y.z" }, { merge: true }),
  );
  await expectDenied("edit the WhatsApp copy without the original", () =>
    setDoc(doc(db, "founders/ada-example/private/directory"), { whatsapp: "+33600000000" }, { merge: true }),
  );
  await expectOk("edit WhatsApp in identity and copy together", async () => {
    const b = writeBatch(db);
    b.set(doc(db, "people/person-ada-example"), { whatsapp: "+33600000001", updatedDateISOString: new Date().toISOString() }, { merge: true });
    b.set(doc(db, "founders/ada-example/private/directory"), { whatsapp: "+33600000001" }, { merge: true });
    await b.commit();
  });
  await expectDenied("edit the phone copy without the original", () =>
    setDoc(doc(db, "founders/ada-example/private/directory"), { phone: "+33600000002" }, { merge: true }),
  );
  await expectOk("edit phone in identity and copy together", async () => {
    const b = writeBatch(db);
    b.set(doc(db, "people/person-ada-example"), { phone: "+33600000003", updatedDateISOString: new Date().toISOString() }, { merge: true });
    b.set(doc(db, "founders/ada-example/private/directory"), { phone: "+33600000003" }, { merge: true });
    await b.commit();
  });
  await expectDenied("set her own Slack id (staff only)", () =>
    setDoc(doc(db, "founders/ada-example/private/directory"), { slackUserId: "U000" }, { merge: true }),
  );
  await expectOk("edit her own T-shirt size", () =>
    setDoc(doc(db, "founders/ada-example/private/profile"), { tShirtSize: "M" }, { merge: true }),
  );
  await expectDenied("edit her own age", () =>
    setDoc(doc(db, "founders/ada-example/private/profile"), { age: 20 }, { merge: true }),
  );
  await deleteApp(app);
}

// ---- Investor IC ------------------------------------------------------------
console.log("investor (IC access)");
{
  const { app, db } = await clientAs("ic-1");
  await expectOk("list ALL founders", () => count(foundersOfBatch(db)));
  await expectOk("read founder directory", () => read(doc(db, "founders/ada-example/private/directory")));
  await expectOk("read founder private profile", () => read(doc(db, "founders/ada-example/private/profile")));
  await expectOk("read founder internal record", () => read(doc(db, "founders/ada-example/private/internal")));
  await expectOk("read startup profile", () => read(doc(db, "startups/lumen/private/profile")));
  await expectOk("read startup internal record", () => read(doc(db, "startups/lumen/private/internal")));
  await expectOk("read KPIs", () => read(doc(db, "kpiSeries/lumen")));
  await expectOk("read scores", () => read(doc(db, "scores/founder_ada-example")));
  await expectOk("read notes", () => read(doc(db, "notes/demo-note")));
  await expectOk("read score signals", () => read(doc(db, "scoreSignals/founder_ada-example")));
  await expectOk("read a founder identity", () => read(doc(db, "people/person-ben-sample")));
  await expectOk("read a founder weekly tracking", () => read(doc(db, "founderWeeks/ben-sample_2026-11-16")));
  await expectOk("read mentors", () => read(doc(db, "mentors/mia-mentor")));
  await expectOk("list weekly updates", () => count(weeklyResponses(db)));
  await expectDenied("read a peer feedback response", () => read(doc(db, "formResponses/demo-peer")));
  await expectDenied("write a founder", () => setDoc(doc(db, "founders/ada-example"), { name: "x" }, { merge: true }));
  await deleteApp(app);
}

// ---- Investor portfolio -----------------------------------------------------
console.log("investor (portfolio access)");
{
  const { app, db } = await clientAs("lp-1");
  await expectOk("list ALL founders", () => count(foundersOfBatch(db)));
  await expectOk("read founder directory", () => read(doc(db, "founders/ada-example/private/directory")));
  await expectDenied("read founder private profile", () => read(doc(db, "founders/ada-example/private/profile")));
  await expectDenied("read founder internal record", () => read(doc(db, "founders/ada-example/private/internal")));
  await expectOk("read startup profile", () => read(doc(db, "startups/lumen/private/profile")));
  await expectDenied("read startup internal record", () => read(doc(db, "startups/lumen/private/internal")));
  await expectOk("read KPIs", () => read(doc(db, "kpiSeries/lumen")));
  await expectOk("read scores", () => read(doc(db, "scores/founder_ada-example")));
  await expectDenied("read score signals (staff judgements)", () => read(doc(db, "scoreSignals/founder_ada-example")));
  await expectOk("read a weekly update", () => read(doc(db, "checkins/lumen_2026-11-16_ada-example")));
  await expectOk("read a metric snapshot", () => read(doc(db, "metricSnapshots/lumen_revenue_2026-11-16")));
  await expectDenied("read a founder identity", () => read(doc(db, "people/person-ben-sample")));
  await expectDenied("read a founder weekly tracking", () => read(doc(db, "founderWeeks/ben-sample_2026-11-16")));
  await expectDenied("read notes", () => read(doc(db, "notes/demo-note")));
  await expectDenied("query attendance across sessions", () =>
    count(query(collectionGroup(db, "attendance"), where("founderId", "==", "ada-example"))),
  );
  await expectDenied("read mentors", () => read(doc(db, "mentors/mia-mentor")));
  await expectDenied("list weekly updates", () => count(weeklyResponses(db)));
  await deleteApp(app);
}

// ---- Mentor (pas d'acces en v1) ---------------------------------------------
console.log("mentor (no access in v1)");
{
  const { app, db } = await clientAs("mentor-1");
  await expectDenied("list ALL founders", () => count(foundersOfBatch(db)));
  await expectDenied("read founder directory", () => read(doc(db, "founders/ada-example/private/directory")));
  await expectDenied("read scores", () => read(doc(db, "scores/founder_ada-example")));
  await expectDenied("read own mentor record", () => read(doc(db, "mentors/mia-mentor")));
  await deleteApp(app);
}

// ---- Connecte sans profil ---------------------------------------------------
console.log("signed in, no profile (stranger)");
{
  const { app, db } = await clientAs("stranger-1");
  const blank = { personId: null, investorAccess: null, loginCount: 0 };
  await expectDenied("create own user doc as staff", () =>
    setDoc(doc(db, "users/stranger-1"), { ...blank, roles: ["staff"] }),
  );
  await expectDenied("create own user doc as IC investor", () =>
    setDoc(doc(db, "users/stranger-1"), { ...blank, roles: [], investorAccess: "ic" }),
  );
  await expectOk("create own user doc", () => setDoc(doc(db, "users/stranger-1"), { ...blank, roles: [] }));
  await expectOk("read own (missing) membership", () => read(doc(db, "batchMemberships/fall-2026_stranger-1")));
  await expectDenied("read someone else's membership", () => read(doc(db, "batchMemberships/fall-2026_ada-1")));
  await expectDenied("list ALL founders", () => count(foundersOfBatch(db)));
  await deleteApp(app);
}

// ---- Rattachement par email -------------------------------------------------
console.log("account claim by email (gina, unclaimed profile)");
{
  const { app, db } = await clientAs("gina-1");
  const now = new Date().toISOString();
  const claim = (founderId, personId) => {
    const b = writeBatch(db);
    b.set(doc(db, `founders/${founderId}`), { uid: "gina-1", claimedDateISOString: now, updatedDateISOString: now }, { merge: true });
    b.set(doc(db, `people/${personId}`), { uid: "gina-1", updatedDateISOString: now }, { merge: true });
    b.set(doc(db, "batchMemberships/fall-2026_gina-1"), {
      programId: "accelerator",
      batchId: "fall-2026",
      uid: "gina-1",
      founderId,
      createdDateISOString: now,
    });
    b.set(doc(db, "users/gina-1"), { personId }, { merge: true });
    return b.commit();
  };
  await expectOk("find her identity by email", () =>
    count(query(collection(db, "people"), where("email", "==", "gina-unclaimed@pioneers.test"))),
  );
  await expectDenied("find someone else's identity by email", () =>
    count(query(collection(db, "people"), where("email", "==", "eva-private@pioneers.test"))),
  );
  await expectOk("claim her own profile (founder + identity + membership + account)", () =>
    claim("gina-unclaimed", "person-gina-unclaimed"),
  );
  await expectOk("then list ALL founders of her batch", () => count(foundersOfBatch(db)));
  await deleteApp(app);
}

// ---- Demande de rattachement --------------------------------------------------
console.log("claim request (stranger, chooses a profile)");
{
  const { app, db } = await clientAs("stranger-1");
  const now = new Date().toISOString();
  const request = (founderId, overrides = {}) =>
    setDoc(doc(db, "claimRequests/fall-2026_stranger-1"), {
      programId: "accelerator",
      batchId: "fall-2026",
      uid: "stranger-1",
      founderId,
      email: "stranger@pioneers.test",
      displayName: "Stan Stranger",
      status: "pending",
      createdDateISOString: now,
      decidedByUid: null,
      decidedDateISOString: null,
      ...overrides,
    });
  await expectOk("list unclaimed profiles of a batch", () =>
    count(query(collection(db, "founders"), where("batchId", "==", "fall-2026"), where("uid", "==", null))),
  );
  await expectDenied("read an unclaimed profile's directory", () => read(doc(db, "founders/eva-private/private/directory")));
  await expectDenied("request an already claimed profile", () => request("ada-example"));
  await expectDenied("request with status approved", () => request("eva-private", { status: "approved" }));
  await expectOk("request an unclaimed profile", () => request("eva-private"));
  await expectOk("switch to another unclaimed profile", () => request("finn-private"));
  await expectOk("read own request", () => read(doc(db, "claimRequests/fall-2026_stranger-1")));
  await expectDenied("approve own request", () =>
    setDoc(doc(db, "claimRequests/fall-2026_stranger-1"), { status: "approved" }, { merge: true }),
  );
  const pick = (founderId) => {
    const b = writeBatch(db);
    b.set(doc(db, `founders/${founderId}`), { uid: "stranger-1", claimedDateISOString: now, updatedDateISOString: now }, { merge: true });
    b.set(doc(db, `people/person-${founderId}`), { uid: "stranger-1", updatedDateISOString: now }, { merge: true });
    b.set(doc(db, "batchMemberships/fall-2026_stranger-1"), {
      programId: "accelerator",
      batchId: "fall-2026",
      uid: "stranger-1",
      founderId,
      createdDateISOString: now,
    });
    return b.commit();
  };
  await expectOk("pick a profile in the list (Tricount): founder + identity + membership", () => pick("eva-private"));
  await expectOk("then read the batch directory", () => read(doc(db, "founders/ben-sample/private/directory")));
  await expectDenied("pick a second profile in the same batch", () => pick("finn-private"));
  await deleteApp(app);
}

// ---- Email non confirme -----------------------------------------------------
console.log("unverified email (password account)");
{
  const { app, db } = await clientAs("unverified-1");
  await expectDenied("pick a profile before confirming the email", () =>
    setDoc(doc(db, "founders/finn-private"), { uid: "unverified-1", claimedDateISOString: new Date().toISOString() }, { merge: true }),
  );
  await expectDenied("request a profile before confirming the email", () =>
    setDoc(doc(db, "claimRequests/fall-2026_unverified-1"), {
      programId: "accelerator",
      batchId: "fall-2026",
      uid: "unverified-1",
      founderId: "finn-private",
      email: "unverified@pioneers.test",
      displayName: "Uma Unverified",
      status: "pending",
      createdDateISOString: new Date().toISOString(),
      decidedByUid: null,
      decidedDateISOString: null,
    }),
  );
  await deleteApp(app);
}

// ---- Staff ------------------------------------------------------------------
console.log("staff");
{
  const { app, db, functions } = await clientAs("staff-1");
  await expectOk("list ALL founders", () => count(foundersOfBatch(db)));
  await expectOk("read founder internal record", () => read(doc(db, "founders/ada-example/private/internal")));
  await expectOk("read startup internal record", () => read(doc(db, "startups/lumen/private/internal")));
  await expectOk("read a peer feedback response", () => read(doc(db, "formResponses/demo-peer")));
  await expectOk("list pending claim requests", () =>
    count(query(collection(db, "claimRequests"), where("status", "==", "pending"))),
  );
  await expectOk("list accounts", () => count(collection(db, "users")));
  await expectOk("query a founder's attendance across sessions", () =>
    count(query(collectionGroup(db, "attendance"), where("founderId", "==", "ada-example"))),
  );
  await expectOk("query the evaluations of a startup", () =>
    count(query(collectionGroup(db, "evaluations"), where("targetId", "==", "lumen"))),
  );
  await expectOk("callable health", async () => {
    const { data } = await httpsCallable(functions, "health")({});
    return `${data.region}, uid=${data.uid}`;
  });
  await deleteApp(app);
}

// ---- Cles d'API : chacun lit les siennes ---------------------------------------
console.log("api keys (each account reads its own)");
{
  const { getFirestore: adminFirestore } = await import("firebase-admin/firestore");
  const adb = adminFirestore();
  const key = (ownerUid) => ({
    ownerUid,
    name: `${ownerUid} key`,
    prefix: "ph_live_test",
    keyHash: `hash-${ownerUid}`,
    createdDateISOString: new Date().toISOString(),
    lastUsedDateISOString: null,
    revokedDateISOString: null,
  });
  await adb.doc("apiKeys/check-ada").set(key("ada-1"));
  await adb.doc("apiKeys/check-staff").set(key("staff-1"));
  const { app, db } = await clientAs("ada-1");
  await expectOk("founder lists own API keys", () => count(query(collection(db, "apiKeys"), where("ownerUid", "==", "ada-1"))));
  await expectDenied("founder reads another account's API key", () => read(doc(db, "apiKeys/check-staff")));
  await expectDenied("founder lists all API keys", () => count(collection(db, "apiKeys")));
  await deleteApp(app);
}

console.log(failures === 0 ? "\nall rules checks passed" : `\n${failures} rules check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
