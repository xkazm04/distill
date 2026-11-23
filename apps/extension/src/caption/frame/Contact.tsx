// #5 Call, write or find them: the contact card in More. The page side reads the whole page (the parts Clean hid
// too) with the engine's findContacts; this lists what it found, each with the one action that fits: Call (tel:),
// Write (mailto:), Open (the contact page), plus Copy and Show on page. Page text only, read inside the browser.
import { useEffect, useState } from "react";
import type { CleanReport, ContactItem } from "../../messages";
import { send, tabId } from "./send";

const LABEL: Record<ContactItem["kind"], string> = {
  phone: "Phone",
  email: "E-mail",
  address: "Address",
  hours: "Hours",
  contactPage: "Contact page",
};

/** Whether the page lets this frame use the Clipboard API (a frame in another site's page usually may not: asking
 *  anyway prints a policy error in the page's console). */
function clipboardAllowed(): boolean {
  const policy = (document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy;
  try { return !!navigator.clipboard && (!policy || policy.allowsFeature("clipboard-write")); } catch { return false; }
}

/** Copies `text`: the Clipboard API where the page lets the frame use it, else the older copy command. */
export async function copy(text: string): Promise<boolean> {
  try {
    if (!clipboardAllowed()) throw new Error("not allowed here");
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "vh";
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export function ContactSection(props: { report: CleanReport }) {
  const { report } = props;
  const [items, setItems] = useState<ContactItem[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Asked once each time More opens (this section mounts with More); `report` changes as parts come back, and with
  // them whether an item sits in a hidden part.
  useEffect(() => {
    let live = true;
    void send<"distill:caption:contact">({ type: "distill:caption:contact" }).then(
      (list) => { if (live) setItems(list); },
      () => { if (live) setItems([]); },
    );
    return () => { live = false; };
  }, [report.restored.length]);

  if (!items?.length) return null;

  const show = async (id: string) => {
    setProblem(null);
    try { await send({ type: "distill:caption:showContact", id }); } catch (e) { setProblem(e instanceof Error ? e.message : String(e)); }
  };
  const doCopy = async (it: ContactItem) => {
    const ok = await copy(it.kind === "contactPage" && it.href ? it.href : it.text);
    setCopied(ok ? it.id : null);
    if (!ok) setProblem("Copying is not allowed here. Select the text and copy it yourself.");
    else setTimeout(() => setCopied((c) => (c === it.id ? null : c)), 1600);
  };

  return (
    <section className="contact" aria-labelledby="cap-contact-h" data-testid="cap-contact">
      <h2 id="cap-contact-h">Contact</h2>
      <ul>
        {items.map((it) => (
          <li key={it.id} data-testid="cap-contact-item" data-kind={it.kind}>
            <span className="contact-kind">{LABEL[it.kind]}</span>
            <span className="contact-what">
              <span className="contact-text">{it.text}</span>
              {it.hidden && <span className="contact-note">In a part Distill hid. Original shows it.</span>}
            </span>
            <span className="contact-acts">
              <span className="contact-main">
                {it.kind === "phone" && it.href && <a className="btn sm" href={it.href} target="_top" rel="noopener">Call</a>}
                {it.kind === "email" && it.href && <a className="btn sm" href={it.href} target="_top" rel="noopener">Write</a>}
                {it.kind === "contactPage" && it.href && (
                  <button type="button" className="btn sm" onClick={() => { void chrome.tabs.update(tabId, { url: it.href as string }); }}>Open</button>
                )}
              </span>
              <button type="button" className="btn sm quiet" onClick={() => void doCopy(it)} aria-label={`Copy ${LABEL[it.kind].toLowerCase()}`}>
                {copied === it.id ? "Copied" : "Copy"}
              </button>
              {!it.hidden && <button type="button" className="btn sm quiet" onClick={() => void show(it.id)}>Show on page</button>}
            </span>
          </li>
        ))}
      </ul>
      {problem && <p className="note" role="status">{problem}</p>}
    </section>
  );
}
