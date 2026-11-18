// ARIA widgets that are not native controls: role=radio, checkbox, switch, combobox and listbox, as design systems
// build them from divs, spans, lis and buttons. Shared by form extraction (form.ts) and writing (fill.ts).
import type { FieldOption } from "./types.js";
import { attr, byId, collapse, isHidden, parentOf, tag } from "./dom.js";

const NATIVE = new Set(["input", "select", "textarea"]);
const WIDGET_ROLES = new Set(["radio", "checkbox", "switch", "combobox", "listbox"]);

/** Native controls and ARIA widgets: what counts as "a field" when looking at a label's surroundings. */
export const FIELDISH = "input, select, textarea, [role=radio], [role=checkbox], [role=switch], [role=combobox], [role=listbox]";

const roleOf = (el: Element): string => (attr(el, "role").trim().split(/\s+/)[0] ?? "").toLowerCase();

/** The widget role of a non-native element ("radio", "checkbox", "switch", "combobox", "listbox"), else "". */
export function widgetRole(el: Element): string {
  if (NATIVE.has(tag(el))) return "";
  const r = roleOf(el);
  return WIDGET_ROLES.has(r) ? r : "";
}

/** A text input that acts as a combobox: role=combobox on the input, or inside an ARIA 1.1 combobox container. */
export function inputCombobox(el: Element): boolean {
  if (tag(el) !== "input") return false;
  const type = attr(el, "type").toLowerCase() || "text";
  if (!["text", "search", "email", "tel", "url"].includes(type)) return false;
  return roleOf(el) === "combobox" || !!el.parentElement?.closest("[role=combobox]");
}

/** The listbox a combobox (div or input) opens: by aria-controls / aria-owns, inside its ARIA 1.1 container, or
 *  by its active descendant. Null when the page has not rendered it. */
export function listboxOf(cb: Element): Element | null {
  const holders = [cb];
  const container = tag(cb) === "input" ? cb.parentElement?.closest("[role=combobox]") : null;
  if (container) holders.push(container);
  for (const h of holders) {
    for (const id of `${attr(h, "aria-controls")} ${attr(h, "aria-owns")}`.split(/\s+/).filter(Boolean)) {
      const el = byId(h, id);
      if (!el) continue;
      if (roleOf(el) === "listbox") return el;
      const inner = el.querySelector("[role=listbox]");
      if (inner) return inner;
    }
  }
  if (container) {
    const inner = container.querySelector("[role=listbox]");
    if (inner) return inner;
  }
  if (roleOf(cb) === "combobox" && tag(cb) !== "input") {
    const inner = cb.querySelector("[role=listbox]");
    if (inner) return inner;
  }
  const active = attr(cb, "aria-activedescendant");
  const act = active ? byId(cb, active) : null;
  return act?.closest("[role=listbox]") ?? null;
}

/** The option elements of a listbox, in order. */
export const optionEls = (lb: Element | null): Element[] => (lb ? Array.from(lb.querySelectorAll("[role=option]")) : []);

/** An option's label: its text, read whole (a filtered list hides options, and the text is still the page's own). */
export const optionText = (o: Element): string => collapse(attr(o, "aria-label") || (o.textContent ?? ""));

/** An ARIA option or choice item's value: data-value, then value, then its label. */
export const itemValue = (el: Element, label: string): string => attr(el, "data-value") || attr(el, "value") || label;

export function listOptions(lb: Element | null): FieldOption[] {
  const out: FieldOption[] = [];
  for (const o of optionEls(lb)) {
    const label = optionText(o);
    if (!label) continue;
    out.push({ value: itemValue(o, label), label });
  }
  return out;
}

export const isOn = (el: Element, state: "aria-checked" | "aria-selected" = "aria-checked"): boolean => attr(el, state).toLowerCase() === "true";

/** True when the element or an ancestor (across shadow roots) is hidden. */
export function hiddenUp(el: Element): boolean {
  for (let cur: Element | null = el; cur; cur = parentOf(cur)) if (isHidden(cur)) return true;
  return false;
}
