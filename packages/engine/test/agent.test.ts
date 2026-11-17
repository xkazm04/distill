import { describe, expect, it } from "vitest";
import { AGENT_TASKS, agentCanDo, agentDoor, extractActions, pageToken, parseSimplified } from "../src/agent.js";
import { route } from "../src/route.js";
import type { FormStructure, PageModel, Task } from "../src/types.js";
import { parse } from "./helpers.js";

const PAGE: PageModel = {
  url: "https://office.example/form", title: "Form", lang: "cs", kind: "form",
  blocks: [{ id: "b0", kind: "paragraph", text: "Hello" }, { id: "b1", kind: "list", text: "a\nb" }],
};
const FORM: FormStructure = {
  fingerprint: "fpA", url: PAGE.url, lang: "cs", title: "Form",
  fields: [
    { fieldId: "name", kind: "text", label: "Jméno", required: true },
    { fieldId: "email", kind: "email", label: "E-mail", required: false },
  ],
};
const ALL_TASKS: Task[] = ["classifyPage", "simplifyBlocks", "recast", "buildWizard", "explainField", "suggestValue", "checkValue", "readLetter", "buildReplyWizard", "draftReply"];

describe("pageToken", () => {
  it("is sha-256 hex of the url and the blocks' id:text lines", async () => {
    const t = await pageToken(PAGE);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    const text = `${PAGE.url}\nb0:Hello\nb1:a\nb`;
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    expect(t).toBe(Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join(""));
  });
  it("changes when the text or the address changes, not otherwise", async () => {
    const t = await pageToken(PAGE);
    expect(await pageToken({ ...PAGE, title: "Another title" })).toBe(t);
    expect(await pageToken({ ...PAGE, blocks: [{ ...PAGE.blocks[0]!, text: "Hello!" }, PAGE.blocks[1]!] })).not.toBe(t);
    expect(await pageToken({ ...PAGE, url: "https://office.example/other" })).not.toBe(t);
  });
});

describe("parseSimplified (moved from the web app)", () => {
  it("reads {blocks:[...]}, a bare list and an id-keyed object; ignores unknown ids and empty text", () => {
    expect(parseSimplified({ blocks: [{ id: "b0", text: "Hi" }, { id: "b9", text: "x" }, { id: "b1", text: " " }] }, PAGE.blocks)).toEqual({ b0: "Hi" });
    expect(parseSimplified([{ id: "b1", text: "z" }], PAGE.blocks)).toEqual({ b1: "z" });
    expect(parseSimplified({ b0: "x", zzz: "y" }, PAGE.blocks)).toEqual({ b0: "x" });
    expect(parseSimplified("nonsense", PAGE.blocks)).toEqual({});
  });
});

describe("which tasks an agent may do", () => {
  it("never a values task, whatever the list says", () => {
    for (const t of ALL_TASKS) if (route(t).promptClass === "values") expect(agentCanDo(t), t).toBe(false);
    for (const t of AGENT_TASKS) expect(route(t).promptClass).not.toBe("values");
  });
  it("only the tasks with a door", () => {
    expect(ALL_TASKS.filter(agentCanDo).sort()).toEqual(["buildWizard", "recast", "simplifyBlocks"]);
  });
});

