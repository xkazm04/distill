// The caption strip, an extension page in a frame the content script puts at the bottom of the page (docs/caption.md).
// First sight: one line saying what Distill did, where it ran, More and Original. No next step is suggested: tours are
// optional and start only when the person asks for one (owner, 2026-11-21). This is slice 1: Clean, What was removed,
// Original and the model state. Translate, Simplify and the tours come in later slices (docs/caption.md).
import { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { clutterSummary, type LocalModelState } from "@distill/engine";
import { downloadLocalModel, isOnDeviceOnlyBuild, localModelState, ON_DEVICE_ONLY_NOTE } from "@distill/web/ai";
import { BRAND_DARK, BRAND_LIGHT } from "@distill/web/ui/theme/brand";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/fredoka/wght.css";
import "./caption.css";
import { applyBinding } from "../../sidepanel/applyBinding";
import type { CleanReport, ContentReplies, ContentRequest, ContentResponse } from "../../messages";

const tabId = Number(new URLSearchParams(location.search).get("tabId"));

/** To the content script of the top frame of this tab (never to other frames, never to this frame). */
async function send<K extends ContentRequest["type"]>(req: ContentRequest): Promise<ContentReplies[K]> {
  const res = (await chrome.tabs.sendMessage(tabId, req, { frameId: 0 })) as ContentResponse<ContentReplies[K]> | undefined;
  if (!res) throw new Error("The page did not answer.");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

const MODEL_WORDS: Record<LocalModelState, string> = {
  available: "AI model on this device: ready.",
  downloadable: "AI model on this device: not downloaded yet.",
  downloading: "AI model on this device: downloading.",
  unavailable: "This computer cannot run the AI model on the device.",
};

const langName = (code: string): string => {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code; } catch { return code; }
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
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== last) { last = h; void send({ type: "distill:caption:size", height: h }).catch(() => undefined); }
    });
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
  const moreBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void send<"distill:caption:clean">({ type: "distill:caption:clean" }).then(setReport, (e: unknown) =>
      setProblem(e instanceof Error ? e.message : String(e)));
    void localModelState().then(setModel);
  }, []);

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
  const lang = report && report.lang !== "en" && report.lang !== "und" ? langName(report.lang) : null;
  const status = problem ?? (!report ? "Cleaning the page..."
    : report.restored.length ? `${clutterSummary(report.items)} · ${report.restored.length} back` : clutterSummary(report.items));

  return (
    <div className="cap" ref={root} data-testid="caption">
      <div className="cap-in">
        {more && report && (
          <section className="more" id="cap-more" aria-label="More" data-testid="cap-more">
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
                  {model === "downloadable" && <> <button type="button" className="link" onClick={() => { setModel("downloading"); void downloadLocalModel(() => undefined).finally(() => void localModelState().then(setModel)); }}>Download the model</button></>}
                </p>
                {isOnDeviceOnlyBuild() && <p className="note">{ON_DEVICE_ONLY_NOTE}</p>}
              </div>
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
            <span className="status" role="status" data-testid="cap-status">{status}{lang ? ` · Page in ${lang}` : ""}</span>
            {report && (
              <span className="chip" data-src="none" tabIndex={0} title="Clean reads the page's own structure on this device. No AI is used and nothing is sent anywhere."
                data-testid="cap-chip">No AI used</span>
            )}
            <span className="sp" />
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
