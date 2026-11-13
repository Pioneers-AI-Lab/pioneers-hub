// ----------------------------
// Import du batch Fall 2026 (Profile Book FA26, vue partagee Airtable)
// ----------------------------
// node scripts/import-fa26.mjs <lien-de-partage-airtable> --prod [--dry-run]     projet reel pioneers-3627c
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9399 \
//   node scripts/import-fa26.mjs <lien-de-partage-airtable>                       emulateurs
//
// La source est la vue partagee « Pioneers Profile Book - FA26 » (galerie),
// lue comme le fait la page publique d'Airtable. Le lien donne acces a des
// DONNEES PERSONNELLES (noms, photos) : il se passe en argument et ne va
// jamais dans le depot. La vue n'a ni email ni telephone : les fondateurs se
// rattachent par /claim (choix du profil), pas par email.
//
// Photos : les URL Airtable expirent. Chaque photo est telechargee puis
//   - reduite en vignette JPEG 128 px en data URL (`photoUrl`, comme SP26) ;
//   - reduite a 800 px au plus et deposee dans Storage
//     (`founders/{id}/cover.jpg`), son URL a jeton dans `coverPhotoUrl`.
//     Image identique (MD5) : ni envoi ni nouveau jeton, l'URL ne change pas ;
//     image changee : nouveau jeton, donc nouvelle URL (le cache d'un an des
//     navigateurs ne sert pas l'ancienne).
// Sans Storage (emulateurs lances sans lui), `coverPhotoUrl` reste nul.
//
// Rejouable : les ids sont les ids Airtable des lignes (`founders/{recId}`,
// `people/person-{recId}`), chaque ecriture remplace le document du meme id.
// Un profil deja reclame garde son rattachement et ce que le fondateur a
// rempli : ses valeurs non vides l'emportent sur celles d'Airtable. Sa photo
// est la sienne (deposee, remplacee ou retiree depuis « Mon profil ») : l'import
// n'y touche plus, ni dans Firestore ni dans Storage.
//
// Correspondance avec le modele : SPECS §6.1 et functions/src/shared/types.

import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";

const args = process.argv.slice(2);
const shareUrl = args.find((a) => a.startsWith("https://airtable.com/"));
const dryRun = args.includes("--dry-run");
if (!shareUrl) throw new Error("usage: node scripts/import-fa26.mjs <lien-de-partage-airtable> [--prod] [--dry-run]");
const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!onEmulator && !args.includes("--prod")) throw new Error("projet reel : ajouter --prod (ou FIRESTORE_EMULATOR_HOST pour les emulateurs)");

const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
const BUCKET = onEmulator ? "demo-pioneers-hub.appspot.com" : "pioneers-3627c.firebasestorage.app";
const app = initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();
const withStorage = !onEmulator || !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const bucket = withStorage ? getStorage(app).bucket(BUCKET) : null;
const STORAGE_ENDPOINT = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0`
  : "https://firebasestorage.googleapis.com/v0";

const PROGRAM_ID = "accelerator";
const BATCH_ID = "fall-2026";
const scoped = { programId: PROGRAM_ID, batchId: BATCH_ID };
const now = new Date().toISOString();
const stamps = { createdDateISOString: now, updatedDateISOString: now, archivedDateISOString: null };

// ---- Lecture de la vue partagee ----------------------------------------------------
// La page publique embarque l'URL signee de ses donnees (`readSharedViewData`).
const BROWSER = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};
const page = await (await fetch(shareUrl, { headers: BROWSER })).text();
const dataPath = page.match(/urlWithParams: "([^"]+)"/)?.[1]?.replaceAll("\\u002F", "/");
if (!dataPath) throw new Error("vue Airtable illisible : lien expire ou partage retire ?");
const applicationId = new URL(shareUrl).pathname.split("/")[1];
const response = await fetch(`https://airtable.com${dataPath}`, {
  headers: { ...BROWSER, "x-airtable-application-id": applicationId, "x-requested-with": "XMLHttpRequest", "x-time-zone": "Europe/Paris" },
});
const { msg, data } = await response.json();
if (msg !== "SUCCESS") throw new Error(`vue Airtable : ${msg}`);
const { table } = data;
const signed = table.signedUserContentUrls ?? {};

const column = (name) => {
  const column = table.columns.find((c) => c.name === name);
  if (!column) throw new Error(`colonne Airtable absente : « ${name} »`);
  return column;
};
const COL = {
  name: column("Full Name"),
  photo: column("Your Photo"),
  profileType: column("Profile type"),
  trackRecord: column("Track Record"),
  interestedIn: column("What I am interested in working on"),
  hardSkills: column("Hard skills"),
  industries: column("Industries you have experience on"),
  education: column("Main education"),
  companies: column("Notable companies worked at"),
  nationality: column("Nationality"),
};
const cell = (row, column) => row.cellValuesByColumnId[column.id] ?? null;
const choice = (column, id) => column.typeOptions?.choices?.[id]?.name ?? null;
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const select = (row, column) => choice(column, cell(row, column));
const multi = (row, column) => (cell(row, column) ?? []).map((id) => choice(column, id)).filter(Boolean);
/** Texte libre « Google, McKinsey » ou une entreprise par ligne -> liste. */
const splitList = (v) => (text(v) ?? "").split(/[\n,;]/).map((s) => s.trim()).filter(Boolean);

