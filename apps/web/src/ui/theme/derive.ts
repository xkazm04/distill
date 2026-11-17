// Stub with the final signature; WP6 implements it. Pure: no DOM access, so it runs in the side panel and in tests.
import type { DerivedTheme, PageThemeSeed, ThemeBinding } from "./roles";

/**
 * Derive a complete role binding from a host page's seed. Every role is bound; each contrast floor in
 * CONTRAST_FLOORS holds (adjust lightness, else fall back to `fallback`'s value for that role) and every adjusted
 * role is listed in `adjusted`.
 */
export function deriveTheme(_seed: PageThemeSeed, _fallback: ThemeBinding): DerivedTheme {
  throw new Error("deriveTheme is not implemented yet");
}
