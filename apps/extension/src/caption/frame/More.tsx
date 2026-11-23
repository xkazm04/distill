// Round 5, r5-02 and r5-08: More in parts (This page, Do, Check, Settings, What was removed) behind one small tab row,
// and on a phone a bottom sheet with a handle. Only parts with something in them get a tab: every part is rendered
// (the hidden ones with `hidden`), and a part whose panel holds no section has none. Which part opens: parts.ts.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./more.css";
import { loadChoice, nextTab, pickPart, PART_LABEL, PARTS, saveChoice, type Part } from "./parts";

// ---- the phone sheet (r5-08) -----------------------------------------------------------------------------------------

/** The strip's own width (the frame spans the window) is a phone's. */
export const PHONE_QUERY = "(max-width: 560px)";
export const SHEET_HALF = 0.5;
export const SHEET_FULL = 0.92;
/** Let go above this share: full; below SHEET_CLOSE: closed; between: half. */
const SNAP_FULL = 0.72;
const SNAP_CLOSE = 0.28;

export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/** Where a let-go sheet settles. */
export function snap(share: number): "full" | "half" | "closed" {
  return share >= SNAP_FULL ? "full" : share < SNAP_CLOSE ? "closed" : "half";
}

export interface Sheet {
  size: "half" | "full";
  /** The share a finger holds it at, while it drags. */
  drag: number | null;
}

/** The handle: drag it (pointer events) up to full or down to close; press it, or use the buttons, from the keyboard. */
function SheetBar(props: { sheet: Sheet; setSheet: (s: Sheet) => void; close: () => void; win: () => number }) {
  const { sheet, setSheet, close } = props;
  const grab = useRef<{ id: number; offset: number; moved: boolean; share: number } | null>(null);
  const frame = useRef(0);
  const full = sheet.size === "full";

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // The frame's bottom is the window's: the finger's distance from it, plus where on the sheet it took hold, is the
    // sheet's height, whatever the frame's height is while it catches up.
    grab.current = { id: e.pointerId, offset: e.clientY, moved: false, share: full ? SHEET_FULL : SHEET_HALF };
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = grab.current;
    if (!g || g.id !== e.pointerId) return;
    const height = innerHeight - e.clientY + g.offset;
    const share = Math.max(0.08, Math.min(SHEET_FULL, height / Math.max(1, props.win())));
    if (!g.moved && Math.abs(share - g.share) * props.win() < 6) return;
    g.moved = true;
    g.share = share;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setSheet({ size: sheet.size, drag: share }));
  };
  const onUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = grab.current;
    if (!g || g.id !== e.pointerId) return;
    grab.current = null;
    cancelAnimationFrame(frame.current);
    if (!g.moved) return; // a tap: the click that follows toggles
    e.preventDefault();
    suppress.current = true;
    const to = snap(g.share);
    if (to === "closed") { setSheet({ size: "half", drag: null }); close(); } else setSheet({ size: to, drag: null });
  };
  const suppress = useRef(false);
  const onClick = () => {
    if (suppress.current) { suppress.current = false; return; }
    setSheet({ size: full ? "half" : "full", drag: null });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") { e.preventDefault(); setSheet({ size: "full", drag: null }); }
    if (e.key === "ArrowDown") { e.preventDefault(); if (full) setSheet({ size: "half", drag: null }); else close(); }
  };

  return (
    <div className="sheet-bar" data-testid="cap-sheet-bar">
      <button type="button" className="sheet-grip" data-testid="cap-sheet-grip" onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={onUp} onPointerCancel={onUp} onClick={onClick} onKeyDown={onKey}
        aria-label={full ? "Make More half the screen (drag down to close)" : "Make More full screen (drag up, or down to close)"}>
        <span className="sheet-handle" aria-hidden="true" />
      </button>
      <button type="button" className="btn quiet sheet-size" data-testid="cap-sheet-size" onClick={() => setSheet({ size: full ? "half" : "full", drag: null })}>
        {full ? "Half" : "Full screen"}
      </button>
      <button type="button" className="btn quiet sheet-close" data-testid="cap-sheet-close" onClick={close}>Close</button>
    </div>
  );
}

// ---- the parts and their tabs (r5-02) ----------------------------------------------------------------------------

export interface MoreProps {
  parts: Record<Part, ReactNode>;
  /** The part asked for (a chip, a tab), or null: open on the remembered or the default part. */
  asked: Part | null;
  setAsked: (p: Part) => void;
  /** The part with the most to say on this page (parts.ts defaultPart). */
  preferred: Part;
  /** The page's origin, for the per-site choice; null where Distill keeps nothing. */
  origin: string | null;
  counts?: Partial<Record<Part, number>>;
  phone: boolean;
  sheet: Sheet;
  setSheet: (s: Sheet) => void;
  close: () => void;
  win: () => number;
  /** On a phone: the row's controls (Translate, Plain, form check, video skip), moved into the sheet. */
  acts?: ReactNode;
}

