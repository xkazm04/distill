// "Put into Czech" (tiger 2026-11-25, L2; pool P10). A person's typed answer, put into the form's language with Chrome's
// built-in Translator API, then translated back so they see what the form will say.
//
// This is NOT the Firebase SDK and has no cloud path: the Translator API runs on this device only (language packs are
// downloaded once, then translation is local), so the source is "on_device" by construction. It is the values task
// `translateAnswer`, and the Sieve's decision is checked all the same: if it ever said anything but only_on_device,
// nothing runs. With no Translator in this browser, or no pack for the pair, the answer is not translated and the
// reason is said in plain words; it is never sent anywhere instead. Never automatic: the caller runs it on a click.
import { engine, type LocalModelState } from "./ui/engine";

// Chrome's Translator and LanguageDetector APIs (Chrome 138+, desktop). Only what Distill touches.
declare global {
  interface AiDownloadMonitor extends EventTarget {}
  interface ChromeTranslator {
    translate(text: string): Promise<string>;
    destroy?(): void;
  }
  interface ChromeLanguageDetector {
    detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
    destroy?(): void;
  }
  // eslint-disable-next-line no-var
  var Translator:
    | {
        availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
        create(options: { sourceLanguage: string; targetLanguage: string; monitor?: (m: AiDownloadMonitor) => void }): Promise<ChromeTranslator>;
      }
    | undefined;
  // eslint-disable-next-line no-var
  var LanguageDetector:
    | {
        availability(options?: object): Promise<string>;
        create(options?: { monitor?: (m: AiDownloadMonitor) => void }): Promise<ChromeLanguageDetector>;
      }
    | undefined;
}

const STATES: readonly LocalModelState[] = ["unavailable", "downloadable", "downloading", "available"];
const asState = (v: unknown): LocalModelState => (STATES as readonly string[]).includes(v as string) ? (v as LocalModelState) : "unavailable";
const primary = (lang: string): string => (lang || "").toLowerCase().split(/[-_]/)[0] ?? "";

/** "Czech" for "cs", in English (the app's own words are English). */
export function languageName(lang: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(primary(lang)) ?? lang;
  } catch {
    return lang;
  }
}

const translatorApi = () => (typeof globalThis.Translator === "object" || typeof globalThis.Translator === "function" ? globalThis.Translator : undefined);

/** The translator's state for this pair, in the local model's words. No Translator in this browser: "unavailable". */
export async function translatorState(from: string, to: string): Promise<LocalModelState> {
  const api = translatorApi();
  if (!api || !primary(from) || !primary(to)) return "unavailable";
  try {
    return asState(await api.availability({ sourceLanguage: primary(from), targetLanguage: primary(to) }));
  } catch {
    return "unavailable";
  }
}

/** The plain-words reason the answer was not translated. Every one says nothing was sent. */
export function unavailableReason(from: string, to: string, why: "no-api" | "no-pair" | "failed" | "same" | "empty" | "route"): string {
  const pair = `from ${languageName(from)} into ${languageName(to)}`;
  switch (why) {
    case "no-api": return `Putting answers into ${languageName(to)} needs the translator built into Chrome on a computer, and this browser has none. Your answer was not sent anywhere.`;
    case "no-pair": return `This device cannot translate ${pair}. Your answer was not sent anywhere.`;
    case "failed": return `The translator on this device could not translate this answer. Your answer was not sent anywhere.`;
    case "same": return `This answer is already in ${languageName(to)}.`;
    case "empty": return "Type an answer first.";
    case "route": return "Translating answers runs only on this device, and that could not be ensured. Your answer was not sent anywhere.";
  }
}

export type ToFormLanguage =
  | {
      ok: true;
      /** The answer in the form's language: what would be written. */
      translated: string;
      /** `translated` put back into the reader's language, so they see what the form will say. */
      back: string;
      source: "on_device";
      ms: number;
      /** The Sieve's reason, shown on hover of the source chip. */
      reason: string;
    }
  | { ok: false; reason: string; state: LocalModelState };

export interface ToFormLanguageOptions {
  /** Download progress of a language pack, 0-1, while the state is downloadable/downloading. */
  onProgress?: (loaded: number) => void;
}

/**
 * Puts `text` from the reader's language `from` into the form's language `to`, and back. On a click only: creating a
 * translator for a pack that still has to download needs the person's gesture.
 */
export async function toFormLanguage(text: string, from: string, to: string, opts: ToFormLanguageOptions = {}): Promise<ToFormLanguage> {
  const decision = engine.route("translateAnswer");
  if (decision.mode !== "only_on_device") return { ok: false, reason: unavailableReason(from, to, "route"), state: "unavailable" };
  if (!text.trim()) return { ok: false, reason: unavailableReason(from, to, "empty"), state: "unavailable" };
  if (primary(from) === primary(to)) return { ok: false, reason: unavailableReason(from, to, "same"), state: "available" };
  const api = translatorApi();
  if (!api) return { ok: false, reason: unavailableReason(from, to, "no-api"), state: "unavailable" };
  const [there, back] = await Promise.all([translatorState(from, to), translatorState(to, from)]);
  if (there === "unavailable" || back === "unavailable") return { ok: false, reason: unavailableReason(from, to, "no-pair"), state: "unavailable" };

  const monitor = (m: AiDownloadMonitor) => {
    m.addEventListener("downloadprogress", (e) => opts.onProgress?.(Number((e as Event & { loaded?: number }).loaded ?? 0)));
  };
  const t0 = performance.now();
  let forth: ChromeTranslator | undefined;
  let home: ChromeTranslator | undefined;
  try {
    forth = await api.create({ sourceLanguage: primary(from), targetLanguage: primary(to), monitor });
    const translated = (await forth.translate(text)).trim();
    if (!translated) return { ok: false, reason: unavailableReason(from, to, "failed"), state: "available" };
    home = await api.create({ sourceLanguage: primary(to), targetLanguage: primary(from), monitor });
    const backText = (await home.translate(translated)).trim();
    return { ok: true, translated, back: backText, source: "on_device", ms: Math.round(performance.now() - t0), reason: decision.reason };
  } catch {
    return { ok: false, reason: unavailableReason(from, to, "failed"), state: there };
  } finally {
    forth?.destroy?.();
    home?.destroy?.();
  }
}

/**
 * Whether the answer already reads as the form's language, by Chrome's on-device language detector: true or false
 * when it is sure, null when it cannot say (no detector, not ready, or not sure). Never downloads a model.
 */
export async function alreadyIn(text: string, lang: string, minConfidence = 0.7): Promise<boolean | null> {
  const api = typeof globalThis.LanguageDetector === "object" || typeof globalThis.LanguageDetector === "function" ? globalThis.LanguageDetector : undefined;
  if (!api || !text.trim()) return null;
  let detector: ChromeLanguageDetector | undefined;
  try {
    if ((await api.availability()) !== "available") return null;
    detector = await api.create();
    const top = (await detector.detect(text))[0];
    if (!top || top.confidence < minConfidence) return null;
    return primary(top.detectedLanguage) === primary(lang);
  } catch {
    return null;
  } finally {
    detector?.destroy?.();
  }
}
