// Papers by label (tiger 2026-11-25, L1; pool P17). A person's identity facts, answered once on one form, proposed on the
// next form of any office, with no model and no guide.
//
// Two halves, both pure:
//  - conceptOf / conceptsOf read STRUCTURE ONLY (FieldStructure: label, section, kind, fieldId). They say which of nine
//    identity facts a field asks for, from a closed table of exact labels (Czech first, then the English and Ukrainian
//    a trilingual ministry form prints beside it). No concept when the kind does not fit, when the label, section or
//    field id names another party (mother, representative, employer, spouse, child, payer ...), when the field is one
//    part of a number split over several boxes, or when two fields of the same form would take the same fact.
//    Addresses are never a concept: one form asks for the previous, new, permanent and mailing address.
//  - papersFrom / proposeFromPapers join VALUES on the device: canonical facts out of answers the page read back, and
//    proposals in each field's own format for the empty fields of the next form. Nothing here touches the network; the
//    device vault is apps/web/src/ui/papers.ts.
import { toIsoDate } from "./fill.js";
import { sameLabel } from "./guides.js";
import type { FieldKind, FieldStructure, FormStructure, FormValues } from "./types.js";

export const PAPER_CONCEPTS = [
  "surname", "givenName", "birthSurname", "birthDate", "birthNumber", "nationality", "passportNumber", "phone", "email",
] as const;
export type PaperConcept = (typeof PAPER_CONCEPTS)[number];

/** concept -> canonical value (ISO date, digits for a birth number, + and digits for a phone). DEVICE ONLY, like
 *  FormValues: never in a prompt, never in Firestore. */
export type Papers = Partial<Record<PaperConcept, string>>;

export const isPaperConcept = (v: unknown): v is PaperConcept => typeof v === "string" && (PAPER_CONCEPTS as readonly string[]).includes(v);

/** The kinds each fact can be written into. */
const KINDS: Record<PaperConcept, readonly FieldKind[]> = {
  surname: ["text"],
  givenName: ["text"],
  birthSurname: ["text"],
  birthDate: ["date", "text"],
  birthNumber: ["text", "number"],
  nationality: ["text", "select"],
  passportNumber: ["text"],
  phone: ["tel", "text", "number"],
  email: ["email", "text"],
};

type TableLang = "cs" | "en" | "uk";

/** The closed table: exact labels as forms print them. A wrong entry is a one-line, reviewable change; the snapshot
 *  test (packages/engine/test/papers.snapshot.test.ts) shows what every guide's field gets. */
const TABLE: Record<TableLang, Record<PaperConcept, readonly string[]>> = {
  cs: {
    surname: ["příjmení"],
    givenName: ["jméno", "jména", "jméno jména", "křestní jméno", "křestní jména"],
    birthSurname: ["rodné příjmení"],
    birthDate: ["datum narození", "datum narozeni"],
    birthNumber: ["rodné číslo", "rodne cislo", "číslo pojištěnce rodné číslo"],
    nationality: ["státní příslušnost", "státní občanství", "občanství"],
    // "Číslo OP / pasu / povolení k pobytu" takes any of the three; a passport number is one of them.
    passportNumber: ["číslo pasu", "číslo cestovního pasu", "číslo cestovního dokladu", "číslo op pasu povolení k pobytu"],
    phone: ["telefon", "tel", "telefonní číslo", "číslo telefonu", "kontaktní telefon", "mobil", "mobilní telefon"],
    email: ["e mail", "email", "e mailová adresa", "emailová adresa", "adresa elektronické pošty"],
  },
  en: {
    surname: ["surname", "family name", "last name"],
    givenName: ["given name", "given names", "first name", "first names", "forename", "forenames"],
    birthSurname: ["birth surname", "surname at birth", "maiden name"],
    birthDate: ["date of birth", "birth date"],
    birthNumber: ["birth number", "birth number rodné číslo"],
    nationality: ["nationality", "citizenship"],
    passportNumber: ["passport number", "passport no", "travel document number"],
    phone: ["phone", "telephone", "phone number", "telephone number", "mobile", "mobile phone", "mobile number"],
    email: ["e mail", "email", "e mail address", "email address"],
  },
  uk: {
    surname: ["прізвище"],
    givenName: ["ім'я", "імя"],
    birthSurname: ["прізвище при народженні", "дівоче прізвище"],
    birthDate: ["дата народження"],
    birthNumber: [],
    nationality: ["громадянство"],
    passportNumber: ["номер паспорта", "номер паспорту"],
    phone: ["телефон", "номер телефону"],
    email: ["електронна пошта", "ел пошта", "e mail", "email"],
  },
};

