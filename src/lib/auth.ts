import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

// ----------------------------
// Connexion par email et mot de passe (comme Trippple)
// ----------------------------
// Google se connecte par AuthContext (`signInWithGoogle`). Un compte cree par
// mot de passe a un email NON VERIFIE : il recoit un lien de confirmation, et
// rien ne se rattache a son profil avant (les regles exigent `email_verified`
// pour le rattachement automatique et pour une demande de rattachement).

/** Ou revient le lien des emails (confirmation, mot de passe) : la page d'accueil de l'app. */
const continueUrl = (path = "/") => ({ url: `${window.location.origin}${path}` });

const capitalize = (name: string) =>
  name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

export async function signInWithEmail(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
}

export async function registerWithEmail(firstName: string, lastName: string, email: string, password: string) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  await updateProfile(cred.user, { displayName: `${capitalize(firstName)} ${capitalize(lastName)}`.trim() });
  await sendEmailVerification(cred.user, continueUrl());
}

export async function resendVerificationEmail(user: FirebaseUser) {
  await sendEmailVerification(user, continueUrl());
}

export async function sendResetPasswordEmail(email: string) {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase(), continueUrl("/signin"));
}

/** Compte a mot de passe dont l'email n'est pas encore confirme. Un compte Google l'est toujours. */
export const needsEmailVerification = (user: FirebaseUser | null): boolean =>
  user !== null && !user.emailVerified && user.providerData.some((p) => p.providerId === "password");

// ---- Messages d'erreur ----------------------------------------------------------

/** Annulations volontaires : aucun message. */
const SILENT = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

const MESSAGES: Record<string, string> = {
  "auth/email-already-in-use": "An account already exists with this email. Sign in instead, or continue with Google.",
  "auth/invalid-email": "This email address is not valid.",
  "auth/weak-password": "Choose a password of at least 6 characters.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/invalid-credential":
    "Wrong email or password. If you signed up with Google, use Continue with Google. Invited by the Pioneers team? Use Forgot password to choose yours.",
  "auth/user-disabled": "This account is blocked. Contact the Pioneers team.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  "auth/network-request-failed": "No connection. Check your network and try again.",
  "auth/account-exists-with-different-credential": "This email already has an account with another sign-in method.",
  "auth/unauthorized-domain": "Sign-in is not enabled on this address yet. Contact the Pioneers team.",
};

/** Message a afficher, ou `null` pour une annulation volontaire. */
export function authErrorMessage(err: unknown): string | null {
  const code = (err as { code?: string }).code ?? "";
  if (SILENT.has(code)) return null;
  return MESSAGES[code] ?? "Something went wrong. Try again in a moment.";
}
