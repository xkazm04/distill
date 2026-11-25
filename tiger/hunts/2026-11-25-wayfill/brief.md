# Territory dossier - Wayfill (form -> English wizard -> values written back)

Commit: 3043172 - written 2026-11-25

Area paths: `packages/engine/src/wizard.ts`, `guides.ts`, `form.ts`, `fill.ts`, `route.ts`, `prompts.ts`,
`types.ts`; `packages/pdf/src`; `apps/web/src/ui/Wayfill.tsx`, `guides.ts`, `guideStore.ts`, `HandrailPanel.tsx`;
`apps/web/src/ai.ts`; `apps/extension/src/sidepanel/`; `guides/`; `scripts/guides/`; `tools/handrail/src/mcp.ts`.

## Why this area

The person who owns the product picked it. It is the product's one capability with no ready substitute: a
residence, tax or benefits form in a language the person cannot read becomes an English (or Ukrainian) wizard, one
question at a time, and the answers are written into the original fields in the format each field expects, with
the values never leaving the device (`README.md:21-24`). The bp product tree marks it `major`, `live` since
2026-11-17 (`.ai/lens-scan/app-structure.json`, feature `wayfill-wizard`, contexts workspace-ui / engine-extraction /
engine-contract). Hunt (`tiger.mjs hunt`, 180 days at 3043172): its home group "Distill Engine" has the most heat
(65 of 100, 249 commits, 1223 kB). `packages/engine/src` is the hottest directory (heat 100, 165 commits).
`packages/pdf/src` ranks third (heat 33). The extension's recent churn is captions, not Wayfill: the last 14 days
show 103 caption commits against 44 engine commits (`git log --since=14.days`).

## Who uses it, for what

The users are people facing bureaucracy in a language or register that is not theirs: immigrants filling in
residence, tax and benefits forms; older people; anyone slowed by clutter or jargon (`README.md:13-17`). The first
corridor is Czechia: 21 target forms are listed in `docs/corridor/czechia.md:7`. Residence forms must be filled in
Czech, so an English wizard has to produce Czech-valid values (`czechia.md:79-80`). The job is to reach a correctly
filled official form without understanding the language, without handing personal data to a cloud, and with trust
that a step means what the official instructions say. It is done well when every required field is filled in the
expected format, the person knows what each question meant, and nothing was sent anywhere.

A 5-10 person validation protocol exists (`docs/corridor/validation-protocol.md:1-5`). No results are recorded.

## What it does today

**Entry.** In the web app, the Workspace "Fill a form" tab (`apps/web/src/ui/Workspace.tsx:222`) serves the routes
`#/demo/<id>/wayfill`, `#/page/<tab>` and `#/pdf/<tab>` (`apps/web/src/App.tsx:13-14`); opening a PDF goes straight
to Wayfill (`App.tsx:47`). Wayfill stays mounted across tab switches, so the step and answers survive
(`Workspace.tsx:110-114`). The extension side panel renders the same Workspace (`sidepanel/main.tsx:113`) and talks
to the page through `distill:getForm` / `readValues` / `writeValues` / `readErrors` (`sidepanel/host.ts:48-52`).
The person's own agent reaches it through the Handrail MCP tools `wayfill_schema` / `wayfill_propose` /
`wayfill_next` (`tools/handrail/src/mcp.ts:43,48,59`).

**Reading the form.** `extractForm` is at `packages/engine/src/form.ts:680-691` (reader `FORM_READER = "html/1"`,
`:678`). It enters open shadow roots and same-origin frames (`:59-86`, `:602-613`), detects "required" from
multilingual cues such as povinné and Pflicht (`:114-122`), and joins split day/month/year fields into one date
(`:342-404`). Field kinds are text, textarea, email, tel, number, date, select, radio, checkbox, file, other
(`types.ts:43-44`). The fingerprint (`fingerprint.ts:4-18`) is a SHA-256 of origin + path + ordered
(fieldId, kind, label), with no values.

