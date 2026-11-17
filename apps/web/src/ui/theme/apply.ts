// Binds a theme onto an element as role custom properties. The web app binds the brand on <html>; the extension's side
// panel binds a derived theme the same way. Components never read the binding: they only use var(--role).
import { ROLES, type ThemeBinding } from "./roles";

export function applyBinding(root: HTMLElement, b: ThemeBinding): void {
  for (const role of ROLES) root.style.setProperty(role, b[role]);
}
