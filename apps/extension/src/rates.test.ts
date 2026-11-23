// r3-07: the ECB rates in the service worker - at most one download a day, only with the permission, kept on the device,
// and a download that carries no cookies, referrer or headers of Distill's own.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ECB_URL, fetchEcb, getRates, RATES_MAX_AGE_MS, RATES_RETRY_MS, type KeptRates, type RatesDeps } from "./rates";

const XML = `<Cube><Cube time='2026-11-20'><Cube currency='USD' rate='1.05'/><Cube currency='JPY' rate='162'/>
<Cube currency='CZK' rate='25.1'/><Cube currency='GBP' rate='0.83'/><Cube currency='PLN' rate='4.25'/></Cube></Cube>`;

function deps(over: Partial<RatesDeps> = {}, kept: KeptRates | null = null) {
  let store = kept;
  let t = 1_000_000_000;
  const d = {
    now: () => t,
    get: async () => store,
    set: vi.fn(async (k: KeptRates) => { store = k; }),
    allowed: vi.fn(async () => true),
    fetchText: vi.fn(async (_url: string) => XML),
    ...over,
  };
  return { d, tick: (ms: number) => { t += ms; }, kept: () => store };
}

describe("getRates", () => {
  it("downloads once, then answers from the device for a day", async () => {
    const { d, tick } = deps();
    expect((await getRates(d))?.rates.CZK).toBe(25.1);
    expect(d.fetchText).toHaveBeenCalledWith(ECB_URL);
    tick(RATES_MAX_AGE_MS - 1);
    expect((await getRates(d))?.date).toBe("2026-11-20");
    expect(d.fetchText).toHaveBeenCalledTimes(1);
    tick(2);
    await getRates(d);
    expect(d.fetchText).toHaveBeenCalledTimes(2);
  });

  it("asks at the same moment share one download", async () => {
    const { d } = deps();
    await Promise.all([getRates(d), getRates(d), getRates(d)]);
    expect(d.fetchText).toHaveBeenCalledTimes(1);
  });

  it("never downloads without the permission", async () => {
    const { d } = deps({ allowed: vi.fn(async () => false) });
    expect(await getRates(d)).toBeNull();
    expect(d.fetchText).not.toHaveBeenCalled();
  });

  it("offline: the kept rates, and no new try for a day; nothing kept: null, and a new try after an hour", async () => {
    const old = { base: "EUR" as const, date: "2026-11-19", rates: { CZK: 25 } };
    const a = deps({ fetchText: vi.fn(async () => { throw new Error("offline"); }) }, { rates: old, tried: 0 });
    expect(await getRates(a.d)).toEqual(old);
    expect(a.kept()?.rates).toEqual(old);

    const b = deps({ fetchText: vi.fn(async () => "<html>down</html>") });
    expect(await getRates(b.d)).toBeNull();
    b.tick(RATES_RETRY_MS - 1);
    await getRates(b.d);
    expect(b.d.fetchText).toHaveBeenCalledTimes(1);
    b.tick(2);
    await getRates(b.d);
    expect(b.d.fetchText).toHaveBeenCalledTimes(2);
  });
});

describe("fetchEcb", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("a plain GET: no cookies, no referrer, no headers of its own", async () => {
    const f = vi.fn(async () => new Response(XML, { status: 200 }));
    vi.stubGlobal("fetch", f);
    await fetchEcb(ECB_URL);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ECB_URL);
    expect(init).toMatchObject({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer" });
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });
});

describe("the manifest", () => {
  it("asks for the ECB only as an optional host permission", () => {
    const m = JSON.parse(readFileSync(resolve(process.cwd(), "public/manifest.json"), "utf8")) as Record<string, string[] | undefined>;
    expect(m.optional_host_permissions).toContain("https://www.ecb.europa.eu/*");
    expect(m.host_permissions ?? []).not.toContain("https://www.ecb.europa.eu/*");
  });
});
