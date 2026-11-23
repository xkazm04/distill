// The caption strip, an extension page in a frame the content script puts at the bottom of the page (docs/caption.md).
// First sight: one line saying what Distill did, where it ran, More and Original. No next step is suggested: tours are
// optional and start only when the person asks for one in More (owner, 2026-11-21; Tours.tsx, r4-08). This is slice 1: Clean, What was removed,
// Original and the model state. Translate, Simplify and the tours come in later slices (docs/caption.md).
import { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LocalModelState } from "@distill/engine";
import { downloadLocalModel, isOnDeviceOnlyBuild, localModelState, ON_DEVICE_ONLY_NOTE } from "@distill/web/ai";
import { BRAND_DARK, BRAND_LIGHT } from "@distill/web/ui/theme/brand";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/fredoka/wght.css";
import "./caption.css";
import { applyBinding } from "../../sidepanel/applyBinding";
import { deviceModelBlocked, offscreenModelState } from "../../offscreen/client";
import { isCaptionUpdate, type CleanReport } from "../../messages";
import { send, tabId } from "./send";
import { statusLine } from "./status";
import { CalmSection } from "./Calm";
import { ComfortSection } from "./Comfort";
import { ContactSection } from "./Contact";
import { FormCheckRow, FormCheckSection, ROW_MIN_FIELDS, useFormFields } from "./FormCheck";
import { sourceChip, TranslateRow, useTranslate } from "./Translate";
import { ClaimsSection, useClaims, withPageTasks } from "./Claims";
import { chipWithChecks, ChecksControls, useChecks } from "./ClaimCheck";
import { GistSection, useGist } from "./Gist";
import { plainChip, PlainRow, usePlain, withPlain } from "./Plain";
import { TablesLinksSection } from "./Tables";
import { RememberSection, useRemember } from "./Remember";
import { AskSection } from "./Ask";
import { BylineSection, useByline, withByline } from "./Byline";
import { ActionsSection, useActions, withActions } from "./Actions";
import { TermsSection, useTerms } from "./Terms";
import { DarkSection, useDark } from "./Dark";
import { ConsentSection } from "./Consent";
import { ProductSection } from "./Product";
import { VideoRow, VideoSection } from "./Video";
import { ToursSection, TourRow, useTours } from "./Tours";
import { useExplain } from "./Explain";
import { More, SHEET_FULL, SHEET_HALF, usePhone, type Sheet } from "./More";
import { defaultPart, type Part } from "./parts";
import { DistillLinks, RemovedSection } from "./Removed";
import { FirstLine } from "./FirstLine";
import { chips as lineChips, sentence as lineSentence } from "./lineParts";

function useTheme() {
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const bind = () => applyBinding(document.documentElement, mq.matches ? BRAND_DARK : BRAND_LIGHT);
    bind();
    mq.addEventListener("change", bind);
    return () => mq.removeEventListener("change", bind);
  }, []);
}

/** Tells the page side how tall the strip is, so it sizes the frame and keeps the page's last lines clear of it. */
function useReportHeight(ref: React.RefObject<HTMLElement | null>, sheet: { share: number; drag: boolean } | null, win: React.MutableRefObject<number>) {
  // r5-08: on a phone More is a bottom sheet: it asks for its share of the window (half, full, where a finger holds it)
  // instead of its natural height, and fills the frame inside.
  const share = sheet?.share ?? null;
  const drag = sheet?.drag ?? false;
  useLayoutEffect(() => {
    if (share === null) return;
    void send<"distill:caption:size">({ type: "distill:caption:size", height: 0, sheet: share, drag }).then((r) => { win.current = r.win; }, () => undefined);
  }, [share, drag, win]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || share !== null) return;
    let last = 0;
    // The height the strip wants is its natural height: More counted in full even while it scrolls inside itself. The
    // page side clamps it (at most 45% of the window); when it does, More gets the rest as its own scroll box, so the
    // row with More and Original always stays on screen.
    const measure = () => {
      const more = el.querySelector<HTMLElement>(".more");
      const natural = Math.ceil(el.getBoundingClientRect().height + (more ? more.scrollHeight - more.clientHeight : 0));
      for (const c of Array.from(more?.children ?? [])) ro.observe(c);
      if (natural === last) return;
      last = natural;
      void send<"distill:caption:size">({ type: "distill:caption:size", height: natural }).then(({ height, win: w }) => {
        win.current = w;
        if (!more?.isConnected) return;
        const over = natural - height;
        if (over > 0) more.style.setProperty("--more-max", `${Math.max(80, more.scrollHeight - over)}px`);
        else more.style.removeProperty("--more-max");
      }, () => undefined);
    };
    const ro = new ResizeObserver(measure);
    // Only once the fonts are in: a height measured in the fallback font is a jump the page would see.
    let live = true;
    void document.fonts.ready.then(() => { if (live) ro.observe(el); });
    return () => { live = false; ro.disconnect(); };
  }, [ref, share]);
}

