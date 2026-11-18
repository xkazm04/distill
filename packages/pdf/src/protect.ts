// A PDF its author protected with an owner password only: anyone can open it, and its permission flags (/P) say what a
// reader may do. When those flags allow filling in forms, Distill fills it, and the saved copy carries the same
// protection again: encrypted, with the same flags, under a new random owner password (the author's is unknown, and
// no one needs it to open the file). A file whose flags forbid filling, one that needs a password to open, and one
// whose encryption is not the standard password kind are not filled.
//
// pdf-lib (@cantoo/pdf-lib 2.11.1) decrypts such a file and writes an encrypted one, but its writer encrypts stream
// contents only, never strings: every string in an object written outside an object stream (field names, tooltips,
// values) would reach a reader as garbage. So the strings are encrypted here, with the library's own security handler
// for the new file (`context.security.getEncryptFn`), the file is written without object streams, and a fresh
// decrypting parse of the new bytes must give back every string and every stream byte for byte, with the same flags.
// Anything less and nothing is saved: an unprotected or garbled copy is never handed out.
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFStream, PDFString, type PDFObject, type PDFRef,
} from "@cantoo/pdf-lib";

/** The facts of a file's encryption that decide whether it may be filled and how its copy is protected again. */
export interface Protection {
  /** The security handler. Only "Standard" (password based) can be opened without a key Distill does not have. */
  filter: string;
  /** Algorithm (/V) and revision (/R) of the standard handler. */
  v: number;
  r: number;
  /** The permission flags, as the file stores them (a signed 32-bit number). */
  p: number;
}

/** Bit n (1-based) of the permission flags, ISO 32000-1 table 22. */
const bit = (p: number, n: number): boolean => ((p >>> (n - 1)) & 1) === 1;

/**
 * Whether the flags let a reader fill in the form. Revision 3 and later: bit 9 (fill in form fields), or bit 6 (add or
 * modify annotations, which includes filling in fields). Revision 2 has no bit 9: bit 6 decides.
 */
export const fillAllowed = (p: Protection): boolean => (p.r >= 3 ? bit(p.p, 9) || bit(p.p, 6) : bit(p.p, 6));

/** The file's encryption, read without decrypting anything. Null when the file is not encrypted. */
export function protectionOf(raw: PDFDocument): Protection | null {
  const enc = raw.context.lookup(raw.context.trailerInfo.Encrypt);
  if (!(enc instanceof PDFDict)) return null;
  const num = (k: string): number => {
    const v = enc.lookup(PDFName.of(k));
    return v instanceof PDFNumber ? v.asNumber() : NaN;
  };
  const filter = enc.lookup(PDFName.of("Filter"));
  return { filter: filter instanceof PDFName ? filter.decodeText() : "", v: num("V"), r: num("R"), p: num("P") };
}

/**
 * The same flags in pdf-lib's terms. Revision 3 and later map bit for bit (pdf-lib sets the reserved bits as the
 * standard asks). A revision 2 file's flags are read as revision 2 defines them: filling and accessibility follow
 * bits 6 and 5, assembly follows bit 4, and printing is full quality.
 */
export function permissionsOf(p: Protection) {
  const r2 = p.r < 3;
  const print = bit(p.p, 3);
  return {
    printing: print ? (r2 || bit(p.p, 12) ? "highResolution" as const : "lowResolution" as const) : false,
    modifying: bit(p.p, 4),
    copying: bit(p.p, 5),
    annotating: bit(p.p, 6),
    fillingForms: r2 ? bit(p.p, 6) : bit(p.p, 9),
    contentAccessibility: r2 ? bit(p.p, 5) : bit(p.p, 10),
    documentAssembly: r2 ? bit(p.p, 4) : bit(p.p, 11),
  };
}

/** The flags pdf-lib writes for these permissions (revision 3 and later), to check the saved copy against. */
function flagsFor(p: Protection): number {
  const m = permissionsOf(p);
  let f = 0xfffff0c0 >> 0;
  if (m.printing) f |= 1 << 2;
  if (m.printing === "highResolution") f |= 1 << 11;
  if (m.modifying) f |= 1 << 3;
  if (m.copying) f |= 1 << 4;
  if (m.annotating) f |= 1 << 5;
  if (m.fillingForms) f |= 1 << 8;
  if (m.contentAccessibility) f |= 1 << 9;
  if (m.documentAssembly) f |= 1 << 10;
  return f;
}

