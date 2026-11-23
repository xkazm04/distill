// Round 3, r3-02: Google's Search Suggestions under a claim checked on the web. Google's grounding terms ask an app
// that shows a search-grounded answer to show `searchEntryPoint.renderedContent` with it, unchanged. That markup is
// HTML from an AI service's answer, so it never enters the strip's own document: it is shown in a sealed-off frame.
//
// The seal (each lock alone is enough; together they are belt and braces):
// - `sandbox="allow-popups allow-popups-to-escape-sandbox"`: no allow-scripts (no script, no event handler, no
//   javascript: link runs), no allow-same-origin (an opaque origin: it cannot read the strip, the page or chrome.*),
//   no allow-top-navigation (it cannot move the tab away), no allow-forms.
// - The snippet arrives as `srcdoc`, behind a Content-Security-Policy of its own that allows inline CSS and https
//   images only (default-src 'none': no script, no frame, no fetch).
// - `<base target="_blank">`: Google's search links open in a NEW tab; allow-popups-to-escape-sandbox lets that tab be
//   an ordinary Google page.
// The door before it (entryPointOf in @distill/web/ai) only lets a non-empty string up to ENTRY_POINT_MAX through;
// with no suggestions there is no frame at all.

/** The iframe's sandbox: exactly these two tokens (the e2e and unit tests read it). */
export const SUGGESTIONS_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";
/** The snippet document's own policy: inline CSS, https/data images and fonts; nothing that runs or loads a page. */
export const SUGGESTIONS_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; form-action 'none'";

/** The frame's document: Google's markup as it came, inside a head that seals it and sends links to a new tab. */
export function suggestionsDoc(html: string): string {
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    `<meta http-equiv="Content-Security-Policy" content="${SUGGESTIONS_CSP}">` +
    "<meta name=\"color-scheme\" content=\"light dark\"><meta name=\"referrer\" content=\"no-referrer\">" +
    "<base target=\"_blank\"><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>" +
    html +
    "</body></html>"
  );
}

/** "Search on Google": the suggestions in their sealed frame, or nothing when the answer had none. */
export function SearchSuggestions(props: { html: string | undefined }) {
  if (!props.html) return null;
  return (
    <div className="ck-sugg" data-testid="cap-check-suggestions">
      <span className="ck-sugg-h">Search on Google</span>
      <iframe
        title="Google Search suggestions for this claim"
        sandbox={SUGGESTIONS_SANDBOX}
        srcDoc={suggestionsDoc(props.html)}
        referrerPolicy="no-referrer"
        loading="lazy"
        data-testid="cap-check-suggestions-frame"
      />
    </div>
  );
}
