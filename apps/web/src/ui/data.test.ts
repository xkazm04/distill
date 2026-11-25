import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormStructure, Wizard } from "@distill/engine";

// Firestore is replaced by a recorder: the test checks which document path each call names, and what is written.
const calls: { fn: string; path: string[]; data?: unknown }[] = [];
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path }),
  getDoc: async (ref: { path: string[] }) => {
    calls.push({ fn: "getDoc", path: ref.path });
    return { exists: () => false, data: () => undefined };
  },
  setDoc: async (ref: { path: string[] }, data: unknown) => {
    calls.push({ fn: "setDoc", path: ref.path, data });
  },
  collection: () => ({}),
  getDocs: async () => ({ docs: [] }),
}));
vi.mock("../firebase", () => ({ getFirebase: async () => ({ db: {}, uid: "person-1" }) }));

const { getFormGuide, saveFormGuide, saveSettings, saveGlossaryTerm, DEFAULT_SETTINGS } = await import("./data");
const { rememberPapers, loadPapers } = await import("./papers");

const structure: FormStructure = { fingerprint: "fp123", url: "https://mv.example/zadost", lang: "cs", title: "Žádost", fields: [] };
const wizard: Wizard = { fingerprint: "fp123", readerLang: "en", steps: [] };

describe("form guides are per person", () => {
  beforeEach(() => { calls.length = 0; });

  it("reads users/{uid}/formGuides/{fingerprint}, never the old shared path", async () => {
    expect(await getFormGuide("fp123")).toBeNull();
    expect(calls).toEqual([{ fn: "getDoc", path: ["users", "person-1", "formGuides", "fp123"] }]);
  });

  it("writes structure and wizard only, under the person's own document", async () => {
    await saveFormGuide(structure, wizard);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toEqual(["users", "person-1", "formGuides", "fp123"]);
    expect(Object.keys(calls[0]?.data as object).sort()).toEqual(["structure", "updatedAt", "wizard"]);
  });

  it("refuses to write a guide that smuggles values", async () => {
    const dirty = { ...structure, values: { jmeno: "Zqxvlenka" } } as unknown as FormStructure;
    await expect(saveFormGuide(dirty, wizard)).rejects.toThrow(/values/);
    expect(calls).toHaveLength(0);
  });
});

// Tiger 2026-11-25, L1: the saved papers live in localStorage only. With papers saved, nothing written to Firestore
// carries one of them.
describe("saved papers never reach Firestore", () => {
  beforeEach(() => { calls.length = 0; localStorage.clear(); });

  it("no Firestore payload carries a saved fact", async () => {
    const form: FormStructure = { ...structure, fields: [
      { fieldId: "prijmeni", kind: "text", label: "Příjmení", required: true },
      { fieldId: "narozeni", kind: "date", label: "Datum narození", required: true },
      { fieldId: "email", kind: "email", label: "E-mail", required: false },
    ] };
    rememberPapers(form, { prijmeni: "Wbrtnovsky", narozeni: "1987-06-19", email: "zqx.wbrt@private.example" }, ["prijmeni", "narozeni", "email"]);
    expect(Object.keys(loadPapers())).toHaveLength(3);
    await saveFormGuide(form, wizard);
    await saveSettings(DEFAULT_SETTINGS);
    await saveGlossaryTerm("t1", { term: "příjmení", plain: "surname", lang: "cs" });
    expect(calls.filter((c) => c.fn === "setDoc")).toHaveLength(3);
    const sent = JSON.stringify(calls);
    for (const canary of ["Wbrtnovsky", "1987-06-19", "private.example"]) expect(sent).not.toContain(canary);
  });
});
