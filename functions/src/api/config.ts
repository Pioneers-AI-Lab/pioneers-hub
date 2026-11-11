// ----------------------------
// api - configuration
// ----------------------------
// L'ADRESSE PUBLIQUE VIENT DE LA CONFIG, JAMAIS DE L'EN-TETE `Host`. Derriere
// Firebase Hosting, la fonction voit l'hote `run.app` ; une adresse tiree de
// `Host` annoncerait la mauvaise ressource dans la decouverte OAuth, et Claude
// refuserait le connecteur (defaut vecu chez Trippple, `api/oauth/metadata.js`).
//
// Site Hosting `pioneers-hub-api` (firebase.json), reecrit vers la fonction
// `api`. En emulateur : l'emulateur Hosting (port 5102), qui reecrit pareil.

import { API_PUBLIC_URL } from "../shared/api";

const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";

export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? (isEmulator ? "http://127.0.0.1:5102" : API_PUBLIC_URL);

/** Le front, ou vivra la page de consentement OAuth. */
export const FRONTEND_BASE_URL =
  process.env.FRONTEND_BASE_URL ?? (isEmulator ? "http://localhost:3000" : "https://app-pioneers-hub.netlify.app");

export const MCP_URL = `${PUBLIC_BASE_URL}/mcp`;

/** Decouverte OAuth de /mcp (RFC 9728) : servie par oauth/router.ts, citee par le defi 401 de /mcp. */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";