/** Words that put a field in another person's (or an organisation's) block. Whole words of the normalized label,
 *  section or field id. Only ever removes a concept, so a false hit costs a proposal, never a wrong value. */
const PARTY_WORDS = new Set([
  // cs
  "matka", "matky", "matce", "matkou", "otec", "otce", "otci", "otcem", "rodič", "rodiče", "rodičů", "rodičem",
  "zástupce", "zástupci", "zástupcem", "zákonný", "zákonného", "zákonnému", "opatrovník", "opatrovníka", "opatrovníkem",
  "poručník", "poručníka", "poručníkem", "zmocněnec", "zmocněnce", "zmocněncem", "zaměstnavatel", "zaměstnavatele",
  "zaměstnavatelem", "zaměstnavateli", "škola", "školy", "školou", "manžel", "manžela", "manželem", "manželka",
  "manželky", "manželkou", "manželovi", "manželce", "manželé", "partner", "partnera", "partnerka", "partnerky", "dítě", "dítěte", "dítěti", "dítětem",
  "děti", "dětí", "plátce", "plátcem", "novorozenec", "novorozence", "novorozenců", "osvč", "podnikání", "obchodní",
  "firma", "firmy", "ubytovatel", "ubytovatele", "zvoucí", "zvoucího",
  // en
  "mother", "mothers", "father", "fathers", "parent", "parents", "guardian", "representative", "employer", "school",
  "spouse", "husband", "wife", "partners", "child", "children", "childs", "payer", "newborn", "agent", "proxy", "company",
  "business", "host", "inviting",
  // uk
  "мати", "матері", "батько", "батька", "батьків", "представник", "представника", "законний", "законного", "опікун",
  "опікуна", "роботодавець", "роботодавця", "дружина", "дружини", "чоловіка", "дитина", "дитини", "діти", "дітей",
  "платник", "новонароджений", "новонародженого", "школа", "школи",
]);

