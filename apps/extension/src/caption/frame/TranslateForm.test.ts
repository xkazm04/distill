// A form in your language (r4-04), the frame side: when the form's error messages can be translated (a ready model on
// this device only), and what the status line and the chip say about the form's words and its errors.
import { describe, expect, it } from "vitest";
import type { CleanReport } from "../../messages";
import { errorsWords, languagePart } from "./status";
import { ERRORS_KEPT, errorsBlocker, sourceChip, type TranslateState } from "./Translate";

const report: CleanReport = {
  items: [], restored: [], lang: "cs", kind: "form", unlockedScroll: false, langFrom: "page", widened: 0, comfort: 0,
  calm: { media: 0, motion: 0 }, unstuck: 0, tables: 0,
};
const done: TranslateState = { phase: "done", showingSource: false, from: "cs", to: "en", source: "in_cloud", translated: 12, total: 12, form: 9 };

describe("errorsBlocker", () => {
  it("only a ready model on this device, in a frame the page lets run it", () => {
    expect(errorsBlocker({ ai: true, blocked: false, model: "available" })).toBeNull();
    expect(errorsBlocker({ ai: false, blocked: false, model: "available" })).toBe("no-ai");
    expect(errorsBlocker({ ai: true, blocked: true, model: "available" })).toBe("blocked");
    expect(errorsBlocker({ ai: true, blocked: false, model: "downloadable" })).toBe("not-downloaded");
    expect(errorsBlocker({ ai: true, blocked: false, model: "downloading" })).toBe("not-downloaded");
    expect(errorsBlocker({ ai: true, blocked: false, model: "unavailable" })).toBe("no-model");
  });
  it("every reason says the errors are never sent to the cloud when a cloud model exists", () => {
    for (const k of ["blocked", "not-downloaded", "no-model"] as const) expect(ERRORS_KEPT[k]).toMatch(/never sent to the cloud/);
  });
});

describe("the status line and the chip", () => {
  it("no errors: the language part as before", () => {
    expect(languagePart(report, done, "en")).toBe("Translated from Czech");
  });
  it("errors translated: how many, and that it ran on this device", () => {
    const s: TranslateState = { ...done, errors: { phase: "translated", count: 2, source: "on_device" } };
    expect(languagePart(report, s, "en")).toBe("Translated from Czech · 2 error messages translated on this device");
  });
  it("errors kept: in which language, and why", () => {
    const s: TranslateState = { ...done, errors: { phase: "kept", count: 1, why: ERRORS_KEPT["no-model"] } };
    expect(errorsWords(s)).toBe(`Error messages left in Czech: ${ERRORS_KEPT["no-model"]}`);
    expect(languagePart(report, s, "en")).toContain("Error messages left in Czech: this computer has no AI model on the device");
  });
  it("the chip says the form's own words were sent (in the cloud), nothing of the person's, and counts them", () => {
    const chip = sourceChip({ ...done, errors: { phase: "translated", count: 1, source: "on_device" } });
    expect(chip.title).toMatch(/the page's text and the form's own words was sent, nothing of yours/);
    expect(chip.title).toMatch(/1 error message translated on this device/);
    expect(chip.data).toMatchObject({ "data-form": "9", "data-errors": "translated:1" });
  });
});
