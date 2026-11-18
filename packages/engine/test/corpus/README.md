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
  "byHand": [{ "type": "#jmeno", "text": "Olena" }, { "click": "..." }, { "choose": "select", "option": "..." }, { "pick": "input[type=date]", "value": "1990-03-05" }]
}
```

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
3. **The engine run**, on another fresh copy: `extractForm(document)` on the top document, as the web app and the
   extension call it, then `writeValues` with the values, then the probes.
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
