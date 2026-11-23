// r3-07, the service worker's side of prices in your terms: the European Central Bank's daily reference rates, fetched
// at most once a day and kept on this device (chrome.storage.local). The request is a plain GET of a public file: no
// cookies (credentials: "omit"), no referrer, no header of Distill's own, nothing about the page or the person.
//
// It needs the host permission for www.ecb.europa.eu. That permission is OPTIONAL (manifest optional_host_permissions):
// the caption asks for it when the person turns prices in their currency on, so nothing is ever fetched before they
// say so, and installing Distill shows no new warning. Without it, or offline with nothing kept, the answer is null and
// the caption writes only dates.
import { parseEcbRates, type Rates } from "@distill/engine";
import { isRatesRequest, type RatesReply } from "./messages";

export const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_ORIGIN = "https://www.ecb.europa.eu/*";
export const RATES_KEY = "distill:rates";
/** One download a day at most. */
export const RATES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** After a failed download with nothing kept, the next try waits this long (still far from "every request"). */
export const RATES_RETRY_MS = 60 * 60 * 1000;

/** What is kept on the device: the rates (null until one download worked) and when the last download was tried. */
export interface KeptRates { rates: Rates | null; tried: number }

export interface RatesDeps {
  now: () => number;
  get: () => Promise<KeptRates | null>;
  set: (kept: KeptRates) => Promise<void>;
  allowed: () => Promise<boolean>;
  fetchText: (url: string) => Promise<string>;
}

/** The download itself: a GET with no cookies, no referrer and no headers of Distill's own. */
export async function fetchEcb(url: string): Promise<string> {
  const res = await fetch(url, { method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error" });
  if (!res.ok) throw new Error(`ECB answered ${res.status}`);
  return res.text();
}

let inflight: Promise<RatesReply> | null = null;

/** The rates: the ones kept when they are fresh, else one new download (only with the permission), else what is kept. */
export function getRates(deps: RatesDeps): Promise<RatesReply> {
  inflight ??= (async () => {
    const kept = await deps.get().catch(() => null);
    const age = deps.now() - (kept?.tried ?? 0);
    const wait = kept?.rates ? RATES_MAX_AGE_MS : RATES_RETRY_MS;
    if (kept && age >= 0 && age < wait) return kept.rates;
    if (!(await deps.allowed().catch(() => false))) return kept?.rates ?? null;
    const tried = deps.now();
    try {
      const rates = parseEcbRates(await deps.fetchText(ECB_URL));
      if (!rates) throw new Error("not the ECB's list");
      await deps.set({ rates, tried });
      return rates;
    } catch {
      await deps.set({ rates: kept?.rates ?? null, tried }).catch(() => undefined);
      return kept?.rates ?? null;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

/** The real service worker's dependencies. */
export const chromeRatesDeps: RatesDeps = {
  now: () => Date.now(),
  get: async () => ((await chrome.storage.local.get(RATES_KEY))[RATES_KEY] as KeptRates | undefined) ?? null,
  set: (kept) => chrome.storage.local.set({ [RATES_KEY]: kept }),
  allowed: () => chrome.permissions.contains({ origins: [ECB_ORIGIN] }),
  fetchText: fetchEcb,
};

/** Answers distill:rates from the caption frame (background.ts). Any other message is not ours. */
export function registerRates(deps: RatesDeps = chromeRatesDeps): void {
  chrome.runtime.onMessage.addListener((m: unknown, _sender, reply: (r: RatesReply) => void) => {
    if (!isRatesRequest(m)) return false;
    void getRates(deps).then(reply, () => reply(null));
    return true;
  });
}
