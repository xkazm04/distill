// Round 3 (r3-01): the small boxes a news site puts in and around its text that are not the text. A photo's credit
// ("Foto: ČTK", "Deník/Jan Novák"), a "read also" box ("Čtěte také", "Mohlo by vás zajímat"), a "follow us on Google
// News" promo and an ad slot's bare label ("REKLAMA"). The page reader (page.ts) leaves them out of the page's blocks,
// so they are never the main text that claims, the gist, plain words or a translation read; Clean (clutter.ts) takes
// them away and lists them in More. Pure DOM reading, like page.ts.
import { collapse, tag } from "./dom.js";

/** An ad slot's label, the whole text of its box. Word edges by letters: \b is ASCII-only. */
export const AD_LABEL = /^(reklama|advertisement|advertising|sponsored|sponzorov[aá]no|inzerce|ad|anzeige|werbung)$/iu;

/** "Foto: ČTK", "Ilustrační foto | Foto: ČTK / Švancara Petr", "Zdroj: Shutterstock", "Photo: Reuters". */
const CREDIT_START = /^(ilustra[čc]n[ií] (foto|sn[ií]mek|fotografie)|foto|fotografie|fotka|photo|photograph|picture|image|bild|zdroj( fotografie| foto)?|source|credit|autor (foto|fotografie|sn[ií]mku))(?!\p{L})\s*(:|\||$)/iu;
const CREDIT_ANYWHERE = /(^|[|·•]\s*)(foto|photo|zdroj|source|bild)\s*:\s*\S/iu;
/** "Deník/Jakub Dostál", "ČTK/Michal Kamaryt", "Profimedia.cz / John Doe": an agency and a name, alone in a figure. */
const AGENCY_NAME = /^[\p{Lu}\p{N}][\p{L}\p{N}.&-]*( [\p{L}\p{N}.&-]+){0,2} ?\/ ?\p{Lu}[\p{L}.'-]+( \p{Lu}[\p{L}.'-]+){0,3}$/u;

/**
 * True when `text` is a photo's credit, not a sentence of the article: a "Foto:" or "Zdroj:" line, or (inside a figure,
 * `inFigure`) an agency and a photographer's name ("Deník/Jakub Dostál"). Long text is never a credit.
 */
export function isCredit(text: string, inFigure = false): boolean {
  const t = collapse(text);
  if (!t || t.length > 140) return false;
  if (CREDIT_START.test(t) || CREDIT_ANYWHERE.test(t)) return true;
  return inFigure && t.length <= 70 && AGENCY_NAME.test(t);
}

/** "Read also" and "you may also like" boxes, by their first words. */
const READ_ALSO = /^(čtěte (také|též|dále|i)|přečtěte si (také|též|dále|i)|mohlo by vás (také |též |ještě )?zajímat|mohlo by v[áa]s|související( články| zprávy| témata| obsah)?|další články|doporučené články|read (also|next|more on)|related (articles|stories|content|reading)|you (may|might) also like|more stories|lesen sie auch|mehr zum thema|das könnte sie auch interessieren)(?!\p{L})/iu;
/** "Follow us on Google News", "Chcete upřednostnit v Google naše články?", "Add us as a preferred source on Google". */
const GOOGLE_PROMO = /(?<!\p{L})(google news|google zpr[aá]v|zpr[aá]v(y|[aá]ch) (od )?google|v google na[šs]e [čc]l[aá]nky|upřednostn[ií]t v google|preferovan[ýy] zdroj|preferred source|(follow|sledujte|najdete) (us |n[aá]s )?(on |na |v )google)(?!\p{L})/iu;

/** The start of the element's visible text: text nodes outside scripts and styles, at least `min` characters of it when
 *  it has that many. Stops there: a box around a whole page is not read whole to judge its first words. */
export function startText(el: Element, min: number): string {
  let out = "";
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n && out.length < min; n = walker.nextNode()) {
    if (n.parentElement?.closest("script, style, noscript, template")) continue;
    out += ` ${n.nodeValue ?? ""}`;
  }
  return collapse(out);
}

/** How much of the element's text sits in links (0-1). */
function linkShare(el: Element): number {
  const all = collapse(el.textContent ?? "").length;
  if (!all) return 0;
  const linked = Array.from(el.querySelectorAll("a")).reduce((n, a) => n + collapse(a.textContent ?? "").length, 0);
  return Math.min(linked / all, 1);
}

/** Boxes that can be one of these: never a heading, a table's part or a form's control. */
const BOXES = new Set(["div", "section", "aside", "p", "ul", "ol", "li", "figure", "ins", "article", "dl", "blockquote"]);

export type BoilerKind = "related" | "promo" | "ad";

/**
 * What a small box in or around the text is when it is not the text: a "read also" box ("related": its first words say
 * so and it is mostly links), a "follow us on Google" promo ("promo": short, says so, and has a link or a button), or
 * an ad slot's bare label ("ad": its whole text is REKLAMA or the like). Null for anything else, and for a box with a
 * lot of text (an article is never one of these, whatever its first words).
 */
export function boilerKind(el: Element): BoilerKind | null {
  if (!BOXES.has(tag(el))) return null;
  const start = startText(el, 160);
  if (!start) return null;
  if (start.length < 40 && AD_LABEL.test(start)) return "ad";
  if (READ_ALSO.test(start)) {
    const len = collapse(el.textContent ?? "").length;
    if (len <= 1500 && el.querySelector("a[href]") && linkShare(el) >= 0.4) return "related";
  }
  if (GOOGLE_PROMO.test(start) && start.length < 300 && collapse(el.textContent ?? "").length < 400
    && (el.querySelector("a[href], button") || tag(el) === "a")) return "promo";
  return null;
}

/** True when the element is inside a figure but not its caption: a photo credit or a gallery's counter sits there. */
export const inFigure = (el: Element): boolean => !!el.closest("figure") && !el.closest("figcaption");

/** For hosts that read rendered text: the words CSS draws in a box (its ::before and ::after content), as given. */
export function cssLabel(content: string): string {
  const c = content.trim();
  if (!c || c === "none" || c === "normal") return "";
  return collapse(c.replace(/^["']|["']$/g, "").replace(/\\["']/g, ""));
}
