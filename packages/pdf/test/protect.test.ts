// PDFs protected by their author. One encrypted with only an owner password whose permissions allow filling in forms
// is read and filled, and its copy is encrypted again with the same permissions; one whose permissions forbid filling,
// or that needs a password to open, is not filled. The copy is checked here with pdf.js, a different parser from
// pdf-lib (which writes it), and with pdf-lib's raw view of the encryption dictionary.
import { EncryptedPDFError, PDFDict, PDFDocument, PDFName, PDFNumber } from "@cantoo/pdf-lib";
import { fingerprint, prompts, type FormStructure } from "@distill/engine";
import { describe, expect, it } from "vitest";
import { fillPdf, PdfOpenError, ProtectionError, readPdf, readPdfValues, type PdfReading } from "../src/index.js";
import { fillAllowed, permissionsOf } from "../src/protect.js";
import { PDFJS, protectionSeenByPdfJs, seenByPdfJs } from "./bench/pdf-forms.js";
import { buildPdf, fontBytes, readLayout, type Layout, type Protect } from "./corpus/build.js";

/** pdf-lib's raw view of a file's encryption dictionary: algorithm, revision and permission flags. */
async function encryption(bytes: Uint8Array): Promise<{ V: number; R: number; P: number } | null> {
  const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const enc = raw.context.lookup(raw.context.trailerInfo.Encrypt);
  if (!(enc instanceof PDFDict)) return null;
  const n = (k: string) => (enc.lookup(PDFName.of(k)) as PDFNumber).asNumber();
  return { V: n("V"), R: n("R"), P: n("P") };
}

const layoutOf = (slug: string, protect?: Protect): Layout => {
  const { layout } = readLayout(slug) as { layout: Layout };
  return protect ? { ...layout, protect } : layout;
};
const IPC: Protect = { algorithm: "AES-128", permissions: { printing: "highResolution", fillingForms: true, contentAccessibility: true } };
const VZP: Protect = { algorithm: "AES-256", permissions: { printing: "highResolution", annotating: true, fillingForms: true, contentAccessibility: true } };

async function open(slug: string, protect?: Protect) {
  const bytes = await buildPdf(layoutOf(slug, protect));
  const r = await readPdf(bytes, { pdfjs: PDFJS, fileName: `${slug}.pdf` });
  const id = (label: string) => {
    const f = r.structure?.fields.find((x) => x.label === label);
    if (!f) throw new Error(`no field ${label}`);
    return f.fieldId;
  };
  return { bytes, r, id };
}

