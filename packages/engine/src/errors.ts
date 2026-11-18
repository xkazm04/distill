// Validation errors a page shows. A message can repeat what the person typed ("'jan@' není platný e-mail"), so the
// text of an error is in the values class (CLAUDE.md law): page and form extraction leave error elements out, so their
// text never reaches a PageModel, a FormStructure, a cloud-eligible prompt or the person's agent.
import { attr, byId, collapse, tag } from "./dom.js";
import { FIELDISH } from "./aria.js";

/** Words in a class, id or tag that name an error message: "error", "govuk-error-message", "invalid-feedback",
 *  "mat-error", "chyba" (Czech). camelCase is split first, so "errorText" counts. */
const ERROR_WORD = /(^|[\s_-])(error|errors|err|invalid|chyba|chyby)([\s_-]|$)/i;
const HINT_WORD = /(^|[\s_-])(hint|help|helper|description|form-text|note)([\s_-]|$)/i;
/** Longer than this, an element is a section of the page (a docs page's "Errors" chapter), not a message. */
const MESSAGE_MAX = 1000;

const words = (el: Element): string => `${attr(el, "class")} ${attr(el, "id")} ${tag(el)}`.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2");

/** aria-invalid is set and is not "false" ("true", "grammar" and "spelling" all mean invalid). */
export function isInvalid(el: Element): boolean {
  const v = attr(el, "aria-invalid").trim().toLowerCase();
  return v !== "" && v !== "false";
}

/** Help text by its own markup: a <small>, or a hint word in its class or id. */
export const hintLike = (el: Element): boolean => tag(el) === "small" || HINT_WORD.test(`${attr(el, "class")} ${attr(el, "id")}`);

/**
 * An element that looks like an error message by its own markup: role=alert, or an error word in its class, id or tag.
 * It holds no field (a wrapper marked "has-error" holds the field and its label, and is not the message) and is
 * message-sized.
 */
export function looksLikeError(el: Element): boolean {
  if (attr(el, "role").trim().toLowerCase() !== "alert" && !ERROR_WORD.test(words(el))) return false;
  if (el.matches(FIELDISH) || el.querySelector(FIELDISH)) return false;
  return collapse(el.textContent ?? "").length <= MESSAGE_MAX;
}

/** The elements an ARIA attribute of `el` names, in its own tree. */
export function named(el: Element, name: string): Element[] {
  return attr(el, name).split(/\s+/).filter(Boolean).map((id) => byId(el, id)).filter((e): e is Element => !!e);
}

/**
 * The error messages a field links to: its aria-errormessage targets, and while it is aria-invalid, what its
 * aria-describedby names - the targets that look like errors, else every one that is not help text.
 */
export function linkedErrors(el: Element): Element[] {
  const out = named(el, "aria-errormessage");
  if (isInvalid(el)) {
    const described = named(el, "aria-describedby");
    const marked = described.filter(looksLikeError);
    out.push(...(marked.length ? marked : described.filter((d) => !hintLike(d))));
  }
  return out;
}

/**
 * "Is this element an error message?" for one reading of a page (built fresh per reading: the page changes between
 * them). An element linked from a field as its error always is. With `looks`, so is an element that looks like one
 * (see looksLikeError); page extraction passes it when the page holds a form, so a docs page keeps its text.
 */
export function errorElements(looks = true): (el: Element) => boolean {
  const linked = new WeakMap<Node, Set<Element>>();
  const linkedIn = (root: Node & ParentNode): Set<Element> => {
    let set = linked.get(root);
    if (!set) {
      set = new Set();
      for (const el of Array.from(root.querySelectorAll?.("[aria-errormessage], [aria-invalid][aria-describedby]") ?? [])) {
        for (const t of linkedErrors(el)) set.add(t);
      }
      linked.set(root, set);
    }
    return set;
  };
  return (el) => (looks && looksLikeError(el)) || linkedIn(el.getRootNode() as Node & ParentNode).has(el);
}
