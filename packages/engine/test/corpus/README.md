# Form corpus (Czechia corridor)

**These pages are synthetic models, not captures.** Each one is hand-written in Czech to reproduce the widget and markup
patterns that Czech public portals use (custom comboboxes, ARIA choices, shadow roots, iframes, split dates, masks,
framework-controlled inputs, hidden steps, table layouts). No HTML was copied from a real portal. Names of offices
and forms are generic, and all personal data is made up.

The corpus measures how often Wayfill's engine (`src/form.ts`: `extractForm` + `writeValues`) finds, labels and
really fills a form. It is the honest "before" number; improve the engine, not the fixtures.

## Run it

| Command | What it does |
| --- | --- |
| `npm run bench:forms` | Prints the table per fixture and in total, then every miss in plain words. |
| `npm run bench:forms:update` | The same, and rewrites `baseline.json`. The only way the baseline changes. Commit it on purpose, with the reason. |
| `npm run check` | Includes `test/corpus.test.ts`: fixtures must be sound, and no total may fall below `baseline.json`. |

## Files

- `<slug>.html` - the page. `<slug>.expect.json` - what a careful person would list, and how to check a fill.
- `residence-basic` reuses `../fixtures/czech-residence-form.html` through `"source"`.
- `baseline.json` - the stored totals and per-fixture counts.
- The runner is `../bench/forms.ts`.

## `<slug>.expect.json`

```jsonc
{
  "title": "...", "models": "the pattern this page reproduces",
  "requires": ["javascript", "shadow-dom", "iframe-srcdoc", "declarative-shadow-dom"],  // only what it needs
  "fields": [{
    "key": "jmeno",                       // stable name in this file
    "locator": "#jmeno",                  // CSS, or an array; " >>> " steps into an open shadow root or a srcdoc iframe
    "kind": "text", "label": "Jméno", "required": true, "options": 3,   // options: count, for choices only
    "value": "Olena",                     // what the person answers in the wizard (choices: the visible option text)
    "probes": [{ "at": "#jmeno", "prop": "value", "equals": "Olena" }]  // or "attr": "aria-checked"
  }],
  "steps": [{ "fields": ["jmeno"] }, { "do": [{ "click": "#dalsi" }], "fields": ["..."] }],  // optional: a form in steps
  "byHand": [{ "type": "#jmeno", "text": "Olena" }, { "click": "..." }, { "choose": "select", "option": "..." }, { "pick": "input[type=date]", "value": "1990-03-05" }]
}
```

`steps` is for a form shown in steps. The engine skips hidden fields on purpose (honeypots, and fields the person
cannot see should not be filled); the apps read the form again when the page changes. So a step lists its fields and
what a person does to reach it (`do`, the same kinds of hand steps as `byHand`; nothing for the first), and the
benchmark reads each step only once it shows. Every field is in exactly one step. Without `steps`, the whole form is
one step, read on load.

The label is the text as a sighted person reads it beside the field (trailing `*` and `:` ignored); for a field with
no visible label, its accessible name. Comparison is case-sensitive, so a `name`-attribute fallback does not pass.

## How a run is judged

1. **Can this environment run the page?** The runner tries each capability in a fresh happy-dom window
   (`probeCapabilities`), never assumes it. A fixture whose `requires` is missing is listed as "not measurable here"
   and left out of the totals.
2. **Is the fixture sound?** On a fresh copy: every probe of a field with a value must fail on the untouched page,
   then the `byHand` steps run (keydown, beforeinput, the character, input, keyup per character; real clicks; native
   select choice) with no engine code, and every probe must pass. `corpus.test.ts` fails if a runnable fixture is not
   sound, so a broken fixture cannot quietly drop out of the totals.
3. **The engine run**, on another fresh copy, per step (one step unless the fixture declares `steps`): the step's
   `do` actions, then `extractForm(document)` on the top document, as the web app and the extension call it, then
   `writeValues` with the values of the fields first found in this step, then their probes.
   - A field read again on a later step counts once. A field read while its own step is still hidden counts as an
     extra (against precision): hidden fields are not the engine's to fill.
   - An engine field matches a listed field when its `fieldId` equals the `id` or `name` attribute of one of the
     listed field's elements, searched through open shadow roots and same-origin frames. The first match counts;
     a further engine field on the same listed field is a "second piece" (a split) and counts against precision.
   - Each value goes to the first matching engine field only.
   - Success is decided by the probes alone, never by `readValues` or by `writeValues`' `written` list.

| Metric | Meaning |
| --- | --- |
| recall | listed fields the engine found |
| precision | engine fields that are listed fields (splits and extras count against it) |
| labels | listed fields found with the right label (over all listed fields) |
| shape | listed fields found with the right kind, required flag and option count (over all listed fields) |
| fill | values whose probes all hold after `writeValues` |
| **false claims** | values `writeValues` reported as `written` whose probes say otherwise: the trust metric |

