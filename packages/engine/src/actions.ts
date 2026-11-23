// Round 3, card 9 (r3-09): what this page asks of you. Deadlines, sums to pay (with the account number), what to bring,
// how to reach someone and opening hours, found in the main text by patterns (no AI). Pure: text in, items out. The
// items are the page's own words with a few English words around them ("Pay", "By", "Bring"); nothing is made up.
import { contactsInText, type TextContact } from "./contact.js";
import { CZ_MONTHS, EN_MONTHS } from "./byline.js";

export const ACTION_KINDS = ["deadline", "payment", "bring", "contact", "hours"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface FoundAction {
  /** `a0`, `a1`, ... in reading order. */
  id: string;
  kind: ActionKind;
  /** As shown in More: "Pay 500 Kč to 123456789/0100 by 15 March". Page words, never anything the person typed. */
  text: string;
  /** The main-text block it was found in, and the exact words there (what Show me highlights). */
  blockId: string;
  quote: string;
  /** tel:, mailto: for a contact. */
  href?: string;
  /** What Copy copies: the account number (else the sum), the date, the number or address, the hours; page words.
   *  Absent: Copy copies `quote`. */
  value?: string;
}

/** At most this many items on a page: a page with more is a list of prices or a timetable, not a letter. */
export const MAX_ACTIONS = 20;
/** A sentence longer than this is cut to the words around what was found (still the page's exact words). */
const QUOTE_MAX = 240;

const MONTHS = String.raw`(?:${[...CZ_MONTHS, ...EN_MONTHS].join("|")}|brezna|kvetna|cervna|cervence|zari|rijna|unora|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?`;
/** A day with its month (the year optional): "31. 3.", "31.3.2025", "15. března", "15. března 2024", "March 15", "15 March 2025". */
const DATE = String.raw`(?:\d{1,2}\.\s?\d{1,2}\.(?:\s?\d{4})?(?!\d)|\d{1,2}\.?\s+${MONTHS}(?:\s+\d{4})?|${MONTHS}\s+\d{1,2}(?!\d)(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2})`;
/** A span of time: "do 15 dnů", "within 30 days", "do konce března". */
const SPAN = String.raw`(?:\d{1,3}\s+(?:dn[ůuí]|dní|pracovních dn[ůu]|days|business days|working days|týdn[ůu]|tydnu|weeks|měsíc[ůu]|mesicu|months)|konce\s+${MONTHS}|the end of\s+${MONTHS})`;

/** Words that make a date a deadline by themselves. */
const STRONG = String.raw`nejpozději(?:\s+(?:do|dne|však))?|nejpozdeji(?:\s+do)?|lhůt[aěy](?:\s+(?:je|do|končí))?|uzávěrk[ay](?:\s+je)?|termín(?:u)?(?:\s+(?:je|do|pro|podání))?|splatn[éáýost]*(?:\s+(?:je|do|dne|k))?|deadline(?:\s+is)?|no later than|due(?:\s+(?:by|on|date))?|closing date(?:\s+is)?`;
/** Words that make a date a deadline when the sentence asks for something. */
const WEAK = String.raw`do|by|before|until`;
const DEADLINE_RE = new RegExp(String.raw`(?<![\p{L}])(?:(${STRONG})(?:\s+[\p{L}.]+){0,3}?\s*:?\s*(?:(?:dne|do)\s+)?|(${WEAK})\s+)(${DATE}|${SPAN})`, "giu");
/** The sentence asks the reader to do something. */
const ASKS = /(?:musí|musíte|musite|je nutn|je třeba|je treba|nutno|potřeba|povinn|podat|podejte|podání|podávat|zaplať|zaplat|uhraď|uhrad|odevzd|přihl|prihl|registr|dolož|dolozte|předlož|predlozte|zašlete|zaslat|pošlete|poslat|doruč|vyzvedn|žádost|zadost|přihlášk|prihlask|lze|můžete|muzete|nahlas|objednejte|rezervujte|vraťte|vratte|odevzdejte|must|need to|have to|submit|apply|pay|register|send|return|book|required|please)/iu;

const AMOUNT = String.raw`(?:(?:€|EUR|CZK|Kč)\s?\d{1,3}(?:[  .]\d{3})*(?:,\d{1,2})?|\d{1,3}(?:[  .]\d{3})+(?:,(?:\d{1,2}|-|–))?\s?(?:Kč|CZK|korun\p{L}*|EUR|€|eur)|\d+(?:,(?:\d{1,2}|-|–))?\s?(?:Kč|CZK|korun\p{L}*|EUR|€|eur))`;
const AMOUNT_RE = new RegExp(String.raw`(?<![\d\p{L}])${AMOUNT}(?![\p{L}])`, "gu");
/** Czech bank codes (ČNB), so that a reference "123456/2024" is not read as an account. */
const BANKS = "0100|0300|0600|0710|0800|2010|2060|2070|2100|2200|2220|2250|2260|2275|2600|2700|3030|3050|3060|3500|4000|4300|5500|5800|6000|6100|6200|6210|6300|6363|6700|6800|7910|7950|7960|7970|7990|8030|8040|8060|8090|8150|8190|8198|8220|8250|8255|8265|8500";
const ACCOUNT_RE = new RegExp(String.raw`(?<![\d/-])(?:\d{1,6}-)?\d{2,10}\s?\/\s?(?:${BANKS})(?!\d)|(?<![\p{L}\d])CZ\d{2}(?:\s?\d{4}){5}(?!\d)`, "gu");
const VS_RE = /(?:variabilní symbol|variabilni symbol|var\.\s*symbol|v\.\s?s\.|VS)\s*:?\s*(\d{1,10})(?!\d)/iu;
const PAY = /(?:zaplať|zaplat|uhraď|uhrad|úhrad|platb|plaťte|platí se|poplat|splatn|záloh|doplat|převodem|prevodem|složenk|slozenk|na účet|na ucet|na č\.\s?ú|číslo účtu|cislo uctu|\bpay\b|payment|\bfee\b|transfer|\bdue\b|remit)/iu;

/** "S sebou", "doložte", "předložte" and their English kin; the lead word shown in More. */
const BRING: [RegExp, string][] = [
  [/(?<![\p{L}])(?:s sebou|se sebou|přineste|prineste|vezměte si|vezmete si|nezapomeňte si vzít)(?![\p{L}])/iu, "Bring"],
  [/(?<![\p{L}])(?:doložte|dolozte|doložit|dolozit|přiložte|prilozte|přiložit|prilozit|je nutné doložit|k žádosti přiložte|dokládá se)(?![\p{L}])/iu, "Provide"],
  [/(?<![\p{L}])(?:předložte|predlozte|předložit|predlozit|prokažte|prokazte|prokázat|prokazat|předkládá se)(?![\p{L}])/iu, "Show"],
  [/(?<![\p{L}])(?:please bring|bring (?:with you|along|your)|you will need to bring|you(?:'ll| will) need)(?![\p{L}])/iu, "Bring"],
  [/(?<![\p{L}])(?:please provide|you must provide|you need to provide|enclose|attach)(?![\p{L}])/iu, "Provide"],
];

/** Abbreviations a sentence does not end at ("Mgr. Novák", "nám. Míru", "tel. 377"). */
const NO_END = /(?:^|[\s(])(?:mgr|ing|bc|mudr|judr|phdr|rndr|doc|prof|nám|ul|tel|mob|č|čp|ú|p|tzn|tj|např|resp|cca|hod|min|odd|str|sv|st|ev|reg|e\.g|i\.e|mr|mrs|dr|no|vs|ks|ss)\.$/iu;

/** The sentences of `text`, each with where it starts. A date's dots ("31. 3. 2025") never end one. */
export function sentencesOf(text: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  let start = 0;
  const re = /[.!?…](?=\s+["„“(]?\p{Lu})|[.!?…]$/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + 1;
    const piece = text.slice(start, end);
    // "31. 3. Poté": the dot after a day or month number ends nothing unless a capital word follows a full date.
    const next = text.slice(end).trimStart();
    if (NO_END.test(piece)) continue;
    if (/(?:^|\s)\d{1,2}\.$/.test(piece) && /^\d/.test(next)) continue;
    if (/\d{1,2}\.\s?\d{1,2}\.$/.test(piece) && /^\d{4}/.test(next)) continue;
    push(out, text, start, end);
    start = end;
  }
  push(out, text, start, text.length);
  return out;
}

function push(out: { at: number; text: string }[], text: string, from: number, to: number): void {
  const raw = text.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  const t = raw.trim();
  if (t) out.push({ at: from + lead, text: t });
}

/** Words around [at, at+len) of `s`, at most QUOTE_MAX long, cut at spaces: still an exact piece of `s`. */
function around(s: string, at: number, len: number): string {
  if (s.length <= QUOTE_MAX) return s;
  let from = Math.max(0, at - 80);
  let to = Math.min(s.length, Math.max(at + len, from + QUOTE_MAX - 80) + 40);
  if (to - from > QUOTE_MAX) to = from + QUOTE_MAX;
  if (from > 0) { const sp = s.indexOf(" ", from); if (sp >= 0 && sp < at) from = sp + 1; }
  if (to < s.length) { const sp = s.lastIndexOf(" ", to); if (sp > at + len) to = sp; }
  return s.slice(from, to).trim();
}

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n) > n / 2 ? s.lastIndexOf(" ", n) : n).replace(/[\s,;:–-]+$/, "")}...`);
const tidy = (s: string): string => s.replace(/\s+/g, " ").replace(/^[\s,;:–-]+|[\s,;:.–-]+$/g, "").trim();

interface Hit { kind: ActionKind; at: number; quote: string; text: string; href?: string; value?: string; key: string }

/** Items in reading order, at most one per quote. `lang` is the page's language ("cs", "en", ...). */
export function findActions(blocks: readonly { id: string; text: string }[], lang: string): FoundAction[] {
  // A 9-digit number dials with +420 on a Czech page (or one whose language is not known).
  const czech = /^(?:cs|und)?$/i.test(lang.split("-")[0] ?? "");
  const out: (Hit & { blockId: string })[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const hits: Hit[] = [];
    for (const s of sentencesOf(b.text)) {
      const h = sentenceHit(s.text);
      if (h) hits.push({ ...h, at: s.at + s.text.indexOf(h.quote), key: h.kind === "deadline" ? `deadline:${h.text}` : `${h.kind}:${h.quote.toLowerCase()}` });
    }
    // Hours written one day-range after another ("Po - Pá: 7.00 - 16.30 So: 8.00 - 11.00") are one item.
    const contacts: TextContact[] = [];
    for (const c of contactsInText(b.text, czech)) {
      const prev = contacts[contacts.length - 1];
      if (prev?.kind === "hours" && c.kind === "hours" && /^[\s,;/|]*$/.test(b.text.slice(prev.at + prev.quote.length, c.at))) {
        prev.quote = b.text.slice(prev.at, c.at + c.quote.length);
        prev.text = `${prev.text}; ${c.text}`;
      } else contacts.push({ ...c });
    }
    for (const c of contacts) {
      const hit: Hit = c.kind === "hours"
        ? { kind: "hours", at: c.at, quote: c.quote, text: `Hours: ${c.text}`, value: c.text, key: `hours:${c.text.toLowerCase().replace(/\s+/g, "")}` }
        : { kind: "contact", at: c.at, quote: c.quote, text: c.kind === "phone" ? `Call ${c.text}` : `Write to ${c.text}`, value: c.text, key: `contact:${c.href ?? c.text}` };
      if (c.href) hit.href = c.href;
      hits.push(hit);
    }
    for (const h of hits.sort((x, y) => x.at - y.at)) {
      if (seen.has(h.key) || seen.has(`quote:${h.quote}`)) continue;
      seen.add(h.key);
      seen.add(`quote:${h.quote}`);
      out.push({ ...h, blockId: b.id });
    }
  }
  return out.slice(0, MAX_ACTIONS).map((h, i) => {
    const item: FoundAction = { id: `a${i}`, kind: h.kind, text: h.text, blockId: h.blockId, quote: h.quote };
    if (h.href) item.href = h.href;
    if (h.value) item.value = h.value;
    return item;
  });
}

/** The one thing a sentence asks, if any: a payment first, then a deadline, then what to bring. */
function sentenceHit(s: string): Omit<Hit, "at" | "key"> | null {
  const deadline = deadlineIn(s);
  const amounts = [...s.matchAll(AMOUNT_RE)];
  const accounts = [...s.matchAll(ACCOUNT_RE)];
  const pays = PAY.test(s);
  if ((amounts.length && (pays || accounts.length)) || (accounts.length && pays)) {
    const amount = amounts[0]?.[0] ? tidy(amounts[0][0]) : undefined;
    const account = accounts[0]?.[0]?.replace(/\s*\/\s*/, "/");
    const vs = VS_RE.exec(s)?.[1];
    const first = Math.min(...[...amounts, ...accounts].map((m) => m.index ?? 0));
    let text = amount ? `Pay ${amount}` : "Pay";
    if (account) text += ` to ${account}`;
    if (vs) text += `, variable symbol ${vs}`;
    if (deadline) text += ` ${deadline.words}`;
    const hit: Omit<Hit, "at" | "key"> = { kind: "payment", quote: around(s, first, 1), text };
    const value = account ?? amount;
    if (value) hit.value = value;
    return hit;
  }
  if (deadline) return { kind: "deadline", quote: around(s, deadline.at, deadline.len), text: `${deadline.words[0]?.toUpperCase()}${deadline.words.slice(1)}`, value: deadline.date };
  for (const [re, lead] of BRING) {
    const m = re.exec(s);
    if (!m) continue;
    const after = tidy(s.slice((m.index ?? 0) + m[0].length));
    const before = tidy(s.slice(0, m.index ?? 0));
    const what = after.length >= 3 ? after : before;
    if (what.length < 3) continue;
    return { kind: "bring", quote: around(s, m.index ?? 0, m[0].length), text: `${lead}: ${clip(what.replace(/^(?:(?:si|také|prosím|please|vezměte|vezmete|přineste|prineste)\s+)+/iu, ""), 90)}` };
  }
  return null;
}

/** The deadline a sentence states: "by 31. 3." words for More, the date as written, where it is. */
function deadlineIn(s: string): { words: string; date: string; at: number; len: number } | null {
  DEADLINE_RE.lastIndex = 0;
  for (const m of s.matchAll(DEADLINE_RE)) {
    const strong = !!m[1];
    if (!strong && !ASKS.test(s)) continue;
    // "do 2. května." : the last dot ends the sentence, not the date (a numeric "31. 3." keeps its dot).
    const date = (m[3] ?? "").replace(/\s+/g, " ").trim().replace(/(\p{L})\.$/u, "$1");
    if (!date) continue;
    const span = new RegExp(`^${SPAN}$`, "iu").test(date);
    const words = span ? (/^\d/.test(date) ? `within ${date}` : `by ${date.replace(/^konce\s+/iu, "the end of ")}`) : `by ${date}`;
    return { words, date, at: m.index ?? 0, len: m[0].length };
  }
  return null;
}
