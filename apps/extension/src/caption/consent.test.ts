// Cookie banners answered for you (r3-04), the page side: which button is a reject-everything-not-needed button, for
// each common banner system and for plain words; Accept and ambiguous buttons are never pressed; once per page load.
// The real browser run is e2e/caption-consent.spec.ts.
import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { acceptsByWords, ANSWERED, clearConsent, consentWanted, findReject, foldWords, onConsentLater, parseConsentPrefs, pressedVia, rejectsByWords, setConsent } from "./consent";

/** A fresh document per test: a press is remembered per document (once per page load). Every button counts its clicks. */
function page(html: string): { doc: Document; clicks: () => string[] } {
  const doc = document.implementation.createHTMLDocument("t");
  doc.body.innerHTML = html;
  const log: string[] = [];
  for (const b of Array.from(doc.querySelectorAll("button, a, input, [role=button]"))) {
    b.addEventListener("click", (e) => { e.preventDefault(); log.push(b.id || (b.textContent ?? "").trim()); });
  }
  return { doc, clicks: () => log };
}

describe("the words of a button", () => {
  it.each([
    "Reject all", "REJECT ALL", "Reject All Cookies", "Decline", "Deny", "Refuse all", "I do not accept", "Only necessary",
    "Necessary only", "Use necessary cookies only", "Allow only necessary cookies", "Accept only necessary", "Continue without accepting",
    "Odmítnout vše", "Odmítnout", "Zamítnout vše", "Nesouhlasím", "Pouze nezbytné", "Jen nezbytné", "Povolit pouze nezbytné", "Pokračovat bez souhlasu",
    "Odmietnuť všetko", "Alle ablehnen", "Nur notwendige", "Tout refuser", "Continuer sans accepter", "Odrzuć wszystkie",
  ])("%s rejects", (w) => {
    expect(rejectsByWords(foldWords(w))).toBe(true);
    expect(acceptsByWords(foldWords(w))).toBe(false);
  });
  it.each([
    "Accept all", "Accept", "I agree", "Agree and close", "Allow all", "OK", "Got it", "Souhlasím", "Přijmout vše", "Povolit vše",
    "Rozumím", "Akzeptieren", "J'accepte",
  ])("%s accepts and is never a reject", (w) => {
    expect(rejectsByWords(foldWords(w))).toBe(false);
    expect(acceptsByWords(foldWords(w))).toBe(true);
  });
  it.each([
    "Continue", "Close", "Save settings", "Settings", "More options", "Manage preferences", "Nastavení", "Uložit nastavení",
    "Accept selected", "Allow selection", "Reject all or accept later", "Learn more about how we reject spam",
  ])("%s is ambiguous: neither", (w) => {
    expect(rejectsByWords(foldWords(w))).toBe(false);
  });
});

