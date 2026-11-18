// Small riso-style pictures for the example cards. Decorative; colours come from the shell's brand inks.
export function DemoArt({ id }: { id: string }) {
  return (
    <svg className="demo-art" viewBox="0 0 120 80" aria-hidden="true" focusable="false">
      {id === "form" && (
        <g>
          <rect className="a-sheet" x="30" y="8" width="60" height="68" rx="6" />
          <rect className="a-ink-soft" x="38" y="18" width="30" height="5" rx="2.5" />
          <rect className="a-field" x="38" y="30" width="44" height="9" rx="3" />
          <rect className="a-field" x="38" y="45" width="44" height="9" rx="3" />
          <circle className="a-badge" cx="88" cy="60" r="12" />
          <path className="a-tick" d="M82 60l4 4 8-9" />
        </g>
      )}
      {id === "guide" && (
        <g>
          <rect className="a-sheet" x="22" y="10" width="50" height="62" rx="6" />
          <rect className="a-field" x="30" y="22" width="34" height="8" rx="3" />
          <rect className="a-field" x="30" y="36" width="34" height="8" rx="3" />
          <rect className="a-field" x="30" y="50" width="34" height="8" rx="3" />
          <rect className="a-sheet a-lift" x="64" y="18" width="36" height="52" rx="5" />
          <rect className="a-ink" x="70" y="26" width="22" height="5" rx="2.5" />
          <rect className="a-ink-soft" x="70" y="36" width="24" height="4" rx="2" />
          <rect className="a-ink-soft" x="70" y="44" width="18" height="4" rx="2" />
          <circle className="a-badge" cx="94" cy="62" r="9" />
          <path className="a-tick" d="M89.5 62l3 3 6-6.5" />
        </g>
      )}
      {id === "article" && (
        <g>
          <rect className="a-sheet" x="22" y="8" width="76" height="68" rx="6" />
          <rect className="a-ink-soft" x="30" y="16" width="22" height="14" rx="3" />
          <rect className="a-ink-soft" x="58" y="16" width="32" height="4" rx="2" />
          <rect className="a-ink-soft" x="58" y="24" width="24" height="4" rx="2" />
          <rect className="a-mark" x="28" y="38" width="64" height="11" rx="3" />
          <rect className="a-ink" x="32" y="42" width="54" height="4" rx="2" />
          <rect className="a-ink-soft" x="30" y="56" width="60" height="4" rx="2" />
          <rect className="a-ink-soft" x="30" y="64" width="44" height="4" rx="2" />
        </g>
      )}
      {id === "pricing" && (
        <g>
          <rect className="a-sheet" x="14" y="20" width="28" height="50" rx="5" />
          <rect className="a-sheet a-lift" x="46" y="10" width="28" height="60" rx="5" />
          <rect className="a-sheet" x="78" y="20" width="28" height="50" rx="5" />
          <rect className="a-ink-soft" x="20" y="30" width="16" height="4" rx="2" />
          <rect className="a-ink" x="52" y="20" width="16" height="6" rx="3" />
          <rect className="a-ink-soft" x="84" y="30" width="16" height="4" rx="2" />
          <circle className="a-badge" cx="60" cy="48" r="9" />
        </g>
      )}
    </svg>
  );
}
