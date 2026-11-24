// The caption, measured: what the hermetic scenarios (caption.spec.ts, demo pages) and the live run (live/, real sites)
// both check. The numbers are the quality bar the R2-B prototype met (docs/caption.md, "Quality bar"); a real page must
// meet the same ones.
import { expect, type Frame, type Page, type Worker } from "playwright/test";

/** docs/caption.md, "Quality bar". Hard limits fail a run; `warn` limits only mark the report. */
export const BAR = {
  /** Distill's share of the window at first sight: R2-B measured 5.9% at 1440x900 and 14.1% at 390x844. */
  shareDesktop: 0.08,
  sharePhone: 0.15,
  /** From the click to the first-sight line (Clean done). */
  firstSightMs: 5000,
  firstSightWarnMs: 1500,
  /** Long paragraphs of the main text that must still be on screen after Clean. */
  contentKept: 0.85,
  contentKeptWarn: 0.95,
  /** Removed items that come back with Original. */
  originalBack: 0.9,
} as const;

/** Starts the caption on a tab the way the toolbar click does (the e2e build's service worker hook). */
export async function startCaption(worker: Worker, tabId: number): Promise<boolean> {
  return worker.evaluate(async (id) => {
    const hook = (globalThis as { __distillCaption?: { start(id: number): Promise<boolean> } }).__distillCaption;
    if (!hook) throw new Error("No caption hook in the service worker: run the e2e build (npm run build:e2e).");
    return hook.start(id);
  }, tabId);
}

/** The strip's frame (caption.html) in `page`, once it has loaded. */
export async function captionFrame(page: Page, timeout = 10_000): Promise<Frame> {
  const started = Date.now();
  for (;;) {
    const f = page.frames().find((fr) => fr.url().includes("/caption.html"));
    if (f) { await f.waitForLoadState("domcontentloaded"); return f; }
    if (Date.now() - started > timeout) throw new Error("The caption frame never appeared on the page.");
    await page.waitForTimeout(50);
  }
}

/** Waits until the strip says what Clean did and has stopped changing size; returns that line. */
export async function firstSight(frame: Frame, timeout = 15_000): Promise<string> {
  const status = frame.getByTestId("cap-status");
  await status.filter({ hasText: /^(Removed|Nothing to remove)/ }).waitFor({ timeout });
  await settled(frame.page());
  return (await status.textContent()) ?? "";
}

/** Resolves once the strip's box has kept one size and place for 300 ms (its slide-in and height transitions done). */
export async function settled(page: Page, timeout = 5_000): Promise<void> {
  await page.waitForFunction(() => new Promise<boolean>((done) => {
    const host = document.querySelector("distill-caption");
    if (!host) { done(false); return; }
    const box = () => { const r = host.getBoundingClientRect(); return `${r.top},${r.height}`; };
    const first = box();
    setTimeout(() => done(box() === first), 300);
  }), undefined, { timeout, polling: 50 });
}

/** The page before Distill: the main text's long paragraphs (marked, to find them again), the h1, the width. */
export interface Baseline { paragraphs: number; h1: string | null; media: string | null; scrollWidth: number; innerWidth: number; tall: boolean }

