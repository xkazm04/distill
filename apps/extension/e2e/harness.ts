// The end-to-end harness: the built extension in a real Chromium, the demo pages from a local server, and the side
// panel opened as an ordinary extension page pinned to a tab (`sidepanel.html?tabId=<n>`).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test as base, type BrowserContext, type Page, type TestInfo, type Worker } from "playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_ROOT = resolve(here, "..");
const DIST = join(EXTENSION_ROOT, "dist");
const DEMO = resolve(EXTENSION_ROOT, "../web/public/demo");
export const OUT = join(here, "out");

/** The panel's size in the screenshots: about what Chrome gives a side panel. */
export const PANEL_SIZE = { width: 420, height: 800 };

/**
 * Console errors a scenario may show without failing. Each entry says why it is expected. Keep this short: every
 * line here is a message a person could see in DevTools.
 */
export const ALLOWED_CONSOLE_ERRORS: { pattern: RegExp; why: string }[] = [];

interface ConsoleError { page: string; text: string; allowed?: string }

/** How the browser was launched, for the report and the README. */
export const LAUNCH = {
  channel: process.env.E2E_CHANNEL || "chromium",
  headless: !process.env.E2E_HEADED,
};

/**
 * A copy of dist with a TEST-ONLY manifest: `host_permissions: ["<all_urls>"]`, so the panel can inject its content
 * script without the click on the toolbar icon (the activeTab grant) that a test cannot give. The real dist is never
 * written to. `grantHosts: false` keeps the shipped manifest unchanged.
 */