/** Cyrillic letters that look Latin, folded for comparison only ("Tелефон" on a ministry form has a Latin T). */
const LOOKALIKE: Record<string, string> = { а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", к: "k", м: "m", н: "h", т: "t", в: "b" };

const norm = (s: string): string => sameLabel(s.replace(/[’ʼ‘ʹ`]/g, "'").replace(/'/g, "")).replace(/\b(povinné pole|povinné|nepovinné|required|optional)$/u, "").trim();
const fold = (s: string): string => norm(s).replace(/[а-яіїєґ]/g, (c) => LOOKALIKE[c] ?? c);

const LOOKUP: Map<string, { concept: PaperConcept; lang: TableLang }> = (() => {
  const m = new Map<string, { concept: PaperConcept; lang: TableLang }>();
  for (const lang of ["cs", "en", "uk"] as const) {
    for (const concept of PAPER_CONCEPTS) for (const label of TABLE[lang][concept]) m.set(fold(label), { concept, lang });
  }
  return m;
})();

const primary = (lang: string): string => (lang || "").toLowerCase().split(/[-_]/)[0] ?? "";

/** Czech labels apply on a Czech, Slovak or unknown form; the English and Ukrainian ones on any form (Czech offices
 *  print them beside the Czech). */
function hit(piece: string, formLang: string): PaperConcept | null {
  const h = LOOKUP.get(fold(piece));
  if (!h) return null;
  if (h.lang === "cs" && !["cs", "sk", "und", ""].includes(primary(formLang))) return null;
  return h.concept;
}

/** The label's language parts: "Datum narození / Date of birth / Дата народження", and "Name and surname Ім’я та
 *  прізвище" split where Latin turns into Cyrillic. */
function pieces(label: string): string[] {
  return label.split("/").flatMap((p) => p.split(/(?<=[\p{Script=Latin}\d)])\s+(?=[\p{Script=Cyrillic}])/u)).map((p) => p.trim()).filter((p) => norm(p));
}

/** The concept the label alone names: the whole label exactly, or every language part naming the same one. */
export function labelConcept(label: string, formLang: string): PaperConcept | null {
  const whole = hit(label, formLang);
  if (whole) return whole;
  const parts = pieces(label);
  if (parts.length < 2) return null;
  const found = parts.map((p) => hit(p, formLang));
  const first = found[0];
  return first && found.every((c) => c === first) ? first : null;
}

const words = (s: string | undefined): string[] => (s ? norm(s).split(" ") : []);

/** Whether the label, section or field id names another party. */
export function namesAnotherParty(field: Pick<FieldStructure, "label" | "fieldId"> & Partial<Pick<FieldStructure, "section">>): boolean {
  return [field.label, field.section, field.fieldId].some((t) => words(t).some((w) => PARTY_WORDS.has(w)));
}

/** One box of a number split over several ("Číslo pojištěnce -rodné číslo" + "... část 2"): a whole value never fits. */
function isSplitPart(field: FieldStructure, siblings: readonly FieldStructure[]): boolean {
  const id = norm(field.fieldId);
  const lab = norm(field.label);
  const partOf = (base: string, own: string): boolean =>
    !!base && own !== base && own.startsWith(`${base} `) && /(?:^|\s)(část|cast|part|частина)\s*\d+$/u.test(own);
  return siblings.some((s) => s !== field && s.fieldId !== field.fieldId && (partOf(id, norm(s.fieldId)) || partOf(lab, norm(s.label))));
}

/** The concept of one field before the one-field-per-fact rule. */
function candidate(field: FieldStructure, formLang: string, siblings: readonly FieldStructure[]): PaperConcept | null {
  const c = labelConcept(field.label, formLang);
  if (!c || !KINDS[c].includes(field.kind)) return null;
  if (namesAnotherParty(field) || isSplitPart(field, siblings)) return null;
  return c;
}

/**
 * Which identity fact a field asks for, from its structure alone, or null. `siblings` is every field of the same form
 * (the field itself among them): a fact two fields would take goes to neither.
 */
export function conceptOf(field: FieldStructure, formLang: string, siblings: readonly FieldStructure[]): PaperConcept | null {
  const c = candidate(field, formLang, siblings);
  if (!c) return null;
  const takers = siblings.filter((s) => s.fieldId !== field.fieldId && candidate(s, formLang, siblings) === c);
  return takers.length ? null : c;
}

/** fieldId -> concept for every field of the form that has one. */
export function conceptsOf(s: Pick<FormStructure, "fields" | "lang">): Record<string, PaperConcept> {
  const out: Record<string, PaperConcept> = {};
  for (const f of s.fields) {
    const c = conceptOf(f, s.lang, s.fields);
    if (c) out[f.fieldId] = c;
  }
  return out;
}

// ---------------------------------------------------------------- values (device only)

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

function validIso(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1900 && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** A fact in its canonical form, or null when the answer is not a sound value of that fact. */
export function canonicalPaper(concept: PaperConcept, value: string, field?: FieldStructure): string | null {
  const v = collapse(value ?? "");
  if (!v || v.length > 120) return null;
  switch (concept) {
    case "surname": case "givenName": case "birthSurname":
      return /\p{L}/u.test(v) && !/\d/.test(v) ? v : null;
    case "birthDate": {
      const iso = toIsoDate(v);
      return validIso(iso) ? iso : null;
    }
    case "birthNumber": {
      const d = v.replace(/[\s/]/g, "");
      return /^\d{9,10}$/.test(d) ? d : null;
    }
    case "nationality": {
      if (field?.kind === "select") {
        const opt = field.options?.find((o) => o.value === v);
        const label = collapse(opt?.label ?? "");
        return label && !/^[-–—\s]*$/.test(label) ? label : null;
      }
      return /\p{L}/u.test(v) && !/\d/.test(v) ? v : null;
    }
    case "passportNumber": {
      const p = v.replace(/\s/g, "").toUpperCase();
      return /^[A-Z0-9-]{5,20}$/.test(p) && /\d/.test(p) ? p : null;
    }
    case "phone": {
      const intl = /^\s*(\+|00)/.test(v);
      const d = v.replace(/\D/g, "").replace(/^00/, "");
      if (!/^[\d\s+()./-]+$/.test(v) || d.length < 6 || d.length > 15) return null;
      return intl ? `+${d}` : d;
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
  }
}

/**
 * Canonical facts from answers the page READ BACK as written: `readBack` is fieldId -> the value the page holds after
 * the write, `written` the fields the write confirmed. A field with no concept, or an answer that is not a sound value
 * of its fact, is left out.
 */
export function papersFrom(s: Pick<FormStructure, "fields" | "lang">, readBack: FormValues, written: readonly string[]): Papers {
  const concepts = conceptsOf(s);
  const out: Papers = {};
  for (const id of written) {
    const concept = concepts[id];
    const field = s.fields.find((f) => f.fieldId === id);
    const raw = readBack[id];
    if (!concept || !field || raw === undefined) continue;
    const c = canonicalPaper(concept, raw, field);
    if (c) out[concept] = c;
  }
  return out;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** The words a field gives about its own format. */
const formatText = (f: FieldStructure): string => [f.placeholder, f.pattern, f.hint, f.label, f.fieldId].filter(Boolean).join(" ");

function formatDate(iso: string, f: FieldStructure, formLang: string): string | null {
  if (f.kind === "date") return iso; // <input type="date"> and a split date both take ISO; the writer splits it
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = formatText(f);
  if (/(yyyy|rrrr|jjjj)-mm-dd/i.test(t)) return iso;
  if (/dd\.\s?mm\.\s?(yyyy|rrrr|rok|jjjj)/i.test(t)) return `${pad2(d)}.${pad2(m)}.${y}`;
  if (/\bd\.\s?m\.\s?(yyyy|rrrr|jjjj)/i.test(t)) return `${d}.${m}.${y}`;
  if (/dd\/mm\/(yyyy|rrrr)/i.test(t)) return `${pad2(d)}/${pad2(m)}/${y}`;
  if (/mm\/dd\/yyyy/i.test(t)) return null; // never guess a month-first order wrong
  // No format given: a Czech or Slovak form writes a date DD.MM.RRRR; elsewhere the order is not ours to guess.
  return ["cs", "sk"].includes(primary(formLang)) ? `${pad2(d)}.${pad2(m)}.${y}` : null;
}

function formatBirthNumber(digits: string, f: FieldStructure): string {
  if (f.kind === "number") return digits;
  const t = formatText(f);
  const slash = `${digits.slice(0, 6)}/${digits.slice(6)}`;
  if (/\d{6}\s?\/\s?\d{3,4}|lomít|slash/i.test(t)) return slash;
  if ((f.maxLength && f.maxLength <= 10) || /\\d\{9,10\}|\\d\{10\}/.test(f.pattern ?? "")) return digits;
  return slash;
}

function formatPhone(canon: string, f: FieldStructure): string {
  if (f.kind === "number") return canon.replace(/\D/g, "");
  const m = /^\+420(\d{3})(\d{3})(\d{3})$/.exec(canon);
  if (m && /\+420[\s_]\d{3}[\s_]\d{3}[\s_]\d{3}/.test(formatText(f))) return `+420 ${m[1]} ${m[2]} ${m[3]}`;
  return canon;
}

/** A canonical fact in the format this field expects, or null when it cannot be written here. */
export function formatPaper(concept: PaperConcept, canon: string, f: FieldStructure, formLang: string): string | null {
  let out: string | null;
  switch (concept) {
    case "birthDate": out = formatDate(canon, f, formLang); break;
    case "birthNumber": out = formatBirthNumber(canon, f); break;
    case "phone": out = formatPhone(canon, f); break;
    case "nationality":
      out = f.kind === "select"
        ? (f.options?.find((o) => sameLabel(o.label) === sameLabel(canon) || o.value.toLowerCase() === canon.toLowerCase())?.value ?? null)
        : canon;
      break;
    default: out = canon;
  }
  if (out === null) return null;
  if (f.maxLength && out.length > f.maxLength) return null;
  return out;
}

/**
 * What the saved papers propose for this form: fieldId -> the value in that field's format. Only fields with a concept,
 * only facts the papers hold, and only fields that are EMPTY in `filled` (the answers so far and what the page holds).
 * Nothing is written here: a proposal becomes an answer the person checks, and Next writes and proves it.
 */
export function proposeFromPapers(s: Pick<FormStructure, "fields" | "lang">, papers: Papers, filled: FormValues = {}): FormValues {
  const out: FormValues = {};
  for (const [id, concept] of Object.entries(conceptsOf(s))) {
    const canon = papers[concept];
    const field = s.fields.find((f) => f.fieldId === id);
    if (!canon || !field || (filled[id] ?? "").trim()) continue;
    const v = formatPaper(concept, canon, field, s.lang);
    if (v) out[id] = v;
  }
  return out;
}
