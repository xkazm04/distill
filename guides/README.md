# The guide library

A guide is a step-by-step wizard for one official form, written from the authority's own instructions and checked by
a person. When the form a person opens matches a guide, Wayfill shows the guide's steps instead of asking a model to
explain the form. On a legal form a confident wrong explanation is the worst failure the product has; a checked guide
is the answer to it.

Guides are JSON files in this folder, `guides/<country>/<slug>.json`, in the format of
[`packages/engine/schemas/guide.json`](../packages/engine/schemas/guide.json) (the `FormGuide` type in
[`packages/engine/src/types.ts`](../packages/engine/src/types.ts)). There is no other store: a guide becomes
"reviewed" only through a commit to this repository. Nothing a person does in the app can add or change a guide.

## Statuses, and what a person sees

| Status | Who sets it | Used on real pages | What the guide view says |
| --- | --- | --- | --- |
| `draft` | Whoever writes the guide, person or AI | No. Only in a developer's build with `VITE_GUIDE_DRAFTS=1` (the web app's dev server, or the extension's own build), and the builds people use do not even contain drafts | "Draft guide, not checked" and "This guide is a draft. No person has checked it against the official instructions yet, so do not rely on it." |
| `reviewed` | A person, by the commit that adds `reviewer` and `reviewedOn` | Yes | "Checked guide" and "Checked against the Ministry of the Interior's instructions on 2026-11-20." with a link to those instructions, and "Checked by <reviewer>." |
| `draft` with `"demo": true` | Only for Distill's own made-up demo form | Only on the guided demo form (`/demo/guided-form.html`) | "Example guide" and "An example guide for Distill's made-up demo form. No office issues this form, so no official instructions were checked." |

A guide is never labelled as an AI result: it shows no "On this device" or "In the cloud" chip, because no model ran.
If the form changed since the guide was written, the steps for the new or changed fields come from the normal path
(the model, else the form's own labels) and those steps carry their own chip.

## Writing a guide

1. **Read the form.** `npm run guide:new -- <address>` reads a web form, or a PDF by its address or a local path, the
   way the product reads it, and writes `guides/cz/<slug>.json` with the real field list, the fingerprint and one step
   per field (`--id cz/<slug>` to name it, `--form <n>` for the n-th form on a page). Every place only you can fill
   says `TODO`, and `npm run check-guides` fails until none is left.
2. **Read the official instructions.** Find the authority's own instructions for this form (the "Poučení", the
   instructions page, the explanatory notes). Put their https address in `instructionsUrl` and the form's in
   `officialFormUrl`. Do not write a guide from general knowledge, a forum or a model's answer.
3. **Write the steps.** Group fields the instructions treat together (name and surname, an address) into one step, in
   the form's order. For each step write `question` and `explanation` in plain words, in English (`wizards.en`) and
   Ukrainian (`wizards.uk`); both languages have the same steps over the same fields. Use `expectedFormat` and
   `example` when the form wants a format. When a step rests on a sentence of the instructions, quote it word for word
   in `official` (`text`, `lang`, and `url` if it is on another page than `instructionsUrl`). Never paraphrase inside a
   quote.
4. **Notes for the whole form** go in `wizards.<lang>.notes`: what a newcomer must know before step 1 (for example
   that a residence form must be filled in in Czech, or where it is filed).
5. **Say what you are unsure of** in `reviewNotes`: a translation you could not check, an instruction you could not
   find, a field the instructions do not mention. These are for the reviewer and are never shown to a person.
6. Run `npm run check-guides`. The guide stays `draft`.

Plain text only: no HTML, no Markdown, no entities, single spaces, at most 400 characters per question or
explanation (600 for a quote or a note). The check enforces this, because every guide passes the same door as model
output when the app loads it.

### Who may write one

Anyone, including an AI. An AI-written guide is always `draft`, carries a `reviewNotes` entry that says so, and an AI
never sets `reviewed`, `reviewer` or `reviewedOn`.

## Reviewing a guide

"Reviewed" means a named person compared the guide with the official sources and takes responsibility for it.

**Who may review:** a person who reads Czech well enough to read the official instructions, and who reads the language
of each wizard they sign off (English, Ukrainian). If no one person reads both, the guide needs one reviewer per
language; name each in `reviewer` with what they checked ("Jana Nováková (cs, en); Olena Koval (uk)"). The reviewer
should not be the guide's only author. An AI is never a reviewer.

**What they compare against:**

- The form at `officialFormUrl`: is `match.fields` the form as published today (`npm run guides:drift` shows it)?
- The instructions at `instructionsUrl`: does every explanation agree with them, and does no step add a claim they do
  not make? Is every `official.text` word for word as published?
- The Ukrainian and English text: does each say the same as the other, in plain words a newcomer understands?
- Every entry in `reviewNotes`: resolved, and removed.

