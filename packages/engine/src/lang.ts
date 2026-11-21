// The language of a text from its own words (spark universal-core #2), for pages with no lang attribute. Pure and
// deterministic: common words and letters, no AI, nothing leaves the device.
//
// How: a text in a non-Latin script is named by its script (and, for Cyrillic, by the letters Russian and Ukrainian do
// not share). A Latin text is scored against short profiles of each language's most common short words, plus the
// letters with diacritics only a few of the languages use. A word or letter that several languages share counts for
// each of them by 1/n, so only what sets a language apart decides. Old sites often write without diacritics
// ("jsou", "ktery"); a word with no diacritics in the text also matches its profile word with them.

export interface DetectedLang {
  /** ISO 639-1 code ("cs", "en"), or "und" when the text is too short or too mixed to say. */
  lang: string;
  /** 0-1: how sure. Below 0.5 the answer is "und". */
  confidence: number;
}

/** Fewer letters than this: too short to say. */
const MIN_LETTERS = 40;
/** The runner-up scoring this share of the winner or more: a near tie. */
const TIE = 0.8;
/** Read at most this much of the text (a page's running text can be long; its start says enough). */
const MAX_CHARS = 20_000;

const WORDS: Record<string, string> = {
  cs: "a v ve je se na že to s z ze do o i k jsou jako ale pro by byl byla bylo jsem jsme jste nebo který která které "
    + "jeho její jejich také už jen při podle mezi když tak než může není tento tato toto proto kde ještě velmi pouze "
    + "bude budou máte mají jak své od po za si nás vám jsme či již",
  sk: "a v vo je sa na že to s z zo do o i k sú ako ale pre by bol bola bolo som sme ste alebo ktorý ktorá ktoré jeho "
    + "jej ich tiež už len pri podľa medzi keď tak než môže nie tento táto toto preto kde ešte veľmi iba bude budú "
    + "máte majú aj od po za si nás vám či",
  pl: "i w z na się nie to do że jest o a jak ale po co tak za od są przez dla jego jej ich który która które oraz czy "
    + "być był była było tylko już może także przy między gdy bardzo tego tym ten ta jako można we ze się",
  de: "der die das und ist in den von zu mit sich des auf für nicht ein eine als auch es an werden aus er hat dass sie "
    + "nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch "
    + "kann ihre wir ich uns unsere sehr",
  en: "the and of to in is that for it with as was on are be this by you not or from at have an but they which his her "
    + "we will can has their been were more if all would there what about our your when one also who how into its",
  fr: "le la les de des et en un une du est que qui dans pour pas sur au aux avec ce il elle par plus ne se sont ou mais "
    + "nous vous leur cette été être à son sa ses comme tout très aussi peut sans",
  es: "el la los las de del y en que un una es por con para no se al lo como más pero sus su le ya o este esta está "
    + "son entre cuando muy sin sobre también hasta hay donde desde nos ha fue ser",
  it: "il la le lo gli di del della e è che un una in per con non si da al alla dei delle nel nella come più ma anche "
    + "sono questo questa ha ci se tra fra essere molto quando tutto sul ed",
  pt: "o a os as de do da dos das e é que um uma em no na nos nas para com não por se mais como mas ao à sua seu ou são "
    + "foi ser está também muito quando isso este esta pelo pela entre já",
  nl: "de het een en van in is dat op te zijn met voor niet aan er om ook als bij door maar naar wordt worden uit dan "
    + "nog of kan wel deze die wij ze hij heeft zij meer geen over tot onze u uw",
  hu: "a az és hogy nem is egy meg van volt de el ki be csak már mint ez azt ezt még vagy kell lesz fel után között "
    + "minden nagyon sok majd akkor ha mert pedig amely amelyek valamint szerint így",
  sv: "och i att det som en på är av för med till den har de inte om ett var jag men eller så kan från vid sig vi ska "
    + "när efter också bara hade dem mycket under över här nu alla sin sina",
};

/** Letters only some of the languages use. */
const LETTERS: Record<string, string> = {
  cs: "řůěčďťňžšý",
  sk: "äôĺľŕčďťňžšý",
  pl: "ąęłńśźżć",
  de: "ßäöü",
  hu: "őűöü",
  fr: "èêàçœëîïûùâô",
  es: "ñ¿¡",
  pt: "ãõçâêôà",
  it: "ìòàèù",
  sv: "åäö",
};

/** Lower case without diacritics. */
const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type Weights = Map<string, Map<string, number>>;

/** word or letter -> language -> 1/(how many languages share it). */
function weigh(entries: [string, string[]][]): Weights {
  const langs = new Map<string, Set<string>>();
  for (const [lang, keys] of entries) for (const k of keys) (langs.get(k) ?? langs.set(k, new Set()).get(k) as Set<string>).add(lang);
  const out: Weights = new Map();
  for (const [k, set] of langs) out.set(k, new Map(Array.from(set, (l) => [l, 1 / set.size])));
  return out;
}

