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

/** Where the extension install routes are (README, Install): the release download and build-it-yourself. */
export const EXTENSION_STEPS_URL = "https://github.com/xkazm04/distill#install";

/** The privacy policy, a static page next to the app (apps/web/public/privacy.html, hosted at /privacy.html). */
export const PRIVACY_URL = "privacy.html";

const buildIt = (
  <a href={EXTENSION_STEPS_URL} target="_blank" rel="noreferrer">get the Distill extension</a>
);

/** Stagger order for the entrance animation (CSS reads --i). */
const at = (i: number) => ({ "--i": i }) as CSSProperties;

export function Home({ onPaste, onPdf }: { onPaste: (input: string) => void; onPdf?: (file: File) => Promise<void> }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<"empty" | "url" | null>(null);
  const [pdfNote, setPdfNote] = useState<string | null>(null);

  async function choosePdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be chosen again
    if (!file || !onPdf) return;
    setPdfNote(null);
    try { await onPdf(file); } catch (err) { setPdfNote(err instanceof Error ? err.message : "Distill could not open this file."); }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) { setNote("empty"); return; }
    if (looksLikeUrl(text)) { setNote("url"); return; }
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
            {note && (
              <p className="notice" role="status" data-testid="home-note">
                {note === "empty" ? "Paste some text or a page first." : (
                  <>A web page cannot open other websites. Copy the page text and paste it here, or {buildIt} to
                    read any page.</>
                )}
              </p>
            )}
            <button type="submit" className="btn btn-primary drip">Make it clear</button>
          </form>

          {onPdf && (
            <div className="paste paste-card pdf-open reveal" style={at(3)}>
              <p><strong>Or fill in a PDF form</strong></p>
              <p className="muted">
                The PDF is opened on this device and never uploaded. Distill fills in a copy, which you save as a new file.
              </p>
              <label className="btn" data-testid="open-pdf">
                Open a PDF form
                <input type="file" accept="application/pdf,.pdf" className="visually-hidden" onChange={(e) => void choosePdf(e)} />
              </label>
              {pdfNote && <p className="notice notice-warn" role="alert" data-testid="pdf-note">{pdfNote}</p>}
            </div>
          )}
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
          This page cannot open other websites for you. To read any page you are on, {buildIt}. What you type in a form stays on your device.
        </p>
        <p className="muted"><a href={PRIVACY_URL} data-testid="privacy-link">Privacy policy</a></p>
      </footer>
    </main>
  );
}