describe("the banner systems: their own reject button, never Accept", () => {
  it("OneTrust", () => {
    const { doc, clicks } = page(`<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk">
      <button id="onetrust-accept-btn-handler">Accept All Cookies</button><button id="onetrust-reject-all-handler">Reject All</button>
      <button id="onetrust-pc-btn-handler">Cookies Settings</button></div></div>`);
    expect(setConsent(doc, true)).toBe("rejected");
    expect(clicks()).toEqual(["onetrust-reject-all-handler"]);
  });
  it("Didomi (Czech)", () => {
    const { doc, clicks } = page(`<div id="didomi-host"><div id="didomi-notice">
      <button id="didomi-notice-agree-button">Souhlasím</button><button id="didomi-notice-disagree-button">Nesouhlasím</button></div></div>`);
    expect(setConsent(doc, true)).toBe("rejected");
    expect(clicks()).toEqual(["didomi-notice-disagree-button"]);
  });
  it("Didomi's 'continue without agreeing' link", () => {
    const { doc, clicks } = page(`<div id="didomi-host"><div id="didomi-popup"><a href="#" class="didomi-continue-without-agreeing" id="cwa">Pokračovat bez souhlasu</a>
      <button id="didomi-notice-agree-button">Přijmout a zavřít</button></div></div>`);
    expect(setConsent(doc, true)).toBe("rejected");
    expect(clicks()).toEqual(["cwa"]);
  });
  it("Cookiebot", () => {
    const { doc, clicks } = page(`<div id="CybotCookiebotDialog"><button id="CybotCookiebotDialogBodyButtonDecline">Odmítnout</button>
      <button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection">Povolit výběr</button>
      <button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll">Povolit vše</button></div>`);
    expect(setConsent(doc, true)).toBe("rejected");
    expect(clicks()).toEqual(["CybotCookiebotDialogBodyButtonDecline"]);
  });
  it("Quantcast / InMobi: the secondary button only when its words say no", () => {
    const yes = page(`<div id="qc-cmp2-container"><div class="qc-cmp2-summary-buttons">
      <button mode="secondary" id="more">MORE OPTIONS</button><button mode="primary" id="agree">AGREE</button></div></div>`);
    expect(setConsent(yes.doc, true)).toBe("hidden");
    expect(yes.clicks()).toEqual([]);
    const no = page(`<div id="qc-cmp2-container"><div class="qc-cmp2-summary-buttons">
      <button mode="secondary" id="disagree">I DO NOT ACCEPT</button><button mode="primary" id="agree">I ACCEPT</button></div></div>`);
    expect(setConsent(no.doc, true)).toBe("rejected");
    expect(no.clicks()).toEqual(["disagree"]);
  });
  it("Usercentrics, inside its open shadow root", () => {
    const { doc } = page(`<div id="usercentrics-root"></div>`);
    const host = doc.getElementById("usercentrics-root") as HTMLElement;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<div><button data-testid="uc-accept-all-button">Accept All</button><button data-testid="uc-deny-all-button">Deny</button></div>`;
    const log: string[] = [];
    for (const b of Array.from(root.querySelectorAll("button"))) b.addEventListener("click", () => log.push(b.getAttribute("data-testid") ?? ""));
    expect(setConsent(doc, true)).toBe("rejected");
    expect(log).toEqual(["uc-deny-all-button"]);
  });
  it("Sourcepoint showing only its Options button (Reject sits in a frame from elsewhere): only hidden", () => {
    const { doc, clicks } = page(`<div id="sp_message_container_123"><button class="sp_choice_type_12" id="opt">Options</button></div>`);
    expect(setConsent(doc, true)).toBe("hidden");
    expect(clicks()).toEqual([]);
  });
  it("an empty consent container (Didomi keeps #didomi-host on the page) is no banner", () => {
    const { doc } = page(`<div id="didomi-host" aria-hidden="true"></div>`);
    expect(setConsent(doc, true)).toBe("none");
  });
  it("Sourcepoint drawn in the page: its REJECT_ALL choice", () => {
    const { doc, clicks } = page(`<div id="sp_message_container_9"><button class="sp_choice_type_11" id="acc">Accept</button><button class="sp_choice_type_13" id="rej">Reject</button></div>`);
    expect(setConsent(doc, true)).toBe("rejected");
    expect(clicks()).toEqual(["rej"]);
  });
  it("TrustArc", () => {
    const { doc, clicks } = page(`<div id="truste-consent-track"><button id="truste-consent-button">Accept all</button><button id="truste-consent-required">Required only</button></div>`);
    expect(setConsent(doc, true)).toBe("rejected");
    expect(clicks()).toEqual(["truste-consent-required"]);
  });
  it("a system's reject id on a button whose words say yes is never pressed", () => {
    const { doc, clicks } = page(`<div id="onetrust-banner-sdk"><button id="onetrust-reject-all-handler">Accept all</button></div>`);
    expect(setConsent(doc, true)).toBe("hidden");
    expect(clicks()).toEqual([]);
  });
});

describe("plain banners, by their words", () => {
  it("a banner Clean hid, with Odmítnout vše beside Přijmout vše", () => {
    const { doc, clicks } = page(`<div class="lista"><p>Používáme cookies.</p><button id="a">Přijmout vše</button><button id="r">Odmítnout vše</button><button id="s">Nastavení</button></div>`);
    const banner = doc.querySelector(".lista") as Element;
    expect(setConsent(doc, true, [banner])).toBe("rejected");
    expect(clicks()).toEqual(["r"]);
    // Marked as answered (the site removes it once told no, so Original cannot show it again); close takes the mark off.
    expect(banner.hasAttribute(ANSWERED)).toBe(true);
    clearConsent();
    expect(banner.hasAttribute(ANSWERED)).toBe(false);
  });
  it("a banner with only Accept and Settings is hidden, nothing pressed", () => {
    const { doc, clicks } = page(`<div class="lista"><button id="a">Accept</button><button id="s">Settings</button><a href="/privacy">Decline</a></div>`);
    expect(setConsent(doc, true, [doc.querySelector(".lista") as Element])).toBe("hidden");
    expect(clicks()).toEqual([]); // "Decline" here is a link to another page
  });
  it("a reject button outside any banner is never pressed", () => {
    const { doc, clicks } = page(`<form><button id="r">Decline</button></form>`);
    expect(findReject(doc, [])).toBeNull();
    expect(setConsent(doc, true, [])).toBe("none");
    expect(clicks()).toEqual([]);
  });
});

describe("Didomi without a reject button on its notice (r4-01, Deník)", () => {
  /** In a live window (a timer runs): the notice offers only Podrobné nastavení and Souhlasím; the first opens the
   *  choices a moment later, with Zamítnout vše and Povolit vše. */
  async function didomi(choices: string): Promise<{ doc: Document; clicks: string[]; close: () => Promise<void> }> {
    const w = new Window({ url: "https://www.denik.example/clanek/" });
    const doc = w.document as unknown as Document;
    doc.body.innerHTML = `<p>Článek.</p><div id="didomi-host"><div id="didomi-popup"><div id="didomi-notice">
      <button id="didomi-notice-learn-more-button">Podrobné nastavení</button><button id="didomi-notice-agree-button">Souhlasím</button></div></div></div>`;
    const clicks: string[] = [];
    doc.addEventListener("click", (e) => { const b = e.target as Element; clicks.push(b.id); }, true);
    doc.getElementById("didomi-notice-learn-more-button")?.addEventListener("click", () => {
      w.setTimeout(() => {
        const host = doc.getElementById("didomi-host") as Element;
        host.innerHTML = `<div class="didomi-consent-popup-preferences">${choices}</div>`;
      }, 250);
    });
    return { doc, clicks, close: () => w.happyDOM.close() };
  }

  it("opens its own choices, then presses Zamítnout vše there; the strip hears it", async () => {
    const { doc, clicks, close } = await didomi(`<button id="btn-toggle-disagree" aria-label="Zamítnout vše: Nesouhlasit s naším zpracováním údajů a zavřít">Zamítnout vše</button>
      <button id="btn-toggle-agree">Povolit vše</button>`);
    try {
      const heard: string[] = [];
      onConsentLater((o) => heard.push(o));
      expect(setConsent(doc, true, [doc.getElementById("didomi-host") as Element])).toBe("hidden");
      expect(clicks).toEqual(["didomi-notice-learn-more-button"]);
      // Asked again while the choices open (Stay clean): nothing more is pressed.
      expect(setConsent(doc, true)).toBe("hidden");
      await new Promise((r) => setTimeout(r, 700));
      expect(clicks).toEqual(["didomi-notice-learn-more-button", "btn-toggle-disagree"]);
      expect(heard).toEqual(["rejected"]);
      expect(setConsent(doc, true)).toBe("rejected");
      expect(pressedVia(doc)).toBe("Didomi (choices)");
    } finally {
      onConsentLater(null);
      await close();
    }
  });

  it("choices without a reject button: nothing else is pressed, the notice stays hidden", async () => {
    const { doc, clicks, close } = await didomi(`<button id="btn-toggle-agree">Povolit vše</button><button id="btn-toggle-disagree">Souhlasím se vším</button>`);
    try {
      expect(setConsent(doc, true, [doc.getElementById("didomi-host") as Element])).toBe("hidden");
      await new Promise((r) => setTimeout(r, 700));
      expect(clicks).toEqual(["didomi-notice-learn-more-button"]);
    } finally {
      await close();
    }
  }, 10_000);

  it("never opens the choices from a button whose words say yes", async () => {
    const { doc, clicks, close } = await didomi("");
    try {
      const b = doc.getElementById("didomi-notice-learn-more-button") as Element;
      b.textContent = "Souhlasím a zavřít";
      expect(setConsent(doc, true, [doc.getElementById("didomi-host") as Element])).toBe("hidden");
      expect(clicks).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("the switch and once per page", () => {
  it("off: nothing pressed", () => {
    const { doc, clicks } = page(`<div id="onetrust-banner-sdk"><button id="onetrust-reject-all-handler">Reject All</button></div>`);
    expect(setConsent(doc, false)).toBe("off");
    expect(clicks()).toEqual([]);
  });
  it("pressed once per page load, whatever is asked after", () => {
    const { doc, clicks } = page(`<div id="onetrust-banner-sdk"><button id="onetrust-reject-all-handler">Reject All</button></div>`);
    expect(setConsent(doc, true)).toBe("rejected");
    expect(setConsent(doc, true)).toBe("rejected");
    expect(setConsent(doc, false)).toBe("rejected");
    expect(clicks()).toEqual(["onetrust-reject-all-handler"]);
  });
  it("kept choices: the site's own, else every site's, else on", () => {
    const p = parseConsentPrefs({ on: false, sites: { "https://a.cz": true, bad: "x" } });
    expect(p).toEqual({ on: false, sites: { "https://a.cz": true } });
    expect(consentWanted(p, "https://a.cz")).toBe(true);
    expect(consentWanted(p, "https://b.cz")).toBe(false);
    expect(consentWanted(parseConsentPrefs(null), "https://b.cz")).toBe(true);
    expect(consentWanted(parseConsentPrefs({ sites: { "https://b.cz": false } }), "https://b.cz")).toBe(false);
  });
});
