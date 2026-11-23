// #5 Call, write or find them: the contact card in More. The page side reads the whole page (the parts Clean hid
// too) with the engine's findContacts; this lists what it found, each with the one action that fits: Call (tel:),
// Write (mailto:), Open (the contact page), plus Copy and Show on page. Page text only, read inside the browser.
import { useEffect, useState } from "react";
import type { CleanReport, ContactItem } from "../../messages";
import { ActionRow, CopyButton, Note, ReachLink, Rows, Section, Sub, useCopy, type IconKind } from "./kit";
import { send, tabId } from "./send";

/** Kept here for the sections that import it from Contact (round 3); the kit owns it now. */
export { copy } from "./kit";

const LABEL: Record<ContactItem["kind"], string> = {
  phone: "Phone",
  email: "E-mail",
  address: "Address",
  hours: "Hours",
  contactPage: "Contact page",
};
const ICON: Record<ContactItem["kind"], IconKind> = { phone: "phone", email: "email", address: "address", hours: "hours", contactPage: "contactPage" };

export function ContactSection(props: { report: CleanReport }) {
  const { report } = props;
  const [items, setItems] = useState<ContactItem[] | null>(null);
  const copier = useCopy();
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

  return (
    <Section id="cap-contact-h" title="Contact" count={items.length} testid="cap-contact" className="contact">
      <Rows>
        {items.map((it) => (
          <ActionRow key={it.id} testid="cap-contact-item" attrs={{ "data-kind": it.kind }} icon={ICON[it.kind]} kind={LABEL[it.kind]}
            text={it.text} textClass="contact-text"
            sub={it.hidden ? <Sub>In a part Distill hid. Original shows it.</Sub> : undefined}
            acts={<>
              <ReachLink href={it.kind === "phone" || it.kind === "email" ? it.href : undefined} />
              {it.kind === "contactPage" && it.href && (
                <button type="button" className="btn sm" onClick={() => { void chrome.tabs.update(tabId, { url: it.href as string }); }}>Open</button>
              )}
              <CopyButton copied={copier.copied(it.id)} onClick={() => void copier.copy(it.id, it.kind === "contactPage" && it.href ? it.href : it.text)}
                label={`Copy ${LABEL[it.kind].toLowerCase()}`} />
              {!it.hidden && <button type="button" className="btn sm quiet" onClick={() => void show(it.id)}>Show on page</button>}
            </>} />
        ))}
      </Rows>
      {(problem ?? copier.problem) && <Note role="status">{problem ?? copier.problem}</Note>}
    </Section>
  );
}