function prepareExtension(grantHosts: boolean): string {
  if (!existsSync(join(DIST, "manifest.json")) || !existsSync(join(DIST, "content.js"))) {
    throw new Error(`No built extension in ${DIST}. Run \`npm run build -w @distill/extension\` first (npm run e2e does).`);
  }
  const dir = mkdtempSync(join(tmpdir(), "distill-e2e-ext-"));
  cpSync(DIST, dir, { recursive: true });
  if (grantHosts) {
    const file = join(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    manifest.host_permissions = ["<all_urls>"];
    writeFileSync(file, JSON.stringify(manifest, null, 2));
  }
  return dir;
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

/** Serves apps/web/public/demo on 127.0.0.1, any free port. `/blank.html` is a tiny page for tests that need a tab. */
async function serveDemo(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    // No favicon: an empty answer, so the tab's console has no 404 that is not about Distill.
    if (path === "/favicon.ico") { res.writeHead(204).end(); return; }
    if (path === "/blank.html") {
      res.writeHead(200, { "content-type": TYPES[".html"] as string });
      res.end("<!doctype html><html lang=\"en\"><head><title>Blank</title></head><body><p>Blank test page.</p></body></html>");
      return;
    }
    const file = normalize(join(DEMO, path));
    if (!file.startsWith(DEMO + sep) || !existsSync(file)) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the demo server has no port");
  return { server, origin: `http://127.0.0.1:${addr.port}` };
}

export interface Tab { page: Page; id: number; url: string }

export class Distill {
  readonly errors: ConsoleError[] = [];
  /** The pages screenshotted at the end, by role. */
  panel: Page | null = null;
  tab: Page | null = null;
  private seq = 0;

  constructor(readonly context: BrowserContext, readonly worker: Worker, readonly extensionId: string, readonly origin: string) {
    // The service worker relays the Handrail port to the native host; its errors count too.
    worker.on("console", (m) => { if (m.type() === "error") this.errors.push({ page: "worker", text: m.text() }); });
  }

  watch(page: Page, role: string) {
    page.on("console", (m) => { if (m.type() === "error") this.errors.push({ page: role, text: `${m.text()} (${m.location().url})` }); });
    page.on("pageerror", (e) => this.errors.push({ page: role, text: `uncaught: ${e.message}` }));
  }

  /** The Chrome tab id of `page`, found from the service worker by a unique URL. */
  async tabIdOf(url: string): Promise<number> {
    const id = await this.worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
    if (typeof id !== "number") throw new Error(`no tab with ${url}`);
    return id;
  }

  /** Opens a demo page (article, form, pricing, blank) in a new tab. The URL carries a counter, so two tabs differ. */
  async openTab(name: string, role = "tab"): Promise<Tab> {
    const page = await this.context.newPage();
    this.watch(page, role);
    const url = `${this.origin}/${name}.html?t=${++this.seq}`;
    await page.goto(url);
    const id = await this.tabIdOf(url);
    this.tab ??= page;
    return { page, id, url };
  }

  /** Opens the side panel page at the panel's size. With a tab id it is pinned to that tab; without, it follows the active tab. */
  async openPanel(tabId?: number): Promise<Page> {
    const page = await this.context.newPage();
    this.watch(page, "panel");
    await page.setViewportSize(PANEL_SIZE);
    await page.goto(`chrome-extension://${this.extensionId}/sidepanel.html${tabId === undefined ? "" : `?tabId=${tabId}`}`);
    this.panel = page;
    return page;
  }

  /** Makes `tabId` the active tab of its window, as a person clicking it would. */
  activate(tabId: number) {
    return this.worker.evaluate(async (id) => { await chrome.tabs.update(id, { active: true }); }, tabId);
  }

  /** Screenshots of the panel and the tab, and every console error, into e2e/out/<scenario>-*. */
  async save(info: TestInfo) {
    mkdirSync(OUT, { recursive: true });
    const slug = info.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const shots: [Page | null, string][] = [[this.panel, "panel"], [this.tab, "tab"]];
    for (const [page, role] of shots) {
      if (!page || page.isClosed()) continue;
      const path = join(OUT, `${slug}-${role}.png`);
      try {
        await page.screenshot({ path, animations: "disabled" });
        info.attachments.push({ name: `${role}.png`, path, contentType: "image/png" });
      } catch (e) {
        this.errors.push({ page: role, text: `screenshot failed: ${e instanceof Error ? e.message : String(e)}`, allowed: "harness" });
      }
    }
    for (const err of this.errors) err.allowed ??= ALLOWED_CONSOLE_ERRORS.find((a) => a.pattern.test(err.text))?.why;
    writeFileSync(join(OUT, `${slug}-console.json`), JSON.stringify(this.errors, null, 2));
  }

  unexpectedErrors() { return this.errors.filter((e) => !e.allowed); }
}

interface Fixtures { distill: Distill; grantHosts: boolean }
interface WorkerFixtures { demo: { origin: string } }

export const test = base.extend<Fixtures, WorkerFixtures>({
  demo: [async ({}, use) => {
    const { server, origin } = await serveDemo();
    await use({ origin });
    await new Promise<void>((ok) => server.close(() => ok()));
  }, { scope: "worker" }],

  /** Override with `test.use({ grantHosts: false })` to run with the shipped manifest (no host access). */
  grantHosts: [true, { option: true }],

  distill: async ({ demo, grantHosts }, use, info) => {
    const ext = prepareExtension(grantHosts);
    const profile = mkdtempSync(join(tmpdir(), "distill-e2e-profile-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel,
      headless: LAUNCH.headless,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
        ?? await context.waitForEvent("serviceworker", { timeout: 15_000 }).catch(() => {
          throw new Error(`The extension did not load in channel "${LAUNCH.channel}". Branded Google Chrome ignores `
            + "--load-extension since Chrome 137; use the default (Playwright's Chromium) or E2E_CHANNEL=msedge.");
        });
      const extensionId = new URL(worker.url()).host;
      const d = new Distill(context, worker, extensionId, demo.origin);
      await use(d);
      await d.save(info);
      const bad = d.unexpectedErrors();
      expect(bad, `console errors (see e2e/out/*-console.json):\n${bad.map((e) => `[${e.page}] ${e.text}`).join("\n")}`).toEqual([]);
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
  },
});

export { expect };
