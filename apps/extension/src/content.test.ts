// The content script in a page: it keeps the block -> element map from its last read, points at a block or a step's
// fields on distill:locate without touching the filled-field outline, and tells the panel when the page changes.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PageModel } from "@distill/engine";
import type { ContentRequest, ContentResponse } from "./messages";

type Listener = (req: ContentRequest, sender: { id?: string }, send: (r: ContentResponse<unknown>) => void) => boolean;
let listener: Listener;
const sendMessage = vi.fn(async (_m: unknown) => undefined);

beforeAll(async () => {
  document.body.innerHTML = `<main>
    <h2>Opening hours</h2>
    <p id="p1">The office is open on Monday from eight in the morning until noon, and on Wednesday afternoon.</p>
    <form><label for="jmeno">Jméno</label><input id="jmeno"><label for="mesto">Město</label><input id="mesto"></form>
  </main>`;
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: "distill", onMessage: { addListener: (l: Listener) => { listener = l; } }, sendMessage },
  };
  await import("./content");
});

function ask<T>(req: ContentRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    listener(req, { id: "distill" }, (r) => (r.ok ? resolve(r.data as T) : reject(new Error(r.error))));
  });
}
const located = () => [...document.querySelectorAll("[data-distill-locate]")];

describe("distill:locate in the page", () => {
  it("points at the element a block was read from, by the last read", async () => {
    const page = await ask<PageModel>({ type: "distill:getPage" });
    const para = page.blocks.find((b) => b.text.startsWith("The office is open"))!;
    await ask({ type: "distill:locate", target: { blockId: para.id }, color: "#1a73e8" });
    expect(located()).toEqual([document.getElementById("p1")]);
    expect(document.getElementById("distill-locate-style")?.textContent).toContain("#1a73e8");
  });

  it("points at a step's fields, keeps the filled-field outline, and clears with null", async () => {
    await ask({ type: "distill:highlight", fieldIds: ["jmeno"], color: "#00aa55" });
    const filled = document.getElementById("jmeno")!;
    const outline = filled.style.outline;
    await ask({ type: "distill:locate", target: { fieldIds: ["jmeno", "mesto"] } });
    expect(located().map((e) => e.id)).toEqual(["jmeno", "mesto"]);
    expect(filled.style.outline).toBe(outline); // never touched
    await ask({ type: "distill:locate", target: null });
    expect(located()).toEqual([]);
    expect(filled.style.outline).toBe(outline);
  });

  it("ignores messages from anyone but Distill", () => {
    expect(listener({ type: "distill:ping" }, { id: "someone-else" }, () => undefined)).toBe(false);
  });
});

describe("distill:pageChanged", () => {
  it("tells the panel, with the reason only, when a form control appears", async () => {
    document.querySelector("form")!.insertAdjacentHTML("beforeend", `<input id="ulice" value="typed">`);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "distill:pageChanged", reason: "mutation" }), { timeout: 3000 });
  });
});