/** Marks the main text's long paragraphs with data-e2e-para and reads the baseline. Runs in the page. */
export function baseline(page: Page): Promise<Baseline> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 1 && r.height > 1;
    };
    // A paragraph in a fixed or sticky box is a cookie bar or a pop-up, never the main text.
    const floats = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) if (/fixed|sticky/.test(getComputedStyle(e).position)) return true;
      return false;
    };
    // A "paragraph" holding form controls is a widget, not text: a calendar's month picker reads as 120 characters of
    // option labels (Leden Únor Březen...; Štáhlavy's sidebar, 2026-11-22).
    const paras = Array.from(document.querySelectorAll("p")).filter((p) => visible(p) && !floats(p)
      && !p.querySelector("select, input, textarea, button") && (p.textContent ?? "").trim().length >= 120);
    // The main region: the deepest element that holds at least 60% of the long paragraphs' text.
    const len = (els: Element[]) => els.reduce((n, p) => n + (p.textContent ?? "").length, 0);
    const total = len(paras) || 1;
    let region: Element = document.body;
    for (;;) {
      const next = Array.from(region.children).find((c) => len(paras.filter((p) => c.contains(p))) >= total * 0.6);
      if (!next) break;
      region = next;
    }
    const main = paras.filter((p) => region.contains(p));
    main.forEach((p) => p.setAttribute("data-e2e-para", ""));
    const h1 = Array.from(document.querySelectorAll("h1")).find(visible);
    if (h1) h1.setAttribute("data-e2e-h1", "");
    // The page's main picture or video: the largest one at least 320 px wide in the first screen, not floating.
    const area = (el: Element) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    const media = Array.from(document.querySelectorAll("video, img, picture, iframe")).filter((m) => {
      const r = m.getBoundingClientRect();
      // The site's logo or a picture in its header is the site's, not the page's.
      const site = m.closest("header, nav, [role=banner]") || /logo/i.test(`${m.getAttribute("src") ?? ""} ${m.getAttribute("alt") ?? ""} ${m.parentElement?.className ?? ""}`);
      return visible(m) && !floats(m) && !site && r.width >= 320 && r.top < innerHeight;
    }).sort((a, b) => area(b) - area(a))[0];
    if (media) media.setAttribute("data-e2e-media", "");
    return {
      paragraphs: main.length,
      h1: h1 ? (h1.textContent ?? "").trim().slice(0, 120) : null,
      media: media ? `${media.localName} ${Math.round(media.getBoundingClientRect().width)}px` : null,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      tall: document.documentElement.scrollHeight > innerHeight + 200,
    };
  });
}

export interface Measure {
  viewport: { width: number; height: number };
  strip: { height: number; width: number; share: number; onTop: boolean; blockedBy: string[] };
  removed: number;
  contentKept: number;
  h1Kept: boolean;
  /** The main picture or video of the first screen (Baseline.media) is still on screen. */
  mediaKept: boolean;
  overflow: boolean;
  /** Fixed or sticky boxes still covering a quarter of the window (a cookie wall Clean missed). */
  overlaysLeft: string[];
  scrolls: boolean | null;
}

/** Measures the page with the caption on it. Runs in the page. */
export function measure(page: Page, base: Baseline): Promise<Measure> {
  return page.evaluate(async (b) => {
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 1 && r.height > 1;
    };
    const host = document.querySelector("distill-caption");
    const r = host?.getBoundingClientRect();
    const blockedBy: string[] = [];
    let onTop = !!r && r.height > 0;
    if (r && r.height > 0) {
      for (const fx of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2);
        if (hit !== host) { onTop = false; blockedBy.push(hit ? `${hit.localName}.${String(hit.className).slice(0, 40)}` : "nothing"); }
      }
    }
    const paras = Array.from(document.querySelectorAll("[data-e2e-para]"));
    const kept = paras.filter(visible).length;
    const h1 = document.querySelector("[data-e2e-h1]");
    const overlaysLeft = Array.from(document.body.querySelectorAll("*")).filter((el) => {
      if (el === host) return false;
      const pos = getComputedStyle(el).position;
      if (pos !== "fixed" && pos !== "sticky") return false;
      if (!visible(el)) return false;
      const q = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(q.right, innerWidth) - Math.max(q.left, 0));
      const h = Math.max(0, Math.min(q.bottom, innerHeight) - Math.max(q.top, 0));
      return w * h >= innerWidth * innerHeight * 0.25;
    }).map((el) => `${el.localName}${el.id ? `#${el.id}` : ""}.${String(el.className).slice(0, 40)}`);
    let scrolls: boolean | null = null;
    // Only a page still taller than the window must scroll (Clean can make a page short enough to fit).
    if (b.tall && document.documentElement.scrollHeight > innerHeight + 200) {
      const y = scrollY;
      scrollBy({ top: 300, behavior: "instant" });
      await new Promise((res) => requestAnimationFrame(() => res(null)));
      scrolls = scrollY !== y;
      scrollTo({ top: y, behavior: "instant" });
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      strip: { height: r?.height ?? 0, width: r?.width ?? 0, share: r ? (r.height * r.width) / (innerWidth * innerHeight) : 0, onTop, blockedBy },
      removed: document.querySelectorAll("[data-distill-hide]").length,
      contentKept: paras.length ? kept / paras.length : 1,
      h1Kept: !h1 || visible(h1),
      mediaKept: (() => { const m = document.querySelector("[data-e2e-media]"); return !m || visible(m); })(),
      overflow: document.documentElement.scrollWidth > Math.max(b.scrollWidth, b.innerWidth),
      overlaysLeft,
      scrolls,
    };
  }, base);
}

