// r2-08 Remember this site: what is kept, how a kept item is found again on the next load, and the service worker's
// decision (pure), plus the chrome.storage.local round trip with chrome mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClutterItem } from "@distill/engine";
import {
  autoOpenOrigin, describePrefs, idsToShow, loadSites, originPattern, parseSites, prefsNow, samePrefs, saveSites, shouldAutoOpen,
  shownOf, siteName, siteOrigin, SITES_KEY, updateSite, withoutRemoved, type Sites,
} from "./sites";

const item = (id: string, kind: ClutterItem["kind"], label: string): ClutterItem => ({ id, kind, label });
const entry = (prefs: Partial<Sites[string]["prefs"]> = {}) => ({ since: 1, asked: true, prefs: { shown: [], ...prefs } });

describe("the site", () => {
  it("is an http(s) origin only, and its permission is that one origin", () => {
    expect(siteOrigin("https://www.idnes.cz/zpravy/a?b=1#c")).toBe("https://www.idnes.cz");
    expect(siteOrigin("http://127.0.0.1:5173/demo/article.html")).toBe("http://127.0.0.1:5173");
    for (const u of ["file:///C:/a.html", "chrome://settings", "data:text/html,x", "about:blank", "nonsense", undefined]) expect(siteOrigin(u)).toBeNull();
    expect(originPattern("https://www.idnes.cz")).toBe("https://www.idnes.cz/*");
    expect(siteName("https://www.idnes.cz")).toBe("www.idnes.cz");
  });
});

describe("items shown again", () => {
  const items = [item("c0", "header", "Site header"), item("c1", "ad", "Advert"), item("c2", "comments", "Comments"), item("c3", "ad", "Advert")];

  it("are kept by kind and label, one entry per item", () => {
    expect(shownOf({ items, restored: ["c2", "c3"] })).toEqual([{ kind: "comments", label: "Comments" }, { kind: "ad", label: "Advert" }]);
  });

  it("are found again on the next load whatever their ids, each kept entry matching one item", () => {
    const next = [item("c0", "cookie", "Cookie notice"), item("c1", "ad", "Advert"), item("c2", "ad", "Advert"), item("c3", "comments", "Comments")];
    expect(idsToShow(next, [{ kind: "comments", label: "Comments" }, { kind: "ad", label: "Advert" }])).toEqual(["c3", "c1"]);
    expect(idsToShow(next, [{ kind: "ad", label: "Advert" }, { kind: "ad", label: "Advert" }, { kind: "ad", label: "Advert" }])).toEqual(["c1", "c2"]);
    expect(idsToShow(next, [{ kind: "footer", label: "Footer" }])).toEqual([]);
  });
});

describe("the choices kept", () => {
  const items = [item("c0", "comments", "Comments"), item("c1", "footer", "Footer")];

  it("follow the strip: shown items, Keep <language> once the translation is done, comfort only once the page needed it", () => {
    const p = prefsNow({ shown: [] }, { items, restored: ["c1"], comfort: 0 }, { comfortKnown: true, translate: { phase: "done", showingSource: true } });
    expect(p).toEqual({ shown: [{ kind: "footer", label: "Footer" }], translate: "source", comfort: false });
    const q = prefsNow({ shown: [], translate: "source", comfort: false }, { items, restored: [], comfort: 0 }, { comfortKnown: false, translate: { phase: "translating", showingSource: false } });
    expect(q).toEqual({ shown: [], translate: "source", comfort: false });
    expect(prefsNow({ shown: [] }, { items, restored: [], comfort: 3 }, { comfortKnown: true, translate: { phase: "done", showingSource: false } }))
      .toEqual({ shown: [], translate: "translated", comfort: true });
  });

  it("keep an item shown again that this page does not have, for the pages that do", () => {
    const p = prefsNow({ shown: [{ kind: "related", label: "Related links" }] }, { items, restored: ["c0"], comfort: 0 }, { comfortKnown: false });
    expect(p.shown).toEqual([{ kind: "comments", label: "Comments" }, { kind: "related", label: "Related links" }]);
  });

  it("compare by value, and read as a list in More", () => {
    expect(samePrefs({ shown: [{ kind: "ad", label: "Advert" }], comfort: false }, { shown: [{ kind: "ad", label: "Advert" }], comfort: false })).toBe(true);
    expect(samePrefs({ shown: [] }, { shown: [], translate: "source" })).toBe(false);
    const name = (l: string) => (l === "cs" ? "Czech" : l);
    expect(describePrefs({ shown: [{ kind: "comments", label: "Comments" }, { kind: "footer", label: "Footer" }], translate: "source", comfort: false }, name, "cs"))
      .toEqual(["Shown again: Comments, Footer", "Kept in Czech, not translated", "Easier to read: off"]);
    expect(describePrefs({ shown: [] }, name)).toEqual([]);
  });

  it("drop what storage holds that is not well formed", () => {
    const raw = {
      "https://a.cz": { since: 5, asked: false, prefs: { shown: [{ kind: "ad", label: "Advert" }, { kind: 3 }], translate: "source", comfort: "yes" } },
      "https://b.cz/path": { since: 1, prefs: {} },
      "chrome://x": { since: 1, prefs: {} },
      "https://c.cz": { prefs: {} },
      "https://d.cz": { since: 2 },
    };
    expect(parseSites(raw)).toEqual({
      "https://a.cz": { since: 5, asked: false, prefs: { shown: [{ kind: "ad", label: "Advert" }], translate: "source" } },
      "https://d.cz": { since: 2, asked: true, prefs: { shown: [] } },
    });
    expect(parseSites(null)).toEqual({});
  });
});

