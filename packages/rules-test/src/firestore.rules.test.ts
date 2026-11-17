// firestore.rules, evaluated by the real rules engine (the Firestore emulator), not read as text. The rules are the only
// authorization door: there is no server. Every case below is a request the emulator answers allow or deny.
// Run from the repo root: `npm run test:rules` (firebase emulators:exec starts the emulator and sets its host).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PROJECT = "demo-distill"; // a demo- project never reaches a real Firebase project

let env: RulesTestEnvironment;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("No Firestore emulator. Run `npm run test:rules` from the repo root (it needs Java 21 on PATH or JAVA_HOME).");
  }
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(resolve(root, "firestore.rules"), "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const alice = () => env.authenticatedContext("alice").firestore();
const bob = () => env.authenticatedContext("bob").firestore();
const anon = () => env.unauthenticatedContext().firestore();

/** Writes a document with the rules switched off, so reads and updates have something to act on. */
async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx: RulesTestContext) => { await ctx.firestore().doc(path).set(data); });
}

const long = (n: number) => "x".repeat(n);

const SETTINGS = { readingLevel: "plain", readerLang: "en", recastEnabled: true };
const TERM = { term: "trvalý pobyt", plain: "permanent residence", lang: "cs" };

const FP = "0123456789abcdef".repeat(4); // 64 lowercase hex, like packages/engine/src/fingerprint.ts
function guide(fp = FP) {
  return {
    structure: {
      fingerprint: fp,
      url: "https://example.cz/form",
      lang: "cs",
      title: "Žádost",
      fields: [{ fieldId: "f1", kind: "text", label: "Jméno", required: true }],
    },
    wizard: {
      fingerprint: fp,
      readerLang: "en",
      steps: [{ stepId: "f1", fieldIds: ["f1"], question: "What is your first name?", explanation: "As in your passport." }],
    },
    updatedAt: "2026-11-17T10:00:00.000Z",
  };
}
type Guide = ReturnType<typeof guide>;
const withGuide = (edit: (g: Guide) => void) => { const g = guide(); edit(g); return g; };
const guidePath = (fp = FP, uid = "alice") => `users/${uid}/formGuides/${fp}`;

describe("users/{uid} settings", () => {
  it("lets the owner create, read, update and delete their own settings", async () => {
    await assertSucceeds(alice().doc("users/alice").set(SETTINGS));
    await assertSucceeds(alice().doc("users/alice").get());
    await assertSucceeds(alice().doc("users/alice").update({ readingLevel: "standard" }));
    await assertSucceeds(alice().doc("users/alice").delete());
  });

  it("refuses another uid and a signed-out visitor, for reads and writes", async () => {
    await seed("users/alice", SETTINGS);
    for (const db of [bob(), anon()]) {
      await assertFails(db.doc("users/alice").get());
      await assertFails(db.doc("users/alice").set(SETTINGS));
      await assertFails(db.doc("users/alice").delete());
    }
  });

  it("refuses a values key, an unknown key and out-of-range fields", async () => {
    const db = alice();
    await assertFails(db.doc("users/alice").set({ ...SETTINGS, values: { name: "Alice" } }));
    await assertFails(db.doc("users/alice").set({ ...SETTINGS, nickname: "A" }));
    await assertFails(db.doc("users/alice").set({ ...SETTINGS, readingLevel: "expert" }));
    await assertFails(db.doc("users/alice").set({ ...SETTINGS, readerLang: long(17) }));
    await assertFails(db.doc("users/alice").set({ ...SETTINGS, recastEnabled: "yes" }));
  });
});

describe("users/{uid}/glossary", () => {
  it("lets the owner write, read, list and delete their own terms", async () => {
    const db = alice();
    await assertSucceeds(db.doc("users/alice/glossary/t1").set(TERM));
    await assertSucceeds(db.doc("users/alice/glossary/t1").get());
    await assertSucceeds(db.collection("users/alice/glossary").get());
    await assertSucceeds(db.doc("users/alice/glossary/t1").delete());
  });

  it("refuses another uid", async () => {
    await seed("users/alice/glossary/t1", TERM);
    await assertFails(bob().doc("users/alice/glossary/t1").get());
    await assertFails(bob().collection("users/alice/glossary").get());
    await assertFails(bob().doc("users/alice/glossary/t1").set(TERM));
    await assertFails(bob().doc("users/alice/glossary/t1").delete());
  });

  it("refuses a values key and oversize terms", async () => {
    const db = alice();
    await assertFails(db.doc("users/alice/glossary/t1").set({ ...TERM, values: "x" }));
    await assertFails(db.doc("users/alice/glossary/t1").set({ ...TERM, term: long(201) }));
    await assertFails(db.doc("users/alice/glossary/t1").set({ ...TERM, plain: long(1001) }));
    await assertFails(db.doc("users/alice/glossary/t1").set({ ...TERM, lang: long(17) }));
    await assertFails(db.doc(`users/alice/glossary/${long(129)}`).set(TERM));
    // The caps are limits, not off-by-one traps: the largest allowed sizes still pass.
    await assertSucceeds(db.doc(`users/alice/glossary/${long(128)}`).set({ term: long(200), plain: long(1000), lang: long(16) }));
  });
});

