// "Look": the side panel matches the page the person is on (its colours, fonts and corners), or uses the Distill
// style. Matching never costs readability: deriveTheme holds every contrast floor, and a person whose system asks
// for more contrast always gets the Distill style.
import { useEffect, useMemo, useState } from "react";
import { BRAND_DARK, BRAND_LIGHT } from "@distill/web/ui/theme/brand";
import { deriveTheme, isDarkColor, pickFallback, readableColor } from "@distill/web/ui/theme/derive";
import type { PageThemeSeed, ThemeBinding } from "@distill/web/ui/theme/roles";
import { applyBinding } from "./applyBinding";

export type Look = "page" | "distill";
export const LOOK_KEY = "look";

export type LookStatus =
  | { kind: "page"; adjusted: boolean }
  | { kind: "distill"; why: "chosen" | "contrast" | "unreadable" | "no-page" | "waiting" };

export interface ThemeChoice { binding: ThemeBinding; dark: boolean; status: LookStatus }

/** What the panel should look like. Pure, so every branch is tested without a browser. */
export function chooseTheme(o: {
  look: Look;
  moreContrast: boolean;
  prefersDark: boolean;
  /** The page's seed; null when it could not be read, undefined while it is being read. */
  seed: PageThemeSeed | null | undefined;
  hasPage: boolean;
}): ThemeChoice {
  const brand = (why: Extract<LookStatus, { kind: "distill" }>["why"]): ThemeChoice => ({
    binding: o.prefersDark ? BRAND_DARK : BRAND_LIGHT, dark: o.prefersDark, status: { kind: "distill", why },
  });
  if (o.moreContrast) return brand("contrast");
  if (o.look === "distill") return brand("chosen");
  if (!o.hasPage) return brand("no-page");
  if (o.seed === undefined) return brand("waiting");
  if (o.seed === null) return brand("unreadable");
  const t = deriveTheme(o.seed, pickFallback(o.seed, BRAND_LIGHT, BRAND_DARK));
  const bg = readableColor(t.binding["--bg"]);
  return { binding: t.binding, dark: bg ? isDarkColor(bg) : o.prefersDark, status: { kind: "page", adjusted: t.adjusted.length > 0 } };
}

export function lookNote(s: LookStatus): string {
  if (s.kind === "page") return s.adjusted ? "Matched to this page. Some colours were adjusted for readability." : "Matched to this page.";
  switch (s.why) {
    case "contrast": return "Using the Distill style, because your computer asks for more contrast.";
    case "unreadable": return "This page's colours could not be read, so Distill uses its own style.";
    case "waiting": return "Reading this page's colours...";
    default: return "";
  }
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setOn(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [query]);
  return on;
}

export interface ThemeSource { getTheme(): Promise<PageThemeSeed> }

/** Reads the setting and the page's seed, applies the chosen binding to the panel, and reports what it did. */
export function useLook(source: ThemeSource | null, refreshKey: number) {
  const [look, setLookState] = useState<Look>("page");
  const [seed, setSeed] = useState<PageThemeSeed | null | undefined>(undefined);
  const moreContrast = useMedia("(prefers-contrast: more)");
  const prefersDark = useMedia("(prefers-color-scheme: dark)");

  useEffect(() => {
    chrome.storage.local.get(LOOK_KEY).then(
      (r) => { if (r[LOOK_KEY] === "distill") setLookState("distill"); },
      () => undefined,
    );
  }, []);

  const wantsPage = look === "page" && !moreContrast && source !== null;
  useEffect(() => {
    if (!wantsPage || !source) return;
    let live = true;
    // Keep the current look until the new page answers, so switching tabs does not flash.
    source.getTheme().then((s) => live && setSeed(s), () => live && setSeed(null));
    return () => { live = false; };
  }, [source, refreshKey, wantsPage]);

  const hasPage = source !== null;
  const choice = useMemo(
    () => chooseTheme({ look, moreContrast, prefersDark, seed, hasPage }),
    [look, moreContrast, prefersDark, seed, hasPage],
  );
  useEffect(() => {
    const root = document.documentElement;
    applyBinding(root, choice.binding);
    root.style.colorScheme = choice.dark ? "dark" : "light";
  }, [choice.binding, choice.dark]);

  const setLook = (l: Look) => {
    setLookState(l);
    void chrome.storage.local.set({ [LOOK_KEY]: l }).catch(() => undefined);
  };
  return { look, setLook, status: choice.status };
}

export function LookSetting({ look, onLook, status }: { look: Look; onLook: (l: Look) => void; status: LookStatus }) {
  const note = lookNote(status);
  return (
    <footer className="look" data-testid="look">
      <label>
        Look:
        <select value={look} onChange={(e) => onLook(e.target.value === "distill" ? "distill" : "page")}>
          <option value="page">Match this page</option>
          <option value="distill">Distill style</option>
        </select>
      </label>
      {note && <p className="look-note" role="status" data-testid="look-note">{note}</p>}
    </footer>
  );
}
