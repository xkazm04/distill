// The web app's PDF page: a fillable PDF the person opened from their own device. Loaded only when a PDF is opened
// (App.tsx imports this module dynamically), so pdf.js, pdf-lib and the font stay out of the first load.
//
// The PDF never leaves the device: it is read from the file the person chose, never uploaded or fetched. The only
// requests this module makes are for the app's own files (the pdf.js worker and the embedded font, same origin). The
// original bytes are never changed: every answer is written into a new copy, and "Save the filled copy" downloads that.
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import fontUrl from "@distill/pdf/fonts/NotoSans-Regular.ttf?url";
import { fillPdf, PRINT_ONLY_NOTE, readPdf, readPdfValues, type Box, type PdfJs, type PdfProblem, type PdfReading } from "@distill/pdf";
import type { FormStructure, FormValues, PageModel } from "@distill/engine";
import { accentColor, focusColor } from "./ui/dom";
import "./pdf.css";
import type { LocateTarget, PageHost } from "./ui/host";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const PDFJS = pdfjs as unknown as PdfJs;

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** An error whose message is plain words and which carries the problem for Wayfill (see host.ts, FormProblem). */
class ProblemError extends Error {
  constructor(readonly problem: PdfProblem) {
    super(`${problem.title}. ${problem.detail}`);
    this.name = "PdfProblem";
  }
}

let font: Promise<Uint8Array> | null = null;
/** The embedded font (Noto Sans, SIL OFL 1.1), fetched from this app's own files the first time text is written. */
const loadFont = (): Promise<Uint8Array> =>
  (font ??= fetch(fontUrl).then(async (r) => {
    if (!r.ok) throw new Error("The font for writing answers could not be loaded.");
    return new Uint8Array(await r.arrayBuffer());
  }).catch((e: unknown) => { font = null; throw e; }));

interface Marks {
  /** Fields Distill filled: outlined in the accent colour. */
  filled: Box[];
  filledColor?: string;
  /** "Where is it": outlined in the focus colour and scrolled to. */
  located: Box[];
}

