// Round 3, card r3-07: prices and dates in your terms. A switch and the reader's currency in More; the rates come from
// the service worker (distill:rates, the European Central Bank's daily list, kept on the device).
//
// useTerms runs for the strip's whole life (main.tsx): once Clean answered it writes the additions, so they are there
// without opening More. The reader's currency comes from the browser's locale (en-GB -> GBP; no region -> EUR) until
// the person picks one here; the pick and the switch are kept on this device (chrome.storage.local).
//
// The ECB download needs Chrome's permission for www.ecb.europa.eu, asked for inside the click on "Show prices in ...".
// Until then (or without rates) only dates are written. The e2e build already holds every site, so it never asks.
import { useEffect, useSyncExternalStore } from "react";
import { currencyOfLocale, READER_CURRENCIES, type Rates } from "@distill/engine";
import type { CleanReport, RatesReply, RatesRequest } from "../../messages";
import { send } from "./send";

export const TERMS_KEY = "distill:terms";
const ECB_ORIGIN = "https://www.ecb.europa.eu/*";

interface Kept { on?: boolean; currency?: string }

export interface TermsState {
  phase: "idle" | "working" | "ready";
  on: boolean;
  currency: string;
  /** Chrome holds the ECB permission. */
  allowed: boolean;
  rates: Rates | null;
  /** The download was tried and gave nothing. */
  noRates: boolean;
  prices: number;
  dates: number;
  problem: string | null;
}

const locale = (): string => navigator.language || "en";
let st: TermsState = { phase: "idle", on: true, currency: currencyOfLocale(locale()), allowed: false, rates: null, noRates: false, prices: 0, dates: 0, problem: null };
const subs = new Set<() => void>();
const set = (patch: Partial<TermsState>) => { st = { ...st, ...patch }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
let started = false;

async function loadKept(): Promise<Kept> {
  try {
    const got = (await chrome.storage.local.get(TERMS_KEY))[TERMS_KEY] as Kept | undefined;
    return got && typeof got === "object" ? got : {};
  } catch { return {}; }
}
async function keep(): Promise<void> {
  try { await chrome.storage.local.set({ [TERMS_KEY]: { on: st.on, currency: st.currency } satisfies Kept }); } catch { /* kept for this page only */ }
}

async function askRates(): Promise<Rates | null> {
  const req: RatesRequest = { type: "distill:rates" };
  try { return ((await chrome.runtime.sendMessage(req)) as RatesReply | undefined) ?? null; } catch { return null; }
}

/** Writes (or takes off) the additions on the page as the state says now. */
async function apply(): Promise<void> {
  set({ phase: "working", problem: null });
  try {
    let rates = st.rates;
    if (st.on && st.allowed && !rates) {
      rates = await askRates();
      set({ rates, noRates: !rates });
    }
    const req = st.on
      ? { type: "distill:caption:terms" as const, on: true, currency: st.currency, locale: locale(), ...(rates ? { rates } : {}) }
      : { type: "distill:caption:terms" as const, on: false };
    const n = await send<"distill:caption:terms">(req);
    set({ phase: "ready", prices: n.prices, dates: n.dates });
  } catch (e) {
    set({ phase: "ready", problem: e instanceof Error ? e.message : String(e) });
  }
}

/** For the strip's whole life: the additions go in once Clean answered. */
export function useTerms(report: CleanReport | null): TermsState {
  useEffect(() => {
    if (!report || started) return;
    started = true;
    void (async () => {
      const kept = await loadKept();
      const currency = kept.currency && (READER_CURRENCIES as readonly string[]).includes(kept.currency) ? kept.currency : st.currency;
      const allowed = await chrome.permissions.contains({ origins: [ECB_ORIGIN] }).catch(() => false);
      set({ on: kept.on ?? true, currency, allowed });
      await apply();
    })();
  }, [report]);
  return useSyncExternalStore(subscribe, () => st);
}

/** Inside the click: asks Chrome for the ECB (the first thing it does), then downloads the rates and writes prices. */
function allowRates(): void {
  void chrome.permissions.request({ origins: [ECB_ORIGIN] }).then((ok) => {
    set({ allowed: ok });
    if (ok) void apply();
  }, (e: unknown) => set({ problem: e instanceof Error ? e.message : String(e) }));
}

const rateDay = (r: Rates): string =>
  new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${r.date}T00:00:00Z`));

export function TermsSection(_props: { report: CleanReport; setReport: (r: CleanReport) => void }) {
  const s = useSyncExternalStore(subscribe, () => st);
  const busy = s.phase === "working";
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  let line: string;
  if (!s.on) line = "Off: the page's prices and dates as written.";
  else if (s.phase !== "ready") line = "Writing prices and dates your way...";
  else if (!s.prices && !s.dates) line = s.rates ? "No prices or dates to write here." : "No dates to write here.";
  else line = [s.rates ? `${plural(s.prices, "price")} in ${s.currency}` : "", s.dates ? `${plural(s.dates, "date")} written your way` : ""].filter(Boolean).join(", ") + ".";

  return (
    <section aria-labelledby="cap-terms-h" data-testid="cap-terms-section">
      <h2 id="cap-terms-h">Prices and dates</h2>
      <label className="switch">
        <input type="checkbox" role="switch" checked={s.on} disabled={busy} data-testid="cap-terms"
          onChange={(e) => { set({ on: e.currentTarget.checked }); void keep(); void apply(); }} />
        <span>In your terms</span>
      </label>
      <label className="field">
        <span>Your currency</span>{" "}
        <select value={s.currency} disabled={busy || !s.on} data-testid="cap-terms-currency"
          onChange={(e) => { set({ currency: e.currentTarget.value }); void keep(); void apply(); }}>
          {READER_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <p className="note" data-testid="cap-terms-line" data-prices={s.prices} data-dates={s.dates}>{line}</p>
      {s.on && !s.allowed && (
        <p className="note">
          <button type="button" className="link" onClick={allowRates} data-testid="cap-terms-allow">Show prices in {s.currency} too</button>{" "}
          Distill downloads the European Central Bank's daily rates, once a day. Nothing about this page or you is sent.
        </p>
      )}
      {s.on && s.allowed && s.rates && <p className="note" data-testid="cap-terms-rates">Rates of {rateDay(s.rates)} from the European Central Bank, kept on this device. Point at a price to see its rate.</p>}
      {s.on && s.allowed && s.noRates && <p className="note">The rates could not be downloaded just now: only dates are written.</p>}
      {s.problem && <p className="note" role="alert">{s.problem}</p>}
    </section>
  );
}
