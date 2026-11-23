// The strip's one status line: what Distill did on this page, in plain words.
import { clutterSummary } from "@distill/engine";
import type { CleanReport } from "../../messages";
import type { TranslateState } from "./Translate";

export const langName = (code: string): string => {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code; } catch { return code; }
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** r4-04: what happened to the form's error messages, for the status line and the chip's title; "" when it shows none. */
export function errorsWords(state: Pick<TranslateState, "errors" | "from">): string {
  const e = state.errors;
  if (!e) return "";
  if (e.phase === "translated") {
    const where = e.source === "on_device" ? "on this device" : e.source === "in_cloud" ? "in the cloud" : "by your own agent";
    return `${plural(e.count, "error message", "error messages")} translated ${where}`;
  }
  return `Error messages left in ${langName(state.from ?? "und")}: ${e.why}`;
}

/** "Removed 6 distractions · 1 back · Paused 1 video · Page in Czech · 6 claims to check". */
export function statusLine(report: CleanReport, translate: TranslateState, claims = 0): string {
  const parts = [clutterSummary(report.items)];
  if (report.restored.length) parts.push(`${report.restored.length} back`);
  // r3-04: the banner's own reject button was pressed for the person.
  if (report.consent === "rejected") parts.push("Cookies: rejected");
  if (report.calm.media) parts.push(`Paused ${plural(report.calm.media, "video", "videos")}`);
  // Translate (#10) words the language part while it runs and once it is done.
  const lang = languagePart(report, translate);
  if (lang) parts.push(lang);
  // Claims to check (r2-01): only what the model kept, never the engine's candidates alone.
  if (claims > 0) parts.push(`${plural(claims, "claim", "claims")} to check`);
  return parts.join(" · ");
}

/** "cs" from "cs-CZ". */
const primary = (lang: string): string => lang.split("-")[0]?.toLowerCase() || "und";

/** The language part (#10): "Page in Czech" when it is not the reader's language, then what Translate did. */
export function languagePart(report: CleanReport, translate: TranslateState, reader = primary(navigator.language || "en")): string | null {
  const from = langName(translate.from ?? primary(report.lang));
  switch (translate.phase) {
    case "translating": return `Translating from ${from}...`;
    case "done": {
      // r4-04: the form's error messages, translated on this device only or left as they are, and why.
      const errors = errorsWords(translate);
      return `Translated from ${from}${errors ? ` · ${errors}` : ""}`;
    }
    case "failed": return `Not translated: ${translate.problem ?? "something went wrong with the AI"}`;
    case "idle": {
      const lang = primary(report.lang);
      return lang !== "und" && lang !== reader ? `Page in ${langName(lang)}` : null;
    }
  }
}
