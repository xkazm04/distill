import type { FormStructure, FormValues, PageModel } from "@distill/engine";
import type { PageHost } from "@distill/web/ui";
import type { PageThemeSeed } from "@distill/web/ui/theme/roles";
import type { ContentReplies, ContentRequest, ContentResponse } from "../messages";

const CANNOT_READ = "Distill cannot read this page. Click the Distill icon while you are on a normal web page.";

/** The real tab, reached through a content script that the side panel injects on demand. */
export class TabHost implements PageHost {
  constructor(private readonly tabId: number, private readonly title: string) {}

  label() { return this.title || "This page"; }

  private async send<K extends ContentRequest["type"]>(req: ContentRequest): Promise<ContentReplies[K]> {
    try {
      return await this.sendOnce<K>(req);
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId: this.tabId }, files: ["content.js"] });
      } catch {
        throw new Error(CANNOT_READ);
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

  getPage(): Promise<PageModel> { return this.send<"distill:getPage">({ type: "distill:getPage" }); }
  getForm(formIndex = 0): Promise<FormStructure> { return this.send<"distill:getForm">({ type: "distill:getForm", formIndex }); }
  readValues(structure: FormStructure): Promise<FormValues> { return this.send<"distill:readValues">({ type: "distill:readValues", structure }); }
  writeValues(structure: FormStructure, values: FormValues) { return this.send<"distill:writeValues">({ type: "distill:writeValues", structure, values }); }
  async highlight(fieldIds: string[]) { await this.send({ type: "distill:highlight", fieldIds }); }
  /** The page's colours, fonts and corner radius, for "Match this page". */
  getTheme(): Promise<PageThemeSeed> { return this.send<"distill:getTheme">({ type: "distill:getTheme" }); }
  /** The original is the tab itself; the panel just tells the person so. */
  async showOriginal() { /* nothing to do: the page was never replaced */ }
}
