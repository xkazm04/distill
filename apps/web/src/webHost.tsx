import { useEffect, useRef, type ReactNode } from "react";
import type { FormStructure, FormValues, PageModel } from "@distill/engine";
import { engine } from "./ui/engine";
import { applyHighlight, applyLocate, fieldElements, focusColor } from "./ui/dom";
import type { LocateTarget, PageHost } from "./ui/host";

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The web app's page: pasted or demo HTML in a sandboxed iframe. `sandbox="allow-same-origin"` without `allow-scripts`
 * means the page's own scripts never run, but this app can read and fill its fields. The iframe is also the "original".
 */
export class IframeHost implements PageHost {
  readonly iframe: HTMLIFrameElement;
  private ready: Promise<Document>;
  /** Block id -> the element of the original page it was read from, for `locate`. Filled on every read. */
  private sources = new Map<string, Element>();

  constructor(private readonly html: string, private readonly url: string, private readonly name: string) {
    this.iframe = document.createElement("iframe");
    this.iframe.setAttribute("sandbox", "allow-same-origin");
    this.iframe.title = "The original page";
    this.iframe.className = "original-frame";
    this.ready = new Promise((resolve) => {
      this.iframe.addEventListener("load", () => resolve(this.iframe.contentDocument as Document), { once: true });
    });
    this.iframe.srcdoc = html;
  }

  label() { return this.name; }
  private doc() { return this.ready; }

  async getPage(): Promise<PageModel> {
    const sources = new Map<string, Element>();
    const page = engine.extractPage(await this.doc(), this.url, { onSource: (id, el) => sources.set(id, el) });
    this.sources = sources;
    return page;
  }
  async getForm(i = 0): Promise<FormStructure> {
    const doc = await this.doc();
    if (!doc.querySelector("form")) throw new Error("This page has no form.");
    return engine.extractForm(doc, this.url, i);
  }
  async readValues(s: FormStructure): Promise<FormValues> { return engine.readValues(await this.doc(), s); }
  async writeValues(s: FormStructure, v: FormValues) { return engine.writeValues(await this.doc(), s, v); }
  async highlight(ids: string[], color?: string) { applyHighlight(await this.doc(), ids, color); }
  async showOriginal() { /* the shell shows or hides the pane */ }

  async locate(target: LocateTarget | null): Promise<void> {
    const doc = await this.doc();
    let els: Element[] = [];
    if (target && "blockId" in target) {
      const el = this.sources.get(target.blockId);
      if (el?.isConnected) els = [el];
    } else if (target) {
      els = fieldElements(doc, target.fieldIds);
    }
    applyLocate(doc, els, focusColor(), reducedMotion());
  }

  originalPane(visible: boolean): ReactNode {
    return <OriginalPane key="original" host={this} visible={visible} />;
  }
}

function OriginalPane({ host, visible }: { host: IframeHost; visible: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el && host.iframe.parentElement !== el) el.appendChild(host.iframe);
  }, [host]);
  return (
    <div className="original-pane" hidden={!visible} data-testid="original-pane">
      <p className="muted original-hint">Fields that Distill filled have a coloured outline.</p>
      <div ref={box} className="original-box" />
    </div>
  );
}
