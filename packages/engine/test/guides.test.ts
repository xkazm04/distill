// The guide library's engine: the door a guide file passes (parseGuide), which guide fits the form on screen
// (matchGuide), and the steps a person sees when the form changed since the guide was written (guideWizard,
// mergeWizards).
import { describe, expect, it } from "vitest";
import {
  fingerprint, guideSignedFor, guideTextDigest, guideWizard, matchGuide, mergeWizards, narrowStructure, parseGuide, parseLibrary, GUIDE_MIN_OVERLAP,
  type FieldStructure, type FormGuide, type FormStructure, type GuideStep, type Wizard,
} from "../src/index.js";

const URL_NEW = "https://ipc.gov.cz/formular/zmena";
const URL_OLD = "https://www.mvcr.cz/formular/zmena";

const FIELDS: FieldStructure[] = [
  { fieldId: "prijmeni", kind: "text", label: "Příjmení", required: true },
  { fieldId: "jmeno", kind: "text", label: "Jméno", required: true },
  { fieldId: "narozeni", kind: "date", label: "Datum narození", required: true },
  { fieldId: "ulice", kind: "text", label: "Ulice", required: true },
  { fieldId: "obec", kind: "text", label: "Obec", required: true },
  { fieldId: "psc", kind: "text", label: "PSČ", required: false },
];

const steps = (lang: "en" | "uk"): GuideStep[] => [
  {
    stepId: "name", fieldIds: ["prijmeni", "jmeno"],
    question: lang === "en" ? "Your surname and first name" : "Ваше прізвище та ім'я",
    explanation: lang === "en" ? "As in your passport." : "Як у паспорті.",
    official: { text: "Uveďte jméno a příjmení podle cestovního dokladu.", lang: "cs" },
  },
  { stepId: "birth", fieldIds: ["narozeni"], question: lang === "en" ? "Date of birth" : "Дата народження", explanation: "DD.MM.RRRR", expectedFormat: "DD.MM.YYYY" },
  { stepId: "address", fieldIds: ["ulice", "obec", "psc"], question: lang === "en" ? "Your new address" : "Нова адреса", explanation: lang === "en" ? "Where you live now." : "Де ви живете зараз." },
];

async function guide(over: Partial<FormGuide> = {}): Promise<FormGuide> {
  const g: FormGuide = {
    guideVersion: 1,
    id: "cz/zmena-adresy",
    status: "reviewed",
    authority: { name: "Ministerstvo vnitra", nameEn: "the Ministry of the Interior" },
    formName: { cs: "Oznámení změny adresy", en: "Change of address", uk: "Повідомлення про зміну адреси" },
    formLang: "cs",
    officialFormUrl: "https://ipc.gov.cz/formular/zmena.pdf",
    instructionsUrl: "https://ipc.gov.cz/navod",
    draftedOn: "2026-11-18",
    reviewer: "Jana Testová",
    reviewedOn: "2026-11-20",
    match: { format: "html", fingerprints: [await fingerprint(URL_NEW, FIELDS)], urls: [URL_NEW, URL_OLD], fields: FIELDS.map(({ fieldId, kind, label }) => ({ fieldId, kind, label })) },
    wizards: { en: { notes: ["Fill the form in Czech."], steps: steps("en") }, uk: { notes: ["Заповнюйте форму чеською."], steps: steps("uk") } },
    ...over,
  };
  // A reviewed test guide carries the text lock of its own text, as the review commit would.
  if (g.status === "reviewed" && !("reviewedLangs" in over)) g.reviewedLangs = ["en", "uk"];
  if (g.status === "reviewed" && !("reviewedText" in over)) g.reviewedText = guideTextDigest(g, g.reviewedLangs);
  return g;
}

