import { describe, expect, it } from "vitest";
import { extractForm, extractPage, prompts, readValues, route, writeValues, type FormStructure, type Task } from "../src/index.js";
import { parse } from "./helpers.js";
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

  it("a structure smuggling values still never prints them, and is rejected by type", async () => {
    const doc = parse(czech);
    const structure = await extractForm(doc, "https://mv.example/zadost");
    const dirty = { ...structure, values: { jmeno: "Zqxvlenka" }, fields: structure.fields.map((f) => ({ ...f, value: "Zqxvlenka" })) };
    // @ts-expect-error a fresh object literal carrying values is not a FormStructure
    prompts.buildWizard({ ...structure, values: { jmeno: "Zqxvlenka" } }, "en");
    expect(prompts.buildWizard(dirty as unknown as FormStructure, "en")).not.toContain("Zqxvlenka");
    expect(prompts.explainField(dirty as unknown as FormStructure, "jmeno", "en")).not.toContain("Zqxvlenka");
  });

  it("only the values-class prompts carry a person's details, and they route on device only", async () => {
    const structure = await extractForm(parse(czech), "https://mv.example/zadost");
    expect(prompts.suggestValue(structure, "jmeno", { name: "Zqxvlenka" })).toContain("Zqxvlenka");
    expect(prompts.checkValue(structure, "rc", "870619/4321")).toContain("870619/4321");
    expect(route("suggestValue", "only_in_cloud").mode).toBe("only_on_device");
    expect(route("checkValue", "prefer_in_cloud").mode).toBe("only_on_device");
  });
});
