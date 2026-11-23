// Spark universal-core round 2, card 7: where a link goes, read from the link alone. No request is ever made: the site,
// the redirect target, the file type and the tracking tags are all in the address itself.
//
// The rules, in order:
// 1. The kind: mailto:, tel:/callto:/sms:, javascript:, a #anchor on this same page, or a web (http/https) address.
// 2. A known redirector is unwrapped when its target is IN the address (google.com/url?q=, l.facebook.com/l.php?u=,
//    out.reddit.com?url=, youtube.com/redirect?q=, Outlook safe links, ...). A shortener (t.co, bit.ly) hides its
//    target: the note then names only the shortener's site.
// 3. "Leaves this site" compares registrable domains (praslavice.cz for www.praslavice.cz and mapy.praslavice.cz),
//    with a short list of two-part suffixes (co.uk, com.au, ...) and shared hosts (github.io, webnode.cz, ...).
// 4. The file type comes from the path's extension.
// 5. Tracking tags (TRACKING below) are taken out of the target's query; the rest of the address stays byte for byte.

export interface LinkNote {
  /** The host as a person reads it ("praslavice.cz"), after unwrapping a known redirector. */
  site: string;
  /** The link leaves the page's site (registrable domain differs). */
  leaves: boolean;
  /** "PDF", "DOCX", "ZIP" ... when the address names a file type. */
  fileType?: string;
  /** The real target when the link goes through a redirector (google.com/url?q=, l.facebook.com, ...). */
  unwrapped?: string;
  /** The address without tracking tags (utm_*, fbclid, gclid, ...) and without the redirector, when it had either. */
  clean?: string;
  /** Names of the tracking tags taken out. */
  tracking: string[];
  /** mailto:, tel:, javascript: or a same-page #anchor: no note needed. */
  kind: "web" | "mail" | "phone" | "anchor" | "script" | "other";
}

/** Tracking tags taken out wherever they appear (lower case). Plus every `utm_*`. */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid", "li_fat_id",
  "mc_eid", "mc_cid", "_hsenc", "_hsmi", "__hstc", "__hssc", "__hsfp", "hsctatracking", "igshid", "igsh", "mkt_tok",
  "oly_anon_id", "oly_enc_id", "_openstat", "vero_id", "wickedid", "rb_clickid", "s_cid", "ef_id", "srsltid",
  // Seznam's Sklik click id (Czech search ads).
  "sznclid",
]);
/** Tags that track only on some sites (a share link's `si`): taken out there and nowhere else. */
const SITE_TRACKING: { host: RegExp; params: ReadonlySet<string> }[] = [
  { host: /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/, params: new Set(["si"]) },
];

/** File types a person may want to know before they click (lower-case extension -> what the note says). */
const FILE_TYPES: Record<string, string> = {
  pdf: "PDF", doc: "DOC", docx: "DOCX", xls: "XLS", xlsx: "XLSX", ppt: "PPT", pptx: "PPTX", odt: "ODT", ods: "ODS",
  odp: "ODP", rtf: "RTF", csv: "CSV", zip: "ZIP", rar: "RAR", "7z": "7Z", gz: "GZ", tgz: "TGZ", jpg: "JPG", jpeg: "JPG",
  png: "PNG", gif: "GIF", webp: "WEBP", svg: "SVG", mp3: "MP3", wav: "WAV", mp4: "MP4", mov: "MOV", avi: "AVI",
  exe: "EXE", msi: "MSI", apk: "APK", dmg: "DMG", iso: "ISO", bat: "BAT", cmd: "CMD", scr: "SCR",
};
/** File types that run as a program on the person's computer or phone: the note says so. */
export const PROGRAM_FILE_TYPES: ReadonlySet<string> = new Set(["EXE", "MSI", "APK", "DMG", "BAT", "CMD", "SCR"]);

