// ----------------------------
// Verification des regles Firestore, role par role (emulateurs + seed)
// ----------------------------
// npm run check:rules  (lance les emulateurs, le seed, puis ce script)
//
// Chaque cas dit ce qu'un role DOIT pouvoir lire et ce qu'il NE DOIT PAS. Code
// de sortie 1 au premier ecart.

import { initializeApp as initAdmin } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
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
  updateDoc,
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
  await expectOk("read her startup metric snapshot", () => read(doc(db, "metricSnapshots/lumen_totalAmountPaid_2026-11-16")));
  await expectOk("read dated team memberships", () => read(doc(db, "memberships/lumen_ada-example_2026-11-25")));
  await expectOk("read her own identity", () => read(doc(db, "people/person-ada-example")));
  await expectDenied("read another founder identity", () => read(doc(db, "people/person-ben-sample")));
  await expectDenied("read another founder weekly tracking", () => read(doc(db, "founderWeeks/ben-sample_2026-11-16")));
  await expectDenied("read startup internal record", () => read(doc(db, "startups/lumen/private/internal")));
  await expectDenied("read scores", () => read(doc(db, "scores/founder_ada-example")));
  await expectDenied("read notes", () => read(doc(db, "notes/demo-note")));
  await expectOk("query her own attendance across sessions", () =>
    count(query(collectionGroup(db, "attendance"), where("founderId", "==", "ada-example"))),
  );
  await expectOk("read her own attendance", () => read(doc(db, "events/demo-masterclass/attendance/ada-example")));
  await expectDenied("query another founder attendance", () =>
    count(query(collectionGroup(db, "attendance"), where("founderId", "==", "ben-sample"))),
  );
  await expectDenied("read another founder attendance", () => read(doc(db, "events/demo-masterclass/attendance/ben-sample")));
  await expectDenied("list the attendance of a session", () => count(query(collection(db, "events/demo-masterclass/attendance"))));
  await expectDenied("mark her own attendance", () =>
    setDoc(doc(db, "events/demo-masterclass/attendance/ada-example"), { status: "present" }, { merge: true }),
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
  await expectDenied("list weekly updates (raw responses are staff only)", () => count(weeklyResponses(db)));
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
  await expectOk("read a metric snapshot", () => read(doc(db, "metricSnapshots/lumen_totalAmountPaid_2026-11-16")));
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

// ---- Admin > Access : callables des comptes (staff seulement) ----------------
// Une callable refusee rend `functions/<code>` : on compare le code attendu.
const expectCallableError = async (label, code, fn) => {
  try {
    await fn();
    failures++;
    console.log(`  FAIL  ${label}: expected ${code}, got success`);
  } catch (err) {
    if (err.code === `functions/${code}`) console.log(`  ok    ${label} (${code})`);
    else {
      failures++;
      console.log(`  FAIL  ${label}: expected ${code}, got ${err.code ?? err.message}`);
    }
  }
};

console.log("accounts (Admin > Access callables)");
{
  const staff = await clientAs("staff-1");
  const asStaff = (name) => httpsCallable(staff.functions, name);
  await expectOk("staff lists accounts", async () => {
    const { data } = await asStaff("listAccounts")({});
    const lp = data.accounts.find((a) => a.uid === "lp-1");
    if (!lp || lp.investorAccess !== "portfolio") throw new Error("lp-1 missing or wrong access");
    return `${data.accounts.length} accounts`;
  });
  await expectOk("staff changes an investor to IC, then back", async () => {
    await asStaff("setAccountAccess")({ uid: "lp-1", roles: ["investor"], investorAccess: "ic" });
    await asStaff("setAccountAccess")({ uid: "lp-1", roles: ["investor"], investorAccess: "portfolio" });
  });
  await expectOk("staff invites a new email as mentor", async () => {
    const { data } = await asStaff("inviteAccount")({ email: "invited-check@pioneers.test", roles: ["mentor"], investorAccess: null });
    return data.created ? "created" : "existing";
  });
  await expectCallableError("investor without access level", "invalid-argument", () =>
    asStaff("setAccountAccess")({ uid: "lp-1", roles: ["investor"], investorAccess: null }),
  );
  await expectCallableError("staff removes own staff role", "failed-precondition", () =>
    asStaff("setAccountAccess")({ uid: "staff-1", roles: [], investorAccess: null }),
  );
  await expectCallableError("staff blocks own account", "failed-precondition", () =>
    asStaff("setAccountDisabled")({ uid: "staff-1", disabled: true }),
  );
  await expectOk("each change is in the audit log", async () => {
    const logs = await getAdminFirestore().collection("auditLogs").where("targetPath", "==", "users/lp-1").get();
    if (logs.size < 2) throw new Error(`expected 2 audit lines, got ${logs.size}`);
    return `${logs.size} lines`;
  });
  await deleteApp(staff.app);

  const ada = await clientAs("ada-1");
  await expectCallableError("founder lists accounts", "permission-denied", () => httpsCallable(ada.functions, "listAccounts")({}));
  await expectCallableError("founder grants herself staff", "permission-denied", () =>
    httpsCallable(ada.functions, "setAccountAccess")({ uid: "ada-1", roles: ["staff"], investorAccess: null }),
  );
  await deleteApp(ada.app);
}

// ---- Le modele standard (SPECS §2) : Debrief, jury et picks sont des formulaires ---
// Les formulaires viennent du seed (modeles Debrief, Jury, Picks). Les releves de
// metriques et le leaderboard suivent par declencheurs : on les attend.
const waitFor = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
};
let submissionSeq = 0;
const submitForm = (fns, formId, answers, extra = {}) =>
  httpsCallable(fns, "submitFormResponse")({
    formId,
    version: 1,
    submissionId: `check-submission-${String(++submissionSeq).padStart(4, "0")}`,
    answers,
    ...extra,
  });
