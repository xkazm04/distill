import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BRAND_DARK, BRAND_LIGHT, INK } from "../ui/theme/brand";
import { ROLES } from "../ui/theme/roles";
import { grain, SHELL_TOKENS } from "./shell";
import { BINDINGS, readPref, resolveMode, stampTheme, THEME_KEY } from "./theme";

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

  it("binds every shell token in both states, each with a value", () => {
    for (const mode of ["light", "dark"] as const) {
      const el = document.createElement("div");
      stampTheme(el, mode);
      for (const t of SHELL_TOKENS) {
        expect(BINDINGS[mode].shell[t], `${t} in ${mode}`).toBeTruthy();
        expect(el.style.getPropertyValue(t).trim(), `${t} in ${mode}`).not.toBe("");
      }
      expect(["ink", "paper"]).toContain(BINDINGS[mode].art.wordmark);
    }
  });
});

describe("shell tokens", () => {
  it("inks the grain in the colour of the ink it is derived from", () => {
    const light = decodeURIComponent(grain(INK.aubergine, "1.25"));
    expect(light).toContain("values='0 0 0 0 0.22 0 0 0 0 0.11 0 0 0 0 0.27 0 0 0 -2.2 1.25'");
    expect(decodeURIComponent(grain(INK.paper, "1.2"))).toContain("values='0 0 0 0 1 0 0 0 0 0.97 0 0 0 0 0.94 0 0 0 -2.2 1.2'");
  });
});

describe("brand.css", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "brand.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("never branches on which theme is active", () => {
    expect(css).not.toMatch(/data-theme|prefers-color-scheme/);
  });
  it("uses only names some layer binds: a role, a shell token, its own motion tokens or the stagger index", () => {
    const motion = new Set([...css.matchAll(/^\s*(--(?:dur|ease|motion)-[\w-]+)\s*:/gm)].map((m) => m[1] as string));
    expect(motion.size).toBeGreaterThan(0);
    const bound = new Set<string>([...ROLES, ...SHELL_TOKENS, ...motion, "--i"]);
    const used = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] as string))];
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((v) => !bound.has(v))).toEqual([]);
  });
  it("puts every duration and easing through the motion vocabulary", () => {
    const rules = css.replace(/:root\s*\{[^}]*\}/g, "");
    expect(rules).not.toMatch(/(?<![\w.-])\d*\.?\d+m?s\b/);
    expect(rules).not.toMatch(/cubic-bezier\(/);
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
