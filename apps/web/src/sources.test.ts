import { describe, expect, it } from "vitest";
import { MAX_PDF_BYTES, readPdfFile } from "./sources";

const file = (text: string, name = "zadost.pdf") => new File([text], name, { type: "application/pdf" });

describe("opening a PDF from this device", () => {
  it("reads a PDF into memory and keeps its name for the screen", async () => {
    const pdf = await readPdfFile(file("%PDF-1.7\n%âãÏÓ\n1 0 obj<<>>endobj\n%%EOF"));
    expect(pdf.name).toBe("zadost.pdf");
    expect(new TextDecoder().decode(pdf.bytes.subarray(0, 8))).toBe("%PDF-1.7");
  });

  it("says in plain words when the file is not a PDF", async () => {
    await expect(readPdfFile(file("<html>hello</html>", "page.html"))).rejects.toThrow("This file is not a PDF. Choose a PDF form.");
  });

  it("says in plain words when the file is too large, before reading it", async () => {
    const big = { size: MAX_PDF_BYTES + 1, name: "big.pdf", arrayBuffer: () => { throw new Error("read"); } } as unknown as File;
    await expect(readPdfFile(big)).rejects.toThrow("This file is larger than 50 MB.");
  });
});