const publicForm = async (fns, formId, extra = {}) => (await httpsCallable(fns, "getPublicForm")({ formId, ...extra })).data;

console.log("hackathon submission and peer rating (forms)");
{
  const adb = getAdminFirestore();
  const EVENT = "demo-hackathon-1";
  const FORM = "demo-debrief-1";
  const PEER = "demo-peer-1";
  const snapshotsOf = (metric) =>
    adb.collection("metricSnapshots").where("eventId", "==", EVENT).where("metric", "==", metric).get();
  const results = { metric_callsMade: 42, metric_meetingsBooked: 3, proofs: "example.com/calls", product: "https://example.com", notes: "SMB bakeries." };

  const ada = await clientAs("ada-1");
  await expectOk("founder opens the submission: her team", async () => {
    const form = await publicForm(ada.functions, FORM);
    if (form.team?.id !== "team-a" || form.targets.each_teammate.length !== 0) throw new Error(JSON.stringify(form.team));
    return `${form.questions.length} questions`;
  });
  await expectOk("founder opens the peer rating: her teammate", async () => {
    const form = await publicForm(ada.functions, PEER);
    if (form.targets.each_teammate.map((t) => t.value).join() !== "chloe-demo") throw new Error(JSON.stringify(form.targets));
  });
  await expectOk("founder sends the team results after the deadline (late)", async () => {
    await submitForm(ada.functions, FORM, results);
    const sub = (await adb.doc(`events/${EVENT}/submissions/team-a`).get()).data();
    if (sub?.metrics.callsMade !== 42 || sub.proofUrls[0] !== "https://example.com/calls" || sub.recordedSource !== "self_reported" || sub.late !== true) {
      throw new Error(JSON.stringify(sub));
    }
  });
  await expectOk("the submission is done for her teammate too", async () => {
    const done = await adb.doc(`formCompletions/${FORM}_chloe-demo`).get();
    if (!done.exists) throw new Error("no completion for the teammate");
  });
  await expectOk("founder rates her teammate", async () => {
    await submitForm(ada.functions, PEER, { "peerRating@chloe-demo": 4, "peerComment@chloe-demo": "  Ships fast.  " });
    const saved = (await adb.doc(`events/${EVENT}/peerRatings/ada-example_chloe-demo`).get()).data();
    if (saved?.rating !== 4 || saved.comment !== "Ships fast." || saved.teamId !== "team-a") throw new Error("rating not stored as sent");
  });
  await expectOk("one snapshot per metric (trigger)", () =>
    waitFor(async () => {
      const snaps = await adb.collection("metricSnapshots").where("eventId", "==", EVENT).get();
      const calls = snaps.docs.map((d) => d.data()).find((m) => m.metric === "callsMade");
      if (snaps.size !== 2 || calls?.value !== 42 || calls.source !== "self_reported") throw new Error(`${snaps.size} snapshots`);
      return `${snaps.size} snapshots`;
    }),
  );
  await expectOk("her answers come back, to correct them", async () => {
    const form = await publicForm(ada.functions, FORM);
    const peer = await publicForm(ada.functions, PEER);
    if (form.prefill.metric_callsMade !== 42 || peer.prefill["peerRating@chloe-demo"] !== 4 || !form.canResubmit) throw new Error(JSON.stringify(form.prefill));
  });
  await expectOk("a new answer keeps the date of the first one (Engagement)", async () => {
    const before = (await adb.doc(`formCompletions/${FORM}_ada-example`).get()).data();
    await submitForm(ada.functions, FORM, { ...results, notes: "Corrected." });
    const after = (await adb.doc(`formCompletions/${FORM}_ada-example`).get()).data();
    if (!before?.firstCompletedDateISOString || after?.firstCompletedDateISOString !== before.firstCompletedDateISOString || after.completedDateISOString <= before.completedDateISOString) {
      throw new Error(JSON.stringify({ before, after }));
    }
  });
  await expectCallableError("founder rates someone outside her team", "invalid-argument", () =>
    submitForm(ada.functions, PEER, { "peerRating@chloe-demo": 4, "peerRating@ben-sample": 5 }),
  );
  await expectCallableError("each teammate must be rated", "invalid-argument", () => submitForm(ada.functions, PEER, { "peerComment@chloe-demo": "No score." }));
  await expectCallableError("rating out of 1-5", "invalid-argument", () => submitForm(ada.functions, PEER, { "peerRating@chloe-demo": 9 }));
  await expectOk("founder re-reads a rating she gave", () => read(doc(ada.db, `events/${EVENT}/peerRatings/ada-example_chloe-demo`)));
  await adb.doc(`events/${EVENT}/peerRatings/chloe-demo_ada-example`).set({
    programId: "accelerator",
    batchId: "fall-2026",
    raterFounderId: "chloe-demo",
    rateeFounderId: "ada-example",
    teamId: "team-a",
    rating: 5,
    comment: null,
    submittedDateISOString: new Date().toISOString(),
  });
  await expectDenied("founder reads a rating she received", () =>
    read(doc(ada.db, `events/${EVENT}/peerRatings/chloe-demo_ada-example`)),
  );
  await expectDenied("founder reads the raw form responses", () => count(query(collection(ada.db, "formResponses"), where("formId", "==", FORM))));
  await deleteApp(ada.app);

  const pub = await clientAs(null);
  await expectCallableError("the peer rating needs an account", "permission-denied", () =>
    submitForm(pub.functions, PEER, { "peerRating@chloe-demo": 1 }, { respondent: { founderId: "ada-example" } }),
  );
  await deleteApp(pub.app);
  const lp = await clientAs("lp-1");
  await expectOk("investor has no team in the submission", async () => {
    const form = await publicForm(lp.functions, FORM);
    if (form.respondent !== null || form.team !== null) throw new Error(JSON.stringify(form.respondent));
  });
  await expectCallableError("investor answers the peer rating", "permission-denied", () => submitForm(lp.functions, PEER, { "peerRating@chloe-demo": 3 }));
  await expectDenied("investor reads the raw form responses", () => count(query(collection(lp.db, "formResponses"), where("formId", "==", FORM))));
  await deleteApp(lp.app);

  const staff = await clientAs("staff-1");
  await expectOk("staff corrects a team's results (source staff)", async () => {
    const ref = doc(staff.db, `events/${EVENT}/submissions/team-a`);
    const current = (await getDoc(ref)).data();
    await setDoc(ref, { ...current, metrics: { ...current.metrics, callsMade: 40 }, recordedByUid: "staff-1", recordedSource: "staff", submittedDateISOString: new Date().toISOString() });
    return waitFor(async () => {
      const snap = await snapshotsOf("callsMade");
      const m = snap.docs[0]?.data();
      if (snap.size !== 1 || m.value !== 40 || m.source !== "staff") throw new Error("staff snapshot wrong");
    });
  });
  await deleteApp(staff.app);
}