async function form(fields: FieldStructure[] = FIELDS, url = URL_NEW): Promise<FormStructure> {
  return { fingerprint: await fingerprint(url, fields), url, lang: "cs", title: "Oznámení", fields };
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("parseGuide: the door for a guide file", () => {
  it("a complete reviewed guide passes as written", async () => {
    const g = await guide();
    const r = parseGuide(clone(g), { id: "cz/zmena-adresy" });
    expect(r.problems).toEqual([]);
    expect(r.guide).toEqual(g);
  });

  it("refuses HTML, script addresses, unknown keys and kinds, and fields that do not exist", async () => {
    const cases: [string, (g: FormGuide & Record<string, unknown>) => void, RegExp][] = [
      ["html", (g) => { g.wizards.en.steps[0]!.explanation = "As in your <b>passport</b>."; }, /would not pass the door/],
      ["entity", (g) => { g.wizards.en.steps[0]!.question = "Name &amp; surname"; }, /would not pass the door/],
      ["script", (g) => { g.wizards.uk.steps[1]!.example = "javascript:alert(1)"; }, /script address/],
      ["unknown key", (g) => { (g.wizards.en.steps[0] as unknown as Record<string, unknown>).explaination = "x"; }, /unknown key "explaination"/],
      ["unknown top key", (g) => { g.verified = true; }, /unknown key "verified"/],
      ["kind", (g) => { (g.match.fields[0] as { kind: string }).kind = "signature"; }, /not a field kind/],
      ["missing field", (g) => { g.wizards.en.steps[0]!.fieldIds = ["prijmeni", "nope"]; }, /"nope" is not a field/],
      ["uncovered", (g) => { g.wizards.en.steps[2]!.fieldIds = ["ulice", "obec"]; g.wizards.uk.steps[2]!.fieldIds = ["ulice", "obec"]; }, /no step covers the field "psc"/],
      ["two steps", (g) => { g.wizards.en.steps[1]!.fieldIds = ["narozeni", "jmeno"]; }, /already in an earlier step/],
      ["order", (g) => { for (const l of ["en", "uk"] as const) g.wizards[l].steps.reverse(); }, /not in the form's field order/],
      ["parallel", (g) => { g.wizards.uk.steps[0]!.stepId = "jmena"; }, /wizards differ/],
      ["uk missing", (g) => { delete (g.wizards as Record<string, unknown>).uk; }, /wizards\.uk is missing/],
      ["other language", (g) => { (g.wizards as Record<string, unknown>).de = g.wizards.en; }, /carries en and uk only/],
      ["http", (g) => { g.instructionsUrl = "http://ipc.gov.cz/navod"; }, /instructionsUrl must be an https address/],
      ["date", (g) => { g.reviewedOn = "2026-02-30"; }, /reviewedOn, a date/],
      ["drafted date", (g) => { g.draftedOn = "18.11.2026"; }, /draftedOn must be a date/],
      ["query", (g) => { g.match.urls = ["https://ipc.gov.cz/formular/zmena?id=1"]; }, /no query or fragment/],
      ["fingerprint", (g) => { g.match.fingerprints = ["abc"]; }, /sha-256/],
      ["pdf with urls", (g) => { g.match.format = "pdf"; }, /match\.urls is for web forms only/],
      ["id", (g) => { g.id = "cz/jina"; }, /file is cz\/zmena-adresy\.json/],
    ];
    for (const [name, change, why] of cases) {
      const g = clone(await guide()) as FormGuide & Record<string, unknown>;
      change(g);
      const r = parseGuide(g, { id: "cz/zmena-adresy" });
      expect(r.guide, name).toBeNull();
      expect(r.problems.join("\n"), name).toMatch(why);
    }
  });

  it("a reviewed guide names its reviewer and date and has no open review notes; a draft names neither", async () => {
    const noReviewer = clone(await guide()) as Partial<FormGuide>;
    delete noReviewer.reviewer;
    expect(parseGuide(noReviewer).problems.join()).toMatch(/reviewer must be text/);
    const noDate = clone(await guide()) as Partial<FormGuide>;
    delete noDate.reviewedOn;
    expect(parseGuide(noDate).problems.join()).toMatch(/needs reviewedOn/);
    expect(parseGuide(await guide({ reviewNotes: ["uk not checked"] })).problems.join()).toMatch(/no open reviewNotes/);
    expect(parseGuide(await guide({ reviewedOn: "2026-11-01" })).problems.join()).toMatch(/before draftedOn/);

    const draft = await guide({ status: "draft", reviewNotes: ["The Ukrainian text is machine-written."] });
    expect(parseGuide(draft).problems.join()).toMatch(/a draft names no reviewer/);
    delete draft.reviewer; delete draft.reviewedOn;
    expect(parseGuide(draft).problems).toEqual([]);
  });

  it("a demo guide is a draft, matched by path", async () => {
    const demo = clone(await guide({ status: "draft", demo: true })) as Partial<FormGuide>;
    delete demo.reviewer; delete demo.reviewedOn;
    demo.match!.urls = ["/demo/form.html"];
    expect(parseGuide(demo).problems).toEqual([]);
    expect(parseGuide({ ...demo, status: "reviewed", reviewer: "X", reviewedOn: "2026-11-20" }).problems.join()).toMatch(/demo guide is never reviewed/);
    // A path is for the demo guide only.
    expect(parseGuide(await guide({ match: { ...(await guide()).match, urls: ["/demo/form.html"] } })).problems.join()).toMatch(/must be an https address/);
  });

  it("a guide may record the reader that read its fields and the source it read; both are checked", async () => {
    const g = await guide();
    const source = "a".repeat(64);
    expect(parseGuide({ ...g, match: { ...g.match, reader: "html/1", source } }).problems).toEqual([]);
    expect(parseGuide({ ...g, match: { ...g.match, reader: "pdf/2" } }).problems.join()).toMatch(/is not a reader of html forms/);
    expect(parseGuide({ ...g, match: { ...g.match, reader: "html" } }).problems.join()).toMatch(/must look like "pdf\/2"/);
    expect(parseGuide({ ...g, match: { ...g.match, source: "abc" } }).problems.join()).toMatch(/sha-256/);
  });

  it("the text lock: a reviewed guide carries reviewedText, and any change to the checked text refuses it", async () => {
    const g = await guide();
    expect(g.reviewedText).toMatch(/^[0-9a-f]{64}$/);
    expect(guideTextDigest(clone(g))).toBe(g.reviewedText);
    const changes: [string, (x: FormGuide) => void][] = [
      ["one word of an English step", (x) => { x.wizards.en.steps[0]!.explanation = "As in your ID card."; }],
      ["one word of a Ukrainian step", (x) => { x.wizards.uk.steps[2]!.question = "Ваша адреса"; }],
      ["a note", (x) => { x.wizards.en.notes = ["Fill the form in English."]; }],
      ["a quote", (x) => { x.wizards.en.steps[0]!.official!.text = "Uveďte jméno podle cestovního dokladu."; }],
      ["an example added", (x) => { x.wizards.en.steps[2]!.example = "Nová 1, Praha"; }],
      ["a field kind", (x) => { x.match.fields[3]!.kind = "textarea"; }],
    ];
    for (const [name, change] of changes) {
      const x = clone(g);
      change(x);
      expect(guideTextDigest(x), name).not.toBe(g.reviewedText);
      expect(parseGuide(x).problems.join("\n"), name).toMatch(/checked text changed since the review/);
    }
    const noLock = clone(g) as Partial<FormGuide>;
    delete noLock.reviewedText;
    expect(parseGuide(noLock).problems.join()).toMatch(/needs reviewedText/);
    expect(parseGuide({ ...clone(g), reviewedText: "abc" }).problems.join()).toMatch(/sha-256 hex digest/);
    const draft = clone(await guide({ status: "draft" })) as Partial<FormGuide>;
    delete draft.reviewer; delete draft.reviewedOn;
    expect(parseGuide({ ...draft, reviewedText: g.reviewedText }).problems.join()).toMatch(/a draft has no reviewedText/);
  });

  it("the text lock leaves out what the reader produces: relabelled fields, new fingerprints, reader and source keep the review", async () => {
    const g = await guide();
    const refreshed = clone(g);
    refreshed.match.fields = refreshed.match.fields.map((f) => ({ ...f, label: `${f.label} (nově)` }));
    refreshed.match.fingerprints = ["f".repeat(64)];
    refreshed.match.reader = "html/2";
    refreshed.match.source = "e".repeat(64);
    expect(guideTextDigest(refreshed)).toBe(g.reviewedText);
    expect(parseGuide(refreshed).problems).toEqual([]);
  });

  it("a reviewed guide lists the languages signed off in reviewedLangs; a draft lists none", async () => {
    const g = await guide();
    const none = clone(g) as Partial<FormGuide>;
    delete none.reviewedLangs;
    expect(parseGuide(none).problems.join()).toMatch(/lists the languages its reviewer signed off in reviewedLangs/);
    expect(parseGuide({ ...clone(g), reviewedLangs: [] }).problems.join()).toMatch(/signed off in reviewedLangs/);
    expect(parseGuide({ ...clone(g), reviewedLangs: ["en", "de"] }).problems.join()).toMatch(/reviewedLangs\[1\] "de" is not a language/);
    expect(parseGuide({ ...clone(g), reviewedLangs: ["en", "en"] }).problems.join()).toMatch(/names a language twice/);
    const draft = clone(await guide({ status: "draft" })) as Partial<FormGuide>;
    delete draft.reviewer; delete draft.reviewedOn;
    expect(parseGuide({ ...draft, reviewedLangs: ["en"] }).problems.join()).toMatch(/a draft has no reviewedLangs/);
  });

  it("signed off for English only: only English is locked; a Ukrainian change passes, an English one is refused", async () => {
    const g = await guide({ reviewer: "Test Reviewer (fixture) (cs, en)", reviewedLangs: ["en"] });
    expect(parseGuide(clone(g)).problems).toEqual([]);
    expect(g.reviewedText).not.toBe(guideTextDigest(g, ["en", "uk"]));
    const uk = clone(g);
    uk.wizards.uk.steps[0]!.explanation = "Як у закордонному паспорті.";
    uk.wizards.uk.notes = ["Заповнюйте чеською мовою."];
    expect(parseGuide(uk).problems).toEqual([]);
    const en = clone(g);
    en.wizards.en.steps[0]!.explanation = "As in your ID card.";
    expect(parseGuide(en).problems.join()).toMatch(/checked text changed since the review/);
    // Adding a language is a new review: the old lock does not cover it.
    expect(parseGuide({ ...clone(g), reviewedLangs: ["en", "uk"] }).problems.join()).toMatch(/checked text changed since the review/);
  });

  it("parseLibrary keeps the guides that pass and names the ones that do not", async () => {
    const good = await guide();
    const bad = { ...clone(good), id: "cz/spatna", officialFormUrl: "ftp://x" };
    const r = parseLibrary([good, bad, "nonsense"]);
    expect(r.guides.map((g) => g.id)).toEqual(["cz/zmena-adresy"]);
    expect(r.rejected.map((x) => x.id)).toEqual(["cz/spatna", "#2"]);
  });
});

describe("matchGuide", () => {
  it("an exact fingerprint is an exact match, and a form elsewhere is not matched", async () => {
    const g = await guide();
    const m = matchGuide(await form(), [g]);
    expect(m).toMatchObject({ exact: true, changed: [], removed: 0, overlap: 1 });
    expect(m?.same).toEqual(FIELDS.map((f) => f.fieldId));
    expect(matchGuide(await form(FIELDS, "https://evil.example/formular/zmena"), [g])).toBeNull();
    expect(matchGuide(await form(FIELDS, "https://ipc.gov.cz/jiny-formular"), [g])).toBeNull();
  });

  it("the same fields at the office's other host are exact too (the fingerprint holds the address)", async () => {
    const m = matchGuide(await form(FIELDS, `${URL_OLD}/`), [await guide()]);
    expect(m?.exact).toBe(true);
  });

  it("a label that differs only in case, spacing or a star is the same field", async () => {
    const fields = FIELDS.map((f) => (f.fieldId === "obec" ? { ...f, label: "OBEC *" } : f));
    expect(matchGuide(await form(fields), [await guide()])).toMatchObject({ exact: true, changed: [] });
  });

  it("a changed form: the new and relabelled fields are named, and the overlap is shared / all", async () => {
    const fields: FieldStructure[] = [
      ...FIELDS.map((f) => (f.fieldId === "psc" ? { ...f, label: "Poštovní směrovací číslo" } : f)),
      { fieldId: "telefon", kind: "tel", label: "Telefon", required: false },
    ];
    const m = matchGuide(await form(fields), [await guide()]);
    expect(m).toMatchObject({ exact: false, changed: ["psc", "telefon"], removed: 1 });
    expect(m?.overlap).toBeCloseTo(5 / (6 + 7 - 5));
  });

  it(`below ${GUIDE_MIN_OVERLAP} overlap the guide is not used`, async () => {
    const g = await guide();
    // 3 of 6 kept, 3 new: 3 / 9 = 0.33.
    const fields: FieldStructure[] = [...FIELDS.slice(0, 3), ...["a", "b", "c"].map((id): FieldStructure => ({ fieldId: id, kind: "text", label: id, required: false }))];
    expect(matchGuide(await form(fields), [g])).toBeNull();
    // 4 of 6 kept, 2 new: 4 / 8 = 0.5, still used.
    const used = [...FIELDS.slice(0, 4), ...["a", "b"].map((id): FieldStructure => ({ fieldId: id, kind: "text", label: id, required: false }))];
    expect(matchGuide(await form(used), [g])?.overlap).toBe(0.5);
  });

  it("a draft is used only with drafts switched on; the demo guide always, on its path only", async () => {
    const draft = await guide({ status: "draft" });
    const s = await form();
    expect(matchGuide(s, [draft])).toBeNull();
    expect(matchGuide(s, [draft], { drafts: true })?.guide).toBe(draft);

    const demo = await guide({ status: "draft", demo: true, match: { ...draft.match, fingerprints: ["0".repeat(64)], urls: ["/demo/form.html"] } });
    expect(matchGuide(await form(FIELDS, "http://127.0.0.1:5181/demo/form.html"), [demo])?.exact).toBe(true);
    expect(matchGuide(await form(FIELDS, "https://distill-hybrid-ai.web.app/demo/form.html"), [demo])?.exact).toBe(true);
    expect(matchGuide(await form(FIELDS, "http://127.0.0.1:5181/form.html"), [demo])).toBeNull();
  });

  it("a PDF is known by its title, never by an address; an html guide never matches a PDF", async () => {
    const PDF = "pdf://local/";
    const html = await guide();
    const pdf = await guide({ match: { format: "pdf", fingerprints: [await fingerprint(PDF, FIELDS)], titles: ["Oznámení změny adresy"], fields: html.match.fields } });
    const s: FormStructure = { ...(await form(FIELDS, PDF)), title: "OZNÁMENÍ ZMĚNY ADRESY" };
    expect(matchGuide(s, [html])).toBeNull();
    expect(matchGuide(s, [pdf])?.exact).toBe(true);
    // Another PDF with the same generic field ids but another title: not this form.
    expect(matchGuide({ ...s, title: "Žádost o něco jiného", fingerprint: "x" }, [pdf])).toBeNull();
    // The same PDF, one field relabelled: matched by title, with the drift named.
    const changed = FIELDS.map((f) => (f.fieldId === "obec" ? { ...f, label: "Obec a část obce" } : f));
    expect(matchGuide({ ...s, fields: changed, fingerprint: await fingerprint(PDF, changed) }, [pdf])).toMatchObject({ exact: false, changed: ["obec"] });
  });

  it("the best guide wins: exact before changed, then the larger overlap", async () => {
    const a = await guide({ id: "cz/a" });
    const b = await guide({ id: "cz/b", match: { ...a.match, fingerprints: ["1".repeat(64)], fields: a.match.fields.slice(0, 5) } });
    expect(matchGuide(await form(), [b, a])?.guide.id).toBe("cz/a");
  });
});

describe("guideWizard and mergeWizards", () => {
  it("an exact match gives the guide's steps, its quotes and notes, in the reader's language", async () => {
    const s = await form();
    const m = matchGuide(s, [await guide()])!;
    const en = guideWizard(m, s, "en")!;
    expect(en.wizard.steps.map((st) => st.stepId)).toEqual(["name", "birth", "address"]);
    expect(en.wizard.fingerprint).toBe(s.fingerprint);
    expect(en.quotes).toEqual({ name: { text: "Uveďte jméno a příjmení podle cestovního dokladu.", lang: "cs" } });
    expect(en.notes).toEqual(["Fill the form in Czech."]);
    expect(en.rest).toEqual([]);
    expect(guideWizard(m, s, "uk")?.wizard.steps[0]?.question).toBe("Ваше прізвище та ім'я");
    expect(guideWizard(m, s, "uk-UA")?.wizard.readerLang).toBe("uk");
    expect(guideWizard(m, s, "de")).toBeNull();
  });

  it("a reviewed guide is served only in the languages signed off; other readers get the normal path (null)", async () => {
    const s = await form();
    const g = await guide({ reviewer: "Test Reviewer (fixture) (cs, en)", reviewedLangs: ["en"] });
    const m = matchGuide(s, [g])!;
    expect(guideWizard(m, s, "en")?.wizard.steps[0]?.question).toBe("Your surname and first name");
    expect(guideWizard(m, s, "uk")).toBeNull();
    expect(guideWizard(m, s, "uk-UA")).toBeNull();
    expect(guideSignedFor(g, "en")).toBe(true);
    expect(guideSignedFor(g, "uk")).toBe(false);
    // A draft (drafts on) is shown as a draft in every language: nothing claims it was checked.
    expect(guideSignedFor({ status: "draft" }, "uk")).toBe(true);
  });

  it("a changed form: a step any of whose fields changed goes to the normal path whole, with the new fields", async () => {
    const fields: FieldStructure[] = [
      ...FIELDS.map((f) => (f.fieldId === "psc" ? { ...f, label: "Poštovní směrovací číslo" } : f)),
      { fieldId: "telefon", kind: "tel", label: "Telefon", required: false },
    ];
    const s = await form(fields);
    const g = guideWizard(matchGuide(s, [await guide()])!, s, "en")!;
    expect(g.wizard.steps.map((st) => st.stepId)).toEqual(["name", "birth"]);
    expect(g.rest).toEqual(["ulice", "obec", "psc", "telefon"]);

    const rest: Wizard = { fingerprint: "x", readerLang: "en", steps: narrowStructure(s, g.rest).fields.map((f) => ({ stepId: f.fieldId === "telefon" ? "name" : f.fieldId, fieldIds: [f.fieldId], question: f.label, explanation: "" })) };
    const { wizard, fromGuide } = mergeWizards(s, g.wizard, rest);
    expect(wizard.steps.map((st) => st.stepId)).toEqual(["name", "birth", "ulice", "obec", "psc", "name_2"]);
    expect(fromGuide).toEqual(["name", "birth"]);
    expect(wizard.steps.flatMap((st) => st.fieldIds)).toEqual(fields.map((f) => f.fieldId));
  });

  it("the steps pass the wizard door again against the form on screen", async () => {
    const s = await form();
    const g = await guide();
    // A guide changed after it was loaded (it never should be) still cannot carry HTML to the screen.
    g.wizards.en.steps[0]!.explanation = "<img src=x onerror=alert(1)>As in your passport.";
    const out = guideWizard(matchGuide(s, [g])!, s, "en")!;
    expect(out.wizard.steps[0]?.explanation).toBe("As in your passport.");
  });
});