**PDFs** (`packages/pdf/src`, about 3.1k lines in 11 files, `PDF_READER = "pdf/2"`, `read.ts:25`):
- Fillable AcroForms are filled into a copy; the original is never changed and the copy is saved as
  "<stem> (filled).pdf" (`apps/web/src/pdfHost.tsx:6,150-157`).
- Print-only PDFs get drawn overlays, verified with pdf.js (`printed.ts`, `overlay.ts`), and every step warns.
- A permission-protected file that allows filling is re-encrypted with the same permissions (`fill.ts:9-11`,
  `protect.ts:85`).
- Scans, XFA, signed or locked files and password-protected files are refused in plain words (`read.ts:28-55`).

**Building the wizard - one door, a strict preference order.**
1. The order of preference is library guide → this person's saved guide (Firestore, passed through the door
   again) → model → `basicWizard` (`Wayfill.tsx:219-242,329-332`).
2. The prompt (`prompts.ts:130-141`) asks for steps covering every required field in form order, with a made-up
   example that is never real personal data.
3. `parseWizard` (`wizard.ts:6-47`) is the validation door:
   - drops unknown or already-claimed fieldIds (`:19`);
   - rejects script URLs (`:18`);
   - renames duplicate stepIds (`:25`);
   - adds a fallback step for every required field the model missed (`:36-42`);
   - re-sorts the steps into form order (`:44-45`).
4. `basicWizard` (`Wayfill.tsx:19-51`) builds one step per field from the form's own label and format when no
   model is available, and the chip says "No AI used".

**Routing.** `buildWizard` is class `structure` (`route.ts:16`, default `prefer_on_device`, `:51`). The values
tasks `suggestValue`, `checkValue`, `explainError` and `translateErrors` are `only_on_device` (`route.ts:13-21,
38-44`). `apps/web/src/ai.ts` refuses if a pinned task is ever routed elsewhere (`:161-163`), and throws
"device-only" when `LanguageModel` is missing rather than let the SDK reach the cloud (`:164-167`). The cloud
timeout is 25 s with one retry on transient errors (`:311-328`). The inference source comes from the SDK
response, with a cautious default of "in_cloud" (`:335-340`).

**Guides** - wizards for one official form, checked by a named person:
- `packages/engine/src/guides.ts` is 402 lines.
- `parseGuide` enforces the review law (`:93-140`).
- `matchGuide`: an exact match wins over field overlap, with `GUIDE_MIN_OVERLAP = 0.5` (Jaccard) (`:25`,
  `:307-327`). `sameForm` compares the fingerprint, then the PDF title, then origin + path (`:283-300`).
- `guideWizard` keeps only the steps whose fields are unchanged and attaches the official quote (`:351-373`).
  Steps for new or changed fields are built by the normal path and merged in (`Wayfill.tsx:246-262`).
- Guide text exists in `en` and `uk` only (`guides.ts:17`).
- Scripts: `guide:new [--refresh]`, `guides:drift` (needs the network, exits 0/1/2) and `read-form.mjs` (happy-dom,
  page scripts off) (`scripts/guides/*`). `check-guides` runs in `npm run check`.
- Chips read "Checked guide", "Example guide" or "Draft guide, not checked" - never an AI chip
  (`apps/web/src/ui/guides.ts:53-62`).

**Answers and write-back.**
- Answers and the current step live in `sessionStorage` on the web (`guideStore.ts:29`) and in
  `chrome.storage.session` in the extension (`sidepanel/guideStore.ts`). The opt-in profile is `localStorage`
  `distill.profile.v1` (`profile.ts:5-21`); "Remember my answers" is off by default (`Wayfill.tsx:286`).
- Answers carry over from the previous page of the same site by label (`Wayfill.tsx:149-172`). A reload refills
  the steps already passed, never over what the page holds now (`:345-361`).
- Next writes the step, highlights it, re-reads the page's errors, and advances only when every field was written
  (`:527-548`). `fill.ts` counts a field as written only when the page holds the value afterwards (`fill.ts:1-3`).
- Value formats: radios, checkbox groups as a comma list, ano/yes words (`fill.ts:9,200-217`), selects, ISO dates
  through `toIsoDate` from D.M.YYYY (`:219,338-342`), split dates through `writeDate` (`:365`).