export class PdfHost implements PageHost {
  private readonly reading: Promise<PdfReading>;
  /** The copy that holds the answers written so far. Starts as the original. */
  private working: Uint8Array;
  /** The answers written so far, device-only: every write starts again from the original with all of them. */
  private answers: FormValues = {};
  private queue: Promise<unknown> = Promise.resolve();
  private marks: Marks = { filled: [], located: [] };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly original: Uint8Array, private readonly fileName: string) {
    this.working = original;
    this.reading = readPdf(original, { pdfjs: PDFJS, fileName });
    this.reading.then((r) => {
      if (r.protected) this.isProtected = true;
      if (r.printOnly) this.isPrintOnly = true;
      if (r.protected || r.printOnly) this.changed();
    }, () => undefined);
  }

  /** True when the file's author protected it and allowed filling it in: the filled copy is protected the same way. */
  isProtected = false;
  /** True when the PDF has no form fields and Distill found the places to write on from the printed page. */
  isPrintOnly = false;

  /** The file's name, on screen only (the header). It never goes into a structure, a page model or a prompt. */
  label() { return this.fileName; }

  /** Subscribes the pane to new bytes and new outlines. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() { for (const fn of this.listeners) fn(); }
  bytes(which: "copy" | "original"): Uint8Array { return which === "copy" ? this.working : this.original; }
  currentMarks(): Marks { return this.marks; }
  hasAnswers(): boolean { return Object.keys(this.answers).length > 0; }

  async getPage(): Promise<PageModel> {
    return (await this.reading).page;
  }

  async getForm(): Promise<FormStructure> {
    const r = await this.reading;
    if (r.problem || !r.structure) throw new ProblemError(r.problem ?? { kind: "flat", title: "This PDF has no fields to fill in", detail: "" });
    return r.structure;
  }

  /** A print-only PDF: Distill found the places to write on itself, and says so above every step. */
  async formNote(): Promise<{ title: string; detail: string } | null> {
    const r = await this.reading.catch(() => null);
    return r?.printOnly ? { ...PRINT_ONLY_NOTE } : null;
  }

  /** A print-only page cannot be read back at the end (its answers are drawn text): the finish says so per field. */
  async readsBack(): Promise<boolean> {
    const r = await this.reading.catch(() => null);
    return !r?.printOnly;
  }

  /** The answers so far, device-only. A print-only page holds them only as drawn text, so they are kept here. */
  async readValues(): Promise<FormValues> {
    const r = await this.reading;
    if (r.printOnly) return { ...this.answers };
    return readPdfValues(this.working, r);
  }

  writeValues(_s: FormStructure, values: FormValues): Promise<{ written: string[]; failed: string[]; reasons: Record<string, string> }> {
    // One write at a time: each starts from the original with every answer so far.
    const run = this.queue.then(async () => {
      const r = await this.reading;
      const all = { ...this.answers, ...values };
      // pdf.js reads the copy back to confirm each answer drawn on a print-only page.
      const out = await fillPdf(this.original, r, all, loadFont, { pdfjs: PDFJS });
      this.working = out.bytes;
      this.answers = Object.fromEntries(Object.entries(all).filter(([id]) => out.written.includes(id)));
      this.changed();
      const asked = new Set(Object.keys(values));
      const failed = out.failed.filter((id) => asked.has(id));
      return { written: out.written.filter((id) => asked.has(id)), failed, reasons: Object.fromEntries(failed.filter((id) => out.reasons[id]).map((id) => [id, out.reasons[id] as string])) };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private boxesOf(r: PdfReading, ids: readonly string[]): Box[] {
    return r.bindings.filter((b) => ids.includes(b.fieldId)).flatMap((b) => b.boxes);
  }

  async highlight(ids: string[], color?: string): Promise<void> {
    const r = await this.reading;
    this.marks = { ...this.marks, filled: this.boxesOf(r, ids), filledColor: color };
    this.changed();
  }

  async showOriginal(): Promise<void> { /* the shell shows or hides the pane */ }

  async locate(target: LocateTarget | null): Promise<void> {
    const r = await this.reading.catch(() => null);
    if (!r) return;
    let located: Box[] = [];
    if (target && "blockId" in target) {
      const b = r.blockBoxes[target.blockId];
      if (b) located = [b];
    } else if (target) located = this.boxesOf(r, target.fieldIds);
    this.marks = { ...this.marks, located };
    this.changed();
  }

  /** Downloads the filled copy as a new file. The file the person opened is not changed. */
  async saveCopy(): Promise<void> {
    await this.queue;
    const stem = this.fileName.replace(/\.pdf$/i, "") || "form";
    const url = URL.createObjectURL(new Blob([this.working.slice()], { type: "application/pdf" }));
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stem} (filled).pdf`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }

  originalPane(visible: boolean): ReactNode {
    return <PdfPane key="original" host={this} visible={visible} />;
  }
}

/** The PDF itself, page by page: the filled copy, or the file as it was opened. Fields Distill filled are outlined. */
function PdfPane({ host, visible }: { host: PdfHost; visible: boolean }) {
  const [, setTick] = useState(0);
  const [which, setWhich] = useState<"copy" | "original">("copy");
  useEffect(() => host.subscribe(() => setTick((n) => n + 1)), [host]);
  /** Before the first answer the copy is the original: one view, no choice to make. */
  const filled = host.hasAnswers();
  const bytes = host.bytes(filled ? which : "original");
  const marks = host.currentMarks();
  return (
    <div className="original-pane pdf-pane" hidden={!visible} data-testid="original-pane">
      <div className="pdf-pane-bar">
        <p className="muted original-hint">
          {!filled ? `The PDF as you opened it. Distill never changes it: answers go into a copy.${host.isPrintOnly ? " Each step's place on the page is outlined here, so you can see where its answer will be written." : ""}`
            : which === "copy" ? `Your filled copy. ${host.isPrintOnly ? "Answers Distill wrote onto the page" : "Fields that Distill filled"} have a coloured outline.${host.isProtected ? " The original is protected by its author, and the copy keeps the same protection." : ""}${host.isPrintOnly ? " Check each one on the page before you print or send it." : ""}` : "The file as you opened it. Distill never changes it."}
        </p>
        {filled && <div className="seg" role="radiogroup" aria-label="Which PDF to show">
          {(["copy", "original"] as const).map((w) => (
            <label key={w} className={which === w ? "on" : ""}>
              <input type="radio" className="visually-hidden" name="pdf-which" checked={which === w} onChange={() => setWhich(w)} data-testid={`pdf-show-${w}`} />
              <span>{w === "copy" ? "Filled copy" : "As opened"}</span>
            </label>
          ))}
        </div>}
      </div>
      <div className="original-box">
        <PdfPages bytes={bytes} marks={which === "copy" ? marks : { filled: [], located: marks.located }} visible={visible} />
      </div>
    </div>
  );
}

interface Rendered { width: number; height: number; toCss: (b: Box) => { left: number; top: number; width: number; height: number } }

function PdfPages({ bytes, marks, visible }: { bytes: Uint8Array; marks: Marks; visible: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pages, setPages] = useState<Rendered[]>([]);
  const [failed, setFailed] = useState(false);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || width < 50) return;
    let live = true;
    const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, enableXfa: false, verbosity: 0 });
    (async () => {
      const doc = await task.promise;
      const out: Rendered[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (width - 2) / base.width });
        out.push({
          width: vp.width, height: vp.height,
          toCss: (b) => {
            const [x1, y1] = vp.convertToViewportPoint(b.x1, b.y1) as number[];
            const [x2, y2] = vp.convertToViewportPoint(b.x2, b.y2) as number[];
            return { left: Math.min(x1!, x2!), top: Math.min(y1!, y2!), width: Math.abs(x2! - x1!), height: Math.abs(y2! - y1!) };
          },
        });
      }
      if (!live) return;
      setPages(out);
      setFailed(false);
      // Draw once the canvases for these pages are mounted.
      await new Promise((r) => requestAnimationFrame(r));
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
      for (let n = 1; n <= doc.numPages && live; n++) {
        const canvas = canvases.current[n - 1];
        if (!canvas) continue;
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: ((width - 2) / base.width) * dpr });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await page.render({ canvas, viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
      }
    })().catch((e: unknown) => {
      if (!live) return;
      console.warn("[distill] could not show the PDF:", e);
      setFailed(true);
    });
    return () => { live = false; void task.destroy(); };
  }, [bytes, width, visible]);

  // Bring the located field (or block) into view in the pane.
  const located = marks.located[0];
  useEffect(() => {
    if (!visible || !located) return;
    const el = box.current?.querySelector<HTMLElement>("[data-located]");
    el?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [located, visible, pages]);

  const accent = marks.filledColor ?? accentColor();
  const focus = focusColor();
  return (
    <div ref={box} className="pdf-pages" data-testid="pdf-pages">
      {failed && <p className="notice notice-warn" role="alert">Distill could not show this PDF here.</p>}
      {pages.map((p, i) => (
        <div key={i} className="pdf-page" style={{ width: p.width, height: p.height }} aria-label={`Page ${i + 1}`} role="img">
          <canvas ref={(c) => { canvases.current[i] = c; }} style={{ width: p.width, height: p.height }} />
          {marks.filled.filter((b) => b.page === i).map((b, k) => (
            <span key={`f${k}`} className="pdf-mark" style={{ ...p.toCss(b), outlineColor: accent }} />
          ))}
          {marks.located.filter((b) => b.page === i).map((b, k) => (
            <span key={`l${k}`} className="pdf-mark pdf-located" data-located={k === 0 ? "" : undefined} style={{ ...p.toCss(b), outlineColor: focus }} />
          ))}
        </div>
      ))}
    </div>
  );
}
