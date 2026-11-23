// Ask this page (r3-08), the frame side: when the box may run, and that it says why when it may not.
import { describe, expect, it } from "vitest";
import { askBlocker, BLOCKER_WORDS } from "./Ask";

describe("askBlocker", () => {
  it("runs only with AI set up, a frame the page lets the model run in, and a ready model on this device", () => {
    expect(askBlocker({ ai: true, blocked: false, model: "available" })).toBeNull();
    expect(askBlocker({ ai: false, blocked: false, model: "available" })).toBe("no-ai");
    expect(askBlocker({ ai: true, blocked: true, model: "available" })).toBe("blocked");
    expect(askBlocker({ ai: true, blocked: false, model: "downloadable" })).toBe("not-downloaded");
    expect(askBlocker({ ai: true, blocked: false, model: "downloading" })).toBe("not-downloaded");
    expect(askBlocker({ ai: true, blocked: false, model: "unavailable" })).toBe("no-model");
  });

  it("every reason says the question is not sent anywhere else", () => {
    for (const words of Object.values(BLOCKER_WORDS)) expect(words).toMatch(/never sent/);
  });
});