The gate fails when recall, precision, labels, shape or fill fall, when false claims rise, or when a fixture
appears, disappears or changes measurability without a baseline update.

## The environment

Each fixture runs in its own happy-dom `Window` with page scripts on (`enableJavaScriptEvaluation`), so masks,
widgets and the framework stand-in run. Found by trying, in happy-dom 21.0.4:

- inline scripts, `attachShadow({ mode: "open" })` and custom elements work;
- `<iframe srcdoc>` gets a same-origin `contentDocument`;
- declarative shadow roots (`<template shadowrootmode="open">`) are **not** attached by the parser (the serializer
  writes them, the parser does not read them), so `declarative-shadow` is not measurable here.

The framework fixture is a stand-in for React's controlled inputs written in a few lines of script (instance-level
value tracking; text follows input/change, select follows change, checkbox and radio follow click). It models that
behaviour; it is not React.

## PDF forms (`packages/pdf`)

The PDF side of Wayfill (`@distill/pdf`) has its own section of this benchmark, in `packages/pdf/test/`, because the
engine has no PDF dependency and must not get one. Its totals are reported apart from the web totals above, and the
web baseline (`baseline.json` here) does not include them.

**The PDFs are synthetic and built in the test run.** Each fixture is a `<slug>.pdf.json` in `packages/pdf/test/corpus`:
a layout (printed Czech text and form fields at given positions) that `corpus/build.ts` draws with pdf-lib's own form
API and the embedded Noto Sans, plus what a careful person would list. No real office's PDF was downloaded or
committed; names of offices are generic and all personal data is made up. The PDFs Distill must refuse (a print-only
form, a dynamic and a static XFA form, an encrypted file whose permissions forbid filling in forms, a file that needs a
password to open, a signed file) are built in `corpus/refusals.ts` the way such files are made (an XFA stream, pdf-lib's
real encryption, a signed signature field).

**Protected forms.** Most fillable forms of the corridor are encrypted by their author with only an owner password and
permissions that allow filling in forms (ipc.gov.cz: AES-128, P -1084; VZP: AES-256, P -1052). Two fixtures model
them: `zadost-pobyt-chraneny` and `prihlaska-pojistence-chranena` take another fixture's form (`"source"`) and add
`"protect"`, which `build.ts` applies with pdf-lib's own `encrypt`. They are read and filled like any other, and the
**protection** column counts protected originals whose saved copy pdf.js finds encrypted with the same permissions.

| Command | What it does |
| --- | --- |
| `npm run bench:forms -w @distill/pdf` | Prints the PDF table, the refusals and every miss. |
| `npm run bench:forms:update -w @distill/pdf` | The same, and rewrites `packages/pdf/test/corpus/baseline.json`. Commit it on purpose, with the reason. |
| `npm run check` | Includes `packages/pdf/test/corpus.test.ts`: fixtures sound, refusals right, no total below the PDF baseline. |

How a run is judged, where it differs from web forms:

1. **Soundness.** On the untouched file every probe of an answer must fail and every pre-filled value must hold; a
   fill with pdf-lib's plain API (no Distill code, `byHand`) must satisfy every probe.
2. **Matching.** An engine field matches a listed field when its binding shares a PDF field name with it. A listed
   field made of several PDF fields (a date in three boxes, a postcode in five) must come back as one engine field.
3. **Probes are independent of the filler.** `fillPdf` writes with pdf-lib and confirms with a fresh pdf-lib parse;
   the probes read the saved bytes with **pdf.js**, a different parser: the field's value, whether a tick box is
   ticked, and (`shows`) the text the field's appearance stream actually draws, glyph by glyph, with a glyph missing
   from its font counted as a failure. That is what a viewer shows, so a value stored correctly but drawn as garbage
   (the standard fonts draw "Žluťoučký kůň" as "Žlu?ou?ký k??") fails.
4. **Metrics.** recall, precision, labels, shape and fill as above; labels also compare each option's label where the
   fixture lists `optionLabels`, and shape also checks `maxLength` where listed. `kept` counts fields the file already
   held (or left alone) that still hold their value after the fill. **False claims** are values `fillPdf` reported
   written that pdf.js refutes. Refusals count PDFs refused with the right reason.

What the probes do not see: whether drawn text fits inside its box. A line clipped by the box edge still draws the
right glyphs. The fill code sizes text to its box, and the end-to-end check (Chromium's own PDF viewer) is where
clipping was found and fixed; the benchmark does not measure it.

**Held-out fixture.** `ohlaseni-zivnosti` was written after the labelling rules were final and scored once; the rules
are not changed to fit it, so its misses stay in the baseline. `vyzivovane-deti` was written as a hard case before the
last round of rule changes and scored 5 of 12 labels first; the general rules added after it (the nearer side for a
tick box, labels that wrap, labels under a signature line, table column headers) bring it to 12 of 12, so it is no
longer a held-out number. The other four fixtures were written alongside the rules.
