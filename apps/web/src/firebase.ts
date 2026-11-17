// Firebase wiring for the web app and the extension side panel. Config comes from VITE_FIREBASE_* (see .env.example).
// Nothing here runs at import time: `getFirebase()` returns null when the app is not configured, so every screen can
// show a plain "not configured" state instead of crashing.
//
// Two builds share this file. The web app and the build-it-yourself extension ("own") use App Check, anonymous Auth,
// Firestore and Remote Config. The public extension build (VITE_EXT_VARIANT=public) uses none of them: AI runs only on
// the device, so it needs only the app and the AI service. The other modules are imported dynamically inside a branch
// the bundler drops when the variant is "public", so their code (and the reCAPTCHA loader) is not in that bundle at all.
import { initializeApp, type FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { RemoteConfig } from "firebase/remote-config";
import { getAI, type AI } from "firebase/ai";
import { REMOTE_CONFIG_DEFAULTS, type RemoteConfigKey } from "@distill/engine";

interface CommonServices {
  app: FirebaseApp;
  ai: AI;
  /** Null in the public build, which has no account. */
  auth: Auth | null;
  /** Null in the public build, which fetches no Remote Config (the built-in defaults are in force). */
  remoteConfig: RemoteConfig | null;
  /** Remote Config values as activated at start-up (empty when none were fetched). */
  config: Partial<Record<RemoteConfigKey, string>>;
  /** How App Check was set up, for the status line. */
  appCheck: "recaptcha" | "debug" | "off";
}

/** Firestore is usable only when there is a signed-in (anonymous) user. The public build has neither. */
export type FirebaseServices = CommonServices & ({ uid: string; db: Firestore } | { uid: null; db: Firestore | null });

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

  // The public extension build: the AI service only. No App Check (no token is ever needed for ONLY_ON_DEVICE: the
  // SDK fetches one only for a cloud request), no Auth, no Firestore, no Remote Config fetch. The literal comparison
  // is replaced at build time, so everything after this block is dead code in that build and is dropped.
  if (import.meta.env.VITE_EXT_VARIANT === "public") {
    return { app, ai: getAI(app), auth: null, remoteConfig: null, config: {}, appCheck: "off", uid: null, db: null };
  }

  const [appCheckSdk, authSdk, firestoreSdk, remoteConfigSdk] = await Promise.all([
    import("firebase/app-check"),
    import("firebase/auth"),
    import("firebase/firestore"),
    import("firebase/remote-config"),
  ]);

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
    appCheckSdk.initializeAppCheck(app, {
      provider: new appCheckSdk.ReCaptchaEnterpriseProvider(siteKey ?? "debug-no-site-key"),
      isTokenAutoRefreshEnabled: true,
    });
    if (appCheck !== "debug") appCheck = "recaptcha";
  }

  // initializeAuth with IndexedDB persistence only: no popup/redirect resolver, so no remote script is loaded
  // (a Manifest V3 extension page may not load remote code).
  const auth = authSdk.initializeAuth(app, { persistence: authSdk.indexedDBLocalPersistence });
  let uid: string | null = null;
  try {
    uid = (auth.currentUser ?? (await authSdk.signInAnonymously(auth)).user).uid;
  } catch {
    uid = null; // anonymous sign-in not enabled yet: Firestore features stay off, the rest still works
  }

  const remoteConfig = remoteConfigSdk.getRemoteConfig(app);
  remoteConfig.defaultConfig = { ...REMOTE_CONFIG_DEFAULTS };
  remoteConfig.settings.minimumFetchIntervalMillis = env.DEV ? 0 : 60 * 60 * 1000;
  try {
    await remoteConfigSdk.fetchAndActivate(remoteConfig);
  } catch {
    /* defaults stay in force */
  }
  const config: CommonServices["config"] = {};
  for (const key of Object.keys(REMOTE_CONFIG_DEFAULTS) as RemoteConfigKey[]) {
    config[key] = remoteConfigSdk.getValue(remoteConfig, key).asString();
  }

  const db = firestoreSdk.getFirestore(app);
  const common = { app, ai: getAI(app), auth, remoteConfig, config, appCheck };
  return uid ? { ...common, uid, db } : { ...common, uid: null, db };
}

/** A Remote Config value, or its built-in default when Firebase is absent, the fetch failed or the build has none. */
export function remoteValue(services: FirebaseServices | null, key: RemoteConfigKey): string {
  return services?.config[key] || REMOTE_CONFIG_DEFAULTS[key];
}
