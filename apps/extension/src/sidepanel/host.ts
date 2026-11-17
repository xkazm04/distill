import type { FormStructure, FormValues, PageModel } from "@distill/engine";
import type { LocateTarget, PageHost } from "@distill/web/ui";
import { focusColor } from "@distill/web/dom";
import type { PageThemeSeed } from "@distill/web/ui/theme/roles";
import type { ContentReplies, ContentRequest, ContentResponse } from "../messages";

const CANNOT_READ = "Distill cannot read this page.";

/** The page could not be reached at all: the content script could not be put in it. `reason` is Chrome's own words,
 *  which say whether it is a browser page or a page Distill has no permission for (see access.ts). */
export class AccessError extends Error {
  constructor(readonly reason: string) {
    super(CANNOT_READ);
    this.name = "AccessError";
  }
}

/** The real tab, reached through a content script that the side panel injects on demand. One per tab: it lives
 *  across the tab's navigations, so the views can re-read the page without starting over. */
export class TabHost implements PageHost {
  constructor(readonly tabId: number, private readonly title: () => string) {}

  label() { return this.title() || "This page"; }

  private async send<K extends ContentRequest["type"]>(req: ContentRequest): Promise<ContentReplies[K]> {
    try {
      return await this.sendOnce<K>(req);
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId: this.tabId }, files: ["content.js"] });
      } catch (e) {
        throw new AccessError(e instanceof Error ? e.message : String(e));
      }
      return this.sendOnce<K>(req);
    }
  }

  private async sendOnce<K extends ContentRequest["type"]>(req: ContentRequest): Promise<ContentReplies[K]> {
    const res = (await chrome.tabs.sendMessage(this.tabId, req)) as ContentResponse<ContentReplies[K]> | undefined;
    if (!res) throw new Error("no reply");
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }

  /** Resolves when the page answers (the content script is in it); rejects with an AccessError when it cannot be. */
  async ping(): Promise<void> { await this.send<"distill:ping">({ type: "distill:ping" }); }
  getPage(): Promise<PageModel> { return this.send<"distill:getPage">({ type: "distill:getPage" }); }
  getForm(formIndex = 0): Promise<FormStructure> { return this.send<"distill:getForm">({ type: "distill:getForm", formIndex }); }
  readValues(structure: FormStructure): Promise<FormValues> { return this.send<"distill:readValues">({ type: "distill:readValues", structure }); }
  writeValues(structure: FormStructure, values: FormValues) { return this.send<"distill:writeValues">({ type: "distill:writeValues", structure, values }); }
  async highlight(fieldIds: string[], color?: string) {
    await this.send({ type: "distill:highlight", fieldIds, ...(color ? { color } : {}) });
  }
  /** Points at a block or a step's fields in the tab, in the panel's focus colour (the content script scrolls it into
   *  view, instantly under reduced motion). The tab is always beside the panel, so the Workspace calls this always. */
  async locate(target: LocateTarget | null): Promise<void> {
    await this.send<"distill:locate">({ type: "distill:locate", target, color: focusColor() });
  }
  /** The page's colours, fonts and corner radius, for "Match this page". */
  getTheme(): Promise<PageThemeSeed> { return this.send<"distill:getTheme">({ type: "distill:getTheme" }); }
  /** The original is the tab itself; there is nothing to show or hide. */
  async showOriginal() { /* nothing to do: the page was never replaced */ }
}
