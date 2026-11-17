import { useState, type CSSProperties } from "react";
import { looksLikeUrl } from "./ui/dom";
import { DEMOS } from "./sources";
import { Coil } from "./brand/Coil";
import { DemoArt } from "./brand/DemoArt";
import { Wordmark } from "./brand/Wordmark";
import hero768 from "./brand/assets/hero-768.webp";
import hero1280 from "./brand/assets/hero-1280.webp";
import hero1920 from "./brand/assets/hero-1920.webp";

/** Which view an example opens, in the words of the workspace tabs. */
const OPENS: Record<string, string> = { focus: "Read", wayfill: "Fill a form", recast: "New layout", handrail: "Agent" };

const STEPS: { title: string; body: string }[] = [
  {
    title: "On your device first",
    body: "Distill uses the AI model built into your browser when there is one. Then the page never leaves your computer.",
  },
  {
    title: "The cloud only for structure",
    body: "If your device cannot help, the cloud reads the page and the questions on a form: the structure, not your answers.",
  },
  {
    title: "Your answers never leave",
    body: "What you type into a form stays on this device. It is never sent to the cloud and never saved online.",
  },
];

/** Stagger order for the entrance animation (CSS reads --i). */
const at = (i: number) => ({ "--i": i }) as CSSProperties;

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
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-print reveal" style={at(0)}>
          <img className="hero-scene" src={hero1280} srcSet={`${hero768} 768w, ${hero1280} 1280w, ${hero1920} 1920w`}
            sizes="(max-width: 1240px) 100vw, 1180px" width={1920} height={1080} fetchPriority="high"
            alt="Forms and letters in many languages go into a still. Out come three simple steps: Read, Check, Done." />
          <h1 className="hero-mark" id="home-title">
            <Wordmark tone="ink" sizes="(max-width: 1240px) 36vw, 420px" />
          </h1>
        </div>

        <div className="hero-copy">
          <div className="hero-words reveal" style={at(1)}>
            <p className="tagline">Only what matters on the page.</p>
            <p className="lead">
              Paste a letter, a form or a web page. Distill tells you what it says in plain words, and helps you fill
              it in, one step at a time.
            </p>
          </div>

          <form onSubmit={submit} className="paste paste-card reveal" style={at(2)}>
            <label htmlFor="paste">Paste the text or HTML of a page, or a letter</label>
            <textarea id="paste" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste here" />
            {note && <p className="notice" role="status" data-testid="home-note">{note}</p>}
            <button type="submit" className="btn btn-primary drip">Make it clear</button>
          </form>
        </div>
      </section>

      <section className="examples" aria-labelledby="examples-h">
        <h2 id="examples-h" className="section-title reveal" style={at(3)}>Or try an example page</h2>
        <ul className="demos">
          {DEMOS.map((d, i) => (
            <li key={d.id} className="reveal" style={at(4 + i)}>
              <a className={`card demo demo-${d.id}`} href={`#/demo/${d.id}/${d.tab}`} data-testid={`demo-${d.id}`}>
                <span className="demo-plate"><DemoArt id={d.id} /></span>
                <span className="demo-text">
                  <strong>{d.title}</strong>
                  <span>{d.blurb}</span>
                </span>
                <span className="demo-go">Opens in {OPENS[d.tab] ?? "Read"} <span aria-hidden="true">→</span></span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="how" aria-labelledby="how-h">
        <h2 id="how-h" className="section-title reveal" style={at(7)}>How it works</h2>
        <div className="how-track">
          <Coil className="how-coil" turns={28} fill />
          <ol className="how-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="how-step reveal" style={at(8 + i)}>
                <span className="how-num" aria-hidden="true">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="home-foot">
        <Coil className="foot-coil" turns={6} />
        <p className="muted">
          This page cannot fetch other websites for you. The Distill browser extension reads the page you are on.
          What you type in a form stays on your device.
        </p>
      </footer>
    </main>
  );
}