const wordList = Object.entries(WORDS).map(([l, s]) => [l, s.split(/\s+/).filter(Boolean)] as [string, string[]]);
/** Words as written, for a word in the text with diacritics. */
const EXACT = weigh(wordList);
/** Words without diacritics, for a word in the text without them (old sites write "ktery" for "který"). */
const FOLDED = weigh(wordList.map(([l, ws]) => [l, ws.map(fold)]));
const LETTER = weigh(Object.entries(LETTERS).map(([l, s]) => [l, Array.from(s)]));
const LATIN_LANGS = Object.keys(WORDS);
/** A letter counts for less than a word: one text has many more letters than common words. */
const LETTER_WEIGHT = 0.35;

const SCRIPTS: [string, RegExp][] = [
  ["latin", /\p{Script=Latin}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["greek", /\p{Script=Greek}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["han", /\p{Script=Han}/u],
];

const und = (confidence: number): DetectedLang => ({ lang: "und", confidence: Math.min(confidence, 0.49) });

/** Names the language of `text` (the page's running text). */
export function detectLang(text: string): DetectedLang {
  const sample = text.slice(0, MAX_CHARS);
  const scripts = new Map<string, number>();
  let letters = 0;
  for (const ch of sample.match(/\p{L}/gu) ?? []) {
    letters++;
    // Latin up to Latin Extended-B without a regex: most pages are Latin, and 20,000 characters must stay fast.
    const s = (ch.codePointAt(0) as number) < 0x250 ? "latin" : SCRIPTS.find(([, re]) => re.test(ch))?.[0] ?? "other";
    scripts.set(s, (scripts.get(s) ?? 0) + 1);
  }
  if (letters < MIN_LETTERS) return und(letters / MIN_LETTERS / 4);
  const share = (s: string) => (scripts.get(s) ?? 0) / letters;

  // Chinese and Japanese share the Han characters; kana says Japanese.
  if (share("kana") > 0.05) return named("ja", share("kana") + share("han"));
  if (share("latin") < 0.5) {
    const top = [...scripts].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top === "cyrillic") return cyrillic(sample, share("cyrillic"));
    const byScript: Record<string, string> = { greek: "el", hebrew: "he", arabic: "ar", hangul: "ko", han: "zh" };
    if (top && byScript[top]) return named(byScript[top] as string, share(top));
    return und(0.2);
  }
  return latin(sample);
}

/** A language named by its script: as sure as the script dominates. */
function named(lang: string, share: number): DetectedLang {
  const confidence = Math.min(1, 0.5 + share / 2);
  return { lang, confidence: round(confidence) };
}

/** Russian and Ukrainian by the letters only one of them has. Other Cyrillic languages are not told apart: "und". */
function cyrillic(text: string, share: number): DetectedLang {
  const uk = (text.match(/[іїєґІЇЄҐ]/g) ?? []).length;
  const ru = (text.match(/[ыэъёЫЭЪЁ]/g) ?? []).length;
  if (uk + ru < 3) return und(0.3);
  const top = Math.max(uk, ru);
  const second = Math.min(uk, ru);
  if (second / top >= TIE) return und(0.3);
  return { lang: uk > ru ? "uk" : "ru", confidence: round(Math.min(share, sure(top, second))) };
}

function latin(text: string): DetectedLang {
  const score = new Map<string, number>(LATIN_LANGS.map((l) => [l, 0]));
  const byWords = new Map<string, number>();
  const add = (w: Map<string, number> | undefined, by = 1, also?: Map<string, number>) => {
    if (!w) return;
    for (const [l, v] of w) {
      score.set(l, (score.get(l) ?? 0) + v * by);
      also?.set(l, (also.get(l) ?? 0) + v * by);
    }
  };
  const lower = text.toLowerCase();
  let words = 0;
  for (const word of lower.match(/[\p{L}\p{M}]+/gu) ?? []) {
    words++;
    const bare = fold(word);
    // A word written with diacritics must match exactly ("és" is Hungarian, not Spanish "es"); one without them
    // matches the profile word with or without its diacritics.
    add(bare === word ? FOLDED.get(bare) : EXACT.get(word), 1, byWords);
  }
  for (const ch of lower) add(LETTER.get(ch), LETTER_WEIGHT);

  const ranked = [...score].sort((a, b) => b[1] - a[1]);
  const [lang, top] = ranked[0] as [string, number];
  const second = ranked[1]?.[1] ?? 0;
  const words3 = (byWords.get(lang) ?? 0) >= 3 && top / Math.max(words, 1) >= 0.05;
  if (words3) {
    if (second / top >= TIE) return und(0.4);
    return { lang, confidence: round(sure(top, second)) };
  }
  // Few common words (a menu, a list of services, a visitor counter: an old company site's whole text), but letters
  // only one language uses ("návštěvníků", "autoveteránů"): enough when nothing else comes near, and said less surely.
  if (top >= 1 && second / top <= 0.5) return { lang, confidence: round(Math.min(0.65, sure(top, second))) };
  return und(0.2);
}

/** 0.5 at a near tie (TIE), 1 when nothing else scores. */
function sure(top: number, second: number): number {
  const r = top > 0 ? second / top : 1;
  return Math.max(0.5, Math.min(1, 1 - (r / TIE) * 0.5));
}

const round = (n: number) => Math.round(n * 100) / 100;
