import { useShellArt } from "./theme";
import ink360 from "./assets/wordmark-ink-360.webp";
import ink720 from "./assets/wordmark-ink-720.webp";
import ink1280 from "./assets/wordmark-ink-1280.webp";
import paper360 from "./assets/wordmark-paper-360.webp";
import paper720 from "./assets/wordmark-paper-720.webp";
import paper1280 from "./assets/wordmark-paper-1280.webp";

// Cut from brand/final/wordmark.png (paper knocked out, trimmed): "ink" is aubergine lettering for a paper ground,
// "paper" is the same mark with paper lettering for the aubergine ground. Coil and drip keep their colours.
const SETS = {
  ink: `${ink360} 360w, ${ink720} 720w, ${ink1280} 1280w`,
  paper: `${paper360} 360w, ${paper720} 720w, ${paper1280} 1280w`,
};
/** Intrinsic aspect of the trimmed mark (1219 x 497). */
export const WORDMARK_RATIO = 1219 / 497;

interface Props {
  /** "auto" takes the cut the active theme binds for its ground; "ink" always (the mark sits on the paper of the hero print). */
  tone?: "auto" | "ink";
  /** The rendered CSS width, for the browser's pick from the srcset. */
  sizes: string;
  className?: string;
}

export function Wordmark({ tone = "auto", sizes, className }: Props) {
  const art = useShellArt();
  const set = tone === "ink" ? "ink" : art.wordmark;
  return (
    <img className={className} src={set === "ink" ? ink720 : paper720} srcSet={SETS[set]} sizes={sizes}
      width={1219} height={497} alt="Distill" decoding="async" />
  );
}
