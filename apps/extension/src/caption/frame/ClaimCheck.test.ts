// Round 2, card 2: the web check in the strip. Asked once before anything is sent; after yes the top three claims are
// checked by themselves (once), every other one on a click; what is sent is the sentence, the title and the address
// without its query; every answer passes parseCheck; failures in plain words; the public build sends nothing.
import { createElement, Fragment, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Claim } from "@distill/engine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runGrounded = vi.fn();
let publicBuild = false;
vi.mock("@distill/web/ai", async (orig) => ({
  ...(await orig<typeof import("@distill/web/ai")>()),
  runGrounded: (...a: unknown[]) => runGrounded(...a),
  isOnDeviceOnlyBuild: () => publicBuild,
}));
const sent: unknown[] = [];
vi.mock("./send", () => ({
  tabId: 7,
  send: async (req: { type: string }) => {
    sent.push(req);
    if (req.type === "distill:caption:pageInfo") return { title: "City news", url: "https://news.example/a/story?name=Zqxvlenka#top", origin: "https://news.example" };
    throw new Error(`unexpected ${req.type}`);
  },
}));
vi.mock("./runTask", () => ({ canRunTask: async () => true, e2eFake: async () => null }));

let local: Record<string, unknown> = {};
(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: async (k: string) => (k in local ? { [k]: local[k] } : {}),
      set: async (o: Record<string, unknown>) => { Object.assign(local, o); },
    },
    session: { get: async () => ({}), set: async () => undefined },
  },
};

const { ClaimCheck, ChecksControls, useChecks, resetChecksForTest, addressOnly, chipWithChecks, CHECKS_KEY } = await import("./ClaimCheck");

const claims: Claim[] = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, blockId: `t${i}`, text: `Claim number ${i} says 4${i}% of people agree.`, why: "number" }));
const grounding = [{ title: "Example News", url: "https://example.com/a" }, { title: "Plain", url: "http://example.net/x" }];
const answer = (data: unknown = { verdict: "supported", reason: "Others say so." }) =>
  ({ data, grounding, queries: [], source: "in_cloud", ms: 1, reason: "Checked on the web in the cloud." });

function Harness(props: { claims: Claim[] }) {
  const checks = useChecks(props.claims);
  return createElement(Fragment, null,
    createElement(ChecksControls, { checks, claims: props.claims }),
    ...props.claims.map((c) => createElement("div", { key: c.id, "data-row": c.id }, createElement(ClaimCheck, { claim: c, checks }))));
}

let el: HTMLElement;
let root: Root;
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const $ = (sel: string) => el.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => Array.from(el.querySelectorAll<HTMLElement>(sel));
const row = (id: string) => $(`[data-row="${id}"]`)!;
const click = async (b: HTMLElement | null) => { expect(b).not.toBeNull(); await act(async () => { b!.click(); }); await flush(); };
const render = async (list = claims) => { await act(async () => { root.render(createElement(Harness, { claims: list })); }); await flush(); };

beforeEach(() => {
  resetChecksForTest();
  local = {};
  sent.length = 0;
  publicBuild = false;
  runGrounded.mockReset();
  runGrounded.mockImplementation(async () => answer());
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => root.unmount()); el.remove(); });

