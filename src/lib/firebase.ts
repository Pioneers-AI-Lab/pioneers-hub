import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { FUNCTIONS_REGION, type CallableName, type CallableRequest, type CallableResponse } from "@shared/callables";

// ----------------------------
// Firebase cote navigateur
// ----------------------------
// Configuration par variables d'environnement (voir .env.example). En local,
// `NEXT_PUBLIC_USE_EMULATORS=true` branche Auth, Firestore et Functions sur
// les emulateurs, avec le projet de demo `demo-pioneers-hub` (aucun projet
// reel n'est touche).

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

const isFirstInit = getApps().length === 0;
const app = isFirstInit ? initializeApp(firebaseConfig) : getApp();

// Cache IndexedDB en production : les documents deja vus s'affichent sans
// attendre le reseau au retour sur une page. En dev, cache memoire : le HMR
// reevalue ce module a chaque sauvegarde et le cache persistant se battrait
// pour son verrou entre deux evaluations (lecon Trippple).
function createDb() {
  if (!isFirstInit) return getFirestore(app);
  return initializeFirestore(app, {
    localCache:
      process.env.NODE_ENV === "production" && !useEmulators
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache(),
  });
}

export const db = createDb();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const functions = getFunctions(app, FUNCTIONS_REGION);

// Les emulateurs ne se branchent qu'une fois par instance : le HMR reevalue ce
// module, et un second `connect*Emulator` leve une erreur.
if (useEmulators && isFirstInit) {
  connectAuthEmulator(auth, "http://127.0.0.1:9199", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8180);
  connectFunctionsEmulator(functions, "127.0.0.1", 5101);
}

/**
 * Callable typee par son nom : la requete et la reponse viennent de
 * shared/callables.ts, le contrat que l'implementation serveur respecte aussi.
 *
 *   const health = call("health");
 *   const { data } = await health({});
 */
export function call<K extends CallableName>(name: K, options?: { timeout?: number }) {
  return httpsCallable<CallableRequest<K>, CallableResponse<K>>(functions, name, options);
}
