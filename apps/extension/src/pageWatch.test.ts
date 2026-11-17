import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meaningfulChange, snapshot, watchPage, WATCH_DELAY_MS } from "./pageWatch";

const text = (n: number) => "word ".repeat(n / 5);

describe("meaningfulChange", () => {
  const base = { controls: "INPUT:text:name", textLength: 2000 };
  it("counts a form control that came or went", () => {
    expect(meaningfulChange(base, { ...base, controls: "INPUT:text:name|SELECT::city" })).toBe(true);
    expect(meaningfulChange(base, { ...base, controls: "" })).toBe(true);
  });
  it("counts a text change only past a small threshold", () => {
    expect(meaningfulChange(base, { ...base, textLength: 2050 })).toBe(false); // a clock or a counter ticking
    expect(meaningfulChange(base, { ...base, textLength: 2120 })).toBe(true);
    expect(meaningfulChange({ ...base, textLength: 100 }, { ...base, textLength: 150 })).toBe(false); // < 80 characters
  });
  it("never reads a typed value", () => {
    document.body.innerHTML = `<main><p>Hello</p><input id="a" value="secret-typed"></main>`;
    expect(JSON.stringify(snapshot(document))).not.toContain("secret-typed");
  });
});

describe("watchPage", () => {
  let stop: () => void = () => undefined;
  let notify: ReturnType<typeof vi.fn<(reason: "mutation" | "history") => void>>;
  const settle = async (ms = WATCH_DELAY_MS) => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(ms); };

  beforeEach(() => {
    vi.useFakeTimers();
    document.head.innerHTML = "";
    document.body.innerHTML = `<main><h1>Form</h1><p>${text(1000)}</p><form><input id="name"></form></main>`;
    notify = vi.fn<(reason: "mutation" | "history") => void>();
    stop = watchPage(window, document, notify);
  });
  afterEach(() => { stop(); vi.useRealTimers(); });

  it("tells once, after the page is quiet, when a form control is added", async () => {
    const form = document.querySelector("form")!;
    form.insertAdjacentHTML("beforeend", `<input id="city">`);
    await settle(200);
    form.insertAdjacentHTML("beforeend", `<select id="country"></select>`);
    await settle(WATCH_DELAY_MS - 1);
    expect(notify).not.toHaveBeenCalled(); // debounced: still settling
    await settle(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("mutation");
  });

  it("ignores Distill's own outline style sheet and a small text change", async () => {
    const style = document.createElement("style");
    style.id = "distill-locate-style";
    document.head.append(style);
    document.querySelector("h1")!.textContent = "Form 2";
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it("tells when the main text changes a lot", async () => {
    document.querySelector("p")!.textContent = text(300);
    await settle();
    expect(notify).toHaveBeenCalledWith("mutation");
  });

  it("tells about an address change without a load (popstate and the Navigation API)", async () => {
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settle();
    expect(notify).toHaveBeenLastCalledWith("history");

    stop();
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", { value: navigation, configurable: true });
    notify.mockClear();
    stop = watchPage(window, document, notify);
    navigation.dispatchEvent(new Event("currententrychange")); // the page called history.pushState
    await settle();
    expect(notify).toHaveBeenCalledWith("history");
    delete (window as { navigation?: unknown }).navigation;
  });

  it("stops watching", async () => {
    stop();
    document.querySelector("form")!.insertAdjacentHTML("beforeend", `<input id="later">`);
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });
});
