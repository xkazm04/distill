// "Put into Czech" (tiger 2026-11-25, L2; pool P10): when the translation of a typed answer may be OFFERED. Pure, over
// structure only. The translation itself runs in the app on Chrome's on-device Translator (apps/web/src/translator.ts),
// as the values task `translateAnswer` (route.ts: only_on_device), and is never automatic.
//
// Offered only for free text (text, textarea) on a form whose language differs from the reader's. Never for what has a
// form of its own that a translator would spoil: names, numbers, dates, e-mail, phone, birth number, addresses, a
// signature, a field with a pattern, or a step whose expectedFormat says what to write.
import { labelConcept } from "./papers.js";
import { sameLabel } from "./guides.js";
import type { FieldStructure } from "./types.js";

/** Words of a label that say the answer is a name, a number, a date, an address or a code: never translated. */
const NOT_PROSE = new Set([
  // cs
  "jméno", "jména", "příjmení", "titul", "podpis", "číslo", "čísla", "kód", "datum", "dne", "rok", "ič", "ičo", "dič", "psč",
  "ulice", "obec", "město", "adresa", "adresy", "stát", "telefon", "e", "mail", "email", "iban", "účtu", "účet", "rč",
  "pas", "pasu", "doklad", "dokladu", "popisné", "orientační", "okres", "kraj",
  // en
  "name", "names", "surname", "signature", "number", "no", "code", "date", "year", "postcode", "zip", "street", "city",
  "town", "address", "country", "phone", "telephone", "passport", "id", "account",
  // uk
  "ім'я", "імя", "прізвище", "підпис", "номер", "код", "дата", "адреса", "вулиця", "місто", "телефон", "паспорт", "паспорта",
]);

const primary = (lang: string): string => (lang || "").toLowerCase().split(/[-_]/)[0] ?? "";

/**
 * Whether "Put into <form language>" may be offered for this field. `expectedFormat` is the wizard step's, when it has
 * one: a step that says what format to write is not free prose.
 */
export function canOfferTranslation(field: FieldStructure, formLang: string, readerLang: string, expectedFormat?: string): boolean {
  const form = primary(formLang);
  if (!form || form === "und" || form === primary(readerLang)) return false;
  if (field.kind !== "text" && field.kind !== "textarea") return false;
  if (field.pattern || (expectedFormat ?? "").trim()) return false;
  if (labelConcept(field.label, formLang)) return false; // an identity fact, in anyone's block
  const words = sameLabel(`${field.label} ${field.placeholder ?? ""}`.replace(/[’ʼ‘]/g, "'")).split(" ");
  if (words.some((w) => NOT_PROSE.has(w))) return false;
  // A placeholder that shows digits shows a format, not prose.
  if (/\d/.test(field.placeholder ?? "")) return false;
  return true;
}