const CATEGORY = { Technical: "technical", "Non-technical": "business", Hybrid: "hybrid" };

// ---- Photos ------------------------------------------------------------------------
async function photosOf(founderId, row) {
  const attachment = (cell(row, COL.photo) ?? [])[0];
  if (!attachment) return { photoUrl: null, coverPhotoUrl: null };
  const source = signed[attachment.url] ?? attachment.url;
  const res = await fetch(source);
  if (!res.ok) throw new Error(`photo ${founderId} : HTTP ${res.status}`);
  const original = Buffer.from(await res.arrayBuffer());
  const thumb = await sharp(original).rotate().resize(128, 128, { fit: "cover", position: "attention" }).jpeg({ quality: 80 }).toBuffer();
  const photoUrl = `data:image/jpeg;base64,${thumb.toString("base64")}`;
  if (!bucket || dryRun) return { photoUrl, coverPhotoUrl: null };

  const cover = await sharp(original)
    .rotate()
    .resize(800, 800, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const path = `founders/${founderId}/cover.jpg`;
  const file = bucket.file(path);
  const [meta] = await file.getMetadata().catch(() => [null]);
  const md5 = createHash("md5").update(cover).digest("base64");
  let token = meta?.md5Hash === md5 ? meta.metadata?.firebaseStorageDownloadTokens?.split(",")[0] : null;
  if (!token) {
    token = randomUUID();
    await file.save(cover, {
      contentType: "image/jpeg",
      metadata: { cacheControl: "public, max-age=31536000", metadata: { firebaseStorageDownloadTokens: token } },
    });
  }
  return { photoUrl, coverPhotoUrl: `${STORAGE_ENDPOINT}/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}` };
}

// ---- Profils deja reclames : un reimport ne les efface jamais ------------------------
const batch = await db.doc(`batches/${BATCH_ID}`).get();
if (!batch.exists) throw new Error(`batch ${BATCH_ID} introuvable (${PROJECT_ID})`);
const existing = (await db.collection("founders").where("batchId", "==", BATCH_ID).get()).docs;
const rows = table.rows.filter((r) => text(cell(r, COL.name)));
const claimed = new Map(existing.filter((d) => d.data().uid).map((d) => [d.id, d.data()]));
const claimedDirectories = new Map(
  claimed.size
    ? (await db.getAll(...[...claimed.keys()].map((id) => db.doc(`founders/${id}/private/directory`)))).map((d) => [d.ref.parent.parent.id, d.data()])
    : [],
);
/** Personnes deja rattachees a un compte, par id de ligne. */
const claimedPeople = new Map(
  (await db.getAll(...rows.map((r) => db.doc(`people/person-${r.id}`))))
    .filter((d) => d.data()?.uid)
    .map((d) => [d.id.slice("person-".length), d.data()]),
);
const isEmpty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
/** Photo d'un profil reclame : celle du fondateur telle quelle, meme retiree (`null`). */
const FOUNDER_OWNED = new Set(["photoUrl", "coverPhotoUrl"]);
/** Profil reclame : ce que le fondateur a rempli (non vide) l'emporte sur l'import. */
const keepFilled = (imported, current) => {
  if (!current) return imported;
  const merged = Object.fromEntries(
    Object.entries(imported).map(([k, v]) => [k, FOUNDER_OWNED.has(k) ? (current[k] ?? null) : isEmpty(current[k]) ? v : current[k]]),
  );
  if ("updatedDateISOString" in imported) merged.updatedDateISOString = now;
  return merged;
};

// ---- Photos, 6 a la fois (pas celles des profils reclames : voir plus haut) ---------
const photos = new Map();
const unclaimedRows = rows.filter((r) => !claimed.has(r.id));
for (let i = 0; i < unclaimedRows.length; i += 6) {
  const chunk = unclaimedRows.slice(i, i + 6);
  (await Promise.all(chunk.map((r) => photosOf(r.id, r)))).forEach((p, j) => photos.set(chunk[j].id, p));
}

// ---- Ecriture ------------------------------------------------------------------------
const writer = db.bulkWriter();
let writes = 0;
const set = (path, value) => {
  writes += 1;
  if (!dryRun) writer.set(db.doc(path), value);
};

let covers = 0;
for (const r of rows) {
  const { id } = r;
  const name = text(cell(r, COL.name));
  const [firstName, ...rest] = name.split(/\s+/);
  const personId = `person-${id}`;
  // Profil reclame : `keepFilled` garde sa photo, ces valeurs ne servent pas.
  const { photoUrl, coverPhotoUrl } = photos.get(id) ?? { photoUrl: null, coverPhotoUrl: null };
  if (coverPhotoUrl) covers += 1;

  set(`people/${personId}`, keepFilled({
    ...stamps,
    firstName,
    lastName: rest.join(" "),
    displayName: name,
    email: "",
    altEmails: [],
    phone: null,
    whatsapp: null,
    linkedinUrl: null,
    photoUrl,
    slackUserId: null,
    uid: null,
    founderIds: [id],
    mentorId: null,
    investorId: null,
  }, claimedPeople.get(id)));
  const current = claimed.get(id);
  set(`founders/${id}`, keepFilled({
    ...stamps,
    ...scoped,
    personId,
    uid: null,
    claimedDateISOString: null,
    name,
    photoUrl,
    coverPhotoUrl,
    profileCategory: CATEGORY[select(r, COL.profileType)] ?? null,
    hardSkills: multi(r, COL.hardSkills),
    industries: multi(r, COL.industries),
    rolesICouldTake: [],
    trackRecordOneLiner: null,
    startupId: null,
    status: "enrolled",
    leftProgramReason: null,
    isExternalFounder: false,
    publicProfileConsent: false,
    stats: null,
  }, current));
  set(`founders/${id}/private/directory`, keepFilled({
    email: "",
    whatsapp: null,
    linkedinUrl: null,
    phone: null,
    slackUserId: null,
    gender: null,
    nationality: select(r, COL.nationality),
    country: null,
    introduceYourself: null,
    education: text(cell(r, COL.education)),
    degree: null,
    fieldOfStudy: null,
    yearsOfXP: null,
    notableCompanies: splitList(cell(r, COL.companies)),
    trackRecord: text(cell(r, COL.trackRecord)),
    trackRecord3Liners: [],
    interestedInWorkingOn: text(cell(r, COL.interestedIn)),
    hasExistingProject: null,
    projectExplanation: null,
    hasExistingCoFounders: null,
    openToJoinAnotherProject: null,
    mainStartup2025: null,
    lookingForCoFounder: null,
    coFounderTypeWanted: null,
    coFounderSkillsWanted: [],
    industriesToExplore: [],
  }, claimedDirectories.get(id)));
  set(`founders/${id}/private/profile`, {
    age: null,
    birthDayString: null,
    housingSupport: null,
    tShirtSize: null,
    enrolmentConfirmed: null,
  });
  set(`founders/${id}/private/internal`, { eloScore: null, eloMatchesCount: 0 });
}

// ---- Listes fermees : competences et secteurs du batch, avec leurs couleurs ------------
// Couleur de l'option Airtable sans sa nuance (`tealDark`, `blueBright` -> `teal`,
// `blue`), si elle est une teinte connue (TAG_COLORS, lu dans le modele compile :
// `npm --prefix functions run build`). Elle s'applique aussi aux valeurs deja
// connues (listes SP26).
const TAG_COLORS = new Set(createRequire(import.meta.url)("../functions/lib/shared/types/system.js").TAG_COLORS);
const tagColor = (airtableColor) => {
  const base = airtableColor?.match(/^[a-z]+/)?.[0];
  return TAG_COLORS.has(base) ? base : null;
};
const added = {};
for (const [key, label, column] of [
  ["hardSkills", "Hard skills", COL.hardSkills],
  ["industries", "Industries", COL.industries],
]) {
  const colors = new Map(Object.values(column.typeOptions?.choices ?? {}).map((c) => [c.name, tagColor(c.color)]));
  const current = (await db.doc(`lists/${key}`).get()).data();
  const known = new Set((current?.items ?? []).map((i) => i.value));
  const fresh = [...new Set(rows.flatMap((r) => multi(r, column)))].filter((v) => !known.has(v)).sort();
  const items = [...(current?.items ?? []), ...fresh.map((v) => ({ value: v, label: v, group: null, archived: false }))].map((i) => {
    const color = colors.get(i.value);
    return color ? { ...i, color } : i;
  });
  added[key] = fresh.length;
  if (JSON.stringify(items) !== JSON.stringify(current?.items)) {
    set(`lists/${key}`, { key, label: current?.label ?? label, items, updatedDateISOString: now });
  }
}

await writer.close();
const rowIds = new Set(rows.map((r) => r.id));
const stale = existing.filter((d) => !rowIds.has(d.id)).length;
console.log(
  `import-fa26: ${rows.length} founders, ${covers} cover photos, lists +${added.hardSkills} hard skills +${added.industries} industries, ` +
    `${writes} documents ${dryRun ? "to write (dry run, nothing written)" : "written"} (${onEmulator ? "emulators" : PROJECT_ID})` +
    (stale ? `; ${stale} founder(s) of ${BATCH_ID} are not in the Airtable view (left as is)` : ""),
);
