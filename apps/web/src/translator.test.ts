// "Put into Czech" (L2) on a stubbed Chrome Translator: translated and back on the device, and with no translator a
// plain reason and nothing sent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alreadyIn, toFormLanguage, translatorState } from "./translator";

const DICT: Record<string, string> = { "en>cs:studies": "studium", "cs>en:studium": "studies" };

function stubTranslator(availability: (from: string, to: string) => string) {
  const create = vi.fn(async ({ sourceLanguage, targetLanguage }: { sourceLanguage: string; targetLanguage: string }) => ({
    translate: async (text: string) => DICT[`${sourceLanguage}>${targetLanguage}:${text}`] ?? `[${targetLanguage}] ${text}`,
    destroy: vi.fn(),
  }));
  globalThis.Translator = { availability: async ({ sourceLanguage, targetLanguage }) => availability(sourceLanguage, targetLanguage), create };
  return create;
}

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  delete (globalThis as { Translator?: unknown }).Translator;
  delete (globalThis as { LanguageDetector?: unknown }).LanguageDetector;
  vi.unstubAllGlobals();
});

describe("toFormLanguage", () => {
  it("puts an eligible answer into Czech and back, on this device", async () => {
    const create = stubTranslator(() => "available");
    const r = await toFormLanguage("studies", "en", "cs");
    expect(r).toMatchObject({ ok: true, translated: "studium", back: "studies", source: "on_device" });
    if (r.ok) expect(r.reason).toMatch(/only on this device/);
    expect(create).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with no Translator in the browser, says so in plain words and sends nothing", async () => {
    const r = await toFormLanguage("studies", "en", "cs");
    expect(r).toEqual({ ok: false, state: "unavailable", reason: expect.stringMatching(/built into Chrome.*not sent anywhere/) });
    expect(await translatorState("en", "cs")).toBe("unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with no pack for the pair, says so and never creates a translator", async () => {
    const create = stubTranslator((from) => (from === "uk" ? "unavailable" : "available"));
    const r = await toFormLanguage("навчання", "uk", "cs");
    expect(r).toMatchObject({ ok: false, state: "unavailable" });
    if (!r.ok) expect(r.reason).toBe("This device cannot translate from Ukrainian into Czech. Your answer was not sent anywhere.");
    expect(create).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a pack still to download in the local model's words, and translates once created", async () => {
    stubTranslator(() => "downloadable");
    expect(await translatorState("en", "cs")).toBe("downloadable");
    await expect(toFormLanguage("studies", "en", "cs")).resolves.toMatchObject({ ok: true, translated: "studium" });
  });

  it("a translator that throws gives a plain reason, not the raw error", async () => {
    globalThis.Translator = { availability: async () => "available", create: async () => ({ translate: async () => { throw new Error("NotAllowedError raw"); } }) };
    const r = await toFormLanguage("studies", "en", "cs");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toMatch(/NotAllowed/);
  });

  it("an empty answer or one already in the form's language is not translated", async () => {
    const create = stubTranslator(() => "available");
    expect((await toFormLanguage("  ", "en", "cs")).ok).toBe(false);
    expect((await toFormLanguage("studium", "cs", "cs")).ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("alreadyIn", () => {
  it("uses the on-device language detector when it is ready and sure, and says null otherwise", async () => {
    expect(await alreadyIn("studium", "cs")).toBeNull();
    globalThis.LanguageDetector = { availability: async () => "available", create: async () => ({ detect: async () => [{ detectedLanguage: "cs", confidence: 0.9 }] }) };
    expect(await alreadyIn("studium", "cs")).toBe(true);
    expect(await alreadyIn("studium", "uk")).toBe(false);
    globalThis.LanguageDetector = { availability: async () => "downloadable", create: async () => { throw new Error("no"); } };
    expect(await alreadyIn("studium", "cs")).toBeNull();
  });
});