describe("users/{uid}/formGuides", () => {
  it("lets the owner write, read and delete their own form guide", async () => {
    const db = alice();
    await assertSucceeds(db.doc(guidePath()).set(guide()));
    await assertSucceeds(db.doc(guidePath()).get());
    await assertSucceeds(db.doc(guidePath()).delete());
  });

  it("refuses another uid", async () => {
    await seed(guidePath(), guide());
    await assertFails(bob().doc(guidePath()).get());
    await assertFails(bob().doc(guidePath()).set(guide()));
    await assertFails(bob().doc(guidePath()).delete());
    await assertFails(anon().doc(guidePath()).get());
  });

  it("refuses a values key at the top, in the structure and in the wizard", async () => {
    const db = alice();
    await assertFails(db.doc(guidePath()).set({ ...guide(), values: { f1: "Alice" } }));
    await assertFails(db.doc(guidePath()).set(withGuide((g) => Object.assign(g.structure, { values: { f1: "Alice" } }))));
    await assertFails(db.doc(guidePath()).set(withGuide((g) => Object.assign(g.wizard, { values: { f1: "Alice" } }))));
  });

  it("refuses a guide whose fingerprints do not match its path, or a path that is not a fingerprint", async () => {
    const db = alice();
    const other = "f".repeat(64);
    await assertFails(db.doc(guidePath(other)).set(guide()));
    await assertFails(db.doc(guidePath()).set(withGuide((g) => { g.wizard.fingerprint = other; })));
    await assertFails(db.doc(guidePath("not-a-fingerprint")).set(guide("not-a-fingerprint")));
    await assertFails(db.doc(guidePath(FP.toUpperCase())).set(guide(FP.toUpperCase())));
  });

  it("refuses unknown keys and oversize documents", async () => {
    const db = alice();
    const field = guide().structure.fields[0];
    const step = guide().wizard.steps[0];
    await assertFails(db.doc(guidePath()).set({ ...guide(), extra: 1 }));
    await assertFails(db.doc(guidePath()).set(withGuide((g) => { g.structure.fields = Array.from({ length: 301 }, () => field!); })));
    await assertFails(db.doc(guidePath()).set(withGuide((g) => { g.wizard.steps = Array.from({ length: 301 }, () => step!); })));
    await assertFails(db.doc(guidePath()).set(withGuide((g) => { g.structure.url = long(2049); })));
    await assertFails(db.doc(guidePath()).set(withGuide((g) => { g.structure.title = long(1001); })));
    await assertFails(db.doc(guidePath()).set(withGuide((g) => { g.structure.lang = long(17); })));
    await assertFails(db.doc(guidePath()).set(withGuide((g) => { g.wizard.readerLang = long(33); })));
    await assertFails(db.doc(guidePath()).set(withGuide((g) => { g.updatedAt = long(41); })));
    // At the caps exactly, the guide is accepted.
    await assertSucceeds(db.doc(guidePath()).set(withGuide((g) => {
      g.structure.fields = Array.from({ length: 300 }, () => field!);
      g.wizard.steps = Array.from({ length: 300 }, () => step!);
      g.structure.url = long(2048);
      g.structure.title = long(1000);
    })));
  });
});

describe("everything else is closed", () => {
  it("closes the old shared top-level formGuides path, even for a signed-in user", async () => {
    await seed(`formGuides/${FP}`, guide());
    await assertFails(alice().doc(`formGuides/${FP}`).get());
    await assertFails(alice().collection("formGuides").get());
    await assertFails(alice().doc(`formGuides/${FP}`).set(guide()));
  });

  it("denies any other path, inside or outside the person's own tree", async () => {
    await assertFails(alice().doc("users/alice/notes/n1").set({ text: "hi" }));
    await assertFails(alice().doc("users/alice/notes/n1").get());
    await assertFails(alice().doc("values/alice").set({ f1: "Alice" }));
    await assertFails(alice().collection("users").get());
  });
});
