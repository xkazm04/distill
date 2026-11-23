// Spark round 5, r5-04 evidence (opt-in: E2E_KIT_SHOTS=before|after): each section of More on the demo pages, in light
// and dark, as element screenshots of the strip's frame. Run once on the old strip ("before") and once on the kit
// ("after"); the pictures go to E2E_EVIDENCE_DIR as r5-04-<section>-<phase>-<scheme>.jpg. Not part of the hermetic
// run's checks: it asserts only that each section is there to be pictured.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const PHASE = process.env.E2E_KIT_SHOTS ?? "";
const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");

async function fakeModel(worker: Worker, opts: Record<string, unknown> | null) {
  await worker.evaluate(async (o) => {
    if (o) await chrome.storage.session.set({ "distill:e2e:fakeAi": o });
    else await chrome.storage.session.remove("distill:e2e:fakeAi");
  }, opts);
}

async function sectionShot(frame: Frame, testid: string, name: string, scheme: string) {
  const el = frame.getByTestId(testid).first();
  await expect(el).toBeVisible({ timeout: 10_000 });
  await el.scrollIntoViewIfNeeded();
  mkdirSync(EVIDENCE, { recursive: true });
  await el.screenshot({ path: join(EVIDENCE, `r5-04-${name}-${PHASE}-${scheme}.jpg`), type: "jpeg", quality: 85, animations: "disabled" });
}

async function stripShot(page: Page, name: string, scheme: string) {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.locator("distill-caption").screenshot({ path: join(EVIDENCE, `r5-04-${name}-${PHASE}-${scheme}.jpg`), type: "jpeg", quality: 85, animations: "disabled" });
}

const PAGES: { page: string; fake: boolean; sections: [string, string][]; wait?: string }[] = [
  { page: "caption-claims", fake: true, wait: "cap-claim", sections: [["cap-gist", "gist"], ["cap-claims", "claims"], ["cap-checks", "checks"], ["cap-ask", "ask"], ["cap-tours", "tours"], ["cap-byline", "byline-claims"]] },
  { page: "caption-actions", fake: false, wait: "cap-action", sections: [["cap-actions", "actions"], ["cap-byline", "byline"], ["cap-tours", "tours-actions"]] },
  { page: "caption-autoservis", fake: false, wait: "cap-contact-item", sections: [["cap-contact", "contact"], ["cap-remember", "remember"], ["cap-consent-section", "consent"], ["cap-terms-section", "terms"], ["cap-dark-section", "dark"], ["cap-tables-section", "tables"]] },
  { page: "caption-shop", fake: false, wait: "cap-product-fact", sections: [["cap-product", "product"]] },
  { page: "caption-video", fake: false, wait: "cap-chapter", sections: [["cap-video", "video"]] },
  { page: "caption-hlaseni-zavad", fake: false, wait: "cap-form", sections: [["cap-form", "formcheck"]] },
  { page: "caption-lifecycle", fake: false, wait: "cap-calm", sections: [["cap-calm", "calm"]] },
  { page: "caption-comfort", fake: false, wait: "cap-comfort-section", sections: [["cap-comfort-section", "comfort"]] },
];

for (const scheme of ["light", "dark"] as const) {
  for (const p of PAGES) {
    test(`kit shots (${PHASE || "off"}): ${p.page}, ${scheme}`, async ({ distill }) => {
      test.skip(!PHASE, "evidence only: set E2E_KIT_SHOTS=before|after");
      const tab = await distill.openTab(p.page);
      const page = tab.page;
      await page.setViewportSize({ width: 1280, height: 1100 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await fakeModel(distill.worker, p.fake ? {} : null);
      expect(await startCaption(distill.worker, tab.id)).toBe(true);
      const frame = await captionFrame(page);
      await firstSight(frame);
      await frame.getByTestId("cap-more-btn").click();
      await expect(frame.getByTestId("cap-more")).toBeVisible();
      if (p.wait) await expect(frame.getByTestId(p.wait).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(400);
      await stripShot(page, `strip-${p.page}`, scheme);
      for (const [id, name] of p.sections) {
        if (await frame.getByTestId(id).count()) await sectionShot(frame, id, name, scheme);
      }
    });
  }
}
