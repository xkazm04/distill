import type { ReactNode } from "react";
import { setThemePref, useTheme, type ThemePref } from "./theme";
import { Wordmark } from "./Wordmark";

const CHOICES: { id: ThemePref; label: string; name: string; icon: ReactNode }[] = [
  { id: "system", label: "Auto", name: "Auto, match my device", icon: <path d="M4 5h16v11H4zM9 20h6M12 16v4" /> },
  { id: "light", label: "Light", name: "Light", icon: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> },
  { id: "dark", label: "Dark", name: "Dark", icon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /> },
];

/** The web app's chrome: the wordmark (home) and the light / dark choice. */
export function Header() {
  return (
    <header className="shell-head">
      <a className="shell-home" href="#/" aria-label="Distill home">
        <Wordmark className="shell-mark" sizes="(max-width: 480px) 90px, 120px" />
      </a>
      <ThemeSwitch />
    </header>
  );
}

/** Settings > Appearance. A radio group, so arrow keys move between the three choices. */
export function ThemeSwitch() {
  const { pref } = useTheme();
  return (
    <fieldset className="theme-switch" data-testid="theme-switch">
      <legend className="visually-hidden">Appearance</legend>
      {CHOICES.map((c) => (
        <label key={c.id} className={pref === c.id ? "on" : ""} title={c.name}>
          <input type="radio" name="theme" value={c.id} checked={pref === c.id} onChange={() => setThemePref(c.id)}
            aria-label={c.name} />
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{c.icon}</svg>
          <span className="theme-label" aria-hidden="true">{c.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
