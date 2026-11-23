// r2-08: the one host permission "Always clean this site" asks Chrome for (`<origin>/*`, never <all_urls>).
//
// E2E ONLY: Playwright cannot press Chrome's permission prompt, and the e2e manifest already grants every site (so the
// harness can inject the content script without a toolbar click). A test that drives Remember switches a stand-in on
// for the session (chrome.storage.session, key below): a list of the origins "granted". request() then adds the origin
// as if the person pressed Allow, contains() and remove() read and change the list, and the service worker's
// __distillRemember.revoke() plays the person taking the site back in Chrome's settings. `vite build --mode e2e` keeps
// it; every other build replaces the MODE comparison at build time and the branch is dead code (like the fake model in
// Translate.tsx and the fake helper in background.ts).
import { originPattern } from "./sites";

export const E2E_FAKE_SITES_KEY = "distill:e2e:fakeSites";

async function fakeGrants(): Promise<string[] | null> {
  if (import.meta.env.MODE !== "e2e") return null;
  try {
    const got = (await chrome.storage.session.get(E2E_FAKE_SITES_KEY))[E2E_FAKE_SITES_KEY];
    return Array.isArray(got) ? (got as string[]) : null;
  } catch { return null; }
}

async function setFakeGrants(list: string[]): Promise<void> {
  await chrome.storage.session.set({ [E2E_FAKE_SITES_KEY]: list });
}

/** Whether Distill holds this site's permission now (the one actually granted, whatever More last showed). */
export async function hasSite(origin: string): Promise<boolean> {
  if (import.meta.env.MODE === "e2e") {
    const fake = await fakeGrants();
    if (fake) return fake.includes(origin);
  }
  return chrome.permissions.contains({ origins: [originPattern(origin)] }).catch(() => false);
}

/**
 * Asks Chrome for this one site. MUST be called inside the click (a user gesture): in a real build the request is the
 * first thing it does, with no await before it. Chrome shows its prompt over the tab, also when the click was in the
 * strip's frame (an extension page embedded in the page).
 */
export function requestSite(origin: string): Promise<boolean> {
  if (import.meta.env.MODE === "e2e") {
    return fakeGrants().then(async (fake) => {
      if (!fake) return chrome.permissions.request({ origins: [originPattern(origin)] });
      if (!fake.includes(origin)) await setFakeGrants([...fake, origin]);
      return true;
    });
  }
  return chrome.permissions.request({ origins: [originPattern(origin)] });
}

/** Gives the site's permission back to Chrome (Forget). */
export async function removeSite(origin: string): Promise<boolean> {
  if (import.meta.env.MODE === "e2e") {
    const fake = await fakeGrants();
    if (fake) { await setFakeGrants(fake.filter((o) => o !== origin)); return true; }
  }
  return chrome.permissions.remove({ origins: [originPattern(origin)] }).catch(() => false);
}

/** E2E ONLY (service worker): the stand-in list itself, for the test hooks. */
export const e2eFakeSites = { get: fakeGrants, set: setFakeGrants };