function Caption() {
  useTheme();
  const root = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  const [sheet, setSheet] = useState<Sheet>({ size: "half", drag: null });
  const [asked, setAsked] = useState<Part | null>(null);
  const win = useRef(0);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [original, setOriginal] = useState(false);
  const [more, setMore] = useState(false);
  const [model, setModel] = useState<LocalModelState | "checking">("checking");
  const [modelBlocked, setModelBlocked] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const sheetOn = phone && more && report !== null && !original;
  useReportHeight(root, sheetOn ? { share: sheet.drag ?? (sheet.size === "full" ? SHEET_FULL : SHEET_HALF), drag: sheet.drag !== null } : null, win);
  // More closed: the next time it opens on the remembered or default part, at half the screen on a phone.
  useEffect(() => { if (!more) { setAsked(null); setSheet({ size: "half", drag: null }); } }, [more]);
  const openPart = useCallback((p: Part) => { setAsked(p); setMore(true); }, []);
  const closeMore = useCallback(() => { setMore(false); moreBtn.current?.focus(); }, []);
  const winHeight = useCallback(() => win.current || (sheet.size === "full" ? innerHeight / SHEET_FULL : innerHeight / SHEET_HALF), [sheet.size]);

  useEffect(() => {
    void send<"distill:caption:clean">({ type: "distill:caption:clean" }).then(setReport, (e: unknown) =>
      setProblem(e instanceof Error ? e.message : String(e)));
    // On a site that blocks the model in frames, the frame's own LanguageModel always says "unavailable": ask the
    // offscreen document, where Translate runs there (docs/caption.md, risk 1).
    const blocked = deviceModelBlocked();
    setModelBlocked(blocked);
    void (blocked ? offscreenModelState().catch((): LocalModelState => "unavailable") : localModelState()).then(setModel);
    // Stay clean (#3): the page side removed something new by itself.
    const onUpdate = (m: unknown) => { if (isCaptionUpdate(m) && m.tabId === tabId) setReport(m.report); };
    chrome.runtime.onMessage.addListener(onUpdate);
    return () => chrome.runtime.onMessage.removeListener(onUpdate);
  }, []);
  const translate = useTranslate(report);
  const claims = useClaims(report, translate.state);
  const gist = useGist(report, translate.state);
  const plain = usePlain(report, translate);
  // The web check (r2-02) lives here, not only in More: after consent the top claims are checked while More is shut.
  const checks = useChecks(claims.claims);
  const remember = useRemember(report, setReport, translate);
  // Dark page (r3-06) turns on by itself in dark mode once chosen, More open or not.
  useDark(report);
  // r3-07: prices and dates in your terms go in once Clean answered, More open or not.
  useTerms(report);
  // Round 3: who wrote this and when (r3-05), what this page asks of you (r3-09); both parts of the status line.
  const byline = useByline(report);
  const actions = useActions(report);
  // r5-02: a page with a real form opens More on Do when it asks things of the reader.
  const formFields = useFormFields(report);
  // Round 4: explain this word (r4-05) answers the page's Explain button, More open or not.
  useExplain(report);
  // Round 4: tours, started by hand only (r4-08).
  const tours = useTours(report, gist, claims);
  const touring = tours.run !== null;
  const endTour = tours.end;
  // A tour shows the page: More closes when one starts, and focus comes back to More when it ends.
  const wasTouring = useRef(false);
  useEffect(() => {
    if (touring) setMore(false);
    else if (wasTouring.current) moreBtn.current?.focus();
    wasTouring.current = touring;
  }, [touring]);

  const toggleOriginal = useCallback(async () => {
    const on = !original;
    // The original page shows nothing of Distill's: a tour that runs ends.
    if (on && touring) endTour();
    await send({ type: "distill:caption:original", on });
    setOriginal(on);
    setMore(false);
  }, [original, touring, endTour]);

  const restore = useCallback(async (id: string) => {
    setReport(await send<"distill:caption:restore">({ type: "distill:caption:restore", id }));
  }, []);

  const close = useCallback(() => { void send({ type: "distill:caption:close" }); }, []);

  const openPanel = useCallback(async () => {
    try {
      await chrome.sidePanel.open({ tabId });
    } catch (e) {
      setProblem(`The Distill panel could not open here (${e instanceof Error ? e.message : String(e)}).`);
    }
  }, []);

  // Esc ends a tour (so does the End key), else closes More, then shows the page as Distill made it again.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (touring && (e.key === "Escape" || e.key === "End")) { e.preventDefault(); endTour(); return; }
      if (e.key !== "Escape") return;
      if (more) { setMore(false); moreBtn.current?.focus(); } else if (original) void toggleOriginal();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [more, original, toggleOriginal, touring, endTour]);

  const status = problem ?? (!report ? "Cleaning the page..." : withActions(withByline(withPlain(statusLine(report, translate.state, claims.phase === "ready" ? claims.claims.length : 0), plain.state), byline), actions));

  const claimCount = claims.phase === "ready" ? claims.claims.length : 0;
  const lineIn = { report, problem, translate: translate.state, plain: plain.state, claims: claimCount, actions: actions?.length ?? 0, byline };
  // The row's own controls: in the row on a wide strip; on a phone, in the sheet (r5-08), so the row keeps More and Original.
  const rowControls = report && <>
    <VideoRow report={report} />
    <FormCheckRow report={report} />
    <TranslateRow report={report} translate={translate} />
    <PlainRow report={report} plain={plain} translate={translate} />
  </>;

  return (
    <div className="cap" ref={root} data-testid="caption" data-sheet={sheetOn ? "" : undefined}>
      <div className="cap-in">
        {more && report && (
          <More asked={asked} setAsked={setAsked} origin={remember.origin} phone={phone} sheet={sheet} setSheet={setSheet} close={closeMore} win={winHeight}
            preferred={defaultPart({ claims: claimCount, claimsComing: claims.phase === "finding" || claims.phase === "idle", article: report.kind === "article",
              actions: actions?.length ?? 0, actionsComing: actions === null, formOrLetter: report.kind === "form" || report.kind === "letter" || formFields >= ROW_MIN_FIELDS })}
            counts={{ check: claimCount, do: actions?.length ?? 0, removed: report.items.length - report.restored.length }}
            acts={phone ? <div className="sheet-acts" data-testid="cap-sheet-acts">{rowControls}</div> : undefined}
            parts={{
              page: <>
                <GistSection report={report} gist={gist} />
                <AskSection report={report} setReport={setReport} />
                <ProductSection report={report} setReport={setReport} />
                <VideoSection report={report} setReport={setReport} />
                <BylineSection report={report} setReport={setReport} />
              </>,
              do: <>
                <ActionsSection report={report} setReport={setReport} showOriginal={toggleOriginal} />
                <ContactSection report={report} />
                <FormCheckSection report={report} />
                <ToursSection report={report} setReport={setReport} tours={tours} />
              </>,
              check: <>
                <ClaimsSection report={report} claims={claims} />
                <ChecksControls checks={checks} claims={claims.claims} />
              </>,
              settings: <>
                <ComfortSection report={report} setReport={setReport} />
                <DarkSection report={report} setReport={setReport} />
                <TermsSection report={report} setReport={setReport} />
                <TablesLinksSection report={report} setReport={setReport} />
                <ConsentSection report={report} setReport={setReport} />
                <CalmSection report={report} setReport={setReport} />
                <RememberSection report={report} remember={remember} />
              </>,
              removed: <>
                <RemovedSection report={report} restore={(id) => void restore(id)} />
                <DistillLinks model={model} modelBlocked={modelBlocked} openPanel={() => void openPanel()} close={close}
                  onDeviceOnly={isOnDeviceOnlyBuild() ? ON_DEVICE_ONLY_NOTE : null}
                  download={() => { setModel("downloading"); void downloadLocalModel(() => undefined).finally(() => void localModelState().then(setModel)); }} />
              </>,
            }} />
        )}
        {original ? (
          <div className="row" data-testid="cap-row">
            <img className="mark" src="icons/icon-32.png" alt="Distill" />
            <span className="status" role="status">Showing the original page</span>
            <span className="sp" />
            <button type="button" className="btn primary" onClick={() => void toggleOriginal()} data-testid="cap-back">Back to Distill</button>
          </div>
        ) : touring ? (
          <div className="row" data-testid="cap-row">
            <img className="mark" src="icons/icon-32.png" alt="Distill" />
            <TourRow tours={tours} />
            <button type="button" className="btn quiet" onClick={() => void toggleOriginal()} data-testid="cap-original">Original</button>
          </div>
        ) : (
          <div className="row" data-testid="cap-row">
            <img className="mark" src="icons/icon-32.png" alt="Distill" />
            <span className="status vh" role="status" data-testid="cap-status" title={status}>{status}</span>
            <FirstLine sentence={lineSentence(lineIn)} chips={lineChips(lineIn)} full={status} open={openPart} wrap={!!problem && !report} />
            {report && (() => {
              const chip = chipWithChecks(withPageTasks(plainChip(sourceChip(translate.state), plain.state, translate.state.source), claims, gist), checks);
              return <span className="chip" data-src={chip.src} tabIndex={0} title={chip.title} data-testid="cap-chip" {...chip.data}>{chip.text}</span>;
            })()}
            <span className="sp" />
            {!phone && rowControls}
            <button type="button" className="btn quiet more-btn" ref={moreBtn} aria-expanded={more} aria-controls="cap-more" disabled={!report}
              onClick={() => setMore((m) => !m)} data-testid="cap-more-btn">More <span className="car" aria-hidden="true">{more ? "▾" : "▴"}</span></button>
            <button type="button" className="btn quiet" onClick={() => void toggleOriginal()} disabled={!report} data-testid="cap-original">Original</button>
            {problem && !report && <button type="button" className="btn quiet" onClick={close}>Close</button>}
          </div>
        )}
      </div>
    </div>
  );
}

if (!Number.isInteger(tabId)) {
  document.body.textContent = "Distill: this strip belongs on a page.";
} else {
  createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><Caption /></StrictMode>);
}
