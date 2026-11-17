// TODO(WP5): switch to `applyBinding` from apps/web/src/ui/theme/apply.ts once it lands (same signature); this copy
// exists only so the extension can bind roles before then. The Director reconciles at merge.
import { ROLES, type ThemeBinding } from "../../../web/src/ui/theme/roles";

/** Bind every theme role as a custom property on `root` (inline, so it wins over the stylesheet's defaults). */
export function applyBinding(root: HTMLElement, b: ThemeBinding): void {
  for (const role of ROLES) root.style.setProperty(role, b[role]);
}
