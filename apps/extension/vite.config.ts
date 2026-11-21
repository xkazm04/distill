/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { guideLibrary } from "../../scripts/guides/library.mjs";

// Two builds of the extension (VITE_EXT_VARIANT, or `--mode public`):
// - "own" (default) -> dist: the build-it-yourself extension with your own Firebase project and App Check debug token.
// - "public" -> dist-public: AI only on the device (Firebase AI Logic ONLY_ON_DEVICE), no App Check, no Auth, no
//   Firestore, no Remote Config. Nothing in it is a credential, so it can be zipped and shared (npm run pack:extension).
export type Variant = "own" | "public";
export const variantOf = (mode: string): Variant =>
  mode === "public" || process.env.VITE_EXT_VARIANT === "public" ? "public" : "own";
export const outDirOf = (v: Variant) => (v === "public" ? "dist-public" : "dist");

/** What the toolbar icon opens (docs/caption.md): the side panel (today's default) or the caption strip on the page.
 *  A developer's own build chooses with VITE_SURFACE=caption in .env; the public build stays on the panel until the
 *  caption covers what the panel does. The caption code is in every build; only the icon's behaviour differs. */
export type Surface = "panel" | "caption";
export const surfaceOf = (variant: Variant, mode: string): Surface =>
  variant === "own" && mode !== "e2e" && mode !== "test" && loadEnv(mode, "../..", "VITE_").VITE_SURFACE === "caption" ? "caption" : "panel";

/** Build-time constants. The public build blanks both App Check inputs so no token or site key can be inlined. */
export const defineOf = (v: Variant, surface: Surface = "panel"): Record<string, string> => ({
  "import.meta.env.VITE_EXT_VARIANT": JSON.stringify(v),
  "import.meta.env.VITE_SURFACE": JSON.stringify(surface),
  ...(v === "public"
    ? { "import.meta.env.VITE_APPCHECK_DEBUG_TOKEN": JSON.stringify(""), "import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY": JSON.stringify("") }
    : {}),
});

// The public build never calls these SDKs (firebase.ts returns before it imports them, and apps/web/src/ui/data.ts
// writes to Firestore only when a user is signed in, which never happens there). A static import still bundles a
// module that registers itself on import, with its endpoints and, for Auth and App Check, the reCAPTCHA loader. So in
// this build they resolve to a stub that throws if anything ever calls it. A new import of a name missing here fails
// the build, on purpose: decide then whether the public build may have it. `npm run check:dist` is the second lock.
const PUBLIC_STUBS: Record<string, string[]> = {
  "firebase/app-check": ["initializeAppCheck", "ReCaptchaEnterpriseProvider", "ReCaptchaV3Provider", "CustomProvider", "getToken", "getLimitedUseToken"],
  "firebase/auth": ["initializeAuth", "getAuth", "indexedDBLocalPersistence", "browserLocalPersistence", "signInAnonymously", "onAuthStateChanged"],
  "firebase/firestore": ["getFirestore", "doc", "getDoc", "setDoc", "deleteDoc", "collection", "getDocs", "query", "where"],
  "firebase/remote-config": ["getRemoteConfig", "fetchAndActivate", "getValue", "getAll"],
};
const STUB_PREFIX = "\0distill-public-stub:";

function publicStubs(): Plugin {
  return {
    name: "distill-public-stubs",
    enforce: "pre",
    resolveId: (id) => (id in PUBLIC_STUBS ? STUB_PREFIX + id : null),
    load(id) {
      if (!id.startsWith(STUB_PREFIX)) return null;
      const mod = id.slice(STUB_PREFIX.length);
      const fail = `() => { throw new Error(${JSON.stringify(`${mod} is not part of the on-device public build`)}); }`;
      return (PUBLIC_STUBS[mod] ?? []).map((name) => `export const ${name} = ${fail};`).join("\n");
    },
  };
}

// Side panel and caption strip (React) and the background worker are one multi-entry build. The content script is a second build
// (vite.content.config.ts) because a content script must be a single classic script with no imports.
export default defineConfig(({ mode }) => {
  const variant = variantOf(mode);
  // The guide library is bundled (virtual:distill-guides): a lookup needs no network. Drafts only in a developer's own
  // build with VITE_GUIDE_DRAFTS=1; never in the public build, the e2e build or the tests.
  const drafts = variant === "own" && mode !== "e2e" && mode !== "test" && loadEnv(mode, "../..", "VITE_").VITE_GUIDE_DRAFTS === "1";
  return {
    plugins: [react(), guideLibrary({ as: "module", drafts }), ...(variant === "public" ? [publicStubs()] : [])],
    // Tests are hermetic: in test mode no .env is read (this package has none), so the main checkout with a real .env
    // runs the same tests as a worktree without one (the web app does the same).
    envDir: mode === "test" || mode === "e2e" ? "." : "../..",
    base: "./",
    define: { ...defineOf(variant, surfaceOf(variant, mode)), "import.meta.env.VITE_GUIDE_DRAFTS": JSON.stringify(drafts ? "1" : "") },
    build: {
      target: "es2022",
      outDir: mode === "e2e" ? "dist-e2e" : outDirOf(variant), // a test build never lands where a person loads the extension from
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: { sidepanel: "sidepanel.html", caption: "caption.html", background: "src/background.ts" },
        output: {
          entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        },
      },
    },
    test: { environment: "happy-dom", include: ["src/**/*.test.ts"] },
  };
});