// ---- Leaderboard : classe par le jury ou par une metrique ----------------------
console.log("leaderboard ranking (callables)");
{
  const EVENT = "demo-hackathon-1";
  const board = async () => (await getAdminFirestore().doc(`leaderboards/${EVENT}`).get()).data();
  const rank = (fns, metricKey) => httpsCallable(fns, "setEventRanking")({ eventId: EVENT, metricKey });
  const staff = await clientAs("staff-1");
  await expectOk("staff ranks the hackathon by calls made (a debrief question)", async () => {
    await rank(staff.functions, "callsMade");
    return waitFor(async () => {
      const b = await board();
      if (b?.metric?.key !== "callsMade" || b.rows[0]?.targetId !== "team-a" || b.rows[0].score !== 40) throw new Error(JSON.stringify(b?.rows));
      return `${b.rows.length} row(s), "${b.metric.label}"`;
    });
  });
  await expectCallableError("unknown ranking metric", "invalid-argument", () => rank(staff.functions, "revenue"));
  await expectOk("staff ranks by jury scores again", async () => {
    await rank(staff.functions, null);
    const b = await board();
    if (b?.metric !== null) throw new Error("metric still set");
  });
  await deleteApp(staff.app);
  const ada = await clientAs("ada-1");
  await expectCallableError("founder changes the ranking", "permission-denied", () => rank(ada.functions, "callsMade"));
  await deleteApp(ada.app);
}