**How:** one commit that sets `"status": "reviewed"`, adds `"reviewer"` and `"reviewedOn"` (the date of the check,
YYYY-MM-DD), and removes `reviewNotes`; its message names the reviewer and the instructions checked, for example
`review(guides): cz/oznameni-zmen checked against ipc.gov.cz instructions by Jana Nováková`. The commit is made by
the reviewer, or by a maintainer quoting the reviewer's written confirmation in the message. `npm run check-guides`
refuses a reviewed guide without a reviewer, a date, or with open review notes.

Any later change to the steps, the notes or the fields of a reviewed guide sets it back to `draft` (remove `reviewer`
and `reviewedOn`) until it is checked again. Fixing a typo that changes no meaning still gets a new `reviewedOn` by a
reviewer.

One exception: a reader-only refresh (`npm run guide:new -- --refresh <id>`, see [Drift](#drift)) keeps the review.
It applies only when the form is shown to be the same one (the same source digest or fingerprint, the same fields in
the same order and of the same kinds) and it changes only what the reader produces, never the steps, notes or quotes.
When the script cannot show the form is the same, it returns the guide to `draft` itself.

## How a guide is matched

All matching happens on the device: the web app loads the whole library from its own origin
(`guides/library.json`, one fixed address) and the extension carries it inside its bundle, so looking a guide up
sends nothing about the page a person is on.

- **A web form** is known by its addresses (`match.urls`, origin and path; list both the old and the new host when an
  office moved, see `docs/corridor/czechia.md`). **A PDF** has no address (the file name can be a person's name), so it
  is known by the title read from the document (`match.titles`) and its fields.
- **Exact:** the form's fingerprint is one of `match.fingerprints`, or every field is the same (id, kind, and a label
  equal up to case, spacing and a star). The guide is used whole.
- **Changed:** the same form, but fields were added, removed or relabelled. If the shared fields are at least half of
  all the fields of both versions (`GUIDE_MIN_OVERLAP`, 0.5), the guide's steps are used for every step whose fields
  are all unchanged; the new and changed fields get steps from the normal path; and the person is told: "This form
  changed since the guide was checked on <date>: N of its fields are new or different, so their steps are not from the
  guide." Below 0.5 the guide is not used.
- Order: a reviewed guide, then the person's own saved guide, then the model, then the form's own labels.

## Drift

Authorities change their forms without notice, and Distill's readers change too. A guide's fingerprint is made of the
labels the reader produces, so it changes when the form changes **and** when the reader's label rules change. A guide
therefore records which reader read its fields (`match.reader`: `html/<n>` is the engine's `FORM_READER`, `pdf/<n>`
is `@distill/pdf`'s `PDF_READER`) and a digest of what it read (`match.source`: a PDF's bytes; a web form's controls and
their text, without values). `guide:new` writes both. A reader's version goes up with every change that can change
what it reads from the same form; for the PDF reader `packages/pdf/test/corpus/reader.json` records what the corpus
reads as, and `npm run check` fails when that changes while `PDF_READER` stays the same. `npm run check-guides` notes
(without failing) every guide read by another version of its reader.

`npm run guides:drift` re-reads each guide's form (a web guide's addresses, a PDF guide's `officialFormUrl`) and, for
every guide whose fingerprint no longer matches, says which of three it is:

- **The reader changed, the form did not** (`~`): the source is the same file. Run
  `npm run guide:new -- --refresh <id>`. It re-reads the form with today's reader and refreshes only what the reader
  produces (`match.fields` labels, the fingerprint, the title, `match.reader`, `match.source`); it never touches the
  steps, notes or quotes, and it keeps the status, because no checked text and nothing about the form changed. It
  refuses when a field was added, removed or changed kind: the steps no longer fit, and that is the next case.
- **The form changed** (`!`): the source differs. Run `npm run guide:new -- <address> --id cz/<slug>-new` to read the
  new version, carry the new `match` into the guide, rewrite the affected steps from the current instructions, delete
  the scratch file, and set the guide back to `draft` until it is reviewed again. Keep the old fingerprint in
  `match.fingerprints` only while the old version is still in circulation. Until the guide is updated, the app keeps
  using its unchanged steps and tells the person the form changed.
- **Cannot tell** (`!`): the guide recorded no source. `guide:new --refresh` records it; when the reading is not
  exactly the guide's, it cannot know the form is the same, so it returns a reviewed guide to `draft` with a review
  note saying why.

Drift uses the network, so it is not part of `npm run check`; run it before a release, at least monthly, and after
every change to a reader's version.

A print-only PDF (no form field; Distill found the places to write on from the printed page) is a `pdf` guide like
any other: its field ids name each place by page and position (`p1-x293-y630`), which do not change while the file
does not. `guide:new` says in the skeleton's review notes when a form is print-only.

## The demo guide

`cz/demo-guided-form.json` is for Distill's own guided demo form (`apps/web/public/demo/guided-form.html`, the example
"A form with a ready guide"), which is made up and says so on the page. It exists so the library can be seen and
tested end to end without the network. It is `"demo": true`, always `draft`, matches only the path
`/demo/guided-form.html`, and is labelled as an example. The first demo form (`/demo/form.html`) deliberately has no
guide: it is where the model's wizard, on the device or in the cloud, is shown.