/** AES-256 for a file that had it; AES-128 for every other (an RC4 file gets AES-128: Distill writes no weak cipher). */
const algorithmFor = (p: Protection): "AES-256" | "AES-128" => (p.v === 5 ? "AES-256" : "AES-128");

export class ProtectionError extends Error {
  constructor(why: string) {
    super(`The filled copy could not be protected like the original, so it was not saved (${why}).`);
    this.name = "ProtectionError";
  }
}

const isString = (o: unknown): o is PDFString | PDFHexString => o instanceof PDFString || o instanceof PDFHexString;
/** A source object stream or cross-reference stream: its contents are parsed into the context, it is not written. */
const container = (o: PDFObject): boolean => o instanceof PDFRawStream && ["/ObjStm", "/XRef"].includes(String(o.dict.lookup(PDFName.of("Type"))));

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

interface Slot { bytes: Uint8Array; set: (s: PDFHexString) => void }

/** Every string inside an indirect object, depth first, with a way to replace it. A direct dictionary or array met
 *  twice would be encrypted twice: that is refused rather than guessed at. */
function slots(obj: PDFObject, out: Slot[] = [], seen = new Set<PDFObject>()): Slot[] {
  const target = obj instanceof PDFStream ? obj.dict : obj;
  if (!(target instanceof PDFDict || target instanceof PDFArray)) return out;
  if (seen.has(target)) throw new ProtectionError("a part of the file is shared in a way Distill does not rewrite");
  seen.add(target);
  const visit = (v: PDFObject | undefined, set: (s: PDFHexString) => void): void => {
    if (isString(v)) out.push({ bytes: v.asBytes(), set });
    else if (v instanceof PDFDict || v instanceof PDFArray) slots(v, out, seen);
  };
  if (target instanceof PDFDict) for (const [k, v] of target.entries()) visit(v, (s) => target.set(k, s));
  else for (let i = 0; i < target.size(); i++) visit(target.get(i), (s) => target.set(i, s));
  return out;
}

const key = (ref: PDFRef): string => `${ref.objectNumber} ${ref.generationNumber}`;

/** What a decrypting reader must find in each indirect object: its strings and, for a stream, its bytes. */
function contentsOf(doc: PDFDocument): Map<string, string> {
  const out = new Map<string, string>();
  const encrypt = doc.context.trailerInfo.Encrypt;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (ref === encrypt || container(obj)) continue;
    const parts = isString(obj) ? [hex(obj.asBytes())] : slots(obj).map((s) => hex(s.bytes));
    if (obj instanceof PDFStream) parts.push(`stream ${hex(obj.getContents())}`);
    out.set(key(ref), parts.join(" "));
  }
  return out;
}

/**
 * Saves `doc` (opened decrypted from a file with protection `p`) encrypted again with the same permission flags and a
 * random owner password, and confirms it by a fresh parse. Throws ProtectionError, and returns nothing, when the copy
 * would not open, would not keep the flags, or would read back differently from what was written.
 */
export async function saveProtected(doc: PDFDocument, p: Protection): Promise<Uint8Array> {
  const ctx = doc.context;
  // The source's object and cross-reference streams were parsed into objects; they are not written again.
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) if (container(obj)) ctx.delete(ref);
  await doc.flush();
  const owner = hex(crypto.getRandomValues(new Uint8Array(24)));
  doc.encrypt({ userPassword: "", ownerPassword: owner, permissions: permissionsOf(p), algorithm: algorithmFor(p) });
  const security = ctx.security;
  if (!security) throw new ProtectionError("no security handler");
  const want = contentsOf(doc);
  const encryptRef = ctx.trailerInfo.Encrypt;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref === encryptRef) continue;
    const enc = (b: Uint8Array) => PDFHexString.of(hex(security.getEncryptFn(ref.objectNumber, ref.generationNumber)(b)));
    if (isString(obj)) ctx.assign(ref, enc(obj.asBytes()));
    else for (const s of slots(obj)) s.set(enc(s.bytes));
  }
  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });

  let back: PDFDocument;
  try {
    back = await PDFDocument.load(bytes, { password: "", updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    throw new ProtectionError("the copy did not open again");
  }
  const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const now = protectionOf(raw);
  if (!now || now.filter !== "Standard") throw new ProtectionError("the copy is not encrypted");
  if (now.p !== flagsFor(p) || !fillAllowed(now)) throw new ProtectionError("the copy's permissions differ");
  const got = contentsOf(back);
  for (const [k, v] of want) if (got.get(k) !== v) throw new ProtectionError("the copy reads back differently");
  return bytes;
}