// ---- Bareme, publication, verification des preuves, scores du batch ---------------
console.log("scoring: points, late submission, proof check, publication, batch scores");
{
  const adb = getAdminFirestore();
  const EVENT = "demo-hackathon-1";
  const board = async () => (await adb.doc(`leaderboards/${EVENT}`).get()).data();
  const teamA = async () => (await board())?.rows.find((r) => r.targetId === "team-a");
  const staff = await clientAs("staff-1");
  const setScoring = (fns, items) => httpsCallable(fns, "setEventScoring")({ eventId: EVENT, scoring: { items } });
  // 40 points par rendez-vous, 1 point par appel : deux metriques de la Submission.
  const items = [
    { label: "Meetings booked", mode: "per_unit", sourceKey: "meetingsBooked", pointsPerUnit: 40 },
    { label: "Calls made", mode: "per_unit", sourceKey: "callsMade", pointsPerUnit: 1 },
  ];
  await expectCallableError("a scoring item needs a variable of the event's forms", "invalid-argument", () =>
    setScoring(staff.functions, [{ label: "Revenue", mode: "per_unit", sourceKey: "amountPaid", pointsPerUnit: 1 }]),
  );
  await expectOk("staff sets the scoring from the event page", async () => {
    await setScoring(staff.functions, items);
    const ev = (await adb.doc(`events/${EVENT}`).get()).data();
    if (ev?.scoring?.items.map((i) => i.key).join() !== "meetingsBooked,callsMade" || ev.rankingMetricKey !== null) throw new Error(JSON.stringify(ev?.scoring));
  });
  const publish = (fns, on) => httpsCallable(fns, "publishEventRanking")({ eventId: EVENT, publish: on });
  await expectOk("staff publishes the ranking: a late submission scores 0", async () => {
    await publish(staff.functions, true);
    const b = await board();
    const row = b?.rows.find((r) => r.targetId === "team-a");
    if (b?.published !== true || row?.late !== true || row.total !== 0) throw new Error(JSON.stringify(row));
  });
  await expectOk("staff waives the late submission: the points count", async () => {
    await updateDoc(doc(staff.db, `events/${EVENT}/submissions/team-a`), { lateWaived: true });
    return waitFor(async () => {
      const row = await teamA();
      if (row?.total !== 160 || row.points.meetingsBooked !== 120 || row.normalized !== 100) throw new Error(JSON.stringify(row));
      return `${row.total} pts`;
    });
  });
  await expectOk("staff sets an item to 0 after a fake proof", async () => {
    await updateDoc(doc(staff.db, `events/${EVENT}/submissions/team-a`), { zeroedItemKeys: ["meetingsBooked"] });
    return waitFor(async () => {
      const row = await teamA();
      if (row?.total !== 40 || row.points.meetingsBooked !== 0) throw new Error(JSON.stringify(row));
    });
  });
  await expectOk("staff recomputes the batch scores", async () => {
    const r = (await httpsCallable(staff.functions, "recomputeBatchScores")({ batchId: "fall-2026" })).data;
    const stats = (await adb.doc("founderStats/chloe-demo").get()).data();
    const ada = (await adb.doc("scores/founder_ada-example").get()).data();
    if (stats?.peerRating.average !== 4 || stats.peerRating.count !== 1) throw new Error(JSON.stringify(stats?.peerRating));
    if (ada?.subScores.execution !== 10) throw new Error(JSON.stringify(ada?.subScores));
    return `${r.founders} founders`;
  });
  await deleteApp(staff.app);
  const ada = await clientAs("ada-1");
  await expectCallableError("founder publishes a ranking", "permission-denied", () => publish(ada.functions, false));
  await expectCallableError("founder changes the scoring", "permission-denied", () =>
    httpsCallable(ada.functions, "setEventScoring")({ eventId: EVENT, scoring: { items: [] } }),
  );
  await expectCallableError("founder recomputes the scores", "permission-denied", () =>
    httpsCallable(ada.functions, "recomputeBatchScores")({ batchId: "fall-2026" }),
  );
  await deleteApp(ada.app);
}

