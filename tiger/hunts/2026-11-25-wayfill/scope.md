# Scope - Wayfill, 2026-11-25

**Thesis.** Make Wayfill's promise literally true before the deadline. Every answer in the wizard is honest
(nothing erased, every choice answerable in the reader's language, a final account re-read from the form), and the
first guide checked by a named person becomes one sitting of work instead of a manual audit.

The three core clusters A, B and D were proposed independently by all three seats, GPT included. Nothing below is
built until it is ticked.

## Core

| ID | Item | Sources | Effort | Verify |
|---|---|---|---|---|
| C1 | **Never erase or untick.** Read each step's fields on entry and show a page value the wizard did not write as "already on the form". Next writes only fields whose answer differs (`sameAnswer`); clearing a field is an explicit action. A tick group gets one tick per option and holds the comma list. | P18 (lead), P05, P04, P14 | M | New component tests, each failing today: typing in the original and then Next keeps the value; Forget then Next leaves the page unchanged; on aria-choices.html two of four ticks hold and a box the page had ticked stays ticked. `npm run check` is green. |
| C2 | **The finish account.** At the end, re-read values and errors once. Per field, in the reader's language beside the Czech label, show one of: in the form, changed since, required and empty, page error, could not confirm. Each row links to its step. Save or Show original asks once while a required answer is empty. A count is said only for what the re-read confirms. | P07 (lead), P13, P05, P18 | S-M | Unit tests for `account()` cover all statuses. Skipping a required step gives a required-empty row whose link lands on that step. A field a script clears after its write gives a changed row that is not counted. A date the browser reformats is ok. The privacy tests are unchanged. |
| C3 | **Options in your language.** `buildWizard` returns optional `step.options` labels in the reader's language. `parseWizard` keeps only real option values and counts what it drops. The UI shows the translated label with the Czech original beside it and still writes the option's value. With no model, options stay as written and say so. | P04 (lead), P14 | S | On health-insurance.html, "duvod" shows four translated labels with their originals, and the chosen value (1-4) reads back. A door test drops and counts a foreign value. One additive optional field on `WizardStep`, in the schema and the Android export. |
| C4 | **Guide review sheet.** `npm run guides:review -- <id>` (network, not in check) checks every `official.text` with `findSentence` against the instructions (PDF blocks, HTML through happy-dom, and neighbouring blocks joined). The verdict is found with its paragraph, not found, or could not read. It writes a git-ignored sheet: Czech labels, en and uk side by side, steps with no quote first, review notes as tick boxes, and the README commit template. It never writes status or reviewer. | P08 (lead), P16, P01, P12, P19 | S | A verdict for all 19 quotes of the three drafts. Unit tests: a paraphrase is not found; other dashes are found; a sentence split across two blocks is found. The person's review commit, outside this run, then moves check-guides from 0 reviewed. |

## Supporting

| ID | Item | Sources | Effort | Verify |
|---|---|---|---|---|
| S1 | **Text lock for reviewed guides.** An optional `reviewedText` digest covers steps, notes, quotes, field ids and kinds (not labels, so a reader-only refresh still keeps the review). `parseGuide` and check-guides refuse a reviewed guide whose text changed. | P01, P16, P19 | S | Changing one word of a reviewed fixture step makes check-guides exit 1; `guide:new --refresh` on the same form still passes. |
| S2 | **Drift watches the instructions.** guides:drift also re-reads `instructionsUrl` and names the step whose quote no longer exists. | P19, P16 | S | A local instructions fixture with the quoted sentence edited (form unchanged) gives a drift line naming the step and exit 1. |
| S3 | **Script check.** A form or guide that says answers are in Latin letters stops Cyrillic before it is written, with one sentence. No model. | P06 part 1 | S | Cyrillic typed into a cz/oznameni-zmen step does not reach writeValues, and the sentence shows. |
| S4 | **Per-language sign-off** (changes the review law in guides/README.md - your decision). An optional `reviewedLangs`: a Czech-English reviewer releases the English wizard, and Ukrainian readers get the normal path until someone reviews it. | P16, P08 | S | An English-only sign-off shows "Checked guide" to English readers and the normal path to Ukrainian readers. check-guides enforces the key. |

## Leaps

| ID | Item | Sources | Effort | Verify |
|---|---|---|---|---|
| L1 | **Papers by label.** A closed vocabulary of nine identity facts matched by exact Czech, English or Ukrainian label, with sections naming another party (matky, zástupce, zaměstnavatel...) excluded. An opt-in device vault keyed by fact stores only answers that were read back. The next form proposes them in each field's format, with no model and nothing written until Next. Addresses are never guessed. | P17 (lead), P03, P11 | M | With AI off: fill health-insurance.html, open address-change.html, and surname, first name and phone are proposed (3 of 3) while the address fields stay empty. The mother's field on the VZP form gets no concept. Vault canaries reach no prompt and no Firestore write. |
| L2 | **"Put into Czech" on the device.** Chrome's on-device Translator API, with a back-translation, offered for free-text fields only, never automatic, and refused with a note when unavailable. It is a new values task and follows `only_on_device`. | P10 (lead), P06 | M | Route test: values / only_on_device. A stubbed-Translator e2e shows the answer written in Czech and read back, with 0 requests carrying it. A glossary score is measured on real hardware before the feature is turned on. |
| L3 | **Ground AI steps in the PDF's own printed instructions** (PDF only). The model cites a sentence, the door keeps it only when `findSentence` finds it, and drops are counted. The caption says "This form's own words" and the AI chip stays. | P09 (lead), P02, P20 | M | A door test drops an invented sentence. The share of verified quotes is reported on the pdf corpus. The privacy canary is extended to the grounded prompt. |

**Left out:** P15 (two notices from one move: it needs reviewed mappings), P21 (VZP conditional section: it needs
a reviewed guide), and review mode inside Wayfill (L, after the deadline). Details are in verdict.md.

**Dependencies:**
- C2 needs C1, and C3 shares C1's choice rendering, so they go in one lane in the order C1 → C3 → C2.
- S1 and S4 build after C4; S2 reuses C4's reader.
- S3, L1, L2 and L3 are independent.
