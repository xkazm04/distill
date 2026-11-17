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

const { getFormGuide, saveFormGuide } = await import("./data");

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