describe("consent", () => {
  it("asks once before anything is sent; nothing is sent while it waits", async () => {
    await render();
    expect($('[data-testid="cap-checks"]')?.textContent).toContain("Checking facts sends sentences of this page to Google. Check facts?");
    expect($$('[data-testid="cap-check-btn"]')).toHaveLength(5);
    expect(runGrounded).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("after Check facts, the top three are checked by themselves, in order, and the answer is stored on the device", async () => {
    await render();
    await click($('[data-testid="cap-check-agree"]'));
    expect(local[CHECKS_KEY]).toEqual({ consent: "yes", auto: true });
    expect(runGrounded).toHaveBeenCalledTimes(3);
    expect(runGrounded.mock.calls.map((c) => (c[2] as { claim: string }).claim)).toEqual(claims.slice(0, 3).map((c) => c.text));
    for (const id of ["c0", "c1", "c2"]) expect(row(id).querySelector('[data-testid="cap-check-verdict"]')?.textContent).toContain("Supported");
    for (const id of ["c3", "c4"]) expect(row(id).querySelector('[data-testid="cap-check-btn"]')).not.toBeNull();
    expect($('[data-testid="cap-checks-count"]')?.textContent).toBe("Checked 3 of 5 claims in the cloud.");
  });

  it("sends only the sentence, the title and the address without query or fragment", async () => {
    await render();
    await click($('[data-testid="cap-check-agree"]'));
    const [task, prompt] = runGrounded.mock.calls[0] as [string, string];
    expect(task).toBe("checkClaim");
    expect(prompt).toContain(claims[0]!.text);
    expect(prompt).toContain('source-title="City news"');
    expect(prompt).toContain('source-url="https://news.example/a/story"');
    expect(prompt).not.toContain("Zqxvlenka");
    expect(prompt).not.toContain(claims[1]!.text);
    expect(addressOnly("https://x.example/p?q=1#f")).toBe("https://x.example/p");
    expect(addressOnly("not a url")).toBe("");
  });

  it("Not now sends nothing and is remembered; a Check then asks again in its own row and checks only that claim", async () => {
    await render();
    await click($('[data-testid="cap-check-notnow"]'));
    expect(local[CHECKS_KEY]).toMatchObject({ consent: "no" });
    expect(runGrounded).not.toHaveBeenCalled();
    expect($('[data-testid="cap-check-consent"]')).toBeNull();
    await click(row("c3").querySelector('[data-testid="cap-check-btn"]'));
    expect(row("c3").querySelector('[data-testid="cap-check-consent"]')).not.toBeNull();
    expect(runGrounded).not.toHaveBeenCalled();
    await click(row("c3").querySelector('[data-testid="cap-check-agree"]'));
    // The pressed claim first; then the automatic top three, now that the person agreed.
    expect(runGrounded.mock.calls.map((c) => (c[2] as { claim: string }).claim)).toEqual([claims[3]!.text, claims[0]!.text, claims[1]!.text, claims[2]!.text]);
  });

  it("an earlier yes is not asked again; with the switch off nothing starts by itself, a click still checks", async () => {
    local[CHECKS_KEY] = { consent: "yes", auto: false };
    await render();
    expect($('[data-testid="cap-check-consent"]')).toBeNull();
    expect(runGrounded).not.toHaveBeenCalled();
    expect(($('[data-testid="cap-check-auto"]') as HTMLInputElement).checked).toBe(false);
    await click(row("c4").querySelector('[data-testid="cap-check-btn"]'));
    expect(runGrounded).toHaveBeenCalledTimes(1);
    await click($('[data-testid="cap-check-all"]'));
    expect(runGrounded).toHaveBeenCalledTimes(5);
    expect(($('[data-testid="cap-check-all"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("the switch is stored; switching it on runs the automatic part once", async () => {
    local[CHECKS_KEY] = { consent: "yes", auto: false };
    await render();
    await click($('[data-testid="cap-check-auto"]'));
    expect(local[CHECKS_KEY]).toEqual({ consent: "yes", auto: true });
    expect(runGrounded).toHaveBeenCalledTimes(3);
    await click($('[data-testid="cap-check-auto"]'));
    await click($('[data-testid="cap-check-auto"]'));
    expect(runGrounded).toHaveBeenCalledTimes(3);
  });
});

describe("a verdict", () => {
  beforeEach(() => { local[CHECKS_KEY] = { consent: "yes", auto: false }; });

  it("shows the word, where it ran, the reason, the service's sources as new-tab links, and what the door left out", async () => {
    runGrounded.mockImplementation(async () => answer({ verdict: "disputed", reason: "Officials give <b>a lower</b> number.", sources: ["https://made-up.example"] }));
    await render();
    await click(row("c0").querySelector('[data-testid="cap-check-btn"]'));
    const r = row("c0");
    expect(r.querySelector('[data-testid="cap-check-verdict"]')?.textContent).toMatch(/Disputed/);
    const where = r.querySelector('[data-testid="cap-check-where"]')!;
    expect(where.textContent).toBe("In the cloud");
    expect(where.getAttribute("data-src")).toBe("in_cloud");
    expect(where.getAttribute("title")).toMatch(/in the cloud, with Google Search\. Checked on the web in the cloud\./);
    expect(r.querySelector('[data-testid="cap-check-reason"]')?.textContent).toBe("Officials give a lower number.");
    const links = Array.from(r.querySelectorAll<HTMLAnchorElement>('[data-testid="cap-check-source"]'));
    expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.target, a.rel])).toEqual([["Example News", "https://example.com/a", "_blank", "noopener noreferrer"]]);
    expect(r.innerHTML).not.toContain("made-up");
    // HTML in the reason, the model's own link, the http source: three parts left out.
    expect(r.querySelector('[data-testid="cap-check-dropped"]')?.textContent).toBe("Distill left out 3 parts of the answer it could not trust.");
  });

  it("an answer the door refuses is a failure in plain words, with Try again", async () => {
    runGrounded.mockImplementation(async () => answer({ verdict: "true", reason: "x" }));
    await render();
    await click(row("c0").querySelector('[data-testid="cap-check-btn"]'));
    expect(row("c0").textContent).toContain("Not checked: The AI's answer could not be used.");
    expect(row("c0").querySelector('[data-testid="cap-check-retry"]')).not.toBeNull();
  });

  it("a busy service says so and offers Try again, which checks again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { AiError } = await import("@distill/web/ai");
    runGrounded.mockImplementationOnce(async () => { throw new AiError("busy"); });
    await render();
    await click(row("c1").querySelector('[data-testid="cap-check-btn"]'));
    expect(row("c1").textContent).toContain("Not checked: The AI is busy right now.");
    await click(row("c1").querySelector('[data-testid="cap-check-retry"]'));
    expect(row("c1").querySelector('[data-testid="cap-check-verdict"]')?.textContent).toContain("Supported");
  });

  it("App Check and a copy without AI fail without Try again", async () => {
    const { AiError } = await import("@distill/web/ai");
    runGrounded.mockImplementationOnce(async () => { throw new AiError("not-genuine"); });
    await render();
    await click(row("c0").querySelector('[data-testid="cap-check-btn"]'));
    expect(row("c0").textContent).toContain("Not checked: Distill could not prove it is genuine to the AI service.");
    expect(row("c0").querySelector('[data-testid="cap-check-retry"]')).toBeNull();
  });
});

describe("the strip's source chip", () => {
  const none = { src: "none", text: "No AI used", title: "Clean reads the page's own structure on this device. No AI is used and nothing is sent anywhere.", data: { "data-translate": "idle" } };
  const check = { claimId: "c0", verdict: "supported" as const, reason: "", sources: [] };
  it("stays as it is until a check is done", () => {
    expect(chipWithChecks(none, { checks: { c0: "checking" }, meta: {} })).toBe(none);
  });
  it("no longer says No AI used once a sentence was checked in the cloud", () => {
    const c = chipWithChecks(none, { checks: { c0: check, c1: check }, meta: { c0: { source: "in_cloud", why: "", dropped: 0 }, c1: { source: "in_cloud", why: "", dropped: 0 } } });
    expect(c).toMatchObject({ src: "in_cloud", text: "In the cloud", data: { "data-checks": "2" } });
    expect(c.title).toBe("2 claims checked on the web in the cloud: only each sentence, the page's title and its address were sent (and the day the page was published, when it says). Clean used no AI.");
  });
  it("a translation on the device plus a cloud check says In the cloud, and both on hover", () => {
    const device = { src: "on_device", text: "On this device", title: "The translation from Czech ran on this device.", data: {} };
    const c = chipWithChecks(device, { checks: { c0: check }, meta: { c0: { source: "in_cloud", why: "", dropped: 0 } } });
    expect(c.src).toBe("in_cloud");
    expect(c.title).toMatch(/^The translation from Czech ran on this device\. 1 claim checked on the web in the cloud/);
  });
});

describe("the public build (on the device only)", () => {
  it("shows no Check, asks nothing, sends nothing, and says why in one plain sentence", async () => {
    publicBuild = true;
    local[CHECKS_KEY] = { consent: "yes", auto: true };
    await render();
    expect($$('[data-testid="cap-check-btn"]')).toHaveLength(0);
    expect($('[data-testid="cap-check-consent"]')).toBeNull();
    expect($('[data-testid="cap-checks"]')?.textContent).toContain("Checking on the web needs the cloud; this version of Distill uses only the AI on this device.");
    expect(runGrounded).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});
