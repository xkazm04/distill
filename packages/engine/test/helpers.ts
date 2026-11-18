import { Window } from "happy-dom";

export function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** A live page in its own window (frames load, events carry the window's own classes). Page scripts do not run:
 *  a test wires the page's behaviour itself. Close it with `close()`. */
export async function live(html: string, url = "https://forms.example/f"): Promise<{ doc: Document; close: () => Promise<void> }> {
  const w = new Window({ url });
  w.document.write(html);
  await w.happyDOM.waitUntilComplete();
  return { doc: w.document as unknown as Document, close: () => w.happyDOM.close() };
}
