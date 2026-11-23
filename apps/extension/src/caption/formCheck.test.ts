// r3-10 fix 2: Wikipedia's Appearance panel (text size, width, colour) is not the page's form. The fixture is the
// panel's markup as saved from a Wikipedia article (Vector 2022).
import { afterEach, describe, expect, it } from "vitest";
import panel from "./fixtures/wikipedia-appearance.html?raw";
import residence from "../../../../packages/engine/test/fixtures/czech-residence-form.html?raw";
import { pageControl } from "./formCheck";

afterEach(() => { document.body.innerHTML = ""; });

const forms = (html: string): Element[] => {
  document.body.innerHTML = html;
  return Array.from(document.querySelectorAll("form"));
};

describe("pageControl", () => {
  it("knows each form of Wikipedia's Appearance panel as the page's own settings, not a form to fill", () => {
    const found = forms(panel);
    expect(found).toHaveLength(3);
    expect(document.querySelectorAll("input[type=radio]")).toHaveLength(8);
    expect(found.map(pageControl)).toEqual([true, true, true]);
  });

  it("keeps a real form a form: fields to type, a select, or a button that sends it", () => {
    expect(forms(residence).map(pageControl).every((c) => !c)).toBe(true);
    const [survey] = forms(`<form><label><input type="radio" name="q1" value="a"> Ano</label>
      <label><input type="radio" name="q1" value="b"> Ne</label><label><input type="checkbox" name="q2"> Souhlasím</label>
      <button>Odeslat</button></form>`);
    expect(pageControl(survey as Element)).toBe(false);
    const [sent] = forms(`<form action="/hlasovani"><input type="radio" name="a"><input type="radio" name="a"><input type="radio" name="a"></form>`);
    expect(pageControl(sent as Element)).toBe(false);
    const [typed] = forms(`<form><input type="radio" name="a"><input type="text" name="b"></form>`);
    expect(pageControl(typed as Element)).toBe(false);
  });

  it("is only ever a <form>", () => {
    document.body.innerHTML = `<div id="d"><input type="radio" name="a"></div>`;
    expect(pageControl(document.getElementById("d") as Element)).toBe(false);
  });
});
