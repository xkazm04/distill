// The language of a text from its own words (spark universal-core #2), for pages with no lang attribute. Pure and
// deterministic: common words and letters, no AI, nothing leaves the device. STUB: the round-1 builder fills it in.

export interface DetectedLang {
  /** ISO 639-1 code ("cs", "en"), or "und" when the text is too short or too mixed to say. */
  lang: string;
  /** 0-1: how sure. Below 0.5 the answer is "und". */
  confidence: number;
}

/** Names the language of `text` (the page's running text). */
export function detectLang(text: string): DetectedLang {
  void text;
  return { lang: "und", confidence: 0 };
}