export function More(props: MoreProps) {
  const panels = useRef<Partial<Record<Part, HTMLDivElement | null>>>({});
  const tabs = useRef<Partial<Record<Part, HTMLButtonElement | null>>>({});
  const [measured, setFilled] = useState<Part[] | null>(null);
  const filled = measured ?? ["removed"];
  const [remembered, setRemembered] = useState<Part | null | undefined>(props.origin ? undefined : null);
  const { origin, asked, setAsked, preferred } = props;

  useEffect(() => {
    if (!origin) { setRemembered(null); return; }
    let live = true;
    void loadChoice(origin).then((p) => { if (live) setRemembered(p); });
    return () => { live = false; };
  }, [origin]);

  // Which panels hold a section: now, and whenever a section comes or goes (an AI answer arriving).
  useLayoutEffect(() => {
    const read = () => {
      const next = PARTS.filter((p) => (panels.current[p]?.childElementCount ?? 0) > 0);
      setFilled((f) => (f && f.join() === next.join() ? f : next));
    };
    read();
    const mo = new MutationObserver(read);
    for (const p of PARTS) { const el = panels.current[p]; if (el) mo.observe(el, { childList: true }); }
    return () => mo.disconnect();
  }, []);

  // Until the person (or a chip) asks for a part, the part follows what the page holds: a part that fills in a moment
  // later (the product facts, read after Clean) is shown once it has something, if it is the one with the most to say.
  const active = asked && filled.includes(asked) ? asked : pickPart(filled, preferred, remembered);

  const choose = useCallback((p: Part, focus = false) => {
    setAsked(p);
    if (origin) void saveChoice(origin, p);
    if (focus) tabs.current[p]?.focus();
  }, [origin, setAsked]);

  const onKey = (e: React.KeyboardEvent) => {
    const to = nextTab(filled, active, e.key);
    if (!to) return;
    e.preventDefault();
    choose(to, true);
  };

  // The strip grows upward, so a shorter part would move the tab row down under the pointer: while More is open its
  // body keeps the height of the tallest part shown so far (the sheet has its own height on a phone).
  const body = useRef<HTMLDivElement>(null);
  const tallest = useRef(0);
  useLayoutEffect(() => {
    const el = body.current;
    const panel = panels.current[active];
    if (!el || !panel || props.phone) { el?.style.removeProperty("min-height"); return; }
    const grow = () => {
      const h = Math.ceil(panel.getBoundingClientRect().height);
      if (h > tallest.current) { tallest.current = h; el.style.minHeight = `${h}px`; }
    };
    grow();
    const ro = new ResizeObserver(grow);
    ro.observe(panel);
    return () => ro.disconnect();
  }, [active, props.phone]);

  const sheetOn = props.phone;
  return (
    <section className="more" id="cap-more" aria-label="More" data-testid="cap-more" data-part={active}
      data-sheet={sheetOn ? (props.sheet.drag !== null ? "drag" : props.sheet.size) : undefined}>
      {sheetOn && <SheetBar sheet={props.sheet} setSheet={props.setSheet} close={props.close} win={props.win} />}
      {sheetOn && props.acts}
      <div className="more-tabs" role="tablist" aria-label="Parts of More" data-testid="cap-tabs" onKeyDown={onKey}>
        {filled.map((p) => {
          const n = props.counts?.[p];
          return (
            <button key={p} type="button" role="tab" id={`cap-tab-${p}`} aria-controls={`cap-part-${p}`} aria-selected={p === active}
              tabIndex={p === active ? 0 : -1} className="more-tab" data-testid={`cap-tab-${p}`} ref={(el) => { tabs.current[p] = el; }}
              onClick={() => choose(p)}>
              <span className="tab-long">{PART_LABEL[p].long}</span><span className="tab-short">{PART_LABEL[p].short}</span>
              {n !== undefined && n > 0 && <span className="k-count"><span className="vh"> (</span>{n}<span className="vh">)</span></span>}
            </button>
          );
        })}
      </div>
      <div className="more-body" ref={body}>
        {PARTS.map((p) => (
          <div key={p} role="tabpanel" id={`cap-part-${p}`} aria-labelledby={filled.includes(p) ? `cap-tab-${p}` : undefined}
            hidden={p !== active} className={`more-part part-${p}`} data-testid={`cap-part-${p}`} ref={(el) => { panels.current[p] = el; }}>
            {props.parts[p]}
          </div>
        ))}
      </div>
    </section>
  );
}
