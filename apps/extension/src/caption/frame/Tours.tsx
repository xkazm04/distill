// Round 4, card r4-08: tours started by hand. Three tours in More, each offered only when it has something to show and
// started only when the person presses it (nothing starts by itself, owner 2026-11-21):
// - Just the facts: the gist's points, the claims to check, who wrote it and when.
// - Call or write: the ways to reach someone and their hours (things to do r3-09, then round 1's Contact).
// - Before you go: deadlines, what to bring, the address (things to do r3-09, then Contact's address).
// A tour shows only what Distill already found: no new finding, no AI call. Each step scrolls to its words on the page
// and highlights them (caption/tour.ts) while the strip's line says "Step 2 of 5 · <what it is>" with Back, Next and
// End; Esc or the End key ends it, and so do Original and close.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Byline, Claim, GistPoint } from "@distill/engine";
import type { ActionItem, CleanReport, ContactItem, TourStep } from "../../messages";
import { useActions } from "./Actions";
import { dateWords, useByline } from "./Byline";
import type { ClaimsState } from "./Claims";
import type { GistState } from "./Gist";
import { ActionRow, Note, Rows, Section } from "./kit";
import { send } from "./send";
import "./tours.css";

export type TourId = "facts" | "call" | "before";

/** One stop of a tour: what the strip says, and where on the page (null: said in the strip only, as the byline). */
export interface TourItem { label: string; step: TourStep | null }

export interface Tour { id: TourId; title: string; what: string; items: TourItem[] }

const TITLE: Record<TourId, [string, string]> = {
  facts: ["Just the facts", "The main points, the claims to check, who wrote it and when."],
  call: ["Call or write", "Phone numbers, e-mails and opening hours."],
  before: ["Before you go", "Deadlines, what to bring and the address."],
};

export interface TourInput {
  gist: readonly GistPoint[];
  claims: readonly Claim[];
  byline: Byline | null;
  actions: readonly ActionItem[];
  contacts: readonly ContactItem[];
}

const flat = (s: string) => s.toLowerCase().replace(/[\s.,;:–-]+/g, "");
/** One number, address or hours however written ("+420 377 912 345", "377912345"). */
function keyOf(href: string | undefined, kind: string, text: string): string {
  if (href) return href.toLowerCase().replace(/\s+/g, "").replace(/^tel:\+?420/, "tel:");
  return `${kind}:${flat(text)}`;
}

const CONTACT_LEAD: Record<ContactItem["kind"], string> = {
  phone: "Call", email: "Write to", hours: "Hours:", contactPage: "Contact page:", address: "Address:",
};
const isAddress = (a: ActionItem) => a.kind === "contact" && /^Address:/.test(a.text);
const actionLabel = (a: ActionItem) => (a.kind === "deadline" ? `Deadline: ${a.text}` : a.text);

/** The byline in a line, or null when it says neither who nor when. */
function bylineLabel(b: Byline | null, now: Date): string | null {
  if (!b) return null;
  const parts: string[] = [];
  const who = [b.author, b.publisher].filter(Boolean).join(", ");
  if (who) parts.push(who);
  if (b.published) parts.push(`published ${dateWords(b.published, now)}`);
  if (b.updated) parts.push(`updated ${dateWords(b.updated, now)}`);
  return parts.length ? `Who wrote it and when: ${parts.join(", ")}` : null;
}

/** Contacts not already among the things to do (the same number, address or hours), shown on the page now. */
function extraContacts(input: TourInput, kinds: readonly ContactItem["kind"][], have: readonly ActionItem[]): TourItem[] {
  const keys = new Set(have.map((a) => keyOf(a.href, a.kind === "hours" ? "hours" : isAddress(a) ? "address" : "contact", a.value ?? a.quote)));
  const hours = have.filter((a) => a.kind === "hours").map((a) => flat(a.value ?? a.quote));
  const out: TourItem[] = [];
  for (const c of input.contacts) {
    if (c.hidden || !kinds.includes(c.kind)) continue;
    const k = keyOf(c.kind === "contactPage" ? undefined : c.href, c.kind === "phone" || c.kind === "email" ? "contact" : c.kind, c.text);
    if (keys.has(k)) continue;
    // The finder joins lines of hours: hours the things to do list already, in part or whole, are the same hours.
    if (c.kind === "hours" && hours.some((h) => h && (flat(c.text).includes(h) || h.includes(flat(c.text))))) continue;
    keys.add(k);
    out.push({ label: `${CONTACT_LEAD[c.kind]} ${c.text}`, step: { kind: "contact", id: c.id } });
  }
  return out;
}

