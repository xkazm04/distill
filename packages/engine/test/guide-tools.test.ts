// The guide scripts run end to end on local fixtures, with no network (`--source <address>=<file>` reads a local copy
// in place of an address): guides:review's verdicts and sheet, and check-guides' text lock on a reviewed guide
// through guide:new --refresh, and guides:drift's check of the instructions. Every guide here is a made-up test guide in a temporary
// folder, never one of guides/.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { extractForm, fingerprint, guideTextDigest, type FormGuide, type GuideMatch, type GuideStep } from "../src/index.js";

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

/** A reviewed test guide over what guide:new reads from the fixture form, with every label as an older reader would
 *  have read it (so a refresh changes labels only). Its reviewer is a made-up fixture name. */
async function reviewedFromSkeleton(dir: string): Promise<FormGuide> {
  const made = run("guides/new.mjs", ["--dir", dir, "--id", "cz/test-oznameni", "--as", FORM_URL, join(FIX, "form.html")]);
  expect(made.code, made.out).toBe(0);
  const skeleton = JSON.parse(readFileSync(join(dir, "cz", "test-oznameni.json"), "utf8")) as FormGuide;
  const fields = skeleton.match.fields.map((f) => ({ ...f, label: `${f.label} (old reader)` }));
  const match: GuideMatch = { ...skeleton.match, fields, fingerprints: [await fingerprint(FORM_URL, fields.map((f) => ({ ...f, required: false })))] };
  const g: FormGuide = { ...(await testGuide()), match, status: "reviewed", reviewer: "Test Reviewer (fixture)", reviewedOn: "2026-11-20", reviewedLangs: ["en", "uk"] };
  delete g.reviewNotes;
  g.reviewedText = guideTextDigest(g, g.reviewedLangs);
  return g;
}

describe("check-guides: the text lock on a reviewed guide (local fixtures, no network)", () => {
  it("one changed word of a step fails check-guides; guide:new --refresh on the same form keeps the review and passes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guide-tools-"));
    dirs.push(dir);
    mkdirSync(join(dir, "cz"));
    const g = await reviewedFromSkeleton(dir);
    const file = join(dir, "cz", "test-oznameni.json");
    const write = (x: FormGuide) => writeFileSync(file, JSON.stringify(x, null, 2) + "\n");
    write(g);
    const clean = run("check-guides.mjs", [dir]);
    expect(clean.out).toContain("1 reviewed");
    expect(clean.code).toBe(0);

    const edited = JSON.parse(JSON.stringify(g)) as FormGuide;
    edited.wizards.en.steps[1]!.explanation = "Where you lived before.";
    write(edited);
    const locked = run("check-guides.mjs", [dir]);
    expect(locked.out).toContain("the checked text changed since the review");
    expect(locked.code).toBe(1);

    write(g);
    const refresh = run("guides/new.mjs", ["--dir", dir, "--refresh", "cz/test-oznameni", join(FIX, "form.html")]);
    expect(refresh.out).toContain("3 label(s) changed; status reviewed");
    expect(refresh.code).toBe(0);
    const after = JSON.parse(readFileSync(file, "utf8")) as FormGuide;
    expect(after.match.fields.some((f) => f.label.includes("old reader"))).toBe(false);
    expect(after.reviewer).toBe("Test Reviewer (fixture)");
    expect(after.reviewedText).toBe(g.reviewedText);
    const still = run("check-guides.mjs", [dir]);
    expect(still.out).toContain("1 reviewed");
    expect(still.code).toBe(0);
  }, 180_000);
});

describe("check-guides: per-language sign-off (local fixtures, no network)", () => {
  it("requires reviewedLangs; signed off for English only, a Ukrainian change passes and an English change fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guide-tools-"));
    dirs.push(dir);
    mkdirSync(join(dir, "cz"));
    const base = await reviewedFromSkeleton(dir);
    const file = join(dir, "cz", "test-oznameni.json");
    const write = (x: object) => writeFileSync(file, JSON.stringify(x, null, 2) + "\n");

    const noLangs = { ...base } as Partial<FormGuide>;
    delete noLangs.reviewedLangs;
    write(noLangs);
    const missing = run("check-guides.mjs", [dir]);
    expect(missing.out).toContain("lists the languages its reviewer signed off in reviewedLangs");
    expect(missing.code).toBe(1);

    const en: FormGuide = { ...base, reviewer: "Test Reviewer (fixture) (cs, en)", reviewedLangs: ["en"] };
    en.reviewedText = guideTextDigest(en, ["en"]);
    const uk = JSON.parse(JSON.stringify(en)) as FormGuide;
    uk.wizards.uk.steps[1]!.explanation = "Де ви живете тепер.";
    write(uk);
    const ukChange = run("check-guides.mjs", [dir]);
    expect(ukChange.out).toContain("1 reviewed");
    expect(ukChange.code).toBe(0);
    const enChange = JSON.parse(JSON.stringify(en)) as FormGuide;
    enChange.wizards.en.steps[1]!.explanation = "Where you live today.";
    write(enChange);
    const locked = run("check-guides.mjs", [dir]);
    expect(locked.out).toContain("the checked text changed since the review");
    expect(locked.code).toBe(1);
  }, 180_000);
});

describe("guides:drift watches the instructions (local fixtures, no network)", () => {
  it("the form unchanged and the quoted sentence edited: the form line is ok, a new line names the step, exit 1", async () => {
    const dir = library(await testGuide());
    const form = `${FORM_URL}=${join(FIX, "form.html")}`;
    const same = run("guides/drift.mjs", ["--dir", dir, "--source", form, "--source", `${INSTRUCTIONS_URL}=${join(FIX, "instructions.html")}`]);
    expect(same.out).toContain(`ok cz/test-oznameni: ${FORM_URL} matches`);
    expect(same.out).toContain("ok cz/test-oznameni: instructions hold all 1 quote(s) word for word");
    expect(same.code).toBe(0);

    const edited = run("guides/drift.mjs", ["--dir", dir, "--source", form, "--source", `${INSTRUCTIONS_URL}=${join(FIX, "instructions-edited.html")}`]);
    expect(edited.out).toContain(`ok cz/test-oznameni: ${FORM_URL} matches`);
    expect(edited.out).toContain(`!  cz/test-oznameni: step name (en, uk): the quoted sentence is no longer in ${INSTRUCTIONS_URL}: "${QUOTE}"`);
    expect(edited.out).toContain("0 drifted or cannot be told, 0 read differently by a newer reader only, 1 quote(s) no longer in the instructions, 0 could not be read");
    expect(edited.code).toBe(1);

    const unread = run("guides/drift.mjs", ["--dir", dir, "--source", form, "--source", `${INSTRUCTIONS_URL}=${join(FIX, "no-such-file.html")}`]);
    expect(unread.out).toContain(`?  cz/test-oznameni: instructions ${INSTRUCTIONS_URL} could not be read`);
    expect(unread.code).toBe(2);
  }, 180_000);
});
