import { useEffect, useState, type ReactNode } from "react";
import { fetchedLibrary, guideLibrary, sessionGuideStore, Workspace, type PageHost, type Tab } from "./ui";
import { IframeHost } from "./webHost";
import { Home } from "./Home";
import { DEMOS, fromPaste, loadDemo, readPdfFile, type Loaded, type OpenedPdf } from "./sources";
import { devHandrailPort } from "./devHandrail";
import { Header, ThemeSwitch } from "./brand/Header";
import { Wordmark } from "./brand/Wordmark";

type Route = { kind: "home" } | { kind: "demo"; id: string; tab: Tab } | { kind: "page"; tab: Tab } | { kind: "pdf"; tab: Tab };
const TABS: Tab[] = ["focus", "wayfill", "recast", "handrail"];

/** Hash routes: #/ , #/demo/<form|article|pricing>/<focus|wayfill|recast|handrail> , #/page/<tab> (pasted content),
 *  #/pdf/<tab> (a PDF opened from this device). */
export function parseHash(hash: string): Route {
  const [, kind, a, b] = hash.replace(/^#/, "").split("/");
  const tab = (t?: string): Tab => (TABS.includes(t as Tab) ? (t as Tab) : "focus");
  if (kind === "demo" && a) return { kind: "demo", id: a, tab: tab(b) };
  if (kind === "page") return { kind: "page", tab: tab(a) };
  if (kind === "pdf") return { kind: "pdf", tab: tab(a) };
  return { kind: "home" };
}

let pasted: Loaded | null = null;
/** The PDF opened in this tab, in memory only. A reload forgets it (the person opens the file again). */
let opened: OpenedPdf | null = null;
/** The form guide keeps its place and answers in this tab's sessionStorage (device only), so a reload picks up there. */
const guideStore = sessionGuideStore();
/** The guide library: the whole of it, fetched once from this app's own origin at one fixed address, and matched on this
 *  device. The request says nothing about the form on screen. Drafts only on the dev server with VITE_GUIDE_DRAFTS=1. */
const guides = guideLibrary(() => fetchedLibrary(new URL("guides/library.json", document.baseURI).href)(), { drafts: import.meta.env.VITE_GUIDE_DRAFTS === "1" });

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const home = route.kind === "home" || (route.kind === "page" && !pasted) || (route.kind === "pdf" && !opened);
  // Home keeps its header; a page opens the workbench, whose sidebar carries the mark and the theme choice.
  return home ? (
    <div className="shell shell-home-page">
      <Header />
      <Home onPaste={(t) => { pasted = fromPaste(t); location.hash = "#/page/focus"; }}
        onPdf={async (f) => { opened = await readPdfFile(f); location.hash = "#/pdf/wayfill"; }} />
    </div>
  ) : (
    <div className="shell shell-work">
      <Page route={route as Exclude<Route, { kind: "home" }>} />
    </div>
  );
}

const ICON: Record<string, ReactNode> = {
  form: <path d="M6 3h9l4 4v14H6zM9 10h7M9 14h7M9 18h4" />,
  article: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />,
  pricing: <path d="M4 5h16v14H4zM4 10h16M10 10v9" />,
  pasted: <path d="M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2" />,
  pdf: <path d="M6 3h9l4 4v14H6zM15 3v4h4M9 13h6M9 17h4" />,
  paste: <path d="M12 5v14M5 12h14" />,
};

function NavIcon({ id }: { id: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICON[id]}</svg>;
}

/** The sidebar's Pages: the three examples, the pasted page when there is one, and a way back to paste another. */
function Pages({ route }: { route: Exclude<Route, { kind: "home" }> }) {
  const here = (id: string) => (route.kind === "demo" ? route.id === id : route.kind === "pdf" ? id === "pdf" : id === "pasted");
  return (
    <ul className="ws-pages">
      {DEMOS.map((d) => (
        <li key={d.id}>
          <a className="ws-navbtn" href={`#/demo/${d.id}/${route.tab}`} aria-current={here(d.id) ? "page" : undefined}>
            <NavIcon id={d.id} /><span className="ws-two">{d.title}</span>
          </a>
        </li>
      ))}
      {pasted && (
        <li>
          <a className="ws-navbtn" href={`#/page/${route.tab}`} aria-current={here("pasted") ? "page" : undefined}>
            <NavIcon id="pasted" /><span className="ws-two">{pasted.name}</span>
          </a>
        </li>
      )}
      {opened && (
        <li>
          <a className="ws-navbtn" href={`#/pdf/${route.tab}`} aria-current={here("pdf") ? "page" : undefined}>
            <NavIcon id="pdf" /><span className="ws-two">{opened.name}</span>
          </a>
        </li>
      )}
      <li>
        <a className="ws-navbtn ws-ghost" href="#/"><NavIcon id="paste" /><span className="ws-two">Paste a page or open a PDF</span></a>
      </li>
    </ul>
  );
}

/** A PDF host, built by the PDF code that loads only now (pdf.js, pdf-lib and the font are not in the first load). */
async function pdfHost(pdf: OpenedPdf): Promise<PageHost> {
  const { PdfHost } = await import("./pdfHost");
  return new PdfHost(pdf.bytes, pdf.name);
}

function Page({ route }: { route: Exclude<Route, { kind: "home" }> }) {
  const key = route.kind === "demo" ? `demo:${route.id}` : route.kind === "pdf" ? `pdf:${opened?.name ?? ""}:${opened?.bytes.length ?? 0}` : "pasted";
  const [host, setHost] = useState<PageHost | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setHost(null); setError(null);
    const pdf = opened;
    const made: Promise<PageHost | null> = route.kind === "pdf"
      ? (pdf ? pdfHost(pdf) : Promise.resolve(null))
      : (route.kind === "demo" ? loadDemo(route.id) : Promise.resolve(pasted)).then((l) => (l ? new IframeHost(l.html, l.url, l.name) : null));
    made.then(
      (h) => { if (!live) return; h ? setHost(h) : setError(route.kind === "pdf" ? "Open the PDF again from the home page." : "That example page does not exist."); },
      (e: unknown) => live && setError(e instanceof Error ? e.message : "Could not open the page."),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setTab = (t: Tab) => {
    location.hash = route.kind === "demo" ? `#/demo/${route.id}/${t}` : route.kind === "pdf" ? `#/pdf/${t}` : `#/page/${t}`;
  };

  if (!host) {
    return (
      <main className="work">
        <p className="topbar"><a href="#/"><span aria-hidden="true">←</span>Home</a></p>
        {error ? <p className="notice notice-warn" role="alert">{error}</p> : <p role="status">Opening the page...</p>}
      </main>
    );
  }
  return (
    <Workspace host={host} initialTab={route.tab} onTab={setTab} handrail={devHandrailPort()} guideStore={guideStore} guides={guides} homeHref="#/"
      brand={<a className="ws-brand-link" href="#/" aria-label="Distill home"><Wordmark tone="paper" className="ws-mark" sizes="100px" /></a>}
      pages={<Pages route={route} />}
      footer={<ThemeSwitch />} />
  );
}