/**
 * The tours of this page, from what Distill already found. A tour with nothing on the page is not offered: "Just the
 * facts" needs a point or a claim (a byline alone is no tour).
 */
export function buildTours(input: TourInput, now = new Date()): Tour[] {
  const tours: Tour[] = [];
  const add = (id: TourId, items: TourItem[]) => {
    if (items.some((i) => i.step)) tours.push({ id, title: TITLE[id][0], what: TITLE[id][1], items });
  };

  const facts: TourItem[] = input.gist.map((p, i) => ({ label: `Main point ${i + 1}: ${p.text}`, step: { kind: "text", blockId: p.blockId, sentence: p.sentence } }));
  const said = new Set(input.gist.map((p) => `${p.blockId}\n${flat(p.sentence)}`));
  for (const c of input.claims) {
    if (said.has(`${c.blockId}\n${flat(c.text)}`)) continue;
    facts.push({ label: `Claim to check: ${c.text}`, step: { kind: "text", blockId: c.blockId, sentence: c.text } });
  }
  const by = bylineLabel(input.byline, now);
  if (by && facts.length) facts.push({ label: by, step: null });
  add("facts", facts);

  // A thing to do in a part Clean hid (r4-01) has no place on the page as Distill shows it: a tour steps over the
  // page as it is, so it is left out (More lists it, and its Show me opens the original there).
  const shown = input.actions.filter((a) => !a.hidden);
  const reach = shown.filter((a) => (a.kind === "contact" && !isAddress(a)) || a.kind === "hours");
  add("call", [
    ...reach.map((a) => ({ label: actionLabel(a), step: { kind: "action", id: a.id } as TourStep })),
    ...extraContacts(input, ["phone", "email", "hours", "contactPage"], reach),
  ]);

  // A sum to pay counts when it has a date to pay by ("Pay 800 Kč ... by 31. 3. 2027").
  const go = shown.filter((a) => a.kind === "deadline" || a.kind === "bring" || isAddress(a) || (a.kind === "payment" && / by /.test(a.text)));
  add("before", [
    ...go.map((a) => ({ label: actionLabel(a), step: { kind: "action", id: a.id } as TourStep })),
    ...extraContacts(input, ["address"], go.filter(isAddress)),
  ]);
  return tours;
}

export interface TourRun { tour: Tour; index: number; found: boolean }

export interface ToursState {
  tours: Tour[];
  run: TourRun | null;
  start(id: TourId): void;
  next(): void;
  back(): void;
  end(): void;
}

/** "Step 2 of 5 · Call 377 912 345", and when the step is no longer on the page, says so. */
export function stepLine(run: TourRun): string {
  const item = run.tour.items[run.index];
  if (!item) return "";
  const gone = item.step && !run.found ? " (no longer on the page)" : "";
  return `Step ${run.index + 1} of ${run.tour.items.length} · ${item.label}${gone}`;
}

/** The tours of the page and the one running. The contacts are read once the report is in, and again as parts come
 *  back (whether one sits in a hidden part changes). */
