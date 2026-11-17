import { describe, expect, it } from "vitest";
import { BRAND_DARK, BRAND_LIGHT } from "../../../web/src/ui/theme/brand";
import { ROLES } from "../../../web/src/ui/theme/roles";
import { applyBinding } from "./applyBinding";
import { chooseTheme, lookNote } from "./look";

const LIGHT_NEWS = { bg: "rgb(250, 250, 250)", fg: "rgb(26, 26, 26)", link: "rgb(196, 48, 43)", scheme: "light" as const };
const base = { look: "page" as const, moreContrast: false, prefersDark: false, seed: LIGHT_NEWS, hasPage: true };

describe("chooseTheme", () => {
  it("matches the page by default", () => {
    const c = chooseTheme(base);
    expect(c.status).toEqual({ kind: "page", adjusted: false });
    expect(c.binding["--bg"]).toBe("#fafafa");
    expect(c.dark).toBe(false);
    expect(lookNote(c.status)).toBe("Matched to this page.");
  });

  it("says when colours were adjusted", () => {
    const c = chooseTheme({ ...base, seed: { bg: "#ffffff", fg: "#eeeeee" } });
    expect(c.status).toEqual({ kind: "page", adjusted: true });
    expect(lookNote(c.status)).toBe("Matched to this page. Some colours were adjusted for readability.");
  });

  it("uses the Distill style when the system asks for more contrast, even if Match is chosen", () => {
    const c = chooseTheme({ ...base, moreContrast: true, prefersDark: true });
    expect(c.binding).toBe(BRAND_DARK);
    expect(c.status).toEqual({ kind: "distill", why: "contrast" });
  });

  it("uses the Distill style when the person chose it", () => {
    expect(chooseTheme({ ...base, look: "distill" }).binding).toBe(BRAND_LIGHT);
  });

  it("falls back to the Distill style when the page cannot be read", () => {
    const c = chooseTheme({ ...base, seed: null });
    expect(c.binding).toBe(BRAND_LIGHT);
    expect(lookNote(c.status)).toMatch(/could not be read/);
  });

  it("follows a dark page into the dark fallback", () => {
    const c = chooseTheme({ ...base, seed: { bg: "rgb(13, 17, 23)", fg: "rgb(230, 237, 243)" } });
    expect(c.dark).toBe(true);
  });
});

describe("applyBinding", () => {
  it("binds every role on the root element", () => {
    const root = document.createElement("div");
    applyBinding(root, BRAND_LIGHT);
    for (const role of ROLES) expect(root.style.getPropertyValue(role)).toBe(BRAND_LIGHT[role]);
  });
});
