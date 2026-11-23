// The caption strip, an extension page in a frame the content script puts at the bottom of the page (docs/caption.md).
// First sight: one line saying what Distill did, where it ran, More and Original. No next step is suggested: tours are
// optional and start only when the person asks for one (owner, 2026-11-21). This is slice 1: Clean, What was removed,
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
import { FormCheckRow, FormCheckSection } from "./FormCheck";
import { sourceChip, TranslateRow, useTranslate } from "./Translate";
import { ClaimsSection, useClaims, withPageTasks } from "./Claims";
import { chipWithChecks, ChecksControls, useChecks } from "./ClaimCheck";
import { GistSection, useGist } from "./Gist";
import { plainChip, PlainRow, usePlain, withPlain } from "./Plain";
import { TablesLinksSection } from "./Tables";
import { RememberSection } from "./Remember";

const MODEL_WORDS: Record<LocalModelState, string> = {
  available: "AI model on this device: ready.",
  downloadable: "AI model on this device: not downloaded yet.",
  downloading: "AI model on this device: downloading.",
  unavailable: "This computer cannot run the AI model on the device.",
};

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
function useReportHeight(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
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
      void send<"distill:caption:size">({ type: "distill:caption:size", height: natural }).then(({ height }) => {
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
  }, [ref]);
}

function Caption() {
  useTheme();
  const root = useRef<HTMLDivElement>(null);
  useReportHeight(root);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [original, setOriginal] = useState(false);
  const [more, setMore] = useState(false);
  const [model, setModel] = useState<LocalModelState | "checking">("checking");
  const [modelBlocked, setModelBlocked] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);

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

  const toggleOriginal = useCallback(async () => {
    const on = !original;
    await send({ type: "distill:caption:original", on });
    setOriginal(on);
    setMore(false);
  }, [original]);

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

  // Esc closes More first, then shows the page as Distill made it again.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (more) { setMore(false); moreBtn.current?.focus(); } else if (original) void toggleOriginal();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [more, original, toggleOriginal]);

  const removed = report ? report.items.length - report.restored.length : 0;
  const status = problem ?? (!report ? "Cleaning the page..." : withPlain(statusLine(report, translate.state, claims.phase === "ready" ? claims.claims.length : 0), plain.state));

  return (
    <div className="cap" ref={root} data-testid="caption">
      <div className="cap-in">
        {more && report && (
          <section className="more" id="cap-more" aria-label="More" data-testid="cap-more">
            <GistSection report={report} gist={gist} />
            <div className="more-cols">
              <div>
                <h2>What was removed ({removed} of {report.items.length})</h2>
                {report.items.length === 0 ? <p className="note">Nothing on this page looked like clutter.</p> : (
                  <ul className="removed">
                    {report.items.map((it) => {
                      const back = report.restored.includes(it.id);
                      return (
                        <li key={it.id} className={back ? "back" : undefined} data-testid="cap-removed-item">
                          <span>{it.label}</span>
                          {back ? <span>Back on the page</span>
                            : <button type="button" className="btn sm quiet" onClick={() => void restore(it.id)} aria-label={`Show ${it.label} again`}>Show</button>}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {removed > 1 && <button type="button" className="link" onClick={() => void restore("all")}>Show everything again</button>}
                {report.unlockedScroll && <p className="note">The page could not scroll while its pop-up was up. Distill let it scroll again.</p>}
              </div>
              <div className="links">
                <h2>Distill</h2>
                <button type="button" className="link" onClick={() => void openPanel()}>Open the full Distill panel</button>
                <button type="button" className="link" onClick={close} data-testid="cap-close">Close Distill on this page</button>
                <p className="model" data-testid="cap-model" data-state={model}>
                  {model === "checking" ? "Checking the AI model on this device..." : MODEL_WORDS[model]}
                  {model === "downloadable" && !modelBlocked && <> <button type="button" className="link" onClick={() => { setModel("downloading"); void downloadLocalModel(() => undefined).finally(() => void localModelState().then(setModel)); }}>Download the model</button></>}
                </p>
                {isOnDeviceOnlyBuild() && <p className="note">{ON_DEVICE_ONLY_NOTE}</p>}
              </div>
            </div>
            <div className="more-extra">
              <ChecksControls checks={checks} claims={claims.claims} />
              <ClaimsSection report={report} claims={claims} />
              <ContactSection report={report} />
              <FormCheckSection report={report} />
              <ComfortSection report={report} setReport={setReport} />
              <CalmSection report={report} setReport={setReport} />
              <TablesLinksSection report={report} setReport={setReport} />
              <RememberSection report={report} />
            </div>
          </section>
        )}
        {original ? (
          <div className="row" data-testid="cap-row">
            <img className="mark" src="icons/icon-32.png" alt="Distill" />
            <span className="status" role="status">Showing the original page</span>
            <span className="sp" />
            <button type="button" className="btn primary" onClick={() => void toggleOriginal()} data-testid="cap-back">Back to Distill</button>
          </div>
        ) : (
          <div className="row" data-testid="cap-row">
            <img className="mark" src="icons/icon-32.png" alt="Distill" />
            <span className="status" role="status" data-testid="cap-status" title={status}>{status}</span>
            {report && (() => {
              const chip = chipWithChecks(withPageTasks(plainChip(sourceChip(translate.state), plain.state, translate.state.source), claims, gist), checks);
              return <span className="chip" data-src={chip.src} tabIndex={0} title={chip.title} data-testid="cap-chip" {...chip.data}>{chip.text}</span>;
            })()}
            <span className="sp" />
            {report && <FormCheckRow report={report} />}
            {report && <TranslateRow report={report} translate={translate} />}
            {report && <PlainRow report={report} plain={plain} translate={translate} />}
            <button type="button" className="btn quiet" ref={moreBtn} aria-expanded={more} aria-controls="cap-more" disabled={!report}
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
