import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_STEPS_URL, Home } from "./Home";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
afterEach(() => { host?.remove(); host = null; });

async function paste(text: string, onPaste = vi.fn()) {
  host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<Home onPaste={onPaste} />));
  const area = host.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { (host?.querySelector("form") as HTMLFormElement).requestSubmit(); });
  return { note: host.querySelector('[data-testid="home-note"]'), onPaste, root };
}

describe("Home paste note", () => {
  it("answers a pasted URL with an action: paste the text, or follow the build-it-yourself steps", async () => {
    const { note, onPaste } = await paste("https://example.cz/form");
    expect(onPaste).not.toHaveBeenCalled();
    expect(note?.textContent).toContain("Copy the page text and paste it here");
    expect(note?.textContent).not.toMatch(/Install/);
    expect(note?.querySelector("a")?.getAttribute("href")).toBe(EXTENSION_STEPS_URL);
  });

  it("points the footer at the same steps", async () => {
    await paste("");
    const foot = host?.querySelector(".home-foot a");
    expect(foot?.getAttribute("href")).toBe(EXTENSION_STEPS_URL);
  });

  it("passes pasted text on", async () => {
    const { onPaste, note } = await paste("Dear Ms Novak, your permit expires on 1 March.");
    expect(note).toBeNull();
    expect(onPaste).toHaveBeenCalledOnce();
  });
});
