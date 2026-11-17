import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BRAND_DARK, BRAND_LIGHT } from "../ui/theme/brand";
import { ROLES } from "../ui/theme/roles";
import { readPref, resolveMode, stampTheme, THEME_KEY } from "./theme";

describe("resolveMode", () => {
  it("follows the device when there is no explicit choice", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
  });
  it("lets an explicit choice win in both directions", () => {
    expect(resolveMode("light", true)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
  });
});

describe("readPref", () => {
  afterEach(() => localStorage.clear());
  it("reads light / dark and treats anything else as the device setting", () => {
    expect(readPref()).toBe("system");
    localStorage.setItem(THEME_KEY, "dark");
    expect(readPref()).toBe("dark");
    localStorage.setItem(THEME_KEY, "purple");
    expect(readPref()).toBe("system");
  });
});

describe("stampTheme", () => {
  it("binds every role and the color-scheme for the mode", () => {
    const el = document.createElement("div");
    stampTheme(el, "dark");
    expect(el.dataset.theme).toBe("dark");
    expect(el.style.colorScheme).toBe("dark");
    for (const r of ROLES) expect(el.style.getPropertyValue(r).trim()).toBe(BRAND_DARK[r]);
  });
});

describe("index.html pre-paint stamp", () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.html"), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  it("reads the same storage key as the app", () => {
    expect(script).toContain(`"${THEME_KEY}"`);
  });
  it("uses the brand ground and ink of both states", () => {
    expect(script).toContain(`dark ? "${BRAND_DARK["--bg"]}" : "${BRAND_LIGHT["--bg"]}"`);
    expect(script).toContain(`dark ? "${BRAND_DARK["--fg"]}" : "${BRAND_LIGHT["--fg"]}"`);
  });
});
