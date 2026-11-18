import { describe, expect, it } from "vitest";
import { extractActions, extractForm, extractPage, prompts, readErrors, readValues, route, writeValues, type FormStructure, type Letter, type ReplyAnswer, type Task } from "../src/index.js";
import { live, parse } from "./helpers.js";
import czech from "./fixtures/czech-residence-form.html?raw";

// Free-text values, unmistakable, typed into every field that takes text. Choice fields (radio, select, checkbox)
// can only hold an option that is part of the structure itself.
const SECRETS = {
  jmeno: "Zqxvlenka",
  prijmeni: "Wbrtnovsky",
  datum: "1987-06-19",
  rc: "870619/4321",
  email: "zqx.wbrt@private.example",
  tel: "+420 601 998 877",
  poznamka: "ZQX-secret-note-8842",
};

describe("payload privacy", () => {
  it("no typed value appears in any cloud-eligible prompt built from the Czech fixture", async () => {
    const doc = parse(czech);
    const structure = await extractForm(doc, "https://mv.example/zadost");
    writeValues(doc, structure, { ...SECRETS, stav: "zenaty", stat: "VN", duvod: "studium", souhlas: "true" });
    const typed = readValues(doc, structure);
    for (const v of Object.values(SECRETS)) expect(Object.values(typed)).toContain(v);

    // Everything is extracted AFTER typing, as the extension would.
    const page = extractPage(doc, "https://mv.example/zadost");
    const after = await extractForm(doc, "https://mv.example/zadost");
    expect(after).toEqual(structure);

    // The focus view of a form page carries its labels and help text, never what was typed into it.
    const pageJson = JSON.stringify(page);
    expect(pageJson).toContain("Osobní údaje");
    expect(pageJson).toContain("Jméno");
    for (const secret of Object.values(SECRETS)) expect(pageJson).not.toContain(secret);
    for (const part of ["Zqxvlenka", "Wbrtnovsky", "870619", "private.example", "601 998", "ZQX"]) expect(pageJson).not.toContain(part);

    const built: string[] = [
      prompts.classifyPage(page),
      prompts.simplifyBlocks(page, "plain", "en"),
      prompts.recast(page, ["summary", "steps"]),
      prompts.buildWizard(after, "en"),
      ...after.fields.map((f) => prompts.explainField(after, f.fieldId, "en")),
    ];
    expect(built.length).toBe(4 + structure.fields.length);

    const eligible: Task[] = ["classifyPage", "simplifyBlocks", "recast", "buildWizard", "explainField"];
    for (const t of eligible) expect(route(t, "prefer_in_cloud").promptClass).not.toBe("values");

    for (const prompt of built) {
      for (const secret of Object.values(SECRETS)) expect(prompt).not.toContain(secret);
      for (const part of ["Zqxvlenka", "Wbrtnovsky", "870619", "private.example", "601 998", "ZQX"]) expect(prompt).not.toContain(part);
    }
  });

  it("values typed into shadow roots, frames and comboboxes never reach a structure, the page model or a prompt", async () => {
    const { doc, close } = await live(`<!doctype html><html lang="cs"><head><title>Žádost</title></head><body><main>
      <h1>Žádost o kartu</h1><p>Vyplňte údaje podle dokladu.</p>
      <form>
        <x-field id="jmeno"></x-field>
        <label for="adr">Adresa</label>
        <input id="adr" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="adr-list">
        <ul id="adr-list" role="listbox"></ul>
        <span id="kl">Kraj</span><div id="kraj" role="combobox" aria-labelledby="kl" aria-controls="kraj-list" aria-expanded="false">Vyberte</div>
        <ul id="kraj-list" role="listbox" hidden><li role="option" data-value="PHA">Praha</li></ul>
        <label for="pozn">Poznámka</label><input id="pozn">
      </form>
      <iframe id="f" srcdoc="<form><label for='d'>Držitel</label><input id='d'><label for='e'>E-mail</label><input id='e'></form>"></iframe>
    </main></body></html>`, "https://mv.example/zadost");
    const root = (doc.getElementById("jmeno") as HTMLElement).attachShadow({ mode: "open" });
    root.innerHTML = `<label for="jm">Jméno</label><input id="jm">`;
    const frame = (doc.getElementById("f") as HTMLIFrameElement).contentDocument as Document;
    const before = [await extractForm(doc, "https://mv.example/zadost", 0), await extractForm(doc, "https://mv.example/zadost", 1)];
    expect(before[0]?.fields.map((f) => f.fieldId)).toEqual(["jm", "adr", "kraj", "pozn"]);
    expect(before[1]?.fields.map((f) => f.fieldId)).toEqual(["d", "e"]);

    // The person types; the address box answers with suggestions that repeat what was typed, as address search does.
    (root.getElementById("jm") as HTMLInputElement).value = "Zqxvlenka";
    (doc.getElementById("adr") as HTMLInputElement).value = "Wbrtnovska 88";
    doc.getElementById("adr-list")!.innerHTML = `<li role="option">Wbrtnovska 88, Praha</li><li role="option">Wbrtnovska 88a, Brno</li>`;
    (doc.getElementById("pozn") as HTMLInputElement).value = "ZQX-secret-note-8842";
    (frame.getElementById("d") as HTMLInputElement).value = "Zqxvlenka Wbrtnovsky";
    (frame.getElementById("e") as HTMLInputElement).value = "zqx.wbrt@private.example";
    const typed = { ...readValues(doc, before[0]!), ...readValues(doc, before[1]!) };
    expect(Object.values(typed)).toEqual(expect.arrayContaining(["Zqxvlenka", "Wbrtnovska 88", "zqx.wbrt@private.example"]));

    const after = [await extractForm(doc, "https://mv.example/zadost", 0), await extractForm(doc, "https://mv.example/zadost", 1)];
    const page = extractPage(doc, "https://mv.example/zadost");
    expect(JSON.stringify(page)).toContain("Vyplňte údaje podle dokladu.");
    const built = [
      JSON.stringify(after), JSON.stringify(page),
      prompts.classifyPage(page), prompts.simplifyBlocks(page, "plain", "en"), prompts.recast(page, ["summary"]),
      ...after.flatMap((s) => [prompts.buildWizard(s, "en"), ...s.fields.map((f) => prompts.explainField(s, f.fieldId, "en"))]),
    ];
    for (const text of built) {
      for (const part of ["Zqxvlenka", "Wbrtnovsk", "ZQX", "private.example"]) expect(text).not.toContain(part);
    }
    await close();
  });

  it("a structure smuggling values still never prints them, and is rejected by type", async () => {
    const doc = parse(czech);
    const structure = await extractForm(doc, "https://mv.example/zadost");
    const dirty = { ...structure, values: { jmeno: "Zqxvlenka" }, fields: structure.fields.map((f) => ({ ...f, value: "Zqxvlenka" })) };
    // @ts-expect-error a fresh object literal carrying values is not a FormStructure
    prompts.buildWizard({ ...structure, values: { jmeno: "Zqxvlenka" } }, "en");
    expect(prompts.buildWizard(dirty as unknown as FormStructure, "en")).not.toContain("Zqxvlenka");
    expect(prompts.explainField(dirty as unknown as FormStructure, "jmeno", "en")).not.toContain("Zqxvlenka");
  });

  it("of the two reply prompts, only draftReply carries the person's answers, and it routes on device only", () => {
    const letterText = "Vážený pane, pošlete nám prosím číslo pasu do 30. 11. 2026. Číslo jednací: OAM-1234/2026.";
    const letter: Letter = {
      sender: "Ministerstvo vnitra",
      lang: "cs",
      summary: "The ministry asks for your passport number by 30 November 2026.",
      deadline: "30. 11. 2026",
      actions: [{ what: "Send your passport number", by: "30. 11. 2026" }],
    };
    const answers: ReplyAnswer[] = [
      { stepId: "r0", question: "What is your passport number?", value: SECRETS.rc },
      { stepId: "r1", question: "Your full name?", value: `${SECRETS.jmeno} ${SECRETS.prijmeni}` },
      { stepId: "r2", question: "Anything to add?", value: SECRETS.poznamka },
    ];

    // The wizard takes the shared letter text and nothing else: answers cannot reach it, not even by mistake.
    const wizard = prompts.buildReplyWizard(letterText, "en");
    // @ts-expect-error the reply wizard takes letter text, not the person's answers
    prompts.buildReplyWizard(answers, "en");
    expect(wizard).toContain("OAM-1234/2026");
    for (const a of answers) expect(wizard).not.toContain(a.value);
    for (const part of ["Zqxvlenka", "Wbrtnovsky", "870619", "ZQX"]) expect(wizard).not.toContain(part);
    expect(route("buildReplyWizard", "prefer_in_cloud").promptClass).toBe("page");

    const draft = prompts.draftReply(letter, answers, "en");
    for (const a of answers) expect(draft).toContain(a.value);
    for (const cfg of ["only_in_cloud", "prefer_in_cloud", "prefer_on_device", undefined]) {
      expect(route("draftReply", cfg)).toMatchObject({ promptClass: "values", mode: "only_on_device" });
    }
  });

  // A validation message can repeat what the person typed ("'zqx@' není platný e-mail"), so the page's error text is in
  // the values class: it must never reach the page model, a structure, a cloud-eligible prompt or the agent.
  it("the page's validation errors never reach the page model, a structure, a cloud prompt or the agent", async () => {
    const { doc, close } = await live(`<!doctype html><html lang="cs"><head><title>Žádost</title></head><body><main>
      <h1>Žádost o kartu</h1><p>Vyplňte údaje podle dokladu.</p>
      <div class="error-summary" role="alert"><h2>Formulář obsahuje chyby</h2><ul><li>SUMMARY-ZQX-1: e-mail zqx@ není platný</li><li><a href="#jm">LINK-ZQX-9 obsahuje číslici</a></li></ul></div>
      <form>
        <label for="jm">Jméno <span class="field-error">LABEL-ZQX-2 obsahuje číslici</span></label>
        <input id="jm" aria-invalid="true">
        <label for="rc">Rodné číslo</label>
        <input id="rc" aria-invalid="true" aria-describedby="rc-hint rc-err">
        <small id="rc-hint">Ve tvaru 123456/7890</small>
        <span id="rc-err" class="govuk-error-message">DESCRIBED-ZQX-3 není ve správném tvaru</span>
        <label for="psc">PSČ</label>
        <input id="psc" aria-invalid="true" aria-errormessage="psc-msg">
        <div id="psc-msg">ERRMSG-ZQX-4 má mít 5 číslic</div>
        <div class="form-group"><label for="em">E-mail</label><input id="em" type="email"><p role="alert">ALERT-ZQX-5 není platný e-mail</p></div>
        <div class="form-group"><label for="tel">Telefon</label><input id="tel"><div class="invalid-feedback">ADJACENT-ZQX-6 je příliš krátký</div></div>
        <x-field id="host"></x-field>
        <button type="submit">Odeslat</button>
      </form>
      <iframe id="f" srcdoc="<form><label for='d'>Držitel</label><input id='d' aria-invalid='true' aria-describedby='d-err'><span id='d-err' class='error'>FRAME-ZQX-7 je povinné</span><label for='e'>Obec</label><input id='e'></form>"></iframe>
    </main></body></html>`, "https://mv.example/zadost");
    const root = (doc.getElementById("host") as HTMLElement).attachShadow({ mode: "open" });
    root.innerHTML = `<label for="cp">Číslo pasu</label><input id="cp" aria-invalid="true" aria-describedby="cp-err"><span id="cp-err" class="error-text">SHADOW-ZQX-8 neplatné</span>`;

    const forms = [await extractForm(doc, "https://mv.example/zadost", 0), await extractForm(doc, "https://mv.example/zadost", 1)];
    const page = extractPage(doc, "https://mv.example/zadost");
    expect(JSON.stringify(page)).toContain("Vyplňte údaje podle dokladu.");
    expect(JSON.stringify(page)).toContain("Rodné číslo");
    const actions = extractActions(doc, "https://mv.example/zadost");

    const offered: Record<string, string> = {
      structure: JSON.stringify(forms), page: JSON.stringify(page), actions: JSON.stringify(actions),
      classifyPage: prompts.classifyPage(page), simplifyBlocks: prompts.simplifyBlocks(page, "plain", "en"), recast: prompts.recast(page, ["summary"]),
      buildWizard: forms.map((s) => prompts.buildWizard(s, "en")).join("\n"),
      explainField: forms.flatMap((s) => s.fields.map((f) => prompts.explainField(s, f.fieldId, "en"))).join("\n"),
    };
    // Every leak by where it went, so a failure names them all.
    const leaks = Object.entries(offered).flatMap(([where, text]) => (text.match(/[A-Z]+-ZQX-\d/g) ?? []).map((m) => `${where}: ${m}`));
    expect([...new Set(leaks)]).toEqual([]);
    // The fields keep their own labels and help text: only the errors are left out.
    expect(forms[0]?.fields.map((f) => f.label)).toEqual(["Jméno", "Rodné číslo", "PSČ", "E-mail", "Telefon", "Číslo pasu"]);
    expect(forms[0]?.fields.find((f) => f.fieldId === "rc")?.hint).toBe("Ve tvaru 123456/7890");
    expect(forms[1]?.fields.map((f) => f.label)).toEqual(["Držitel", "Obec"]);
    // What was left out is exactly what the device-only reading finds.
    const errors = [readErrors(doc, forms[0]!), readErrors(doc, forms[1]!)];
    const found = JSON.stringify(errors).match(/[A-Z]+-ZQX-\d/g) ?? [];
    expect(new Set(found)).toEqual(new Set(["SUMMARY-ZQX-1", "LINK-ZQX-9", "LABEL-ZQX-2", "DESCRIBED-ZQX-3", "ERRMSG-ZQX-4", "ALERT-ZQX-5", "ADJACENT-ZQX-6", "SHADOW-ZQX-8", "FRAME-ZQX-7"]));
    await close();
  });

  it("only the values-class prompts carry a person's details, and they route on device only", async () => {
    const structure = await extractForm(parse(czech), "https://mv.example/zadost");
    expect(prompts.suggestValue(structure, "jmeno", { name: "Zqxvlenka" })).toContain("Zqxvlenka");
    expect(prompts.checkValue(structure, "rc", "870619/4321")).toContain("870619/4321");
    expect(route("suggestValue", "only_in_cloud").mode).toBe("only_on_device");
    expect(route("checkValue", "prefer_in_cloud").mode).toBe("only_on_device");
  });
});
