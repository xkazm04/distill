// The guide scripts run end to end on local fixtures, with no network (`--source <address>=<file>` reads a local copy
// in place of an address): guides:review's verdicts and sheet. Every guide here is a made-up test guide in a temporary
// folder, never one of guides/.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { extractForm, type FormGuide, type GuideStep } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const FIX = join(HERE, "fixtures/guide-tools");
const FORM_URL = "https://forms.example.gov/oznameni";
const INSTRUCTIONS_URL = "https://forms.example.gov/pouceni";
const QUOTE = "Uveďte jméno a příjmení podle cestovního dokladu.";

let dirs: string[] = [];
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

function run(script: string, args: string[]) {
  const r = spawnSync(process.execPath, [join(REPO, "scripts", script), ...args], { cwd: REPO, encoding: "utf8", timeout: 90_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

async function testGuide(): Promise<FormGuide> {
  const doc = new DOMParser().parseFromString(readFileSync(join(FIX, "form.html"), "utf8"), "text/html");
  const s = await extractForm(doc, FORM_URL);
  const steps = (l: "en" | "uk"): GuideStep[] => [
    {
      stepId: "name", fieldIds: ["prijmeni", "jmeno"],
      question: l === "en" ? "Your surname and first name" : "Ваше прізвище та ім'я",
      explanation: l === "en" ? "As in your passport." : "Як у паспорті.",
      official: { text: QUOTE, lang: "cs" },
    },
    { stepId: "town", fieldIds: ["obec"], question: l === "en" ? "Your town" : "Ваше місто", explanation: l === "en" ? "Where you live now." : "Де ви живете зараз." },
  ];
  const g: FormGuide = {
    guideVersion: 1, id: "cz/test-oznameni", status: "draft",
    authority: { name: "Testovací úřad", nameEn: "the Test Office" },
    formName: { cs: "Oznámení změny", en: "Report of a change", uk: "Повідомлення про зміну" },
    formLang: "cs", officialFormUrl: FORM_URL, instructionsUrl: INSTRUCTIONS_URL, draftedOn: "2026-11-18",
    match: { format: "html", fingerprints: [s.fingerprint], urls: [FORM_URL], fields: s.fields.map(({ fieldId, kind, label }) => ({ fieldId, kind, label })) },
    wizards: { en: { notes: ["Fill the form in Czech."], steps: steps("en") }, uk: { notes: ["Заповнюйте чеською."], steps: steps("uk") } },
    reviewNotes: ["Test note: check that 5 < 6 & \"quotes\" stay text; the Ukrainian text is machine-written."],
  };
  return g;
}

function library(g: object): string {
  const dir = mkdtempSync(join(tmpdir(), "guide-tools-"));
  dirs.push(dir);
  mkdirSync(join(dir, "cz"));
  writeFileSync(join(dir, "cz", "test-oznameni.json"), JSON.stringify(g, null, 2) + "\n");
  return dir;
}

describe("guides:review (local fixtures, no network)", () => {
  it("finds the quote, writes an escaped sheet with the steps without a quote first, and never touches the guide", async () => {
    const g = await testGuide();
    const dir = library(g);
    const before = readFileSync(join(dir, "cz", "test-oznameni.json"), "utf8");
    const out = join(dir, "out");
    const r = run("guides/review.mjs", ["--dir", dir, "--out", out, "--source", `${INSTRUCTIONS_URL}=${join(FIX, "instructions.html")}`, "cz/test-oznameni"]);
    expect(r.out).toContain("found      step name (en, uk)");
    expect(r.out).toContain("1/1 quotes found word for word (0 not found, 0 could not be read); 1 step(s) make claims with no quote: town");
    expect(r.code).toBe(0);
    const html = readFileSync(join(out, "cz", "test-oznameni.html"), "utf8");
    expect(html).toContain("This sheet does not review anything: a person decides. A found quote only proves the words exist.");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("check that 5 &lt; 6 &amp; &quot;quotes&quot; stay text");
    expect(html).toContain(`<mark>${QUOTE}</mark>`);
    expect(html.indexOf('id="step-town"')).toBeLessThan(html.indexOf('id="step-name"'));
    expect(html).toContain("review(guides): cz/test-oznameni checked against forms.example.gov instructions by &lt;your name&gt;");
    expect(readFileSync(join(dir, "cz", "test-oznameni.json"), "utf8")).toBe(before);
  }, 120_000);

  it("a quote the instructions no longer hold is NOT FOUND (exit 1); a source that cannot be read is never found (exit 2)", async () => {
    const dir = library(await testGuide());
    const out = join(dir, "out");
    const edited = run("guides/review.mjs", ["--dir", dir, "--out", out, "--source", `${INSTRUCTIONS_URL}=${join(FIX, "instructions-edited.html")}`, "cz/test-oznameni"]);
    expect(edited.out).toContain("NOT FOUND  step name (en, uk)");
    expect(edited.code).toBe(1);
    const missing = run("guides/review.mjs", ["--dir", dir, "--out", out, "--source", `${INSTRUCTIONS_URL}=${join(FIX, "no-such-file.html")}`, "cz/test-oznameni"]);
    expect(missing.out).toContain("UNREADABLE step name (en, uk)");
    expect(missing.out).toContain("0/1 quotes found word for word (0 not found, 1 could not be read)");
    expect(missing.code).toBe(2);
    expect(existsSync(join(out, "cz", "test-oznameni.html"))).toBe(true);
  }, 120_000);
});
