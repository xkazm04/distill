import { beforeEach, describe, expect, it } from "vitest";
import { asGuideState, labelsKey, normLabel, sessionGuideStore } from "./guideStore";

beforeEach(() => sessionStorage.clear());

describe("sessionGuideStore (the web app)", () => {
  it("round-trips a guide under guide:<fingerprint> in sessionStorage", async () => {
    const store = sessionGuideStore();
    expect(await store.load("abc")).toBeNull();
    await store.save("abc", { stepIndex: 3, answers: { name: "Jana" } });
    expect(JSON.parse(sessionStorage.getItem("guide:abc")!)).toEqual({ stepIndex: 3, answers: { name: "Jana" } });
    expect(await store.load("abc")).toEqual({ stepIndex: 3, answers: { name: "Jana" } });
    await store.clear("abc");
    expect(sessionStorage.getItem("guide:abc")).toBeNull();
    expect(await store.load("abc")).toBeNull();
  });

  it("keeps nothing and never throws when storage is blocked", async () => {
    const blocked = () => { throw new Error("SecurityError"); };
    const store = sessionGuideStore(blocked as () => Storage);
    await expect(store.save("k", { stepIndex: 1, answers: {} })).resolves.toBeUndefined();
    await expect(store.load("k")).resolves.toBeNull();
    await expect(store.clear("k")).resolves.toBeUndefined();
  });

  it("treats anything but a well-formed guide as nothing kept", async () => {
    sessionStorage.setItem("guide:bad", "{not json");
    sessionStorage.setItem("guide:neg", JSON.stringify({ stepIndex: -1, answers: {} }));
    const store = sessionGuideStore();
    expect(await store.load("bad")).toBeNull();
    expect(await store.load("neg")).toBeNull();
    expect(asGuideState({ stepIndex: 1, answers: { a: "x", b: 5 } })).toEqual({ stepIndex: 1, answers: { a: "x" } });
  });
});

describe("labels for multi-page forms", () => {
  it("keys answers by the site, whatever the page", () => {
    expect(labelsKey("https://office.example/form/page-2?x=1")).toBe("labels:https://office.example");
  });

  it("matches labels across pages despite case, marks and punctuation", () => {
    expect(normLabel("Město:*")).toBe(normLabel("město"));
    expect(normLabel("  E-mail  (required) ")).toBe("e mail");
    expect(normLabel("Datum narození")).toBe("datum narození");
  });
});
