import { useState } from "react";
import { looksLikeUrl } from "./ui/dom";
import { DEMOS } from "./sources";

export function Home({ onPaste }: { onPaste: (input: string) => void }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) { setNote("Paste some text or a page first."); return; }
    if (looksLikeUrl(text)) {
      setNote("A web page cannot open other websites from here. Install the Distill extension to read any page, or copy the page text and paste it here.");
      return;
    }
    setNote(null);
    onPaste(text);
  }

  return (
    <main className="home">
      <h1>Distill</h1>
      <p className="lead">Only what matters on the page. Paste text, or try an example.</p>

      <form onSubmit={submit} className="paste">
        <label htmlFor="paste">Paste the text or HTML of a page, or a letter</label>
        <textarea id="paste" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste here" />
        {note && <p className="notice" role="status" data-testid="home-note">{note}</p>}
        <button type="submit" className="btn btn-primary">Make it clear</button>
      </form>

      <h2>Or try an example page</h2>
      <ul className="demos">
        {DEMOS.map((d) => (
          <li key={d.id}>
            <a className="card demo" href={`#/demo/${d.id}/${d.tab}`} data-testid={`demo-${d.id}`}>
              <strong>{d.title}</strong>
              <span>{d.blurb}</span>
            </a>
          </li>
        ))}
      </ul>

      <p className="muted">
        This page cannot fetch other websites for you. The Distill browser extension reads the page you are on.
        What you type in a form stays on your device.
      </p>
    </main>
  );
}