/** Redirectors whose target is in the address: host (registrable or exact) + path -> the parameter holding it. */
const REDIRECTORS: { host: RegExp; path: RegExp; param: string[] }[] = [
  { host: /(^|\.)google\.[a-z.]+$/, path: /^\/url$/, param: ["q", "url"] },
  { host: /^(l|lm)\.facebook\.com$|^l\.messenger\.com$/, path: /^\/l\.php$/, param: ["u"] },
  { host: /^l\.instagram\.com$/, path: /^\/$/, param: ["u"] },
  { host: /^out\.reddit\.com$/, path: /.*/, param: ["url"] },
  { host: /(^|\.)youtube\.com$/, path: /^\/redirect$/, param: ["q"] },
  { host: /\.safelinks\.protection\.outlook\.com$/, path: /.*/, param: ["url"] },
  { host: /^slack-redir\.net$/, path: /^\/link$/, param: ["url"] },
  { host: /^t\.umblr\.com$/, path: /^\/redirect$/, param: ["z"] },
  { host: /^steamcommunity\.com$/, path: /^\/linkfilter\/?$/, param: ["url", "u"] },
  { host: /^(m\.)?vk\.com$/, path: /^\/away\.php$/, param: ["to"] },
  { host: /^away\.vk\.com$/, path: /.*/, param: ["to"] },
  { host: /^(www\.)?linkedin\.com$/, path: /^\/redir\/redirect\/?$/, param: ["url"] },
  { host: /^href\.li$/, path: /.*/, param: [] }, // href.li/?https://target: the target is the whole query
];

/** Two-part public suffixes (a name under them is one owner) and shared hosts (each subdomain is another owner). */
const TWO_PART = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk", "nhs.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "co.nz", "org.nz", "govt.nz", "co.jp", "ne.jp", "or.jp", "ac.jp",
  "go.jp", "co.kr", "or.kr", "com.br", "com.cn", "com.mx", "co.za", "co.in", "org.in", "gov.in", "com.tr", "com.ua",
  "com.pl", "net.pl", "org.pl", "co.il", "org.il", "com.sg", "com.hk", "com.tw", "com.ar", "co.id", "co.th", "com.my",
  // Shared hosts: each name under them is somebody else's site.
  "github.io", "gitlab.io", "blogspot.com", "wordpress.com", "web.app", "firebaseapp.com", "netlify.app", "vercel.app",
  "pages.dev", "herokuapp.com", "webnode.cz", "webnode.com", "webnode.sk", "estranky.cz", "estranky.sk", "mypage.cz",
  "rajce.idnes.cz", "blog.idnes.cz", "sites.google.com", "wixsite.com", "weebly.com", "azurewebsites.net",
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The registrable domain of a host: "praslavice.cz" for "www.mapy.praslavice.cz", "bbc.co.uk" for "news.bbc.co.uk". */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || IPV4.test(h) || h.includes(":") || h.startsWith("[") || !h.includes(".")) return h;
  const parts = h.split(".");
  // The longest listed suffix decides how many labels the owner's name takes.
  for (let n = Math.min(parts.length - 1, 3); n >= 2; n--) {
    if (TWO_PART.has(parts.slice(-n).join("."))) return parts.slice(-(n + 1)).join(".");
  }
  return parts.slice(-2).join(".");
}

