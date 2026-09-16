import { getApps, initializeApp } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
};

const hasPlaceholder = (value: string): boolean =>
  !value || value.includes("replace-me") || value.includes("your-project");
export const firebaseConfigured = !Object.values(config).some(hasPlaceholder);
export const firebaseApp: FirebaseApp | null = firebaseConfigured
  ? getApps()[0] ?? initializeApp(config)
  : null;
export const auth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

let appCheck: AppCheck | undefined;
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY ?? "";
if (appCheckSiteKey && firebaseApp && typeof window !== "undefined") {
  appCheck = initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export function subscribeToAuth(listener: (user: User | null) => void): () => void {
  if (!auth) {
    listener(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, listener);
}

export async function signIn(): Promise<User> {
  if (!firebaseConfigured) {
    throw new Error("Firebase web configuration is missing. Copy web/.env.example and configure the app.");
  }
  if (!auth) throw new Error("Firebase web configuration is missing.");
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOut(): Promise<void> {
  if (auth) await firebaseSignOut(auth);
}

export async function idToken(): Promise<string | null> {
  return auth?.currentUser?.getIdToken() ?? null;
}

/** Used only during the HTTPS OAuth consent handoff to the own Worker. */
export async function firebaseRefreshToken(): Promise<string | null> {
  return auth?.currentUser?.refreshToken ?? null;
}

export async function appCheckToken(): Promise<string | null> {
  if (!appCheck) return null;
  try {
    return (await getToken(appCheck, false)).token;
  } catch {
    return null;
  }
}
