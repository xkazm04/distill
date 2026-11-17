// Following tabs: a page Distill may not read yet is a designed state with two ways to give access; a page no
// extension may read says so with no button. chrome.* is mocked.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccess, classifyFailure, isBrowserPage, originPattern } from "./access";
import { AccessNeeded, BrowserPage } from "./accessView";
import { AccessError } from "./host";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const request = vi.fn(async (_p: chrome.permissions.Permissions) => true);
const contains = vi.fn(async (_p: chrome.permissions.Permissions) => false);
const fileAccess = vi.fn(async () => false);

beforeEach(() => {
  request.mockReset().mockResolvedValue(true);
  contains.mockReset().mockResolvedValue(false);
  fileAccess.mockReset().mockResolvedValue(false);
  (globalThis as { chrome?: unknown }).chrome = {
    permissions: { request, contains },
    extension: { isAllowedFileSchemeAccess: fileAccess },
  };
});

const NO_HOST = "Cannot access contents of the page. Extension manifest must request permission to access the respective host.";

describe("which pages can be read", () => {
  it("knows browser pages from the address", () => {
    for (const url of ["chrome://settings", "chrome-extension://abc/x.html", "edge://flags", "about:blank", "view-source:https://a.example",
      "https://chromewebstore.google.com/detail/x", "https://chrome.google.com/webstore/category"]) {
      expect(isBrowserPage(url, false), url).toBe(true);
    }
    expect(isBrowserPage("file:///C:/letter.html", false)).toBe(true); // files, without file access
    expect(isBrowserPage("file:///C:/letter.html", true)).toBe(false);
    expect(isBrowserPage("https://office.example/form", false)).toBe(false);
    expect(isBrowserPage(undefined, false)).toBe(false);
  });

  it("asks for the site of the page, every page of it", () => {
    expect(originPattern("https://office.example:8443/visit?x=1")).toBe("https://office.example/*");
    expect(originPattern("http://localhost:5181/")).toBe("http://localhost/*");
    expect(originPattern("chrome://settings")).toBeUndefined();
    expect(originPattern(undefined)).toBeUndefined();
  });

  it("tells a missing permission from a browser page", () => {
    expect(classifyFailure("https://office.example/a", NO_HOST, false, false)).toEqual({ kind: "needed", origin: "https://office.example/*" });
    // Chrome hides the address of a page Distill may not read: the state stays, only the site button cannot be offered.
    expect(classifyFailure(undefined, NO_HOST, false, false)).toEqual({ kind: "needed" });
    expect(classifyFailure(undefined, "Cannot access a chrome:// URL", false, false)).toEqual({ kind: "browser" });
    expect(classifyFailure(undefined, "The extensions gallery cannot be scripted.", false, false)).toEqual({ kind: "browser" });
    // Allowed, and still refused (the PDF viewer, a protected page): the browser's refusal, not the person's.
    expect(classifyFailure("https://office.example/a.pdf", NO_HOST, false, true)).toEqual({ kind: "browser" });
  });

  it("checkAccess: a page that answers is read; one that cannot be reached is classified", async () => {
    expect(await checkAccess({ ping: async () => undefined }, "https://office.example/")).toEqual({ kind: "ok" });
    const refused = { ping: async () => { throw new AccessError(NO_HOST); } };
    expect(await checkAccess(refused, "https://office.example/")).toEqual({ kind: "needed", origin: "https://office.example/*" });
    expect(contains).toHaveBeenLastCalledWith({ origins: ["https://office.example/*"] });
    contains.mockResolvedValue(true);
    expect(await checkAccess(refused, "https://office.example/")).toEqual({ kind: "browser" });
  });
});

describe("the states the panel shows", () => {
  let root: Root;
  let el: HTMLElement;
  beforeEach(() => { el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
  afterEach(async () => { await act(async () => root.unmount()); el.remove(); });
  const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);
  const click = async (b: HTMLButtonElement | undefined) => { await act(async () => { b!.click(); }); await act(async () => undefined); };

  it("access needed: Read this page asks Chrome for this site, and a yes reads at once", async () => {
    const onGranted = vi.fn();
    await act(async () => root.render(createElement(AccessNeeded, { origin: "https://office.example/*", onGranted })));
    const state = el.querySelector('[data-testid="access-needed"]')!;
    expect(state.textContent).toContain("Distill needs your OK to read this page.");
    expect(state.textContent).toContain("office.example");
    expect(el.querySelector('[role="alert"]')).toBeNull(); // a state, not an error
    await click(button("Read this page"));
    expect(request).toHaveBeenCalledWith({ origins: ["https://office.example/*"] });
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it("access needed: Allow on all sites says plainly what it means, and asks for every site", async () => {
    const onGranted = vi.fn();
    await act(async () => root.render(createElement(AccessNeeded, { origin: "https://office.example/*", onGranted })));
    expect(el.textContent).toContain("can read any page you open while its panel is open");
    await click(button("Allow on all sites"));
    expect(request).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it("access needed: a no from Chrome is said calmly, and nothing is read", async () => {
    request.mockResolvedValue(false);
    const onGranted = vi.fn();
    await act(async () => root.render(createElement(AccessNeeded, { origin: "https://office.example/*", onGranted })));
    await click(button("Read this page"));
    expect(onGranted).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="access-note"]')?.textContent).toContain("Chrome did not give access");
  });

  it("access needed without the page's address: points to the icon, and still offers all sites", async () => {
    await act(async () => root.render(createElement(AccessNeeded, { onGranted: () => undefined })));
    expect(button("Read this page")).toBeUndefined();
    expect(el.textContent).toContain("click the Distill icon");
    expect(button("Allow on all sites")).toBeDefined();
  });

  it("browser page: says so, with no button", async () => {
    await act(async () => root.render(createElement(BrowserPage)));
    const state = el.querySelector('[data-testid="browser-page"]')!;
    expect(state.textContent).toBe("Browser pages cannot be read.Open a normal web page.");
    expect(el.querySelector("button")).toBeNull();
  });
});
