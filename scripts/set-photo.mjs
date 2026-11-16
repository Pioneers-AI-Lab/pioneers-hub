// ----------------------------
// Photo d'un fondateur deposee par le staff (hors « Mon profil »)
// ----------------------------
// node scripts/set-photo.mjs <founderId> <image> [--prod]
// FIRESTORE_EMULATOR_HOST=... FIREBASE_STORAGE_EMULATOR_HOST=... node scripts/set-photo.mjs ... [--prod]   emulateurs
//
// Fait ce que fait « Mon profil » (src/lib/profile.ts saveProfilePhoto) : la
// grande photo (800 px, JPEG) dans `founders/{id}/photo-<horodatage>.jpg`, son
// URL a jeton dans `founders.coverPhotoUrl`, la vignette 128 px en data URL dans
// `photoUrl` (`people` et la fiche). Meme nom de fichier que l'app : un depot
// ulterieur du fondateur supprimera celui-ci. Sans --prod : a blanc.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";

// Code partage compile (`npm --prefix functions run build`).
const { docPaths } = createRequire(import.meta.url)("../functions/lib/shared/collections.js");

const [founderId, imagePath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const write = process.argv.includes("--prod");
if (!founderId || !imagePath) throw new Error("usage: node scripts/set-photo.mjs <founderId> <image> [--prod]");

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = onEmulator ? "demo-pioneers-hub" : "pioneers-3627c";
const BUCKET = onEmulator ? "demo-pioneers-hub.appspot.com" : "pioneers-3627c.firebasestorage.app";
const STORAGE_ENDPOINT = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0`
  : "https://firebasestorage.googleapis.com/v0";
initializeApp(onEmulator ? { projectId: PROJECT_ID } : { projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore();

const founder = await db.doc(docPaths.founder(founderId)).get();
if (!founder.exists) throw new Error(`fondateur ${founderId} introuvable (${PROJECT_ID})`);
const personId = founder.get("personId");

const original = readFileSync(imagePath);
const { width, height } = await sharp(original).metadata();
if (Math.min(width, height) < 400) throw new Error(`photo trop petite (${width} x ${height}), 400 px minimum`);
const thumb = await sharp(original).rotate().resize(128, 128, { fit: "cover", position: "attention" }).jpeg({ quality: 80 }).toBuffer();
const photoUrl = `data:image/jpeg;base64,${thumb.toString("base64")}`;
const cover = await sharp(original).rotate().resize(800, 800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();

console.log(`${PROJECT_ID} · ${founder.get("name")} · ${write ? "ECRITURE" : "a blanc"}`);
console.log(`vignette ${photoUrl.length} car. · grande photo ${cover.length} o · actuelle : ${founder.get("coverPhotoUrl") ?? "aucune"}`);
if (!write) process.exit(0);

const path = `founders/${founderId}/photo-${Date.now().toString(36)}.jpg`;
const token = randomUUID();
await getStorage().bucket(BUCKET).file(path).save(cover, {
  contentType: "image/jpeg",
  metadata: { cacheControl: "public, max-age=31536000", metadata: { firebaseStorageDownloadTokens: token } },
});
const coverPhotoUrl = `${STORAGE_ENDPOINT}/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

const batch = db.batch();
batch.set(db.doc(docPaths.person(personId)), { photoUrl, updatedDateISOString: new Date().toISOString() }, { merge: true });
batch.set(founder.ref, { photoUrl, coverPhotoUrl }, { merge: true });
await batch.commit();
console.log(`ecrit : ${coverPhotoUrl}`);