describe("the service worker's decision", () => {
  const sites: Sites = { "https://www.idnes.cz": entry() };

  it("opens on a remembered site once it finished loading, and only while its permission is held", () => {
    const at = { status: "complete", url: "https://www.idnes.cz/zpravy", sites };
    expect(autoOpenOrigin(at)).toBe("https://www.idnes.cz");
    expect(shouldAutoOpen({ ...at, granted: true })).toBe(true);
    expect(shouldAutoOpen({ ...at, granted: false })).toBe(false);
    expect(shouldAutoOpen({ ...at, status: "loading", granted: true })).toBe(false);
    expect(shouldAutoOpen({ ...at, status: undefined, granted: true })).toBe(false);
    expect(shouldAutoOpen({ ...at, url: "https://www.seznam.cz/", granted: true })).toBe(false);
    expect(shouldAutoOpen({ ...at, url: "http://www.idnes.cz/", granted: true })).toBe(false); // another origin
    expect(shouldAutoOpen({ ...at, url: undefined, granted: true })).toBe(false); // Chrome hid the URL: no permission
  });

  it("forgets the sites whose permission Chrome took back, and a wider pattern takes every site it covered", () => {
    const many: Sites = { "https://www.idnes.cz": entry(), "https://a.example.org": entry(), "http://127.0.0.1:8080": entry() };
    expect(Object.keys(withoutRemoved(many, ["https://www.idnes.cz/*"]))).toEqual(["https://a.example.org", "http://127.0.0.1:8080"]);
    expect(Object.keys(withoutRemoved(many, ["*://*.example.org/*"]))).toEqual(["https://www.idnes.cz", "http://127.0.0.1:8080"]);
    expect(Object.keys(withoutRemoved(many, ["http://127.0.0.1/*"]))).toEqual(["https://www.idnes.cz", "https://a.example.org"]);
    expect(withoutRemoved(many, ["<all_urls>"])).toEqual({});
    expect(Object.keys(withoutRemoved(many, ["https://other.cz/*"]))).toHaveLength(3);
  });
});

describe("chrome.storage.local", () => {
  const local = new Map<string, unknown>();
  beforeEach(() => {
    local.clear();
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (k: string) => (local.has(k) ? { [k]: local.get(k) } : {})),
          set: vi.fn(async (o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) local.set(k, structuredClone(v)); }),
          remove: vi.fn(async (k: string) => { local.delete(k); }),
        },
      },
    };
  });

  it("keeps the sites under one key, and removes the key when the last site is forgotten", async () => {
    expect(await loadSites()).toEqual({});
    await updateSite("https://www.idnes.cz", () => entry({ comfort: false }));
    expect(local.get(SITES_KEY)).toEqual({ "https://www.idnes.cz": entry({ comfort: false }) });
    await updateSite("https://www.idnes.cz", (e) => (e ? { ...e, prefs: { shown: [{ kind: "ad", label: "Advert" }] } } : e));
    expect((await loadSites())["https://www.idnes.cz"]?.prefs.shown).toEqual([{ kind: "ad", label: "Advert" }]);
    await updateSite("https://www.idnes.cz", () => undefined);
    expect(local.has(SITES_KEY)).toBe(false);
    await saveSites({});
    expect(local.has(SITES_KEY)).toBe(false);
  });
});