- Suggest and Check (device-only) appear only when the local model is `available` (`Wayfill.tsx:418,750-757`);
  otherwise `modelNote` says why (`:80-87`). `SourceChip` shows the source, the router's reason and the time taken
  (`chips.tsx:17-25`).

**What it does unusually well (evolve these):**
- **Proof of each write.** A write counts only when read back, and an unwritten step never advances.
- **Privacy by construction.** The canary payload-privacy tests (`packages/engine/test/privacy.test.ts`,
  257 lines; `packages/pdf/test/privacy.test.ts`) and a second lock before Firestore (`assertNoValues`,
  `apps/web/src/ui/data.ts:19,72`) guard it.
- **The one validation door, with graceful degradation.** Guide → saved → model → label-only, each step saying
  where it came from.
- **Real-world reach.** Shadow roots, frames, split dates, protected and print-only PDFs.
- **Agent proposals are bound to the form.** A proposal is bound to the form's fingerprint, the form is re-read
  and re-compared on Accept (`HandrailPanel.tsx:244-251`), and `stale_form` is returned when the page moved on.

## Measured state

Run at 3043172 on 2026-11-25 with `npx vitest run` per package; all suites pass:
| Suite | Pass |
|---|---|
| Engine, 13 Wayfill-related files (wizard 4, guides 17, privacy 9, fill 17, form 9, form-reach 9, form-required 9, errors 15, repair 9, schemas 6, route 6, corpus 8, editable-privacy 2) | 120/120 |
| `packages/pdf` | 68/68 |
| `apps/web/src/ui` (guides 13, guideStore 5, wayfill 4) | 22/22 |
| `apps/extension/src/sidepanel` | 7/7 |
| `tools/handrail` | 26/26 |

- The web UI is the thinnest-tested part: `wayfill.test.ts` has 4 tests against the 871-line `Wayfill.tsx`.
- `node scripts/check-guides.mjs` prints "clean (4 guide(s): 0 reviewed, 3 draft, 1 demo)".
- **The guide library has no reviewed guide.** The three Czech drafts (`guides/cz/vzp-prihlaska-pojistence.json`,
  `vzp-prihlaska-a-evidencni-list.json`, `oznameni-zmen.json`) say they were written by an AI and not checked
  (`vzp-prihlaska-pojistence.json:503-506`). Drafts show only with `VITE_GUIDE_DRAFTS=1` (`guides/README.md:17`), so
  production shows no library guide on any real form, while `README.md:24` promises checked steps.
- Guides exist for 3 of the 21 corridor forms.
- The on-device path is "not yet observed on real hardware" (`.ai/lens-scan/work/product-tree.json:267`).
- Not measured: wizard quality, step completion rates, on-device latency for `buildWizard`, user results.
  `npm run bench:forms` was not run.
- Registry map (`.ai/registry-map.json`, 2026-11-17): all 72 pairs `unknown`. form-guides and pdf-forms are absent
  (the map is stale since `42f119c`).

## Recent history

The repo started on 2026-11-17 (`8002bc6`, 410 commits). Wayfill was built in two days and then largely left
alone:
- **11-17:** the validation door and router (`1cfa333`); the 25 s cloud timeout (`35cf721`); "No AI used" steps
  (`8cc5311`); "nothing to fill" and staying on an unwritten step (`0b67ef4`); GuideStore on the device and one
  guide per tab (`3e58755`, `b741b6b`); reload restore (`ee971f4`); per-person saved guides
  (`759bf96`, `users/{uid}/formGuides`); Handrail proposals bound to the fingerprint (`1c3a018`, `f5c6018`).
- **11-18:** writes reach widgets, shadow roots and frames (`a8460a5`); readErrors and explainError, device-only
  (`760ace7`, `50dd84c`); fillable PDFs (`3985adb`, `4738ff8`, `be7314f`) and print-only PDFs (`238a09d`,
  `03fde23`, `96264b7`); the guide library, its door, matching and drift (`14b7199`, `7b9fec7`, `69c0547`,
  `0ce6158`, `25b46fc`, `196ad84`); drafts (`80c18c3`); drift and refresh (`965203e`, `a214ffa`).