// ---- Jury : le formulaire de jury, par un lien partage -------------------------------
console.log("jury (form, shared link)");
{
  const adb = getAdminFirestore();
  const EVENT = "demo-hackathon-2";
  const FORM = "demo-jury-2";
  const staff = await clientAs("staff-1");
  const asStaff = (name) => httpsCallable(staff.functions, name);
  const pub = await clientAs(null);
  const linkSecret = async () => (await getDoc(doc(staff.db, `events/${EVENT}/judges/link`))).data()?.secret;
  const board = async () => (await adb.doc(`leaderboards/${EVENT}`).get()).data();
  let key = null;
  await expectCallableError("no link yet", "permission-denied", () => publicForm(pub.functions, FORM, { key: "nope" }));
  await expectOk("staff creates the jury link and reads it back", async () => {
    await asStaff("resetJuryLink")({ eventId: EVENT });
    key = await linkSecret();
    if (typeof key !== "string" || key.length < 20) throw new Error("no secret");
    const logs = await adb.collection("auditLogs").where("action", "==", "jury.resetLink").get();
    if (logs.size === 0 || logs.docs.some((d) => JSON.stringify(d.data()).includes(key))) throw new Error("no audit line, or the secret in it");
  });
  const sheet = (respondent, k = key) => publicForm(pub.functions, FORM, { key: k, respondent });
  const score = (judge, answers, fns = pub.functions) => submitForm(fns, FORM, answers, { key, respondent: judge });
  const JANE = { name: "Jane Juror" };
  let janeId = null;
  await expectOk("the link opens without an account: names, no email", async () => {
    const data = await sheet(null);
    if (data.respondent !== null || data.targets.each_target.length !== 0 || data.state !== "open" || !data.allowTypedName) throw new Error(JSON.stringify(data));
    if (!data.respondents.some((j) => j.value === "founder-ada-example" && j.label === "Ada E.")) throw new Error("no founder in the list");
    if (JSON.stringify(data).includes("@example")) throw new Error("an email leaked");
  });
  await expectCallableError("wrong secret", "permission-denied", () => sheet(null, "nope"));
  await expectOk("an external judge types their name and sees every team", async () => {
    const data = await sheet(JANE);
    janeId = data.respondent?.judgeId;
    if (!janeId?.startsWith("jury-") || data.targets.each_target.map((t) => t.value).sort().join() !== "team-c,team-d") throw new Error(JSON.stringify(data.respondent));
    if (!data.targets.each_target.find((t) => t.value === "team-d").hint?.includes("Chloe D.")) throw new Error("members missing");
  });
  await expectCallableError("score out of the grid", "invalid-argument", () => score(JANE, { "criterion_execution@team-d": 9 }));
  await expectOk("judge scores a team, the leaderboard follows (trigger)", async () => {
    await score(JANE, { "criterion_execution@team-d": 5, "criterion_pitch@team-d": 3, "comment@team-d": "Clear." });
    return waitFor(async () => {
      const row = (await board())?.rows[0];
      // (5-1)/4*10 = 10 (poids 2), (3-1)/4*10 = 5 (poids 1) : 25/3.
      if (row?.targetId !== "team-d" || Math.abs(row.score - 25 / 3) > 1e-9) throw new Error(JSON.stringify(row));
      return row.score.toFixed(2);
    });
  });
  await expectOk("a correction is logged under the judge", async () => {
    await score(JANE, { "criterion_execution@team-d": 4, "criterion_pitch@team-d": 3 });
    const logs = await adb.collection("auditLogs").where("actorUid", "==", `jury:${janeId}`).get();
    if (logs.size !== 2 || !logs.docs.every((d) => d.data().payload?.judgeName === "Jane Juror")) throw new Error(`${logs.size} lines`);
  });
  await expectOk("the same name, typed differently, finds the same scores; then it is in the list", async () => {
    const data = await sheet({ name: "  jane   JUROR " });
    if (data.respondent?.judgeId !== janeId || data.prefill["criterion_execution@team-d"] !== 4) throw new Error(JSON.stringify(data.respondent));
    if (!data.respondents.some((j) => j.value === janeId)) throw new Error("not in the list");
    if ((await sheet({ judgeId: janeId })).respondent?.judgeId !== janeId) throw new Error("cannot pick the name");
  });
  await expectOk("a founder does not see her own team (picked or typed)", async () => {
    const picked = await sheet({ judgeId: "founder-ada-example" });
    const typed = await sheet({ name: "Ada Example" });
    if (picked.targets.each_target.map((t) => t.value).join() !== "team-d" || typed.respondent?.judgeId !== "founder-ada-example") {
      throw new Error(JSON.stringify(typed.respondent));
    }
  });
  await expectCallableError("a founder scores her own team", "invalid-argument", () =>
    score({ name: "ada example" }, { "criterion_execution@team-c": 5, "criterion_pitch@team-c": 5 }),
  );
  await expectOk("staff enters a paper sheet through the link, logged under the staff", async () => {
    await score({ name: "Paper Judge" }, { "criterion_execution@team-c": 3, "criterion_pitch@team-c": 3 }, staff.functions);
    const logs = await adb.collection("auditLogs").where("actorUid", "==", "staff-1").where("action", "==", "submit_form_response").get();
    if (!logs.docs.some((d) => d.data().payload?.judgeName === "Paper Judge")) throw new Error("no staff audit line");
  });
  await expectOk("staff deletes a mistaken score, the leaderboard follows", async () => {
    await asStaff("deleteJuryScore")({ eventId: EVENT, evaluationId: `${janeId}_team-d` });
    if ((await adb.doc(`events/${EVENT}/evaluations/${janeId}_team-d`).get()).exists) throw new Error("still there");
    const logs = await adb.collection("auditLogs").where("action", "==", "evaluation.delete").get();
    if (!logs.docs.some((d) => d.data().payload?.before?.evaluatorId === janeId)) throw new Error("not kept in the audit");
    return waitFor(async () => {
      const rows = (await board())?.rows ?? [];
      if (rows.some((r) => r.targetId === "team-d")) throw new Error(JSON.stringify(rows));
    });
  });
  await expectOk("staff locks the scores (closes the jury form)", async () => {
    await updateDoc(doc(staff.db, `forms/${FORM}`), { status: "closed" });
    if ((await sheet(JANE)).state !== "closed") throw new Error("still open");
  });
  await expectCallableError("nobody scores once locked", "failed-precondition", () => score(JANE, { "criterion_execution@team-d": 5 }));
  await expectOk("staff unlocks (opens the form again)", async () => {
    await updateDoc(doc(staff.db, `forms/${FORM}`), { status: "open" });
    if ((await sheet(JANE)).state !== "open") throw new Error("still locked");
  });
  const oldKey = key;
  await expectOk("a new link replaces the old one", async () => {
    await asStaff("resetJuryLink")({ eventId: EVENT });
    key = await linkSecret();
    if (key === oldKey) throw new Error("same secret");
    await sheet(null);
  });
  await expectCallableError("the old link stops working", "permission-denied", () => sheet(null, oldKey));
  await deleteApp(pub.app);
  await deleteApp(staff.app);

  const ada = await clientAs("ada-1");
  const asAda = (name) => httpsCallable(ada.functions, name);
  await expectCallableError("founder makes a jury link", "permission-denied", () => asAda("resetJuryLink")({ eventId: EVENT }));
  await expectDenied("founder locks the scores", () => updateDoc(doc(ada.db, `forms/${FORM}`), { status: "closed" }));
  await expectCallableError("founder deletes a score", "permission-denied", () =>
    asAda("deleteJuryScore")({ eventId: EVENT, evaluationId: "founder-ada-example_team-d" }),
  );
  await expectDenied("founder reads the jury link", () => read(doc(ada.db, `events/${EVENT}/judges/link`)));
  await deleteApp(ada.app);
}