export function useTours(report: CleanReport | null, gist: GistState, claims: ClaimsState): ToursState {
  const byline = useByline(report);
  const actions = useActions(report);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [run, setRun] = useState<TourRun | null>(null);
  const restored = report?.restored.length ?? -1;
  useEffect(() => {
    if (restored < 0) return;
    let live = true;
    void send<"distill:caption:contact">({ type: "distill:caption:contact" }).then((c) => { if (live) setContacts(c); }, () => undefined);
    return () => { live = false; };
  }, [restored]);

  const tours = useMemo(() => buildTours({
    gist: gist.phase === "ready" ? gist.points : [],
    claims: claims.phase === "ready" ? claims.claims : [],
    byline, actions: actions ?? [], contacts,
  }), [gist, claims, byline, actions, contacts]);

  // The step asked last: a slower answer to an earlier step must not overwrite it.
  const asked = useRef(0);
  const go = useCallback((tour: Tour, index: number) => {
    const item = tour.items[index];
    if (!item) return;
    const n = ++asked.current;
    setRun({ tour, index, found: true });
    void send<"distill:caption:tour">({ type: "distill:caption:tour", step: item.step }).then(
      (r) => { if (n === asked.current) setRun({ tour, index, found: r.found }); },
      () => { if (n === asked.current) setRun({ tour, index, found: false }); },
    );
  }, []);

  const start = useCallback((id: TourId) => { const t = tours.find((x) => x.id === id); if (t) go(t, 0); }, [tours, go]);
  const next = useCallback(() => { if (run && run.index + 1 < run.tour.items.length) go(run.tour, run.index + 1); }, [run, go]);
  const back = useCallback(() => { if (run && run.index > 0) go(run.tour, run.index - 1); }, [run, go]);
  const end = useCallback(() => {
    asked.current++;
    setRun(null);
    void send({ type: "distill:caption:tour", step: null }).catch(() => undefined);
  }, []);

  return { tours, run, start, next, back, end };
}

/** The tours in More: one button each, for the tours with something on the page. */
export function ToursSection(props: { report: CleanReport; setReport: (r: CleanReport) => void; tours?: ToursState }) {
  const t = props.tours;
  if (!t?.tours.length) return null;
  return (
    <Section id="cap-tours-h" title="Tours" count={t.tours.length} testid="cap-tours" className="tours">
      <Note>Step through what Distill found on this page, one thing at a time. Nothing new is read and no AI runs.</Note>
      <Rows className="tours-list">
        {t.tours.map((tour) => (
          <ActionRow key={tour.id} testid="cap-tour" attrs={{ "data-tour": tour.id }} className="tour-row"
            text={<button type="button" className="btn sm" onClick={() => t.start(tour.id)} data-testid={`cap-tour-start-${tour.id}`}
              aria-label={`Start the tour ${tour.title}, ${tour.items.length} ${tour.items.length === 1 ? "step" : "steps"}`}>
              {tour.title}
            </button>}
            sub={<span className="tour-what">{tour.what} {tour.items.length} {tour.items.length === 1 ? "step" : "steps"}.</span>} />
        ))}
      </Rows>
    </Section>
  );
}

/** The strip's row while a tour runs: where it is, Back, Next (Done on the last step) and End, by keyboard too. */
export function TourRow(props: { tours: ToursState }) {
  const { run, next, back, end } = props.tours;
  const nextBtn = useRef<HTMLButtonElement>(null);
  const started = run?.tour.id;
  // Focus goes to Next once a tour starts, so the keyboard carries on from there.
  useEffect(() => { if (started) nextBtn.current?.focus(); }, [started]);
  if (!run) return null;
  const last = run.index + 1 >= run.tour.items.length;
  const line = stepLine(run);
  return (
    <>
      <span className="status" role="status" data-testid="cap-tour-status" data-tour={run.tour.id} title={line}>{line}</span>
      <span className="sp" />
      <button type="button" className="btn quiet" onClick={back} aria-disabled={run.index === 0} data-testid="cap-tour-back">Back</button>
      <button type="button" className="btn primary" ref={nextBtn} onClick={last ? end : next} data-testid="cap-tour-next">{last ? "Done" : "Next"}</button>
      <button type="button" className="btn quiet" onClick={end} aria-label={`End the tour ${run.tour.title}`} data-testid="cap-tour-end">End</button>
    </>
  );
}
