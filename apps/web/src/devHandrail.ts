// Since WP9, proposal.create must carry the fingerprint of the form the agent read, or the panel refuses it.
// The demo agent therefore reads the form first (form.schema) and proposes for the fingerprint it got back.
import type { HandrailPort, HostToPanel } from "./ui";

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
  const subs = new Set<(e: HostToPanel) => void>();
  const emit = (e: HostToPanel) => subs.forEach((cb) => cb(e));
  cached = {
    onMessage(cb) {
      subs.add(cb);
      setTimeout(() => {
        cb({ id: "s1", type: "status", payload: { connected: true } });
        cb({ id: "fs", type: "form.schema", payload: {} });
      }, 100);
      return () => { subs.delete(cb); };
    },
    post(e) {
      if (e.type !== "tool.result" || e.id !== "fs" || !e.payload.ok) return;
      const { fingerprint } = (e.payload.result as { structure: { fingerprint: string } }).structure;
      emit({ id: "x1", type: "proposal.create", payload: { proposalId: "pr1", fieldId: "email", value: "jana.novakova@example.org", rationale: "Your saved profile lists this address.", fingerprint } });
      emit({ id: "x2", type: "proposal.create", payload: { proposalId: "pr2", fieldId: "phone", value: "+420 777 123 456", rationale: "The letter on your desktop gives this number.", fingerprint } });
    },
    disconnect() { subs.clear(); },
  };
  return cached;
}