// ---- Punycode (RFC 3492), so a Czech IDN reads as it is written: xn--obec-pslavice-xxx.cz -> obec-přáslavice.cz ----
const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700;
function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) { d = Math.floor(d / (BASE - TMIN)); k += BASE; }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}
function decodeLabel(label: string): string {
  const input = label.slice(4);
  const out: number[] = [];
  const dash = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(dash, 0); j++) out.push(input.charCodeAt(j));
  let n = 128, i = 0, bias = 72;
  for (let idx = dash > 0 ? dash + 1 : 0; idx < input.length;) {
    const old = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (idx >= input.length) throw new Error("bad punycode");
      const c = input.charCodeAt(idx++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : BASE;
      if (digit >= BASE) throw new Error("bad punycode");
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    bias = adapt(i - old, out.length + 1, old === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}
/** A host as a person reads it: IDN labels decoded, no leading "www.". */
export function readableHost(host: string): string {
  const h = host.toLowerCase().replace(/^www\d?\./, "");
  return h.split(".").map((l) => {
    if (!l.startsWith("xn--")) return l;
    try { return decodeLabel(l); } catch { return l; }
  }).join(".");
}

const parse = (href: string, base?: string): URL | null => {
  try { return base === undefined ? new URL(href) : new URL(href, base); } catch { return null; }
};
const web = (u: URL | null): u is URL => !!u && (u.protocol === "http:" || u.protocol === "https:");

/** The query's raw pairs, as written (nothing re-encoded). */
const pairs = (search: string): string[] => search.replace(/^\?/, "").split("&").filter(Boolean);
const keyOf = (pair: string): string => {
  const raw = pair.split("=")[0] ?? "";
  try { return decodeURIComponent(raw.replace(/\+/g, " ")); } catch { return raw; }
};
const valueOf = (pair: string): string => {
  const raw = pair.slice(pair.indexOf("=") + 1);
  if (!pair.includes("=")) return "";
  try { return decodeURIComponent(raw.replace(/\+/g, " ")); } catch { return raw; }
};

/** The target a redirector holds in its address, or null. */
function unwrapOnce(u: URL): URL | null {
  const host = u.hostname.toLowerCase();
  for (const r of REDIRECTORS) {
    if (!r.host.test(host) || !r.path.test(u.pathname)) continue;
    // Google sends both q= and url=, one of them empty: the first that holds a web address.
    const all = pairs(u.search);
    const candidates = r.param.length
      ? r.param.flatMap((name) => all.filter((x) => keyOf(x) === name).map(valueOf))
      : [decodeURIComponentSafe(u.search.slice(1))];
    for (const c of candidates) {
      const t = c ? parse(c) : null;
      if (web(t)) return t;
    }
  }
  return null;
}
function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** The address with its tracking tags taken out; null when it had none. */
function stripTracking(u: URL): { url: string; tags: string[] } | null {
  if (!u.search) return null;
  const host = u.hostname.toLowerCase();
  const local = SITE_TRACKING.filter((s) => s.host.test(host)).flatMap((s) => [...s.params]);
  const tags: string[] = [];
  const kept = pairs(u.search).filter((p) => {
    const k = keyOf(p);
    const lower = k.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower) || local.includes(lower)) { tags.push(k); return false; }
    return true;
  });
  if (!tags.length) return null;
  const query = kept.length ? `?${kept.join("&")}` : "";
  return { url: `${u.origin}${u.pathname}${query}${u.hash}`, tags };
}

/** The file type the path's extension names, if it is one a person may want to know about. */
function fileTypeOf(u: URL): string | undefined {
  const last = u.pathname.split("/").pop() ?? "";
  const m = /\.([a-z0-9]{1,4})$/i.exec(decodeURIComponentSafe(last));
  return m ? FILE_TYPES[(m[1] as string).toLowerCase()] : undefined;
}

/** What a link is, from its href and the page's address. Reads the address only: nothing is fetched. */
export function describeLink(href: string, pageUrl: string): LinkNote {
  const raw = href.trim();
  const none = (kind: LinkNote["kind"]): LinkNote => ({ site: "", leaves: false, tracking: [], kind });
  if (/^mailto:/i.test(raw)) return none("mail");
  if (/^(tel|callto|sms):/i.test(raw)) return none("phone");
  if (/^javascript:/i.test(raw)) return none("script");
  if (raw === "" || raw.startsWith("#")) return none("anchor");
  const page = parse(pageUrl);
  const link = parse(raw, page ? page.href : undefined);
  if (!web(link)) return none("other");
  // The same page with only another #fragment: an anchor.
  if (page && link.hash && link.origin === page.origin && link.pathname === page.pathname && link.search === page.search) return none("anchor");

  // Unwrap known redirectors (a redirect to a redirect: up to three).
  let target = link;
  for (let i = 0; i < 3; i++) {
    const next = unwrapOnce(target);
    if (!next) break;
    target = next;
  }
  const unwrapped = target !== link ? target.href : undefined;
  const stripped = stripTracking(target);
  const clean = stripped?.url ?? unwrapped;
  const pageHost = page ? page.hostname || page.host : "";
  const leaves = registrableDomain(target.hostname) !== registrableDomain(pageHost);
  const fileType = fileTypeOf(target);
  const note: LinkNote = { site: readableHost(target.hostname), leaves, tracking: stripped?.tags ?? [], kind: "web" };
  if (fileType) note.fileType = fileType;
  if (unwrapped) note.unwrapped = unwrapped;
  if (clean) note.clean = clean;
  return note;
}
