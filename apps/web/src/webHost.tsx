import { useEffect, useRef, type ReactNode } from "react";
import type { FormStructure, FormValues, PageModel } from "@distill/engine";
import { engine } from "./ui/engine";
import { applyHighlight } from "./ui/dom";
import type { PageHost } from "./ui/host";

/**
 * The web app's page: pasted or demo HTML in a sandboxed iframe. `sandbox="allow-same-origin"` without `allow-scripts`
 * means the page's own scripts never run, but this app can read and fill its fields. The iframe is also the "original".
 */
export class IframeHost implements PageHost {
  readonly iframe: HTMLIFrameElement;
  private ready: Promise<Document>;

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

  async getPage(): Promise<PageModel> { return engine.extractPage(await this.doc(), this.url); }
  async getForm(i = 0): Promise<FormStructure> {
    const doc = await this.doc();
    if (!doc.querySelector("form")) throw new Error("This page has no form.");
    return engine.extractForm(doc, this.url, i);
  }
  async readValues(s: FormStructure): Promise<FormValues> { return engine.readValues(await this.doc(), s); }
  async writeValues(s: FormStructure, v: FormValues) { return engine.writeValues(await this.doc(), s, v); }
  async highlight(ids: string[]) { applyHighlight(await this.doc(), ids); }
  async showOriginal() { /* the shell shows or hides the pane */ }

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
    <div className="panel original-pane" hidden={!visible} data-testid="original-pane">
      <p className="muted">The original page. Fields that Distill filled are outlined in blue.</p>
      <div ref={box} />
    </div>
  );
}