// ---- Choix prives d'un evenement : le formulaire Picks -------------------------
console.log("picks (form)");
{
  const adb = getAdminFirestore();
  const EVENT = "demo-hackathon-2";
  const FORM = "demo-picks-2";
  const ada = await clientAs("ada-1");
  const pick = (fns, ids) => submitForm(fns, FORM, { picks: ids });
  await expectOk("founder ranks her picks", async () => {
    await pick(ada.functions, ["chloe-demo", "ben-sample"]);
    const saved = (await adb.doc(`picks/${EVENT}_ada-example`).get()).data();
    if (saved?.pickedFounderIds.join() !== "chloe-demo,ben-sample") throw new Error("not stored in order");
  });
  await expectOk("her picks come back, to change them", async () => {
    const form = await publicForm(ada.functions, FORM);
    if (form.prefill.picks?.join() !== "chloe-demo,ben-sample") throw new Error(JSON.stringify(form.prefill));
    if (form.choices.founder?.some((c) => c.value === "ada-example")) throw new Error("she can pick herself");
  });
  await expectOk("founder reads her own picks", () =>
    count(query(collection(ada.db, "picks"), where("batchId", "==", "fall-2026"), where("founderId", "==", "ada-example"))),
  );
  await adb.doc(`picks/${EVENT}_chloe-demo`).set({
    programId: "accelerator",
    batchId: "fall-2026",
    eventId: EVENT,
    founderId: "chloe-demo",
    pickedFounderIds: ["ada-example"],
    submittedDateISOString: new Date().toISOString(),
  });
  await expectDenied("founder reads someone else's picks", () => read(doc(ada.db, `picks/${EVENT}_chloe-demo`)));
  await expectCallableError("founder picks herself", "invalid-argument", () => pick(ada.functions, ["ada-example"]));
  await expectCallableError("more picks than allowed", "invalid-argument", () => pick(ada.functions, ["chloe-demo", "ben-sample", "dan-placeholder"]));
  await expectCallableError("pick outside the batch", "invalid-argument", () => pick(ada.functions, ["nobody-here"]));
  const lp = await clientAs("lp-1");
  await expectCallableError("investor submits picks", "permission-denied", () => pick(lp.functions, ["chloe-demo"]));
  await deleteApp(lp.app);
  await expectDenied("founder opens or closes the picks", () => updateDoc(doc(ada.db, `forms/${FORM}`), { status: "closed" }));
  const staff = await clientAs("staff-1");
  await expectOk("staff closes the picks (closes the form)", () => updateDoc(doc(staff.db, `forms/${FORM}`), { status: "closed" }));
  await deleteApp(staff.app);
  await expectCallableError("picks after closing", "failed-precondition", () => pick(ada.functions, ["chloe-demo"]));
  await deleteApp(ada.app);
}