- **11-21 to 11-23:** only contract stubs (`explainTerm` and `translateErrors` as values tasks). Since then the
  effort has gone into the extension's live caption. The caption's "form in your language" (`d05570b`) translates
  a form's words but is not a wizard; a caption wizard is planned as slice 5 (`docs/caption.md:92`), not built.
- **Owner decisions:** only a named person reviews a guide (`e36e4c2`, law in `CLAUDE.md`); a reader-only refresh
  of the same form keeps the review (`9125b8b`).
- No reverts. The three lens-scan Wayfill proposals have all landed (`.ai/lens-scan/ADOPT.md:43-47`).
- No rejected directions are recorded.

## Known limits and open questions

- **No checked guides.** Reviewing is a person's job, so no AI can close this gap. The repo has no path that
  makes a person's review cheap: a reviewer has to compare the JSON with the official instructions by hand.
- **Language of values.** The wizard asks in English or Ukrainian, but a Czech form expects Czech values for free
  text (`czechia.md:79-80`). Nothing translates or checks answer language today.
- **Kind gaps observed in code (verify before relying on them):**
  - A checkbox group renders as one "Yes" box from `options[0]` (`Wayfill.tsx:857-859`), while the write path
    expects a comma list (`fill.ts:206-213`).
  - Kind `date` also covers time, month and week inputs (`form.ts:55`), but is rendered as a text input
    (`Wayfill.tsx:868`) and written only as YYYY-MM-DD.
  - `file` fields are never filled (`fill.ts:413`; `Wayfill.tsx:864`).
  - A custom dropdown whose options were never shown falls back to typed text (`Wayfill.tsx:835-837`).
- **PDFs not supported:** scans and XFA (`pdf/src/read.ts:34,38`). The PDF path is web-only (`pdf/src/index.ts:1-3`).
- **Cross-origin frames** are skipped silently (`form.ts:602-613`).
- **Open owner question:** where "Remember my answers" goes in the caption (`docs/caption.md:213`).
- **Unanswered:** how good model-built wizards are on real Czech forms, and whether the 5-10 person validation will
  run before the deadline.

## Constraints

- **Deadline.** #BuildHybridAI Devpost deadline 2026-11-30 14:00 PT, five days away (`CLAUDE.md:7`). Moves that
  land and demo before then are worth more; label longer ones honestly.
- **Wire contract.** `packages/engine/src/types.ts` names are exact and shared with the web app, the extension,
  Handrail and Android (exported JSON Schema). Absent optional fields are omitted, never `null`.
- **Values never leave the device.** Cloud-eligible prompts take `FormStructure` (no values). Values-class tasks
  route `only_on_device`, have no cloud fallback, and say so when no local model exists. Firestore never stores a
  value. Never weaken the payload-privacy test.
- **Say where it ran.** Every AI result shows its `inferenceSource` and, while it matters, the local model state.
- **Model output is untrusted.** Wizards pass `parseWizard` and guides pass `parseGuide`: closed vocabulary, no
  HTML, dropped items counted.
- **The original page is never lost.** For PDFs, the original file is never changed.
- **Only a named person reviews a guide.** An AI writes `draft` only and never sets `reviewer` or `reviewedOn`.
  Editing a reviewed guide's text returns it to draft. A proposal may make a person's review easier, never skip it.
- **Secrets.** Firebase config comes from `.env`; `npm run secret-scan` runs in `npm run check`.
- **Gates.** `npm run check` (typecheck, tests, secret scan). Tests are hermetic.
- **Stack.** TypeScript and React (Vite) in the web app and the MV3 extension, pdf-lib and pdf.js, Firebase AI
  Logic hybrid inference with Gemini Nano on the device, and Kotlin for Android (out of scope here).
- **Out of scope:** the live caption and Recast, except where they connect to Wayfill; generic hygiene.

The area is LLM-powered (`buildWizard`, `suggestValue`, `checkValue`, `explainError`): the engine checklist lens (the tiger skill's
`references/llm-lens.md`) applies - use it where a proposal touches a call site.