describe("a PDF its author protected, with filling allowed", () => {
  it("is read like the same form unprotected: the same fields, labels and fingerprint, and says it is protected", async () => {
    for (const [slug, protect] of [["zadost-pobyt", IPC], ["prihlaska-pojistence", VZP]] as const) {
      const plain = await open(slug);
      const prot = await open(slug, protect);
      expect(await encryption(prot.bytes), slug).not.toBeNull();
      expect(prot.r.problem, slug).toBeUndefined();
      expect(prot.r.protected, slug).toBe(true);
      expect(plain.r.protected, slug).toBeUndefined();
      expect(prot.r.structure, slug).toEqual(plain.r.structure);
      expect(prot.r.structure?.fingerprint).toBe(await fingerprint("pdf://local/", plain.r.structure!.fields));
    }
  });

  it("its filled copy is encrypted again with the same permissions, and both parsers read the Czech answer from it", async () => {
    for (const [slug, protect, label, field] of [["zadost-pobyt", IPC, "Příjmení", "Pole1"], ["prihlaska-pojistence", VZP, "Příjmení", "form1[0].#subform[0].TextField1[0]"]] as const) {
      const { bytes, r, id } = await open(slug, protect);
      const copy = bytes.slice();
      const out = await fillPdf(bytes, r, { [id(label)]: "Řezníčková-Ševčenko" }, fontBytes());
      expect(out.failed, slug).toEqual([]);
      // The person's file is untouched.
      expect(Buffer.from(bytes).equals(Buffer.from(copy))).toBe(true);
      // Same algorithm, same flags; a plain open is refused, as for the original.
      const was = await encryption(bytes);
      const now = await encryption(out.bytes);
      expect(now, slug).toEqual(was);
      await expect(PDFDocument.load(out.bytes)).rejects.toBeInstanceOf(EncryptedPDFError);
      // pdf.js opens it with no password, sees the same permissions, the value and its drawing.
      expect(await protectionSeenByPdfJs(out.bytes)).toEqual(await protectionSeenByPdfJs(bytes));
      const seen = (await seenByPdfJs(out.bytes)).get(field);
      expect(seen?.value, slug).toBe("Řezníčková-Ševčenko");
      expect(seen?.shown, slug).toBe("Řezníčková-Ševčenko");
      // And Distill reads it back, from the protected copy, as the wizard shows it.
      expect((await readPdfValues(out.bytes, r))[id(label)]).toBe("Řezníčková-Ševčenko");
      // Reading the copy again gives the same form, still protected.
      const again = await readPdf(out.bytes, { pdfjs: PDFJS });
      expect(again.protected).toBe(true);
      expect(again.structure).toEqual(r.structure);
    }
  });

  it("each copy gets its own random owner password: two saves of the same answers differ in their encryption", async () => {
    const { bytes, r, id } = await open("zadost-pobyt", IPC);
    const a = await fillPdf(bytes, r, { [id("Jméno")]: "Olena" }, fontBytes());
    const b = await fillPdf(bytes, r, { [id("Jméno")]: "Olena" }, fontBytes());
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(false);
  });

  it("a weak (RC4) original is protected again with AES-128 and the same flags: Distill writes no broken cipher", async () => {
    const layout = layoutOf("zadost-pobyt");
    const doc = await PDFDocument.load(await buildPdf(layout));
    doc.encrypt({ ownerPassword: "author", userPassword: "", algorithm: "RC4-128", allowWeakCryptography: true, permissions: { printing: "highResolution", fillingForms: true, contentAccessibility: true } });
    const bytes = await doc.save();
    const r = await readPdf(bytes, { pdfjs: PDFJS });
    expect(r.protected).toBe(true);
    const id = r.structure!.fields.find((f) => f.label === "Jméno")!.fieldId;
    const out = await fillPdf(bytes, r, { [id]: "Huong" }, fontBytes());
    expect(out.failed).toEqual([]);
    const was = (await encryption(bytes))!;
    const now = (await encryption(out.bytes))!;
    expect(was).toMatchObject({ V: 2, R: 3 });
    expect(now).toEqual({ V: 4, R: 4, P: was.P });
    expect((await seenByPdfJs(out.bytes)).get("Pole2")?.value).toBe("Huong");
  });

  it("the values a protected file holds never reach its structure, page model or a cloud-eligible prompt", async () => {
    const { bytes, r } = await open("prohlaseni-poplatnika", VZP);
    const { prefilled } = readLayout("prohlaseni-poplatnika") as { prefilled: string[] };
    expect(r.protected).toBe(true);
    expect(prefilled.length).toBeGreaterThan(0);
    const s = r.structure as FormStructure;
    for (const v of [...prefilled, "Zqxvbrt", "27082440"]) {
      expect(JSON.stringify(s)).not.toContain(v);
      expect(JSON.stringify(r.page)).not.toContain(v);
      expect(prompts.buildWizard(s, "en")).not.toContain(v);
    }
    expect(Object.values(await readPdfValues(bytes, r))).toContain("27082440"); // device-only, and it is there
  });
});

describe("a protected PDF Distill does not fill", () => {
  it("permissions that forbid filling in forms: refused with the plain-words reason, never filled", async () => {
    const bytes = await buildPdf(layoutOf("zadost-pobyt", { algorithm: "AES-128", permissions: { printing: "highResolution", contentAccessibility: true } }));
    const r = await readPdf(bytes, { pdfjs: PDFJS });
    expect(r.problem?.kind).toBe("encrypted");
    expect(r.structure).toBeUndefined();
    expect(r.page.blocks.map((b) => b.text).join(" ")).toContain("Žádost o prodloužení dlouhodobého pobytu");
    // Even handed a reading from elsewhere, fillPdf gives no bytes for it.
    const open = await readPdf(await buildPdf(layoutOf("zadost-pobyt")), { pdfjs: PDFJS });
    await expect(fillPdf(bytes, open as PdfReading, { [open.structure!.fields[0]!.fieldId]: "x" }, fontBytes())).rejects.toBeInstanceOf(ProtectionError);
  });

  it("a password to open it: rejected before anything is read, even when it would permit filling", async () => {
    const bytes = await buildPdf(layoutOf("zadost-pobyt", { ...IPC, userPassword: "open-me" }));
    const err = await readPdf(bytes, { pdfjs: PDFJS }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfOpenError);
    expect((err as PdfOpenError).problem.kind).toBe("password");
  });

  it("reads the permission flags as the standard defines them, revision 2 included", () => {
    const p = (P: number, r = 4) => ({ filter: "Standard", v: 4, r, p: P });
    expect(fillAllowed(p(-1084))).toBe(true); // ipc.gov.cz: print, fill, accessibility, high-quality print
    expect(fillAllowed(p(-1052))).toBe(true); // VZP: the same plus annotations
    expect(fillAllowed(p(-3904 | 32))).toBe(true); // annotations alone also allow filling
    expect(fillAllowed(p(-3904 | 4))).toBe(false); // print only
    expect(fillAllowed(p(-64 | 32, 2))).toBe(true); // revision 2: bit 6
    expect(fillAllowed(p(-64 | 4 | 256, 2))).toBe(false); // revision 2 has no bit 9
    expect(permissionsOf(p(-1084))).toEqual({ printing: "highResolution", modifying: false, copying: false, annotating: false, fillingForms: true, contentAccessibility: true, documentAssembly: false });
  });
});
