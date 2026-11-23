// The proof page (r3-03) end to end, with the stand-in model: one click runs Translate, the claims, the gist, plain
// words and the web check on the three saved pages through the strip's own code, and the report (JSON and Markdown,
// both downloads) has every task with where it ran, how long it took and what the door left out. With the real models
// this is the page the owner runs in the developer build (docs/caption.md, "The proof page").
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, OUT, test } from "./harness";

const TASKS = ["translate", "claims", "gist", "plain", "check"];

test("proof: Run reports every task on every saved page; the report saves as JSON and Markdown", async ({ distill }) => {
  // No source named: the stand-in says on_device for the page tasks and in_cloud for the grounded web check.
  await distill.worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
  const page = await distill.context.newPage();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`chrome-extension://${distill.extensionId}/proof.html`);
  await expect(page.getByRole("heading", { name: "Distill proof run" })).toBeVisible();
  await expect(page.getByTestId("proof-save-json")).toBeDisabled();

  await page.getByTestId("proof-run").click();
  await expect(page.getByTestId("proof-status")).toHaveText("Done.", { timeout: 60_000 });
  await expect(page.getByTestId("proof-fixture")).toHaveCount(3);
  for (const id of ["denik", "aktualne", "praslavice"]) {
    await expect(page.locator(`[data-fixture="${id}"] [data-testid="proof-task"]`)).toHaveCount(5);
  }
  // The two articles: every task ran, the page tasks on the device (the stand-in says so), the web check in the cloud.
  for (const id of ["denik", "aktualne"]) {
    const row = (t: string) => page.locator(`[data-fixture="${id}"] [data-task="${t}"]`);
    for (const t of ["translate", "claims", "gist", "plain"]) {
      await expect(row(t), `${id} ${t}`).toHaveAttribute("data-status", "ok");
      await expect(row(t)).toHaveAttribute("data-src", "on_device");
    }
    await expect(row("check")).toHaveAttribute("data-status", "ok");
    await expect(row("check")).toHaveAttribute("data-src", "in_cloud");
    await expect(row("check")).toContainText("suggestions");
    // r4-03: the first check's Search Suggestions, in the strip's sealed frame (no scripts, no same origin).
    const sugg = page.locator(`[data-fixture="${id}"] [data-testid="cap-check-suggestions-frame"]`);
    await expect(sugg).toHaveCount(1);
    await expect(sugg).toHaveAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  }
  await expect(page.locator(`[data-fixture="praslavice"] [data-testid="cap-check-suggestions-frame"]`)).toHaveCount(0);
  // The village office's form page is not an article: no claims, no gist, so no check; translated and plain words.
  const office = (t: string) => page.locator(`[data-fixture="praslavice"] [data-task="${t}"]`);
  await expect(office("translate")).toHaveAttribute("data-status", "ok");
  for (const t of ["claims", "gist", "check"]) await expect(office(t)).toHaveAttribute("data-status", "skipped");

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, "r3-03-proof.jpg"), type: "jpeg", quality: 85, fullPage: true });

  // The report as JSON: every task of every page, with where it ran, its time and the door's count.
  const dl = page.waitForEvent("download");
  await page.getByTestId("proof-save-json").click();
  const json = await dl;
  expect(json.suggestedFilename()).toMatch(/^distill-proof-.*\.json$/);
  const report = JSON.parse(readFileSync((await json.path())!, "utf8")) as {
    kind: string; reader: string; available: boolean; model: { before: string; after: string };
    fixtures: { id: string; clean: { kind: string; blocks: number }; tasks: { task: string; status: string; source?: string; ms: number; dropped: number; calls: number; answer?: unknown; error?: unknown }[] }[];
  };
  expect(report.kind).toBe("distill-proof-report");
  expect(report.available).toBe(true);
  expect(report.model.before).toMatch(/^(unavailable|downloadable|downloading|available|error)$/);
  expect(report.fixtures.map((f) => f.id)).toEqual(["denik", "aktualne", "praslavice"]);
  for (const f of report.fixtures) {
    expect(f.tasks.map((t) => t.task)).toEqual(TASKS);
    for (const t of f.tasks) {
      expect(typeof t.ms, `${f.id} ${t.task}`).toBe("number");
      expect(typeof t.dropped).toBe("number");
      expect(typeof t.calls).toBe("number");
      if (t.status === "ok") {
        expect(t.source, `${f.id} ${t.task}`).toMatch(/^(on_device|in_cloud)$/);
        expect(t.answer).toBeTruthy();
        expect(t.calls).toBeGreaterThan(0);
      }
    }
  }
  const denik = report.fixtures[0]!;
  expect(denik.clean.kind).toBe("article");
  const check = denik.tasks.find((t) => t.task === "check")!;
  // Three claims checked (as the strip checks the top three by itself); each stand-in answer has one http source the
  // door leaves out, and Search Suggestions that passed their door.
  expect(check.calls).toBe(3);
  expect(check.dropped).toBe(3);
  expect((check.answer as { checks: { verdict: string; suggestions: boolean }[] }).checks.every((c) => c.verdict === "supported" && c.suggestions)).toBe(true);
  const tr = denik.tasks.find((t) => t.task === "translate")!.answer as { from: string; to: string; translated: number; total: number };
  expect(tr.from).toBe("cs");
  expect(tr.to).toBe(report.reader);
  expect(tr.translated).toBeGreaterThan(5);

  // And as Markdown, with the same rows.
  const dl2 = page.waitForEvent("download");
  await page.getByTestId("proof-save-md").click();
  const md = readFileSync((await (await dl2).path())!, "utf8");
  expect(md).toContain("# Distill proof report");
  expect(md).toMatch(/\| check \| ok \| in cloud \| \d+ ms \| 3 \| 3 \| supported/);
  expect(md).toMatch(/\| claims \| skipped \| - \| 0 ms \| 0 \| 0 \| skipped: not an article/);
});
