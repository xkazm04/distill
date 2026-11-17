// Firebase wiring for the web app and the extension side panel. Config comes from VITE_FIREBASE_* (see .env.example).
// Nothing here runs at import time: `getFirebase()` returns null when the app is not configured, so every screen can
// show a plain "not configured" state instead of crashing.
import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { initializeAuth, indexedDBLocalPersistence, signInAnonymously, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getRemoteConfig, fetchAndActivate, getValue, type RemoteConfig } from "firebase/remote-config";
import { getAI, type AI } from "firebase/ai";
import { REMOTE_CONFIG_DEFAULTS, type RemoteConfigKey } from "@distill/engine";

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  remoteConfig: RemoteConfig;
  ai: AI;
  /** The signed-in (anonymous) user's id; null when sign-in failed. */
  uid: string | null;
  /** How App Check was set up, for the status line. */
  appCheck: "recaptcha" | "debug" | "off";
}

const env = import.meta.env;

export function firebaseConfig() {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    appId: env.VITE_FIREBASE_APP_ID as string | undefined,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  };
}

export function isFirebaseConfigured(): boolean {
  const c = firebaseConfig();
  return Boolean(c.apiKey && c.projectId && c.appId);
}

const inExtension = () => typeof location !== "undefined" && location.protocol === "chrome-extension:";

let pending: Promise<FirebaseServices | null> | null = null;

export function getFirebase(): Promise<FirebaseServices | null> {
  if (!isFirebaseConfigured()) return Promise.resolve(null);
  pending ??= init().catch((e) => {
    pending = null;
    throw e;
  });
  return pending;
}

async function init(): Promise<FirebaseServices> {
  const app = initializeApp(firebaseConfig() as Record<string, string>);

  // App Check first, so every later SDK call carries a token. The extension (and local dev) cannot load the reCAPTCHA
  // script, so they use a debug token registered in the console; the hosted web app uses reCAPTCHA Enterprise.
  let appCheck: FirebaseServices["appCheck"] = "off";
  const debugToken = env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY as string | undefined;
  if ((inExtension() || env.DEV) && debugToken) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    appCheck = "debug";
  }
  if (siteKey || appCheck === "debug") {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey ?? "debug-no-site-key"),
      isTokenAutoRefreshEnabled: true,
    });
    if (appCheck !== "debug") appCheck = "recaptcha";
  }

  // initializeAuth with IndexedDB persistence only: no popup/redirect resolver, so no remote script is loaded
  // (a Manifest V3 extension page may not load remote code).
  const auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
  let uid: string | null = null;
  try {
    uid = (auth.currentUser ?? (await signInAnonymously(auth)).user).uid;
  } catch {
    uid = null; // anonymous sign-in not enabled yet: Firestore features stay off, the rest still works
  }

  const remoteConfig = getRemoteConfig(app);
  remoteConfig.defaultConfig = { ...REMOTE_CONFIG_DEFAULTS };
  remoteConfig.settings.minimumFetchIntervalMillis = env.DEV ? 0 : 60 * 60 * 1000;
  try {
    await fetchAndActivate(remoteConfig);
  } catch {
    /* defaults stay in force */
  }

  return { app, auth, db: getFirestore(app), remoteConfig, ai: getAI(app), uid, appCheck };
}

/** A Remote Config value, or its built-in default when Firebase is absent or the fetch failed. */
export function remoteValue(services: FirebaseServices | null, key: RemoteConfigKey): string {
  if (!services) return REMOTE_CONFIG_DEFAULTS[key];
  const v = getValue(services.remoteConfig, key).asString();
  return v || REMOTE_CONFIG_DEFAULTS[key];
}
