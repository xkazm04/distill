/// <reference types="node" />
// PDFs Distill must refuse to fill, and say why: built here, in the test run, like the fillable fixtures. Each one is
// made the way such files are made in the wild (as far as a small synthetic file can be), not by setting a flag that
// only Distill reads: an XFA stream in the AcroForm, real encryption (pdf-lib's own encrypt), a signed signature field.
import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import type { PdfProblemKind } from "../../src/index.js";
import { buildPdf, type Layout } from "./build.js";

const form = (): Layout => ({
  pages: [{
    text: [{ at: [50, 790], size: 16, text: "Žádost o vydání potvrzení" }, { at: [50, 712], text: "Příjmení:" }],
    fields: [{ type: "text", name: "Text1", rect: [150, 706, 250, 18] }],
  }],
});

const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
<subform name="form1" layout="tb" locale="cs_CZ"><pageSet><pageArea name="Page1"><contentArea x="0.25in" y="0.25in" w="8in" h="10.5in"/>
<medium stock="a4" short="210mm" long="297mm"/></pageArea></pageSet>
<subform name="page1" w="8in"><field name="Prijmeni" w="80mm" h="9mm"><ui><textEdit/></ui><caption><value><text>Příjmení</text></value></caption></field></subform>
</subform></template><xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data/></xfa:datasets></xdp:xdp>`;

/** Puts an XFA stream into the AcroForm of finished bytes (pdf-lib keeps it only when told to preserve it). */
async function withXfa(bytes: Uint8Array, dynamic: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { preserveXFA: true });
  const acro = doc.catalog.getOrCreateAcroForm();
  acro.dict.set(PDFName.of("XFA"), doc.context.register(doc.context.flateStream(XDP)));
  if (dynamic) {
    // Dynamic XFA: nothing but the XFA describes the form; the PDF page is a "please wait" placeholder.
    acro.dict.set(PDFName.of("Fields"), doc.context.obj([]));
    doc.catalog.set(PDFName.of("NeedsRendering"), doc.context.obj(true));
  }
  return doc.save();
}

export interface Refusal { slug: string; models: string; want: PdfProblemKind; build: () => Promise<Uint8Array> }

export const REFUSALS: Refusal[] = [
  {
    slug: "flat-scan", want: "flat", models: "A form made for printing: printed text and lines to write on, no fields.",
    build: async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([595, 842]);
      const f = await doc.embedFont(StandardFonts.Helvetica);
      page.drawText("Zadost o vydani potvrzeni", { x: 50, y: 790, size: 16, font: f });
      page.drawText("Prijmeni: ..............................................", { x: 50, y: 712, size: 10, font: f });
      return doc.save();
    },
  },
  {
    slug: "xfa-dynamic", want: "xfa", models: "A dynamic XFA form: the AcroForm holds an XFA stream and no fields; the page is a placeholder.",
    build: async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([595, 842]);
      page.drawText("Please wait... If this message is not eventually replaced, your viewer cannot show this form.", { x: 30, y: 790, size: 9, font: await doc.embedFont(StandardFonts.Helvetica) });
      doc.getForm();
      return withXfa(await doc.save(), true);
    },
  },
  {
    slug: "xfa-static", want: "xfa", models: "A static (hybrid) XFA form: real AcroForm fields, and an XFA stream that Adobe Reader shows instead of them.",
    build: async () => withXfa(await buildPdf(form()), false),
  },
  {
    slug: "encrypted", want: "encrypted", models: "Encrypted with an owner password only, permissions that forbid filling in forms (and annotating, which would also allow it): it opens and shows, but its author did not allow filling it. Protected files that do allow filling are fillable fixtures (*-chraneny, *-chranena).",
    build: async () => {
      const doc = await PDFDocument.load(await buildPdf(form()));
      doc.encrypt({ userPassword: "", ownerPassword: "owner-only-9f3", permissions: { printing: "highResolution", modifying: false, annotating: false, fillingForms: false } });
      return doc.save();
    },
  },
  {
    slug: "password", want: "password", models: "Encrypted with a password to open it, and permissions that would allow filling: a file that needs a password is not opened, whatever it permits.",
    build: async () => {
      const doc = await PDFDocument.load(await buildPdf(form()));
      doc.encrypt({ userPassword: "open-me-7c1", ownerPassword: "owner-7c1", permissions: { printing: "highResolution", fillingForms: true, contentAccessibility: true } });
      return doc.save();
    },
  },
  {
    slug: "signed", want: "locked", models: "A form with a signed signature field (SigFlags 3): rewriting it would break the signature.",
    build: async () => {
      const doc = await PDFDocument.load(await buildPdf(form()));
      const ctx = doc.context;
      const page = doc.getPage(0);
      const sig = ctx.register(ctx.obj({
        Type: "Sig", Filter: "Adobe.PPKLite", SubFilter: "adbe.pkcs7.detached", ByteRange: [0, 0, 0, 0],
        Contents: PDFHexString.of("00".repeat(256)), M: PDFString.of("D:20261101000000Z"), Name: PDFHexString.fromText("Úředník"),
      }));
      const widget = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Widget", FT: "Sig", T: PDFHexString.fromText("Podpis"), Rect: [300, 100, 500, 140], F: 4, V: sig, P: page.ref }));
      page.node.addAnnot(widget);
      const acro = doc.catalog.getOrCreateAcroForm();
      acro.addField(widget);
      acro.dict.set(PDFName.of("SigFlags"), PDFNumber.of(3));
      return doc.save();
    },
  },
];
