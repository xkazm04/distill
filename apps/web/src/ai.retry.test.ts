import { describe, expect, it } from "vitest";
import { isTransient, withRetry } from "./ai";

const overload = new Error("AI: Error fetching from https://x/models/m:generateContent: [500 Internal Server Error] This model is currently experiencing high demand.");

describe("cloud retry", () => {
  it("classifies overload, rate limit and timeouts as transient, and a bad request as not", () => {
    expect(isTransient(overload)).toBe(true);
    expect(isTransient(new Error("[429 Too Many Requests]"))).toBe(true);
    expect(isTransient(new Error("Request timed out"))).toBe(true);
    expect(isTransient(new Error("[400 Bad Request] invalid schema"))).toBe(false);
    expect(isTransient(new Error("[401 Unauthorized] Firebase App Check token is invalid."))).toBe(false);
  });
  it("retries a transient failure once, then succeeds", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; if (n === 1) throw overload; return "ok"; }, 1)).resolves.toBe("ok");
    expect(n).toBe(2);
  });
  it("gives up after one retry, and never retries a permanent error", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw overload; }, 1)).rejects.toThrow(/high demand/);
    expect(n).toBe(2);
    let m = 0;
    await expect(withRetry(async () => { m++; throw new Error("[400 Bad Request]"); }, 1)).rejects.toThrow();
    expect(m).toBe(1);
  });
});
