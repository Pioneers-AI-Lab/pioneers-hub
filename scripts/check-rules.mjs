// ----------------------------
// Verification des regles Firestore, role par role (emulateurs + seed)
// ----------------------------
// npm run check:rules  (lance les emulateurs, le seed, puis ce script)
//
// Chaque cas dit ce qu'un role DOIT pouvoir lire et ce qu'il NE DOIT PAS. Code
// de sortie 1 au premier ecart.

import { createRequire } from "node:module";
import { initializeApp as initAdmin } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithCustomToken } from "firebase/auth";
import {
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
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
  // Fiches publiques, sans consentement (decision du 17/11) ; l'annuaire reste au batch.
  await expectOk("list ALL founders of a batch", () => count(foundersOfBatch(db)));
  await expectOk("read any founder card", () => read(doc(db, "founders/eva-private")));
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
  await deleteApp(app);
}

// ---- Fondatrice rattachee ---------------------------------------------------
console.log("founder (ada, member of lumen)");
{
  const { app, db } = await clientAs("ada-1");
  await expectOk("read own membership", () => read(doc(db, "batchMemberships/fall-2026_ada-1")));
  await expectOk("list ALL founders of her batch", () => count(foundersOfBatch(db)));
  await expectOk("read another founder card", () => read(doc(db, "founders/eva-private")));
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
  await expectOk("set her own repeat founder answer", () =>
    setDoc(doc(db, "founders/ada-example/private/directory"), { repeatFounder: true }, { merge: true }),
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
  await expectOk("list ALL founders (public cards)", () => count(foundersOfBatch(db)));
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
  await expectOk("list ALL founders (public cards)", () => count(foundersOfBatch(db)));
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
    if (!("photoUrl" in form.targets.each_teammate[0])) throw new Error("no teammate photo");
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
    await submitForm(ada.functions, PEER, { "peerLikability@chloe-demo": 4, "peerReliability@chloe-demo": 4, "peerComment@chloe-demo": "  Ships fast.  " });
    const saved = (await adb.doc(`events/${EVENT}/peerRatings/ada-example_chloe-demo`).get()).data();
    if (saved?.likability !== 4 || saved.reliability !== 4 || saved.comment !== "Ships fast." || saved.teamId !== "team-a") throw new Error("rating not stored as sent");
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
    if (form.prefill.metric_callsMade !== 42 || peer.prefill["peerReliability@chloe-demo"] !== 4 || !form.canResubmit) throw new Error(JSON.stringify(form.prefill));
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
    submitForm(ada.functions, PEER, { "peerLikability@chloe-demo": 4, "peerReliability@chloe-demo": 4, "peerLikability@ben-sample": 5, "peerReliability@ben-sample": 5 }),
  );
  await expectCallableError("each teammate must be rated", "invalid-argument", () => submitForm(ada.functions, PEER, { "peerComment@chloe-demo": "No score." }));
  await expectCallableError("each score is required", "invalid-argument", () => submitForm(ada.functions, PEER, { "peerLikability@chloe-demo": 4 }));
  await expectCallableError("rating out of 1-5", "invalid-argument", () => submitForm(ada.functions, PEER, { "peerLikability@chloe-demo": 9, "peerReliability@chloe-demo": 4 }));
  await expectOk("founder re-reads a rating she gave", () => read(doc(ada.db, `events/${EVENT}/peerRatings/ada-example_chloe-demo`)));
  await adb.doc(`events/${EVENT}/peerRatings/chloe-demo_ada-example`).set({
    programId: "accelerator",
    batchId: "fall-2026",
    raterFounderId: "chloe-demo",
    rateeFounderId: "ada-example",
    teamId: "team-a",
    likability: 5,
    reliability: 5,
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
    submitForm(pub.functions, PEER, { "peerLikability@chloe-demo": 1, "peerReliability@chloe-demo": 1 }, { respondent: { founderId: "ada-example" } }),
  );
  await deleteApp(pub.app);
  const lp = await clientAs("lp-1");
  await expectOk("investor has no team in the submission", async () => {
    const form = await publicForm(lp.functions, FORM);
    if (form.respondent !== null || form.team !== null) throw new Error(JSON.stringify(form.respondent));
  });
  await expectCallableError("investor answers the peer rating", "permission-denied", () => submitForm(lp.functions, PEER, { "peerLikability@chloe-demo": 3, "peerReliability@chloe-demo": 3 }));
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
console.log("scoring: former points per unit, late submission, former proof check, publication, batch scores");
{
  const adb = getAdminFirestore();
  const EVENT = "demo-hackathon-1";
  const board = async () => (await adb.doc(`leaderboards/${EVENT}`).get()).data();
  const teamA = async () => (await board())?.rows.find((r) => r.targetId === "team-a");
  const staff = await clientAs("staff-1");
  const setScoring = (fns, items) => httpsCallable(fns, "setEventScoring")({ eventId: EVENT, scoring: { items } });
  // Un bareme d'avant le 17/11 (40 points par rendez-vous, 1 point par appel : deux metriques de la
  // Submission), pose comme par l'import : retire, il se garde et se calcule encore, mais ne se cree plus.
  const items = [
    { label: "Meetings booked", mode: "per_unit", sourceKey: "meetingsBooked", pointsPerUnit: 40 },
    { label: "Calls made", mode: "per_unit", sourceKey: "callsMade", pointsPerUnit: 1 },
  ];
  await expectCallableError("a new per-unit item is refused (retired 17/11)", "invalid-argument", () => setScoring(staff.functions, items));
  await expectCallableError("a scoring item needs a variable of the event's forms", "invalid-argument", () =>
    setScoring(staff.functions, [{ label: "Revenue", mode: "criterion", sourceKey: "amountPaid", maxPoints: 20 }]),
  );
  const { scoringFrom } = createRequire(import.meta.url)("../functions/lib/shared/scoringRules.js");
  await adb.doc(`events/${EVENT}`).update({ scoring: scoringFrom(items) });
  await expectCallableError("a former item cannot change its points", "invalid-argument", () =>
    setScoring(staff.functions, [{ ...items[0], pointsPerUnit: 50 }, items[1]]),
  );
  await expectOk("staff saves a former scoring again (kept as it is)", async () => {
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
  await expectOk("an item set to 0 before 17/11 (former proof check) still counts 0", async () => {
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
    if (stats?.peerRating.reliability.average !== 4 || stats.peerRating.reliability.count !== 1 || stats.peerRating.likability.average !== 4) throw new Error(JSON.stringify(stats?.peerRating));
    // Sur 100 (17/11) : la note de son equipe, seul signal d'Execution du seed.
    if (ada?.scale !== 100 || ada.subScores.execution !== 100) throw new Error(JSON.stringify({ scale: ada?.scale, subScores: ada?.subScores }));
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
    if (!data.respondents.some((j) => j.label === "Sam S." && j.hint === "Pioneers team")) throw new Error("no staff in the list");
    if (/@(example|pioneers\.test)/.test(JSON.stringify(data))) throw new Error("an email leaked");
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
  await expectOk("the judge reads the submissions of the teams they score, never their own team's", async () => {
    const at = new Date().toISOString();
    const sub = (teamId, extra) => adb.doc(`events/${EVENT}/submissions/${teamId}`).set({ teamId, late: false, lateWaived: false, submittedDateISOString: at, ...extra });
    await sub("team-d", { notes: "Demo notes", proofUrls: ["https://proof.example/d"], driveFolderUrl: "https://drive.example/d", metrics: { conversationsDone: 7 }, late: true });
    await sub("team-c", { metrics: { conversationsDone: 3 } });
    if ((await sheet(null)).juryBrief !== null) throw new Error("a brief before the judge is chosen");
    const jane = (await sheet(JANE)).juryBrief;
    const d = jane?.submissions["team-d"];
    if (jane?.metrics.map((m) => m.key).join() !== "conversationsDone" || jane.submissions["team-c"]?.metrics.conversationsDone !== 3) throw new Error(JSON.stringify(jane));
    if (!d?.late || d.driveFolderUrl !== "https://drive.example/d" || d.metrics.conversationsDone !== 7) throw new Error(JSON.stringify(d));
    if (!d.answers.some((a) => a.text === "Demo notes") || !d.answers.some((a) => a.urls.join() === "https://proof.example/d")) throw new Error(JSON.stringify(d.answers));
    const ada = (await sheet({ judgeId: "founder-ada-example" })).juryBrief;
    if (!ada?.submissions["team-d"] || "team-c" in ada.submissions) throw new Error("her own team's submission was sent");
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

// ---- Shortlist et rencontres : le fondateur lui-meme, le staff et l'IC lisent ; lui seul ecrit
console.log("shortlist and met (founders/*/private/connections)");
{
  const adb = getAdminFirestore();
  // Un fondateur d'un autre batch : jamais dans les listes d'Ada.
  await adb.doc("founders/check-other-batch").set({
    programId: "accelerator",
    batchId: "other-batch",
    name: "Olga Otherbatch",
    uid: null,
    archivedDateISOString: null,
  });
  const own = "founders/ada-example/private/connections";
  const stamp = () => new Date().toISOString();
  const ada = await clientAs("ada-1");
  await expectOk("founder reads her own shortlist", () => read(doc(ada.db, own)));
  await expectOk("founder shortlists a founder of her batch", () =>
    updateDoc(doc(ada.db, own), { shortlistedFounderIds: arrayUnion("dan-placeholder"), updatedDateISOString: stamp() }),
  );
  await expectOk("founder removes a founder from her shortlist", () =>
    updateDoc(doc(ada.db, own), { shortlistedFounderIds: arrayRemove("dan-placeholder"), updatedDateISOString: stamp() }),
  );
  await expectOk("founder marks a founder as met", () =>
    updateDoc(doc(ada.db, own), { metFounderIds: arrayUnion("chloe-demo"), updatedDateISOString: stamp() }),
  );
  await expectDenied("founder shortlists herself", () =>
    updateDoc(doc(ada.db, own), { shortlistedFounderIds: arrayUnion("ada-example"), updatedDateISOString: stamp() }),
  );
  await expectDenied("founder marks herself as met", () =>
    updateDoc(doc(ada.db, own), { metFounderIds: arrayUnion("ada-example"), updatedDateISOString: stamp() }),
  );
  await expectDenied("founder shortlists a founder of another batch", () =>
    updateDoc(doc(ada.db, own), { shortlistedFounderIds: arrayUnion("check-other-batch"), updatedDateISOString: stamp() }),
  );
  await expectDenied("founder shortlists an unknown id", () =>
    updateDoc(doc(ada.db, own), { shortlistedFounderIds: arrayUnion("no-such-founder"), updatedDateISOString: stamp() }),
  );
  await expectDenied("founder adds another field", () =>
    setDoc(doc(ada.db, own), { rank: 1 }, { merge: true }),
  );
  await expectDenied("founder reads another founder's shortlist", () => read(doc(ada.db, "founders/ben-sample/private/connections")));
  await expectDenied("founder writes another founder's shortlist", () =>
    setDoc(doc(ada.db, "founders/ben-sample/private/connections"), {
      shortlistedFounderIds: ["chloe-demo"],
      metFounderIds: [],
      updatedDateISOString: stamp(),
    }),
  );
  await deleteApp(ada.app);
  // Premiere coche (document absent) : une fusion avec la seule liste, comme lib/firestore/write.ts.
  await adb.doc("founders/check-connections-owner").set({
    programId: "accelerator",
    batchId: "fall-2026",
    name: "Cora Connections",
    uid: "check-connections-1",
    personId: null,
    archivedDateISOString: null,
  });
  await adb.doc("batchMemberships/fall-2026_check-connections-1").set({
    programId: "accelerator",
    batchId: "fall-2026",
    uid: "check-connections-1",
    founderId: "check-connections-owner",
  });
  const cora = await clientAs("check-connections-1");
  const coraDoc = "founders/check-connections-owner/private/connections";
  await expectDenied("founder creates her lists with her own id", () =>
    setDoc(doc(cora.db, coraDoc), { shortlistedFounderIds: ["check-connections-owner"], metFounderIds: [], updatedDateISOString: stamp() }),
  );
  await expectDenied("founder creates her lists with two ids at once", () =>
    setDoc(doc(cora.db, coraDoc), { shortlistedFounderIds: ["ada-example", "ben-sample"], metFounderIds: [], updatedDateISOString: stamp() }),
  );
  await expectOk("founder creates her lists (first shortlist)", () =>
    setDoc(doc(cora.db, coraDoc), { shortlistedFounderIds: arrayUnion("ada-example"), updatedDateISOString: stamp() }, { merge: true }),
  );
  await expectOk("founder marks a first founder as met (list absent until now)", () =>
    setDoc(doc(cora.db, coraDoc), { metFounderIds: arrayUnion("ben-sample"), updatedDateISOString: stamp() }, { merge: true }),
  );
  await deleteApp(cora.app);
  const staff = await clientAs("staff-1");
  await expectOk("staff reads a founder's shortlist", () => read(doc(staff.db, own)));
  await expectDenied("staff writes a founder's shortlist", () =>
    updateDoc(doc(staff.db, own), { shortlistedFounderIds: arrayUnion("finn-private"), updatedDateISOString: stamp() }),
  );
  await deleteApp(staff.app);
  const ic = await clientAs("ic-1");
  await expectOk("IC investor reads a founder's shortlist", () => read(doc(ic.db, own)));
  await deleteApp(ic.app);
  const lp = await clientAs("lp-1");
  await expectDenied("portfolio investor reads a founder's shortlist", () => read(doc(lp.db, own)));
  await deleteApp(lp.app);
  const pub = await clientAs(null);
  await expectDenied("public reads a founder's shortlist", () => read(doc(pub.db, own)));
  await deleteApp(pub.app);
}

// ---- Historique des shortlists : le serveur seul l'ecrit (declencheur), staff et IC le lisent
console.log("shortlist history (shortlistHistory, server only)");
{
  const adb = getAdminFirestore();
  // Ada a shortliste puis retire Dan (bloc precedent) ; Cora a shortliste Ada a sa premiere coche.
  const removed = "shortlistHistory/ada-example_dan-placeholder";
  const recorded = async (path, founderId, targetFounderId) =>
    waitFor(async () => {
      const r = (await adb.doc(path).get()).data();
      if (r?.founderId !== founderId || r.targetFounderId !== targetFounderId || r.batchId !== "fall-2026" || !r.firstShortlistedDateISOString) {
        throw new Error(JSON.stringify(r ?? null));
      }
    });
  await expectOk("the trigger records a shortlist, kept after its removal", () => recorded(removed, "ada-example", "dan-placeholder"));
  await expectOk("the trigger records a first shortlist (document created)", () =>
    recorded("shortlistHistory/check-connections-owner_ada-example", "check-connections-owner", "ada-example"),
  );
  const fake = { programId: "accelerator", batchId: "fall-2026", founderId: "ada-example", targetFounderId: "ben-sample", firstShortlistedDateISOString: new Date().toISOString() };
  const staff = await clientAs("staff-1");
  await expectOk("staff reads the shortlist history", () => read(doc(staff.db, removed)));
  await expectOk("staff lists the batch's shortlist history", () => count(query(collection(staff.db, "shortlistHistory"), where("batchId", "==", "fall-2026"))));
  await expectDenied("staff writes a history record", () => setDoc(doc(staff.db, "shortlistHistory/ada-example_ben-sample"), fake));
  await expectDenied("staff deletes a history record", () => deleteDoc(doc(staff.db, removed)));
  await deleteApp(staff.app);
  const ic = await clientAs("ic-1");
  await expectDenied("IC investor reads the shortlist history (staff only, SPECS §6.2)", () => read(doc(ic.db, removed)));
  await deleteApp(ic.app);
  const lp = await clientAs("lp-1");
  await expectDenied("portfolio investor reads the shortlist history", () => read(doc(lp.db, removed)));
  await deleteApp(lp.app);
  const ada = await clientAs("ada-1");
  await expectDenied("founder reads her own shortlist history", () => read(doc(ada.db, removed)));
  await expectDenied("founder writes a history record", () => setDoc(doc(ada.db, "shortlistHistory/ada-example_ben-sample"), fake));
  await deleteApp(ada.app);
  const pub = await clientAs(null);
  await expectDenied("public reads the shortlist history", () => read(doc(pub.db, removed)));
  await deleteApp(pub.app);
}

// ---- Presence optionnelle : un reglage de l'evenement, ecrit par le staff (Admin > Events > Attendance)
console.log("optional attendance (events.attendanceOptional)");
{
  const EVENT = "events/demo-masterclass";
  const staff = await clientAs("staff-1");
  await expectOk("staff makes an event's attendance optional", () => updateDoc(doc(staff.db, EVENT), { attendanceOptional: true, updatedDateISOString: new Date().toISOString() }));
  await expectOk("staff makes it mandatory again", () => updateDoc(doc(staff.db, EVENT), { attendanceOptional: false, updatedDateISOString: new Date().toISOString() }));
  await deleteApp(staff.app);
  const ada = await clientAs("ada-1");
  await expectDenied("founder makes an event's attendance optional", () => updateDoc(doc(ada.db, EVENT), { attendanceOptional: true }));
  await deleteApp(ada.app);
}

// ---- Taches du To do : communes au batch, cochees par chaque fondateur ---------
console.log("tasks (To do checklist)");
{
  const adb = getAdminFirestore();
  const stamp = new Date().toISOString();
  // Une tache d'un autre batch, et la coche d'un autre fondateur (seed : demo-task-intro, cochee par Ada).
  await adb.doc("batchTasks/check-task-other").set({
    programId: "accelerator",
    batchId: "other-batch",
    title: "Other batch task",
    description: null,
    linkUrl: null,
    order: 1,
    createdDateISOString: stamp,
    updatedDateISOString: stamp,
    archivedDateISOString: null,
  });
  await adb.doc("taskCompletions/demo-task-intro_ben-sample").set({
    programId: "accelerator",
    batchId: "fall-2026",
    taskId: "demo-task-intro",
    founderId: "ben-sample",
    done: true,
    updatedDateISOString: stamp,
  });
  const tasksOf = (db) => query(collection(db, "batchTasks"), where("batchId", "==", "fall-2026"));
  const completionsOf = (db) => query(collection(db, "taskCompletions"), where("batchId", "==", "fall-2026"));
  const tick = (db, taskId, founderId, extra = {}) =>
    setDoc(doc(db, `taskCompletions/${taskId}_${founderId}`), {
      programId: "accelerator",
      batchId: "fall-2026",
      taskId,
      founderId,
      done: true,
      updatedDateISOString: new Date().toISOString(),
      ...extra,
    });
  const newTask = { programId: "accelerator", batchId: "fall-2026", title: "x", description: null, linkUrl: null, order: 9, archivedDateISOString: null };

  const pub = await clientAs(null);
  await expectDenied("public lists the tasks of the batch", () => count(tasksOf(pub.db)));
  await deleteApp(pub.app);

  // Un compte neuf : « stranger-1 » a reclame un profil de fall-2026 plus haut.
  const stranger = await clientAs("outsider-tasks-1");
  await expectDenied("signed-in outsider lists the tasks of the batch", () => count(tasksOf(stranger.db)));
  await deleteApp(stranger.app);

  const ada = await clientAs("ada-1");
  await expectOk("founder lists the tasks of her batch", () => count(tasksOf(ada.db)));
  await expectDenied("founder reads a task of another batch", () => read(doc(ada.db, "batchTasks/check-task-other")));
  await expectDenied("founder creates a task", () => setDoc(doc(ada.db, "batchTasks/check-by-ada"), newTask));
  await expectDenied("founder edits a task", () => setDoc(doc(ada.db, "batchTasks/demo-task-intro"), { title: "x" }, { merge: true }));
  await expectOk("founder lists her own ticks", () =>
    count(query(collection(ada.db, "taskCompletions"), where("batchId", "==", "fall-2026"), where("founderId", "==", "ada-example"))),
  );
  await expectDenied("founder lists every tick of the batch", () => count(completionsOf(ada.db)));
  await expectDenied("founder reads another founder's tick", () => read(doc(ada.db, "taskCompletions/demo-task-intro_ben-sample")));
  await expectOk("founder ticks a task of her batch", () => tick(ada.db, "demo-task-shortlist", "ada-example"));
  await expectOk("founder unticks it (done: false)", () => tick(ada.db, "demo-task-shortlist", "ada-example", { done: false }));
  await expectDenied("founder ticks for another founder", () => tick(ada.db, "demo-task-shortlist", "ben-sample"));
  await expectDenied("founder ticks an archived task", () => tick(ada.db, "demo-task-archived", "ada-example"));
  await expectDenied("founder ticks a task of another batch", () => tick(ada.db, "check-task-other", "ada-example"));
  await expectDenied("founder ticks under another id", () =>
    setDoc(doc(ada.db, "taskCompletions/demo-task-intro_x"), { programId: "accelerator", batchId: "fall-2026", taskId: "demo-task-intro", founderId: "ada-example", done: true, updatedDateISOString: stamp }),
  );
  await expectDenied("founder adds a field to her tick", () => tick(ada.db, "demo-task-intro", "ada-example", { score: 1 }));
  await expectDenied("founder sets done to a non-boolean", () => tick(ada.db, "demo-task-intro", "ada-example", { done: "yes" }));
  await expectDenied("founder deletes her tick", () => deleteDoc(doc(ada.db, "taskCompletions/demo-task-intro_ada-example")));
  await deleteApp(ada.app);

  const ic = await clientAs("ic-1");
  await expectOk("IC investor lists the tasks of the batch", () => count(tasksOf(ic.db)));
  await expectDenied("IC investor reads a founder's tick", () => read(doc(ic.db, "taskCompletions/demo-task-intro_ada-example")));
  await deleteApp(ic.app);

  const lp = await clientAs("lp-1");
  await expectOk("portfolio investor lists the tasks of the batch", () => count(tasksOf(lp.db)));
  await expectDenied("portfolio investor lists the ticks", () => count(completionsOf(lp.db)));
  await deleteApp(lp.app);

  const staff = await clientAs("staff-1");
  await expectOk("staff creates a task", () => setDoc(doc(staff.db, "batchTasks/check-by-staff"), { ...newTask, createdDateISOString: stamp, updatedDateISOString: stamp }));
  await expectOk("staff archives a task", () =>
    setDoc(doc(staff.db, "batchTasks/check-by-staff"), { archivedDateISOString: stamp, updatedDateISOString: stamp }, { merge: true }),
  );
  await expectOk("staff lists every tick of the batch", () => count(completionsOf(staff.db)));
  await expectDenied("staff ticks a task for a founder", () => tick(staff.db, "demo-task-shortlist", "ada-example"));
  await deleteApp(staff.app);
}

// ---- Agenda Google (SPECS §2, 16/11) : synchro, verrou, masquage ----------------
// Un batch a part (le seed n'est pas touche). Aux emulateurs, l'agenda est le
// document `calendarFakes/{id}` (services/calendarSync.ts).
console.log("google calendar sync");
{
  const admin = getAdminFirestore();
  const CAL = "cal-check@group.calendar.google.com";
  const B = "cal-check";
  const stamp = "2026-11-16T08:00:00.000Z";
  await admin.doc(`batches/${B}`).set({
    programId: "accelerator", name: "cal", startDayString: "2026-11-16", endDayString: "2026-11-27", status: "active", milestones: [],
    settings: { leaderboardVisibility: "visible", slackChannelId: null, googleCalendarId: CAL },
    archivedDateISOString: null, createdDateISOString: stamp, updatedDateISOString: stamp,
  });
  // Deja dans le Hub avant la connexion (import du planning) : il sera relie, pas recree.
  await admin.doc("events/cal-existing").set({
    programId: "accelerator", batchId: B, kind: "matching", name: "Lunch roulette", templateKey: "lunch_roulette", stage: null, topic: null,
    startDateISOString: "2026-11-18T11:30:00.000Z", endDateISOString: "2026-11-18T12:30:00.000Z", location: null, programWeek: null,
    isMilestone: false, audience: "batch", guests: [], guestFounderIds: [], mentorIds: [], startupIds: [], signUpUrl: null, resourceUrl: null,
    status: "scheduled", matching: null, leaderboardRevealDateISOString: null, rankingMetricKey: null, archivedDateISOString: null,
    createdDateISOString: stamp, updatedDateISOString: stamp,
  });
  await admin.doc("forms/cal-existing-feedback").set({
    programId: "accelerator", batchId: B, eventId: "cal-existing", kind: "session_feedback", title: "Lunch feedback", status: "open", questions: [],
    archivedDateISOString: null, opensDateISOString: "2026-11-18T11:30:00.000Z", deadlineDateISOString: null,
    createdDateISOString: stamp, updatedDateISOString: stamp,
  });
  const offsite = { id: "g5", summary: "Offsite", start: { date: "2026-11-20" }, end: { date: "2026-11-21" } };
  const g = (id, summary, start, end, extra = {}) => ({ id, summary, start: { dateTime: start }, end: { dateTime: end }, htmlLink: `https://calendar.google.com/event?eid=${id}`, ...extra });
  const fake = admin.doc(`calendarFakes/${encodeURIComponent(CAL)}`);
  await fake.set({
    events: [
      g("g1", "Lunch roulette", "2026-11-18T12:30:00+01:00", "2026-11-18T13:30:00+01:00"),
      g("g2", "Masterclass pricing", "2026-11-19T10:00:00+01:00", "2026-11-19T11:30:00+01:00", { description: '<p>Bring your <a href="https://x.y">slides</a></p>', location: " Station F ", hangoutLink: "https://meet.google.com/abc-defg-hij" }),
      g("g3", "After the batch", "2026-12-10T10:00:00+01:00", "2026-12-10T11:00:00+01:00"),
      { id: "g4", status: "cancelled" },
      offsite,
    ],
  });

  const staff = await clientAs("staff-1");
  const sync = (data) => httpsCallable(staff.functions, "syncBatchCalendar")({ batchId: B, ...data }).then((r) => r.data);
  const ada = await clientAs("ada-1");
  await expectCallableError("a founder cannot sync a calendar", "permission-denied", () => httpsCallable(ada.functions, "syncBatchCalendar")({ batchId: B }));
  await deleteApp(ada.app);
  await expectCallableError("an unshared calendar is refused, naming the account to share with", "not-found", () => sync({ dryRun: true, calendarId: "nope@group.calendar.google.com" }));

  const must = (cond, what) => {
    if (!cond) throw new Error(what);
  };
  await expectOk("dry run: 2 to create, 1 to link, nothing written", async () => {
    const r = await sync({ dryRun: true });
    must(r.counts.created === 2 && r.counts.linked === 1 && r.found === 3, JSON.stringify(r.counts));
    must(!(await admin.doc(`events/${B}_gcal_g2`).get()).exists, "dry run wrote an event");
    return `${r.found} found`;
  });
  await expectOk("sync creates the new events and links the existing one", async () => {
    const r = await sync({});
    must(r.counts.created === 2 && r.counts.linked === 1, JSON.stringify(r.counts));
    const created = (await admin.doc(`events/${B}_gcal_g2`).get()).data();
    must(created?.topic === "Bring your slides (https://x.y)" && created.location === "Station F" && created.status === "scheduled", JSON.stringify(created));
    must(created.videoCallUrl === "https://meet.google.com/abc-defg-hij", `video call ${created.videoCallUrl}`);
    const allDay = (await admin.doc(`events/${B}_gcal_g5`).get()).data();
    must(allDay?.startDateISOString === "2026-11-19T23:00:00.000Z", `all-day start ${allDay?.startDateISOString}`);
    const linked = (await admin.doc("events/cal-existing").get()).data();
    must(linked?.calendarSource?.eventId === "g1" && linked.templateKey === "lunch_roulette", "not linked");
    return "2 created, 1 linked";
  });
  await expectOk("a second sync writes nothing", async () => {
    const r = await sync({});
    must(Object.values(r.counts).every((n) => n === 0), JSON.stringify(r.counts));
  });

  const gEvent = doc(staff.db, `events/${B}_gcal_g2`);
  // Chaque champ d'agenda (CALENDAR_FIELDS) est refuse : la liste des regles ne peut pas diverger.
  const { CALENDAR_FIELDS } = createRequire(import.meta.url)("../functions/lib/shared/calendarSync.js");
  for (const field of CALENDAR_FIELDS) {
    await expectDenied(`staff changes \`${field}\` of an event from Google Calendar`, () => updateDoc(gEvent, { [field]: "2026-11-19T07:00:00.000Z" }));
  }
  await expectDenied("staff unlinks an event from Google Calendar", () => updateDoc(gEvent, { calendarSource: null }));
  await expectOk("staff sets the guests and the milestone of an event from Google Calendar", () => updateDoc(gEvent, { isMilestone: true, audience: "guests", updatedDateISOString: stamp }));
  await expectOk("staff applies a template to an event from Google Calendar", () => updateDoc(gEvent, { templateKey: "masterclass", kind: "session", updatedDateISOString: stamp }));
  await expectDenied("staff creates an event in a batch linked to Google Calendar", () =>
    setDoc(doc(staff.db, "events/cal-made-in-hub"), { batchId: B, programId: "accelerator", name: "Made here", archivedDateISOString: null }),
  );
  await expectDenied("staff marks a Hub event as coming from Google Calendar", () =>
    updateDoc(doc(staff.db, "events/demo-hackathon-1"), { calendarSource: { provider: "google", calendarId: CAL, eventId: "x", htmlLink: null } }),
  );
  await expectOk("staff hides an event from Google Calendar", () => updateDoc(doc(staff.db, `events/${B}_gcal_g5`), { archivedDateISOString: stamp, updatedDateISOString: stamp }));
  await expectOk("staff reads the sync status", async () => (await getDoc(doc(staff.db, `calendarSyncs/${B}`))).data()?.counts.created);

  // Dans Google : le lunch est decale d'une heure, la masterclass supprimee.
  await fake.set({
    events: [
      g("g1", "Lunch roulette", "2026-11-18T13:30:00+01:00", "2026-11-18T14:30:00+01:00"),
      offsite,
    ],
  }, { merge: true }); // garde le canal du faux agenda
  await expectOk("a moved event moves its forms; a deleted one is hidden; a hidden one stays hidden", async () => {
    const r = await sync({});
    must(r.counts.updated === 1 && r.counts.archived === 1 && r.counts.formsMoved === 1, JSON.stringify(r.counts));
    const lunch = (await admin.doc("events/cal-existing").get()).data();
    must(lunch?.startDateISOString === "2026-11-18T12:30:00.000Z", `lunch ${lunch?.startDateISOString}`);
    const form = (await admin.doc("forms/cal-existing-feedback").get()).data();
    must(form?.opensDateISOString === "2026-11-18T12:30:00.000Z", `form opens ${form?.opensDateISOString}`);
    must((await admin.doc(`events/${B}_gcal_g2`).get()).data()?.archivedDateISOString, "deleted event not hidden");
    must((await admin.doc(`events/${B}_gcal_g5`).get()).data()?.archivedDateISOString === stamp, "hidden event came back");
    return "1 moved, 1 hidden";
  });

  // Notifications de Google : l'abonnement est pris a la synchro, la notification synchronise aussitot.
  const state = (await admin.doc(`calendarSyncs/${B}`).get()).data();
  const channel = state?.channel;
  // Le secret en clair n'est que chez « Google » (le faux agenda) ; le Hub garde son empreinte.
  const token = (await fake.get()).data()?.channel?.token;
  await expectOk("a sync subscribes to the calendar's changes, keeping only the secret's hash", async () => {
    must(channel?.id && channel.tokenHash && !channel.token && channel.calendarId === CAL && Date.parse(channel.expirationDateISOString) > Date.now(), JSON.stringify(state));
    must(token && (await fake.get()).data()?.channel?.id === channel.id, "the fake calendar has no channel");
  });
  const { FUNCTIONS_REGION } = createRequire(import.meta.url)("../functions/lib/shared/callables.js");
  const webhook = (headers) =>
    fetch(`http://${FUNCTIONS_EMU.host}:${FUNCTIONS_EMU.port}/demo-pioneers-hub/${FUNCTIONS_REGION}/googleCalendarWebhook`, { method: "POST", headers }).then((r) => r.status);
  const notify = (secretValue, resourceState = "exists") => ({ "X-Goog-Channel-ID": channel.id, "X-Goog-Channel-Token": secretValue, "X-Goog-Resource-ID": channel.resourceId, "X-Goog-Resource-State": resourceState });
  await fake.set({
    events: [
      g("g1", "Lunch roulette", "2026-11-18T13:30:00+01:00", "2026-11-18T14:30:00+01:00", { location: "Room 2", hangoutLink: "https://meet.google.com/lun-chro-ule" }),
      offsite,
    ],
  }, { merge: true }); // garde le canal du faux agenda
  // Avant le 16/11, la visio etait la ressource : la synchro ne la garde pas en double.
  await admin.doc("events/cal-existing").update({ resourceUrl: "https://meet.google.com/lun-chro-ule" });
  await expectOk("a notification with a wrong secret is refused", async () => must((await webhook(notify("wrong"))) === 403, "not 403"));
  await expectOk("the first notification (sync) changes nothing", async () => {
    must((await webhook(notify(token, "sync"))) === 200, "not 200");
    must((await admin.doc("events/cal-existing").get()).data()?.location === null, "synced on the sync message");
  });
  await expectOk("a notification syncs the batch at once", async () => {
    must((await webhook(notify(token))) === 200, "not 200");
    const lunch = (await admin.doc("events/cal-existing").get()).data();
    must(lunch?.location === "Room 2", `location ${lunch?.location}`);
    must(lunch.videoCallUrl === "https://meet.google.com/lun-chro-ule" && lunch.resourceUrl === null, `links ${lunch.videoCallUrl} ${lunch.resourceUrl}`);
  });
  await deleteApp(staff.app);
}

// ---- Agenda Google : les formulaires hebdomadaires suivent les entrees « Weekly Update Form » (18/11) ----
// shared/weeklyForms.ts : la synchro donne le template `weekly_update` a l'entree et lui cree ses deux
// formulaires (ouverts a son debut, echeance 24 h apres) ; deplacee, ils suivent ; supprimee, ils ferment.
console.log("weekly update forms follow the calendar");
{
  const admin = getAdminFirestore();
  const CAL = "cal-weekly@group.calendar.google.com";
  const B = "cal-weekly";
  const stamp = new Date().toISOString();
  await admin.doc(`batches/${B}`).set({
    programId: "accelerator", name: "weekly", startDayString: "2026-11-01", endDayString: null, status: "active", milestones: [],
    settings: { leaderboardVisibility: "visible", slackChannelId: null, googleCalendarId: CAL, weeklyForms: { enabled: true } },
    archivedDateISOString: null, createdDateISOString: stamp, updatedDateISOString: stamp,
  });
  // Dans deux jours et dans neuf jours, a la minute.
  const minute = 60_000;
  const base = Math.floor(Date.now() / minute) * minute;
  const at = (days, minutes = 0) => new Date(base + (days * 24 * 60 + minutes) * minute).toISOString();
  const entry = (id, start) => ({ id, summary: "Weekly Update Form", start: { dateTime: start }, end: { dateTime: new Date(Date.parse(start) + 30 * minute).toISOString() } });
  const fake = admin.doc(`calendarFakes/${encodeURIComponent(CAL)}`);
  await fake.set({ events: [entry("w1", at(2)), entry("w2", at(9))] });
  const staff = await clientAs("staff-1");
  const sync = () => httpsCallable(staff.functions, "syncBatchCalendar")({ batchId: B }).then((r) => r.data);
  const must = (cond, what) => {
    if (!cond) throw new Error(what);
  };
  const form = async (entryId, template) => (await admin.doc(`forms/${B}_gcal_${entryId}-${template}`).get()).data();
  await expectOk("the sync gives each « Weekly Update Form » entry its two weekly forms, open at its start, due 24 h later", async () => {
    const r = await sync();
    must(r.counts.created === 2 && r.counts.formsCreated === 4, JSON.stringify(r.counts));
    const event = (await admin.doc(`events/${B}_gcal_w1`).get()).data();
    must(event?.templateKey === "weekly_update", `template ${event?.templateKey}`);
    for (const template of ["weekly_update_founder", "weekly_update_startup"]) {
      const f = await form("w1", template);
      must(f?.eventId === `${B}_gcal_w1` && f.status === "open" && f.version === 1, JSON.stringify(f && { eventId: f.eventId, status: f.status, version: f.version }));
      must(f.opensDateISOString === at(2) && f.deadlineDateISOString === at(3), `${f.opensDateISOString} -> ${f.deadlineDateISOString}`);
    }
    must((await admin.doc(`forms/${B}_gcal_w1-weekly_update_founder/versions/1`).get()).exists, "no published version");
  });
  await expectOk("a second sync adds nothing", async () => {
    const r = await sync();
    must(Object.values(r.counts).every((n) => n === 0), JSON.stringify(r.counts));
  });
  // Dans Google : la premiere entree passe une heure plus tard, la deuxieme est supprimee.
  await fake.set({ events: [entry("w1", at(2, 60))] }, { merge: true });
  await expectOk("moved in the calendar, the entry moves its forms; deleted, its forms close", async () => {
    const r = await sync();
    must(r.counts.updated === 1 && r.counts.formsMoved === 2 && r.counts.archived === 1 && r.counts.formsCreated === 0, JSON.stringify(r.counts));
    const moved = await form("w1", "weekly_update_founder");
    must(moved?.opensDateISOString === at(2, 60) && moved.deadlineDateISOString === at(3, 60), `${moved?.opensDateISOString} -> ${moved?.deadlineDateISOString}`);
    must((await form("w2", "weekly_update_startup"))?.status === "closed", "the deleted entry's form is still open");
  });
  await deleteApp(staff.app);
}

// ==== LOT 2 (debut) : Lock my team, Admin > Startups, grille Background ============
// Lock my team : un formulaire du BATCH (sans evenement), depuis son compte ; la reponse va
// dans `teamLocks/{founderId}` (le fondateur lui-meme + staff, SPECS §6.2). Puis le staff cree une
// startup en un lot (shared/teamLocks.ts) ; la grille Background (`private/internal.background`)
// s'ecrit par le staff seul, l'Outstanding seulement a 100.
console.log("lock my team (form -> teamLocks), startups, background grid");
{
  const adb = getAdminFirestore();
  const req = createRequire(import.meta.url);
  const { FORM_TEMPLATES } = req("../functions/lib/shared/presets/formTemplates.js");
  const { deriveAttachments } = req("../functions/lib/shared/formRules.js");
  const { startupCreationWrites } = req("../functions/lib/shared/teamLocks.js");
  const { backgroundRatingWrite } = req("../functions/lib/shared/background.js");
  const template = FORM_TEMPLATES.lock_my_team;
  const FORM = "check-lock-my-team";
  const stamp = new Date().toISOString();
  await adb.doc(`forms/${FORM}`).set({
    programId: "accelerator",
    batchId: "fall-2026",
    createdDateISOString: stamp,
    updatedDateISOString: stamp,
    archivedDateISOString: null,
    kind: template.kind,
    title: template.title,
    description: template.description,
    version: 1,
    questions: template.questions,
    attachments: deriveAttachments(template.questions),
    approval: "none",
    identityCheck: template.identityCheck,
    eventId: null,
    status: "open",
    opensDateISOString: stamp,
    deadlineDateISOString: null,
  });
  const lock = (fns, answers, n) =>
    httpsCallable(fns, "submitFormResponse")({ formId: FORM, version: 1, submissionId: `check-lock-my-team-${n}`, answers });

  const ada = await clientAs("ada-1");
  await expectOk("founder locks a team from her account", async () => {
    await lock(ada.functions, { locked: "Yes", coFounders: ["chloe-demo"], startupName: "Nova" }, "0001");
    const saved = (await adb.doc("teamLocks/ada-example").get()).data();
    if (saved?.locked !== true || saved.coFounderIds.join() !== "chloe-demo" || saved.startupName !== "Nova" || saved.batchId !== "fall-2026") {
      throw new Error(JSON.stringify(saved));
    }
  });
  await expectOk("her answer comes back, to change it", async () => {
    const form = await publicForm(ada.functions, FORM);
    if (form.prefill.locked !== "Yes" || form.prefill.coFounders?.join() !== "chloe-demo") throw new Error(JSON.stringify(form.prefill));
  });
  await expectCallableError("founder picks herself as co-founder", "invalid-argument", () => lock(ada.functions, { locked: "Yes", coFounders: ["ada-example"] }, "0002"));
  await expectCallableError("more than 4 co-founders", "invalid-argument", () =>
    lock(ada.functions, { locked: "Yes", coFounders: ["ben-sample", "chloe-demo", "dan-placeholder", "gina-unclaimed", "finn-private"] }, "0003"),
  );
  await expectOk("founder reads her own team lock", () => read(doc(ada.db, "teamLocks/ada-example")));
  await adb.doc("teamLocks/chloe-demo").set({ programId: "accelerator", batchId: "fall-2026", founderId: "chloe-demo", locked: true, coFounderIds: ["ada-example"], startupName: null, updatedDateISOString: stamp });
  await expectDenied("founder reads another founder's team lock", () => read(doc(ada.db, "teamLocks/chloe-demo")));
  await expectDenied("founder writes her team lock directly", () => updateDoc(doc(ada.db, "teamLocks/ada-example"), { coFounderIds: ["ben-sample"] }));
  await expectDenied("founder lists the batch's team locks", () => count(query(collection(ada.db, "teamLocks"), where("batchId", "==", "fall-2026"))));
  await expectDenied("founder creates a startup", () =>
    setDoc(doc(ada.db, "startups/check-founder-made"), { programId: "accelerator", batchId: "fall-2026", name: "Mine", memberIds: ["ada-example"], archivedDateISOString: null }),
  );
  await expectDenied("founder writes her Background", () => setDoc(doc(ada.db, "founders/ada-example/private/internal"), { background: { scores: { execution: 5 } } }, { merge: true }));
  await deleteApp(ada.app);

  const pub = await clientAs(null);
  await expectCallableError("Lock my team needs an account", "permission-denied", () => lock(pub.functions, { locked: "No" }, "0004"));
  await expectDenied("public reads a team lock", () => read(doc(pub.db, "teamLocks/ada-example")));
  await deleteApp(pub.app);

  const ic = await clientAs("ic-1");
  await expectDenied("IC investor reads a team lock (self + staff, SPECS §6.2)", () => read(doc(ic.db, "teamLocks/ada-example")));
  await expectDenied("IC investor lists the batch's team locks", () => count(query(collection(ic.db, "teamLocks"), where("batchId", "==", "fall-2026"))));
  await expectDenied("IC investor writes a team lock", () => updateDoc(doc(ic.db, "teamLocks/ada-example"), { locked: false }));
  await deleteApp(ic.app);
  const lp = await clientAs("lp-1");
  await expectDenied("portfolio investor reads a team lock", () => read(doc(lp.db, "teamLocks/ada-example")));
  await deleteApp(lp.app);

  const staff = await clientAs("staff-1");
  await expectOk("staff lists the batch's team locks", () => count(query(collection(staff.db, "teamLocks"), where("batchId", "==", "fall-2026"))));
  await expectOk("staff creates the startup in one batch (startup, profiles, memberships, founders)", async () => {
    const founders = (await adb.collection("founders").where("batchId", "==", "fall-2026").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const existing = (await adb.collection("startups").get()).docs.map((d) => d.id);
    const { writes, startupIds } = startupCreationWrites({
      programId: "accelerator",
      batchId: "fall-2026",
      drafts: [{ name: "Nova", memberIds: ["chloe-demo", "dan-placeholder"] }],
      founders,
      existingStartupIds: new Set(existing),
      dayString: "2026-11-23",
      nowISO: stamp,
    });
    const batch = writeBatch(staff.db);
    for (const w of writes) {
      if (w.op === "merge") batch.set(doc(staff.db, w.path), w.data, { merge: true });
      else batch.set(doc(staff.db, w.path), w.data);
    }
    await batch.commit();
    const chloe = (await adb.doc("founders/chloe-demo").get()).data();
    const membership = (await adb.doc(`memberships/${startupIds[0]}_dan-placeholder_2026-11-23`).get()).data();
    if (chloe?.startupId !== startupIds[0] || membership?.kind !== "startup") throw new Error(JSON.stringify({ chloe: chloe?.startupId, membership }));
    return startupIds[0];
  });
  const all5 = { execution: 5, founderSignal: 5, pedigree: 5, geography: 5 };
  const rate = (scores, outstanding) => {
    const w = backgroundRatingWrite("ben-sample", { scores, outstanding }, "staff-1", stamp);
    return setDoc(doc(staff.db, w.path), w.data, { merge: true });
  };
  await expectOk("staff rates a Background", () => rate({ ...all5, geography: 3 }, false));
  await expectOk("staff gives the Outstanding mention at 100", () => rate(all5, true));
  await expectDenied("staff gives the Outstanding mention below 100", () =>
    setDoc(doc(staff.db, "founders/ben-sample/private/internal"), { background: { scores: { ...all5, pedigree: 4 }, outstanding: true } }, { merge: true }),
  );
  await expectDenied("staff writes a Background criterion above 5", () =>
    setDoc(doc(staff.db, "founders/ben-sample/private/internal"), { background: { scores: { ...all5, execution: 6 } } }, { merge: true }),
  );
  await expectDenied("staff writes a Background criterion that is not a whole number", () =>
    setDoc(doc(staff.db, "founders/ben-sample/private/internal"), { background: { scores: { ...all5, pedigree: 3.5 } } }, { merge: true }),
  );
  await expectOk("the proposal is kept when the staff rates", async () => {
    await adb.doc("founders/ben-sample/private/internal").set({ background: { proposed: { scores: all5, outstanding: false, ratedByUid: "script:background-draft", ratedDateISOString: stamp, reasoning: null } } }, { merge: true });
    await rate({ ...all5, execution: 4 }, false);
    const b = (await adb.doc("founders/ben-sample/private/internal").get()).data()?.background;
    if (b?.scores.execution !== 4 || b.outstanding !== false || !b.proposed || b.ratedByUid !== "staff-1") throw new Error(JSON.stringify(b));
  });
  await deleteApp(staff.app);
  const ic2 = await clientAs("ic-1");
  await expectOk("IC investor reads a Background", () => read(doc(ic2.db, "founders/ben-sample/private/internal")));
  await deleteApp(ic2.app);
  const lp2 = await clientAs("lp-1");
  await expectDenied("portfolio investor reads a Background", () => read(doc(lp2.db, "founders/ben-sample/private/internal")));
  await deleteApp(lp2.app);
}
// ==== LOT 2 (fin) =================================================================

// ==== LOT 4 (debut) : Weekly updates (formulaires du jeudi), file de revue ===========
// Les deux formulaires d'une entree « Weekly Update Form » (template `weekly_update`, shared/weeklyForms.ts :
// la synchro de l'agenda les accroche, voir « google calendar sync »), depuis son compte : le founder
// rappelle l'objectif donne au Weekly update PRECEDENT (`previousGoal`) ; le startup vaut pour toute la
// startup (« fait » pour chaque membre) et refuse un fondateur sans startup. Sans presence : un fondateur
// marque absent a l'entree repond quand meme. Les revues (`founderReviews`, `startupReviews`) : staff seul
// (lecture et ecriture, SPECS §6.2), notes de 0 a 5, Outstanding seulement a 100 (shared/weeklyReviews.ts).
console.log("weekly updates (founder, startup) and their review queue");
{
  const adb = getAdminFirestore();
  const req = createRequire(import.meta.url);
  const { eventFormDocs, eventFormsPlan } = req("../functions/lib/shared/eventForms.js");
  const { endAfter, newEvent } = req("../functions/lib/shared/events.js");
  const { founderReviewWrite, startupReviewWrite } = req("../functions/lib/shared/weeklyReviews.js");
  const { parisMonday, shiftWeek } = req("../functions/lib/shared/dates.js");
  const must = (cond, what) => {
    if (!cond) throw new Error(what);
  };
  const nowISO = new Date().toISOString();
  const week = parisMonday(nowISO);
  // L'entree de cette semaine (commencee il y a une minute) et celle de la semaine d'avant, avec leurs
  // formulaires tels que la synchro les a crees (avant leur debut).
  const entries = [["check-weekly-previous", endAfter(nowISO, -7 * 24 * 60 - 1)], ["check-weekly", endAfter(nowISO, -1)]];
  for (const [id, start] of entries) {
    const event = newEvent({ programId: "accelerator", batchId: "fall-2026", templateKey: "weekly_update", name: "Weekly Update Form", startDateISOString: start, endDateISOString: null, status: "scheduled" });
    await adb.doc(`events/${id}`).set({ ...event, createdDateISOString: nowISO, updatedDateISOString: nowISO });
    for (const p of eventFormsPlan(id, event, {}, endAfter(start, -60))) for (const d of eventFormDocs(p, nowISO)) await adb.doc(d.path).set(d.data);
  }
  const [FOUNDER_FORM, STARTUP_FORM] = ["check-weekly-weekly_update_founder", "check-weekly-weekly_update_startup"];
  // L'objectif donne au Weekly update precedent (dans sa semaine), et une absence marquee a l'entree : ignoree.
  await adb.doc(`founderWeeks/ada-example_${shiftWeek(week, -1)}`).set(
    { programId: "accelerator", batchId: "fall-2026", founderId: "ada-example", weekStartDayString: shiftWeek(week, -1), goalForWeek: "Talk to 10 nurses", updatedDateISOString: nowISO },
    { merge: true },
  );
  await adb.doc("events/check-weekly/attendance/ada-example").set({ programId: "accelerator", batchId: "fall-2026", eventId: "check-weekly", founderId: "ada-example", status: "absent" });
  const submit = (fns, formId, answers, n) =>
    httpsCallable(fns, "submitFormResponse")({ formId, version: 1, submissionId: `check-weekly-update-${n}`, answers });

  const ada = await clientAs("ada-1");
  await expectOk("the founder update reminds the previous update's goal above « What did you achieve? », absent or not", async () => {
    const form = await publicForm(ada.functions, FOUNDER_FORM);
    must(form.previousGoal?.goal === "Talk to 10 nurses" && form.previousGoal.questionId === "achieved", JSON.stringify(form.previousGoal));
    must(form.absent === false && form.state === "open", `absent ${form.absent}, state ${form.state}`);
  });
  await expectOk("the first update has no previous goal", async () => {
    const form = await publicForm(ada.functions, "check-weekly-previous-weekly_update_founder");
    must(form.previousGoal === null, JSON.stringify(form.previousGoal));
  });
  await expectOk("founder sends her weekly update: it lands in her week", async () => {
    await submit(ada.functions, FOUNDER_FORM, {
      achieved: "Talked to 12 nurses",
      goalForWeek: "Ship a prototype",
      commitmentStatus: "committed",
      messagesSent: 40,
      conversationsDone: 12,
      learnings: "Night shifts matter",
      workingWith: ["ben-sample"],
      matchResult: "still_looking",
    }, "0001");
    const w = (await adb.doc(`founderWeeks/ada-example_${week}`).get()).data();
    must(w?.achieved === "Talked to 12 nurses" && w.messagesSent === 40 && w.conversationsDone === 12 && w.matchResult === "still_looking", JSON.stringify(w));
  });
  await expectOk("the startup update is done for every member of the startup", async () => {
    await submit(ada.functions, STARTUP_FORM, {
      achievement: "First pilot signed",
      goals: "Two more pilots",
      messagesSent: 30, callsMade: 10, conversationsDone: 8, meetingsBooked: 3, demosDone: 2, proposalsSent: 1, closedWon: 1, amountPaid: 500,
      totalAmountPaid: 500, mrr: 0, payingCustomers: 1, totalUsers: 12, activeUsers: 5,
      obstacle: "Procurement",
    }, "0002");
    const checkin = (await adb.doc(`checkins/lumen_${week}_ada-example`).get()).data();
    must(checkin?.amountPaid === 500 && checkin.achievement === "First pilot signed", JSON.stringify(checkin));
    const ben = (await adb.doc(`formCompletions/${STARTUP_FORM}_ben-sample`).get()).data();
    must(ben?.founderId === "ben-sample", "no completion for her co-founder");
  });
  await expectDenied("founder reads her own founder review", () => read(doc(ada.db, `founderReviews/ada-example_${week}`)));
  await expectDenied("founder writes a startup review", () =>
    setDoc(doc(ada.db, `startupReviews/lumen_${week}`), { programId: "accelerator", batchId: "fall-2026", startupId: "lumen", weekStartDayString: week, scores: { traction: 5, progress: 5 }, outstanding: true }),
  );
  await expectDenied("founder lists the batch's startup reviews", () => count(query(collection(ada.db, "startupReviews"), where("batchId", "==", "fall-2026"))));
  // Sans startup, le formulaire de la startup est refuse (la startup lui est retiree le temps du cas).
  await adb.doc("founders/ada-example").update({ startupId: null });
  await expectCallableError("a founder without a startup sends the startup update", "failed-precondition", () =>
    submit(ada.functions, STARTUP_FORM, { achievement: "x", goals: "y", obstacle: "z" }, "0003"),
  );
  await adb.doc("founders/ada-example").update({ startupId: "lumen" });
  await deleteApp(ada.app);

  const staff = await clientAs("staff-1");
  const scoped = { programId: "accelerator", batchId: "fall-2026", weekStartDayString: week, comment: null };
  const put = (w) => setDoc(doc(staff.db, w.path), w.data);
  await expectOk("staff reviews a founder update (yes / no)", () =>
    put(founderReviewWrite({ ...scoped, founderId: "ada-example", goalAmbitious: true, goalReached: true, problemValidated: false }, "staff-1", nowISO)),
  );
  await expectOk("staff reviews a startup update", () => put(startupReviewWrite({ ...scoped, startupId: "lumen", scores: { traction: 4, progress: 3 }, outstanding: false }, "staff-1", nowISO)));
  await expectOk("staff gives the Outstanding mention at 100", () => put(startupReviewWrite({ ...scoped, startupId: "lumen", scores: { traction: 5, progress: 5 }, outstanding: true }, "staff-1", nowISO)));
  const raw = (data) => setDoc(doc(staff.db, `startupReviews/lumen_${week}`), { ...scoped, startupId: "lumen", outstanding: false, reviewedByUid: "staff-1", reviewedDateISOString: nowISO, ...data });
  await expectDenied("staff gives the Outstanding mention below 100", () => raw({ scores: { traction: 5, progress: 4 }, outstanding: true }));
  await expectDenied("staff writes a criterion above 5", () => raw({ scores: { traction: 6, progress: 3 } }));
  await expectDenied("staff writes a criterion that is not a whole number", () => raw({ scores: { traction: 3.5, progress: 3 } }));
  await expectDenied("staff writes a founder review that is not yes / no", () =>
    setDoc(doc(staff.db, `founderReviews/ada-example_${week}`), { ...scoped, founderId: "ada-example", goalAmbitious: "yes" }),
  );
  await expectOk("staff lists the batch's founder reviews", () => count(query(collection(staff.db, "founderReviews"), where("batchId", "==", "fall-2026"))));
  await deleteApp(staff.app);

  const ic = await clientAs("ic-1");
  await expectDenied("IC investor reads a founder review (staff only, SPECS §6.2)", () => read(doc(ic.db, `founderReviews/ada-example_${week}`)));
  await expectDenied("IC investor lists the batch's startup reviews", () => count(query(collection(ic.db, "startupReviews"), where("batchId", "==", "fall-2026"))));
  await expectDenied("IC investor writes a review", () => updateDoc(doc(ic.db, `startupReviews/lumen_${week}`), { comment: "x" }));
  await deleteApp(ic.app);
  const lp = await clientAs("lp-1");
  await expectDenied("portfolio investor reads a startup review", () => read(doc(lp.db, `startupReviews/lumen_${week}`)));
  await deleteApp(lp.app);
  const pub = await clientAs(null);
  await expectDenied("public reads a founder review", () => read(doc(pub.db, `founderReviews/ada-example_${week}`)));
  await expectCallableError("the weekly update needs an account", "permission-denied", () => submit(pub.functions, FOUNDER_FORM, { achieved: "x" }, "0004"));
  await deleteApp(pub.app);
}
// ==== LOT 4 (fin) =================================================================

// ==== LOT 5 (debut) : Pitch deck et grille Pitch ======================================
// Le pack d'un pitch (shared/presets/eventTemplates.ts) : le Pitch deck de la startup (depuis son compte,
// « fait » pour toute la startup, ecrit dans sa fiche) et le jury sur la grille Pitch (neuf criteres, puis
// les questions d'apres la grille), par le lien partage ; le jure lit le Pitch deck de la startup.
console.log("pitch deck and pitch grid (lot 5)");
{
  const adb = getAdminFirestore();
  const req = createRequire(import.meta.url);
  const { newEvent } = req("../functions/lib/shared/events.js");
  const { eventFormDocs, eventFormsPlan } = req("../functions/lib/shared/eventForms.js");
  const { PITCH_CRITERIA } = req("../functions/lib/shared/pitchGrid.js");
  const must = (cond, what) => {
    if (!cond) throw new Error(what);
  };
  const nowISO = new Date().toISOString();
  // Un pitch dans 30 h : le Pitch deck est ouvert (48 h avant), son echeance tombe dans 6 h ; le jury ouvre tout de suite.
  const EVENT = "check-pitch-day";
  const start = new Date(Date.now() + 30 * 3600_000).toISOString();
  const event = newEvent(
    { programId: "accelerator", batchId: "fall-2026", templateKey: "pitch_day", name: "Pitch Day #1", startDateISOString: start, status: "scheduled" },
    { startupIds: ["lumen"] },
  );
  await adb.doc(`events/${EVENT}`).set({ ...event, createdDateISOString: nowISO, updatedDateISOString: nowISO });
  for (const p of eventFormsPlan(EVENT, event, { formDates: { jury: { opensDateISOString: nowISO } } }, nowISO)) {
    for (const d of eventFormDocs(p, nowISO)) await adb.doc(d.path).set(d.data);
  }
  const DECK = `${EVENT}-pitch_deck`;
  const JURY = `${EVENT}-jury`;

  const ada = await clientAs("ada-1");
  await expectOk("a founder sends the pitch deck: it lands in the startup's card and profile, done for every member", async () => {
    await submitForm(ada.functions, DECK, {
      pitchDeck: "deck.example/lumen",
      oneLiner: "Night-shift scheduling for nurses",
      problem: "Rosters are built by hand",
      icp: "Hospital nurse managers",
      solution: "An agent that builds the roster",
      whyNow: "Staff shortages",
    });
    const startup = (await adb.doc("startups/lumen").get()).data();
    const profile = (await adb.doc("startups/lumen/private/profile").get()).data();
    must(startup?.ideaOneLine === "Night-shift scheduling for nurses", JSON.stringify(startup?.ideaOneLine));
    must(profile?.pitchDeckUrl === "https://deck.example/lumen" && profile.icp === "Hospital nurse managers" && profile.whyNow === "Staff shortages", JSON.stringify(profile));
    const ben = (await adb.doc(`formCompletions/${DECK}_ben-sample`).get()).data();
    must(ben?.founderId === "ben-sample", "no completion for her co-founder");
  });
  await deleteApp(ada.app);

  const staff = await clientAs("staff-1");
  await httpsCallable(staff.functions, "resetJuryLink")({ eventId: EVENT });
  const key = (await getDoc(doc(staff.db, `events/${EVENT}/judges/link`))).data()?.secret;
  await deleteApp(staff.app);
  const pub = await clientAs(null);
  const PAT = { name: "Pat Pitchjuror" };
  await expectOk("the juror reads the startup's pitch deck before scoring", async () => {
    const brief = (await publicForm(pub.functions, JURY, { key, respondent: PAT })).juryBrief;
    must(brief?.source === "pitch_deck" && brief.submissions.lumen?.answers.some((a) => a.urls.join() === "https://deck.example/lumen"), JSON.stringify(brief));
  });
  await expectOk("a juror scores the nine criteria, then the questions after the grid", async () => {
    const criteria = Object.fromEntries(PITCH_CRITERIA.map((c) => [`criterion_${c.key}@lumen`, 5]));
    await submitForm(pub.functions, JURY, { ...criteria, "overall@lumen": 4, "wouldInvest@lumen": "Yes", "betLikelihood@lumen": 3, "comment@lumen": "Strong." }, { key, respondent: PAT });
    const e = (await adb.collection(`events/${EVENT}/evaluations`).get()).docs[0]?.data();
    must(e?.targetType === "startup" && e.scores.teamStrength === 5 && e.overallScore === 4 && e.wouldInvest === true && e.betLikelihood === 3, JSON.stringify(e));
  });
  await expectCallableError("Overall above 5", "invalid-argument", () => submitForm(pub.functions, JURY, { "overall@lumen": 6 }, { key, respondent: PAT }));
  await expectOk("the pitch leaderboard is on 100 and offers the Outstanding mention at 100", () =>
    waitFor(async () => {
      const row = (await adb.doc(`leaderboards/${EVENT}`).get()).data()?.rows?.[0];
      must(row?.targetId === "lumen" && row.normalized === 100 && row.outstandingEligible === true, JSON.stringify(row));
    }),
  );
  await deleteApp(pub.app);
}
// ==== LOT 5 (fin) =================================================================

console.log(failures === 0 ? "\nall rules checks passed" : `\n${failures} rules check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
