// "A newer Distill is available" and the two clicks that install it: get it (download and check), then install it
// (write it into the folder Chrome loads Distill from, and restart). Two clicks because each needs the person's own
// click: Chrome's question about GitHub, then the folder. When anything fails, the way to do it by hand is shown.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Identity } from "./package";
import type { Release } from "./release";
import {
  canPickFolder, checkForUpdate, downloadPackage, forgetFolder, installInto, pickFolder, rememberedFolder, rememberFolder,
  UpdateError, updaterKind, withDownloadAccess, type ChosenFolder,
} from "./updater";
import type { ZipEntry } from "./zip";

type Step =
  | { at: "idle" }
  | { at: "downloading" }
  | { at: "ready"; entries: ZipEntry[] }
  | { at: "installing"; done: number; of: number }
  | { at: "installed" };

const message = (e: unknown, fallback: string) => (e instanceof UpdateError ? e.message : fallback);

export function UpdateNotice() {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & { key?: string; update_url?: string };
  const kind = updaterKind(manifest, import.meta.env.VITE_EXT_VARIANT);
  const running: Identity = { version: manifest.version, ...(manifest.key ? { key: manifest.key } : {}) };

  const [release, setRelease] = useState<Release | null>(null);
  const [step, setStep] = useState<Step>({ at: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  /** Read when the panel opens, so the install click can ask for the right to write without waiting on anything. */
  const folder = useRef<ChosenFolder | undefined>(undefined);
  const [hasFolder, setHasFolder] = useState(false);

  const check = useCallback(async (force: boolean) => {
    try {
      const found = await checkForUpdate({ current: manifest.version, now: Date.now(), force, area: chrome.storage.local, fetch: (...a) => fetch(...a) });
      setRelease(found);
      if (force) setCheckNote(found ? null : "You have the newest version.");
    } catch {
      if (force) setCheckNote("Could not reach GitHub to check. Try again later.");
    }
  }, [manifest.version]);

  useEffect(() => {
    if (kind !== "self") return;
    void check(false);
    void rememberedFolder().then((f) => { folder.current = f; setHasFolder(f !== undefined); });
  }, [kind, check]);

  if (kind !== "self") return null;

  const download = () => {
    if (!release) return;
    setProblem(null);
    setStep({ at: "downloading" });
    // Chrome's question runs inside this click.
    withDownloadAccess(() => downloadPackage(release, running, (...a) => fetch(...a))).then(
      (entries) => setStep({ at: "ready", entries }),
      (e) => { setStep({ at: "idle" }); setProblem(message(e, "The update could not be downloaded.")); },
    );
  };

  const install = (entries: ZipEntry[]) => {
    setProblem(null);
    const known = folder.current;
    // Both branches start inside this click: the folder question, or the question to write to the folder chosen before.
    const chosen: Promise<ChosenFolder | null> = known
      ? known.requestPermission({ mode: "readwrite" }).then((p) => (p === "granted" ? known : null))
      : pickFolder().catch((e: unknown) => { if ((e as { name?: string } | null)?.name === "AbortError") return null; throw e; });
    chosen.then(async (f) => {
      if (!f) { setProblem(known ? "Chrome did not allow writing to the folder, so nothing was changed." : null); return; }
      setStep({ at: "installing", done: 0, of: entries.length });
      const result = await installInto(f, entries, running, (done, of) => setStep({ at: "installing", done, of }));
      if (!result.ok) {
        folder.current = undefined; setHasFolder(false); void forgetFolder();
        setStep({ at: "ready", entries }); setProblem(result.why);
        return;
      }
      await rememberFolder(f);
      setStep({ at: "installed" });
      // Chrome reads the folder again. The panel closes with the old version; a short wait lets this line be read.
      setTimeout(() => chrome.runtime.reload(), 1500);
    }).catch(() => {
      setStep({ at: "ready", entries });
      setProblem("The new version could not be written to the folder. Nothing was restarted. You can try again, or install it by hand.");
    });
  };

  return (
    <footer className="update" data-testid="update">
      {release && step.at !== "installed" && (
        <section className="update-card card" aria-labelledby="update-h" data-testid="update-available">
          <h2 id="update-h">Distill {release.version} is available</h2>
          <p>You have version {manifest.version}. <a href={release.page} target="_blank" rel="noreferrer">What is new</a></p>
          {step.at === "idle" && (
            <>
              <button type="button" className="btn btn-primary" onClick={download}>Get the update</button>
              <p className="muted update-note">Downloads it from GitHub and checks it. Chrome may ask you to allow the download. Nothing is installed yet.</p>
            </>
          )}
          {step.at === "downloading" && <p role="status">Downloading and checking...</p>}
          {step.at === "ready" && (canPickFolder() ? (
            <>
              <p role="status">Downloaded and checked.</p>
              <button type="button" className="btn btn-primary" onClick={() => install(step.entries)}>
                {hasFolder ? "Install and restart Distill" : "Choose Distill's folder and install"}
              </button>
              <p className="muted update-note">
                {hasFolder
                  ? "Chrome may ask you to allow writing to Distill's folder."
                  : "Choose the folder you loaded Distill from (the one you picked with \"Load unpacked\"). You do this once; Distill writes the new version there and restarts."}
              </p>
            </>
          ) : <ByHand page={release.page} />)}
          {step.at === "installing" && <p role="status">Installing: {step.done} of {step.of} files...</p>}
          {problem && (
            <>
              <p className="notice" role="alert" data-testid="update-problem">{problem}</p>
              <ByHand page={release.page} />
            </>
          )}
        </section>
      )}
      {step.at === "installed" && release && (
        <p className="notice" role="status" data-testid="update-installed">
          Distill {release.version} is installed. Distill restarts now; open it again from the toolbar.
        </p>
      )}
      <p className="muted update-version">
        Distill {manifest.version}.{" "}
        {!release && <button type="button" className="btn btn-link" onClick={() => { setCheckNote("Checking..."); void check(true); }}>Check for a new version</button>}
        {checkNote && <span role="status"> {checkNote}</span>}
      </p>
    </footer>
  );
}

/** The same update without the folder access: three steps, and the restart is one click here. */
function ByHand({ page }: { page: string }) {
  return (
    <div className="update-byhand">
      <p>To install it by hand:</p>
      <ol>
        <li><a href={page} target="_blank" rel="noreferrer">Download the zip</a> from the release's Assets.</li>
        <li>Unzip it over the folder you loaded Distill from, replacing the files.</li>
        <li><button type="button" className="btn" onClick={() => chrome.runtime.reload()}>Restart Distill</button></li>
      </ol>
    </div>
  );
}
