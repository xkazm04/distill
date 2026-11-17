import type { HandrailPort } from "./ui";

/** The hosted web app has no agent bridge. In `npm run dev` only, `?handrail=fake` shows the panel with sample proposals. */
export function devHandrailPort(): HandrailPort | undefined | null {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get("handrail") === "fake") {
    return fakePort();
  }
  return undefined;
}

let cached: HandrailPort | null = null;
function fakePort(): HandrailPort {
  if (cached) return cached;
  const subs = new Set<(e: never) => void>();
  cached = {
    onMessage(cb) {
      subs.add(cb as (e: never) => void);
      setTimeout(() => {
        (cb as (e: unknown) => void)({ id: "s1", type: "status", payload: { connected: true } });
        (cb as (e: unknown) => void)({ id: "x1", type: "proposal.create", payload: { proposalId: "pr1", fieldId: "email", value: "jana.novakova@example.org", rationale: "Your saved profile lists this address." } });
        (cb as (e: unknown) => void)({ id: "x2", type: "proposal.create", payload: { proposalId: "pr2", fieldId: "phone", value: "+420 777 123 456", rationale: "The letter on your desktop gives this number." } });
      }, 100);
      return () => subs.delete(cb as (e: never) => void);
    },
    post() { /* nothing listens in the demo */ },
    disconnect() { subs.clear(); },
  };
  return cached;
}