/** Share of the removed elements that are back on screen (Original on). Runs in the page. A cookie banner Distill
 *  answered (r3-04, data-distill-answered) is not counted: the site itself removes it once told no. */
export function shownAgain(page: Page): Promise<number> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("[data-distill-hide]:not([data-distill-answered])"));
    if (!els.length) return 1;
    return els.filter((el) => getComputedStyle(el).display !== "none").length / els.length;
  });
}

/** The strip's own font, to prove the page's CSS does not reach it. */
export function stripFont(frame: Frame): Promise<string> {
  return frame.getByTestId("cap-status").evaluate((el) => getComputedStyle(el).fontFamily);
}

/** r5-02: More is in parts behind a tab row. Shows the part that holds the section `testid` (clicks its tab unless it
 *  is the one showing), waiting for the section to be there. More must be open. */
export async function showPart(frame: Frame, testid: string, timeout = 10_000): Promise<void> {
  const panel = frame.locator(`[role="tabpanel"]:has([data-testid="${testid}"])`).first();
  await panel.waitFor({ state: "attached", timeout });
  const id = await panel.getAttribute("id");
  const tab = frame.locator(`[role="tab"][aria-controls="${id}"]`);
  if ((await tab.getAttribute("aria-selected")) !== "true") {
    // More just opened grows the strip upward: click the tab once it holds still, and again if a click missed.
    await settled(frame.page()).catch(() => undefined);
    await expect(async () => {
      if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click({ timeout: 2_000 });
      expect(await tab.getAttribute("aria-selected")).toBe("true");
    }).toPass({ timeout });
    await frame.locator(`#${id}:not([hidden])`).waitFor({ timeout });
    // A taller part grows the strip upward: wait until it holds still, so the next click lands where it aims.
    await settled(frame.page()).catch(() => undefined);
  }
  await frame.locator(`#${id}:not([hidden])`).waitFor({ timeout });
}

/** r5-10: chooses More's tab `tabTestid` (cap-tab-<part>) once the strip holds still, and again if a click missed. */
export async function chooseTab(frame: Frame, tabTestid: string, timeout = 10_000): Promise<void> {
  const tab = frame.getByTestId(tabTestid);
  await settled(frame.page()).catch(() => undefined);
  await expect(async () => {
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click({ timeout: 2_000 });
    expect(await tab.getAttribute("aria-selected")).toBe("true");
  }).toPass({ timeout });
  await settled(frame.page()).catch(() => undefined);
}

/** r5-02: opens More (if it is shut) on the part that holds the section `testid`. */
export async function openMoreAt(frame: Frame, testid: string, timeout = 10_000): Promise<void> {
  const btn = frame.getByTestId("cap-more-btn");
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  await frame.getByTestId("cap-more").waitFor({ timeout });
  await showPart(frame, testid, timeout);
}
