// r3-03: the proof page, for the owner, in the developer ("own") build only (vite.config.ts leaves proof.html out of
// the public build, and check-dist fails a public build that carries it). One click runs Translate, the claims, the
// gist, plain words and the web check with the REAL models on saved copies of three real pages, through the strip's
// own code (run.ts), and makes a report the owner can save as JSON and Markdown and send back.
//
// What is sent where: the saved pages' text goes to the models as the strip sends a page's text (on the device first;
// the web check sends each claim, the page's title and its address to Google). Nothing a person typed is in a fixture.
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { LocalModelState } from "@distill/engine";
import { isOnDeviceOnlyBuild, localModelState } from "@distill/web/ai";
import { BRAND_DARK, BRAND_LIGHT } from "@distill/web/ui/theme/brand";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "./proof.css";
import { applyBinding } from "../sidepanel/applyBinding";
import { canRunTask } from "../caption/frame/runTask";
import { readerLang } from "../caption/frame/Translate";
import fixtureList from "../../proof/fixtures/fixtures.json";
import denik from "../../proof/fixtures/denik.html?raw";
import aktualne from "../../proof/fixtures/aktualne.html?raw";
import praslavice from "../../proof/fixtures/praslavice.html?raw";
import { runFixture, type Fixture } from "./run";
import { answerLine, cleanLine, PROOF_KIND, toMarkdown, type FixtureResult, type ProofReport, type TaskResult } from "./report";

const HTML: Record<string, string> = { denik, aktualne, praslavice };
export const FIXTURES: Fixture[] = (fixtureList as Omit<Fixture, "html">[]).map((f) => ({ ...f, html: HTML[f.id] ?? "" }));

const WHERE = { on_device: "On device", in_cloud: "In cloud", agent: "Agent" } as const;

async function modelNow(): Promise<LocalModelState | "error"> {
  try { return await localModelState(); } catch { return "error"; }
}

/** Saves `text` as a file through the browser's download (nothing is uploaded). */
function save(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function useTheme() {
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const bind = () => applyBinding(document.documentElement, mq.matches ? BRAND_DARK : BRAND_LIGHT);
    bind();
    mq.addEventListener("change", bind);
    return () => mq.removeEventListener("change", bind);
  }, []);
}

function TaskRow(props: { t: TaskResult }) {
  const { t } = props;
  return (
    <tr data-testid="proof-task" data-task={t.task} data-status={t.status} data-src={t.source ?? ""}>
      <th scope="row">{t.task}</th>
      <td>{t.status}</td>
      <td>{t.source ? `${WHERE[t.source]}${t.via ? " (offscreen)" : ""}` : "-"}</td>
      <td className="num">{t.ms} ms</td>
      <td className="num">{t.dropped}</td>
      <td className="ans">{answerLine(t)}</td>
    </tr>
  );
}

function FixtureCard(props: { f: FixtureResult }) {
  const { f } = props;
  return (
    <section className="fx" data-testid="proof-fixture" data-fixture={f.id}>
      <h2>{f.title}</h2>
      <p className="note">Saved copy of {f.url} ({f.savedOn}). {cleanLine(f)}.</p>
      <table>
        <thead><tr><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Where it ran</th><th scope="col">Time</th><th scope="col">Door left out</th><th scope="col">Answer</th></tr></thead>
        <tbody>{f.tasks.map((t) => <TaskRow key={t.task} t={t} />)}</tbody>
      </table>
    </section>
  );
}

function Proof() {
  useTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState("");
  const [results, setResults] = useState<FixtureResult[]>([]);
  const [report, setReport] = useState<ProofReport | null>(null);

  if (isOnDeviceOnlyBuild()) return <main className="proof"><h1>Not in this build</h1></main>;

  /** The fixture as the page: a same-origin frame with scripts off (sandbox without allow-scripts). */
  const mount = (f: Fixture) => new Promise<{ doc: Document; win: Window }>((resolve, reject) => {
    const el = frame.current;
    if (!el) { reject(new Error("no frame")); return; }
    el.onload = () => {
      const doc = el.contentDocument;
      const win = el.contentWindow;
      if (doc && win) resolve({ doc, win }); else reject(new Error("the fixture did not load"));
    };
    el.srcdoc = f.html;
  });

  const run = async () => {
    setRunning(true);
    setResults([]);
    setReport(null);
    const startedAt = new Date().toISOString();
    const before = await modelNow();
    const canRun = await canRunTask().catch(() => false);
    const all: FixtureResult[] = [];
    for (const f of FIXTURES) {
      setNow(`${f.title}: reading...`);
      const r = await runFixture(f, mount, { canRun, onTask: (t) => setNow(`${f.title}: ${t.task} ${t.status} (${t.ms} ms)`) });
      all.push(r);
      setResults([...all]);
    }
    const rep: ProofReport = {
      kind: PROOF_KIND, version: 1, startedAt, finishedAt: new Date().toISOString(),
      build: { variant: import.meta.env.VITE_EXT_VARIANT ?? "own", mode: import.meta.env.MODE, extension: chrome.runtime.getManifest().version, userAgent: navigator.userAgent },
      reader: readerLang(), model: { before, after: await modelNow() }, available: canRun, fixtures: all,
    };
    setReport(rep);
    setNow("Done.");
    setRunning(false);
  };

  const stamp = report?.startedAt.replace(/[:.]/g, "-").slice(0, 19) ?? "";
  return (
    <main className="proof" data-testid="proof">
      <h1>Distill proof run</h1>
      <p>
        Runs Translate, the claims, the gist, plain words and the web check with this copy's real models on saved copies of
        three real pages ({FIXTURES.map((f) => f.id).join(", ")}), through the same code the strip uses. Page text goes to the
        models as the strip sends it: on this device first, and for the web check each claim, the page's title and its
        address go to Google. Nothing you typed is in these pages. Developer build only.
      </p>
      <div className="acts">
        <button type="button" className="btn primary" onClick={() => void run()} disabled={running} data-testid="proof-run">{running ? "Running..." : "Run"}</button>
        <button type="button" className="btn" disabled={!report} data-testid="proof-save-json"
          onClick={() => report && save(`distill-proof-${stamp}.json`, JSON.stringify(report, null, 2), "application/json")}>Save report (JSON)</button>
        <button type="button" className="btn" disabled={!report} data-testid="proof-save-md"
          onClick={() => report && save(`distill-proof-${stamp}.md`, toMarkdown(report), "text/markdown")}>Save report (Markdown)</button>
        <span className="note" role="status" data-testid="proof-status">{now}</span>
      </div>
      {report && (
        <p className="note" data-testid="proof-summary">
          On-device model: {report.model.before} at the start, {report.model.after} at the end. Reader's language: {report.reader}.
          {report.available ? "" : " No model could answer in this copy: every AI task was skipped."}
        </p>
      )}
      {results.map((f) => <FixtureCard key={f.id} f={f} />)}
      <h2 className="sub">The page being read</h2>
      {/* No allow-scripts: the saved page's own scripts (none are kept) could never run; allow-same-origin lets
          Distill's page-side code read it as it reads a tab's page. */}
      <iframe ref={frame} className="page" title="The saved page being read" sandbox="allow-same-origin" data-testid="proof-page" />
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><Proof /></StrictMode>);
