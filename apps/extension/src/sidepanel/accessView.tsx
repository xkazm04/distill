// The two states the panel shows instead of the views when it may not read the tab. Designed states, not errors:
// they say what is going on and, where the person can change it, offer the one step that does.
import { useState } from "react";
import { requestAllSites, requestSite, siteName } from "./access";

const NOT_GIVEN = "Chrome did not give access, so Distill has not read this page. You can try again at any time.";

export function AccessNeeded({ origin, onGranted }: { origin?: string; onGranted: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  // Each request runs inside the click, so Chrome accepts the click as the person's own gesture.
  const ask = (request: () => Promise<boolean>) => {
    setNote(null);
    request().then((ok) => (ok ? onGranted() : setNote(NOT_GIVEN)), () => setNote(NOT_GIVEN));
  };
  return (
    <section className="access card" data-testid="access-needed" aria-labelledby="access-h">
      <h2 id="access-h">Distill needs your OK to read this page.</h2>
      <p>Distill reads a page only while you use it. The answers you type stay on this device.</p>
      {origin ? (
        <>
          <button type="button" className="btn btn-primary" onClick={() => ask(() => requestSite(origin))}>Read this page</button>
          <p className="muted access-note">This lets Distill read pages on {siteName(origin)} while you use it.</p>
        </>
      ) : (
        <p className="access-note">To let Distill read only this page, click the Distill icon in the browser toolbar while you are on it.</p>
      )}
      <button type="button" className="btn" onClick={() => ask(requestAllSites)}>Allow on all sites</button>
      <p className="muted access-note">
        "Allow on all sites" means Distill can read any page you open while its panel is open, without asking each time.
        You can take this back at any time in Chrome's settings for extensions.
      </p>
      {note && <p className="notice" role="status" data-testid="access-note">{note}</p>}
    </section>
  );
}

export function BrowserPage() {
  return (
    <section className="access card" data-testid="browser-page" aria-labelledby="browser-h">
      <h2 id="browser-h">Browser pages cannot be read.</h2>
      <p>Open a normal web page.</p>
    </section>
  );
}