// ---- Note de seance : le formulaire « Session feedback » ecrit `sessionRatings` -----
console.log("session rating (form -> sessionRatings)");
{
  const adb = getAdminFirestore();
  // Le modele tel que le staff le cree (questions COPIEES), rattache a la masterclass.
  const { FORM_TEMPLATES } = await import("../functions/lib/shared/presets/formTemplates.js");
  const { deriveAttachments } = await import("../functions/lib/shared/formRules.js");
  const template = FORM_TEMPLATES.session_feedback;
  const stamp = new Date().toISOString();
  await adb.doc("forms/check-session-feedback").set({
    programId: "accelerator",
    batchId: "fall-2026",
    createdDateISOString: stamp,
    updatedDateISOString: stamp,
    archivedDateISOString: null,
    kind: template.kind,
    title: template.title,
    description: null,
    version: 1,
    questions: template.questions,
    attachments: deriveAttachments(template.questions),
    approval: "none",
    identityCheck: "select_name",
    eventId: "demo-masterclass",
    status: "open",
    opensDateISOString: stamp,
    deadlineDateISOString: null,
  });
  const pub = await clientAs(null);
  await expectOk("a founder rates the session from the form", async () => {
    const { data } = await httpsCallable(pub.functions, "submitFormResponse")({
      formId: "check-session-feedback",
      version: 1,
      submissionId: "check-session-rating-0001",
      respondent: { founderId: "chloe-demo" },
      answers: { rating: 4, takeaway: "Price on value, not on cost." },
    });
    const rating = (await adb.doc("sessionRatings/demo-masterclass_chloe-demo").get()).data();
    if (rating?.rating !== 4 || rating.comment !== "Price on value, not on cost." || rating.batchId !== "fall-2026") {
      throw new Error(`${data.status}: ${JSON.stringify(rating)}`);
    }
    return data.status;
  });
  await deleteApp(pub.app);
  const ada = await clientAs("ada-1");
  await expectDenied("founder reads someone else's session rating", () =>
    read(doc(ada.db, "sessionRatings/demo-masterclass_chloe-demo")),
  );
  await deleteApp(ada.app);
}

// ---- Cles d'API : chacun lit les siennes ---------------------------------------
console.log("api keys (each account reads its own)");
{
  const adb = getAdminFirestore();
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
