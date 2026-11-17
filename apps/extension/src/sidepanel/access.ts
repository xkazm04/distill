// Whether Distill may read the tab the panel shows. The extension holds no standing access: it reads a page with the
// activeTab grant from a click on its icon, or a site the person allowed from the panel (optional host permissions).
// A switched-to or re-navigated tab may have neither, which is a state to explain, never an error.

export type Access =
  /** The page answers: show the views. */
  | { kind: "ok" }
  /** Distill may not read this page yet. `origin` is the match pattern of its site, when Chrome tells the panel the
   *  address (it does only for pages Distill may read, or with the "tabs" permission). */
  | { kind: "needed"; origin?: string }
  /** No extension may read this page: browser pages, the Web Store, the PDF viewer, files without file access. */
  | { kind: "browser" };

export const ALL_SITES = "<all_urls>";

const BROWSER_SCHEME = /^(chrome|chrome-extension|chrome-search|chrome-untrusted|devtools|edge|about|view-source|brave|opera|vivaldi|data|blob|javascript|filesystem):/i;
/** Chrome's own refusals for pages no extension may script (the words of chrome.scripting's errors). */
const BROWSER_ERROR = /chrome:\/\/|chrome-extension:\/\/|chrome-search:\/\/|edge:\/\/|devtools:\/\/|extensions gallery|cannot be scripted|file:\/\//i;

/** Pages no extension may read, judged from the address alone. */
export function isBrowserPage(url: string | undefined, fileAccess: boolean): boolean {
  if (!url) return false;
  if (BROWSER_SCHEME.test(url)) return true;
  if (/^file:/i.test(url)) return !fileAccess;
  try {
    const u = new URL(url);
    if (u.hostname === "chromewebstore.google.com") return true;
    if (u.hostname === "chrome.google.com" && u.pathname.startsWith("/webstore")) return true;
  } catch {
    /* not a URL: judge by the error instead */
  }
  return false;
}

/** The permission pattern for the site of `url`: every page of that host. Undefined for anything but web pages and files. */
export function originPattern(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return `${u.protocol}//${u.hostname}/*`;
    if (u.protocol === "file:") return "file:///*";
  } catch {
    /* no site */
  }
  return undefined;
}

/** The site's name as the person knows it, for the button's explanation. */
export function siteName(pattern: string): string {
  return pattern === "file:///*" ? "files on this computer" : pattern.replace(/^\w+:\/\//, "").replace(/\/\*$/, "");
}

/**
 * Why the page could not be reached. `held`: Distill already holds the permission for this site (or all sites), so a
 * refusal now is the browser's, not the person's to give.
 */
export function classifyFailure(url: string | undefined, error: string, fileAccess: boolean, held: boolean): Access {
  if (isBrowserPage(url, fileAccess) || BROWSER_ERROR.test(error) || held) return { kind: "browser" };
  const origin = originPattern(url);
  return origin ? { kind: "needed", origin } : { kind: "needed" };
}

/** Asks the page to answer (injecting the content script when it can) and says what the panel should show. */
export async function checkAccess(host: { ping(): Promise<void> }, url: string | undefined): Promise<Access> {
  try {
    await host.ping();
    return { kind: "ok" };
  } catch (e) {
    const reason = e && typeof e === "object" && "reason" in e ? String((e as { reason: unknown }).reason) : String(e);
    const fileAccess = await chrome.extension.isAllowedFileSchemeAccess().catch(() => false);
    const pattern = originPattern(url) ?? ALL_SITES;
    const held = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
    return classifyFailure(url, reason, fileAccess, held);
  }
}

/** "Read this page": Chrome asks the person to let Distill read this site. Must run inside the click. */
export function requestSite(origin: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [origin] });
}

/** "Allow on all sites": Chrome asks the person to let Distill read any site. Must run inside the click. */
export function requestAllSites(): Promise<boolean> {
  return chrome.permissions.request({ origins: [ALL_SITES] });
}