describe("agentDoor: the agent's answer passes the same door as a model's", () => {
  it("simplify: accepts usable blocks and counts the rest", () => {
    const v = agentDoor("simplifyBlocks", { blocks: [{ id: "b0", text: "Hi" }, { id: "b7", text: "x" }, { id: 3 }] }, { page: PAGE });
    expect(v.accepted).toBe(true);
    expect(v.dropped).toBe(2);
    expect(v.errors).toHaveLength(2);
    expect(v.errors[0]).toMatch(/b7/);
  });
  it("simplify: an explicit empty list is an answer (already plain); nothing usable is refused", () => {
    expect(agentDoor("simplifyBlocks", { blocks: [] }, { page: PAGE })).toEqual({ accepted: true, dropped: 0, errors: [] });
    expect(agentDoor("simplifyBlocks", { blocks: [{ id: "zz", text: "x" }] }, { page: PAGE }).accepted).toBe(false);
    expect(agentDoor("simplifyBlocks", 42, { page: PAGE }).accepted).toBe(false);
  });
  it("buildWizard: counts steps that name no field, and does not count its own fallback steps as the agent's", () => {
    const ok = agentDoor("buildWizard", { steps: [{ stepId: "s1", fieldIds: ["name"], question: "Your first name?", explanation: "" }, { fieldIds: ["nope"], question: "?" }] }, { structure: FORM });
    expect(ok).toMatchObject({ accepted: true, dropped: 1 });
    expect(ok.errors[0]).toMatch(/Step 2/);
    // Only steps for unknown fields: the door would add a fallback for the required field, but none is the agent's.
    expect(agentDoor("buildWizard", { steps: [{ fieldIds: ["nope"], question: "?" }] }, { structure: FORM })).toMatchObject({ accepted: false, dropped: 1 });
  });
  it("recast: validateAndRepair's verdict, with its reasons", () => {
    const v = agentDoor("recast", { version: 1, nodes: [{ kind: "summary", text: "Short", sourceBlockIds: ["b0"] }, { kind: "html", sourceBlockIds: [] }] }, {});
    expect(v).toMatchObject({ accepted: true, dropped: 1 });
    expect(v.errors[0]).toMatch(/not a section type/);
    expect(agentDoor("recast", { nodes: [{ kind: "summary", text: "x", sourceBlockIds: [] }] }, { kinds: ["steps"] }).accepted).toBe(false);
  });
  it("refuses a script link anywhere, and any task without a door", () => {
    expect(agentDoor("recast", { nodes: [{ kind: "summary", text: "javascript:alert(1)", sourceBlockIds: [] }] }, {}).accepted).toBe(false);
    for (const t of ["suggestValue", "checkValue", "draftReply", "classifyPage"] as const) expect(agentDoor(t, {}, { page: PAGE }).accepted, t).toBe(false);
  });
});

describe("extractActions: labels only", () => {
  const html = `<!doctype html><html><body>
    <nav><a href="/next?session=SECRET#top">Next page</a></nav>
    <form>
      <input id="name" value="SENTINEL-VALUE">
      <textarea>SENTINEL-TEXT</textarea>
      <button>Send</button>
      <button type="button">Add a child</button>
      <button type="reset">Clear</button>
      <input type="submit" value="Submit the form">
      <button disabled>Disabled</button>
    </form>
    <button hidden>Hidden</button>
    <div style="display:none"><a href="/x">Invisible</a></div>
    <a href="javascript:alert(1)">Script</a>
    <span role="button" aria-label="Close the banner">x</span>
    <a href="/empty"></a>
  </body></html>`;

  it("lists visible, enabled controls with their kind, and links by origin + path", () => {
    const doc = parse(html);
    const els: string[] = [];
    const actions = extractActions(doc, "https://office.example/form?id=1", (id, el) => els.push(`${id}:${el.localName}`));
    expect(actions).toEqual([
      { actionId: "a0", label: "Next page", kind: "link", href: "https://office.example/next" },
      { actionId: "a1", label: "Send", kind: "submit" },
      { actionId: "a2", label: "Add a child", kind: "button" },
      { actionId: "a3", label: "Submit the form", kind: "submit" },
      { actionId: "a4", label: "Close the banner", kind: "button" },
    ]);
    expect(els).toEqual(["a0:a", "a1:button", "a2:button", "a3:input", "a4:span"]);
  });

  it("never carries what a person typed", () => {
    const doc = parse(html);
    (doc.getElementById("name") as HTMLInputElement).value = "TYPED-BY-PERSON";
    const json = JSON.stringify(extractActions(doc, "https://office.example/form"));
    expect(json).not.toMatch(/SENTINEL|TYPED-BY-PERSON|SECRET/);
  });
});
