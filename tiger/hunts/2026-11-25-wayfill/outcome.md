# Outcome - Wayfill hunt 2026-11-25

Run branch `tiger/wayfill` (from master 3043172). Three builder lanes merged in order C(1) -> A -> B -> C(2). The full
`npm run check` was green after every merge. Final run: engine 661, pdf 68, web 301, extension 530 and handrail 61
tests pass; check-guides, secret-scan, check-tokens and check-csp are clean.

| Item | Commits | Verify | Result |
|---|---|---|---|
| C1 Never erase or untick | 371e136, 2c9131d | Seven new component tests in `wayfillPage.test.tsx`: 6 fail before the change, all 7 pass after. Covered: typing in the original then Next keeps the value; Forget then Next leaves the page unchanged; on aria-choices, 2 of 4 ticks hold and a box the page ticked stays ticked. `fill.test.ts` 22/22 (sameAnswer). | landed |
| C3 Options in your language | 7d3be47, 2b1370d | health-insurance "duvod" shows translated labels with the Czech originals and writes `2`, read back `2`. The door test drops and counts foreign values (6 counted). The component tests fail before the change (3 failed / 10). | landed |
| C2 Finish account | c02db63, a064fe2 | `account.test.ts` 5/5 cover all six statuses (a reformatted date is ok). Component tests: a skipped required step gives one required-empty row whose link lands on it; a field a script clears is "changed" and not counted; print-only PDF rows say "Could not confirm". All fail before the change. | landed |
| C4 Guide review sheet | e8b3b15 | `quotes.test.ts` 6/6 (paraphrase not found; other dashes found; a sentence split over two blocks found; unreadable never found). Live `guides:review` on the three cz drafts: **19/19 quotes found word for word** (one only across blocks b18+b19). | landed |
| S1 Text lock | a19d549 | One changed word in a reviewed fixture step makes check-guides exit 1; a real `guide:new --refresh` that relabels 3 fields keeps the review and passes. | landed |
| S2 Instruction drift | ea11e03 | Local fixture with the form unchanged and the quoted sentence edited: the form line is ok, a new line names the step, exit 1. Live drift: all forms and instructions hold, exit 0. | landed |
| S3 Latin-script check | 26ea0de, d8465b9 | `script.test.ts` 4/4. Component test: Cyrillic never reaches writeValues and the sentence shows; Czech diacritics are written and read back. | landed |
| S4 Per-language sign-off | ea4d6ec | Web test: an English reader of an en-only sign-off sees "Checked guide"; a Ukrainian reader gets the normal path with no guide chip. check-guides exits 1 without `reviewedLangs`. The README review law is updated (owner's decision 2026-11-25). | landed |
| L1 Papers by label | 930bc1d, d8465b9 | papers 12/12 plus a snapshot over 116 guide fields (20 get a fact, 0 wrong; still needs a person's check). AI off: health-insurance then address-change proposes surname, first name and phone (3/3) with the address fields empty and no AI call. Privacy canaries: 0 in prompts, 0 in Firestore. | landed |
| L2 Put into Czech | 9539e72, d8465b9 | `route.test.ts`: translateAnswer is values / only_on_device. With a stubbed Translator: offered, chosen, written and read back, with no request. Unavailable gives a plain note with nothing sent. **Real-hardware quality is not measured** (stub only). | landed (stub-verified) |

## Found while building (not items)

- **Fixed as a side effect of C1:** Next on a step with a file field always said "Could not fill in", because it
  sent `""` to the file field and file writes always fail.
- **Fixed for the instructions reader only:** happy-dom stops parsing at a `<style>` inside an inline SVG
  (ipc.gov.cz), so the instructions came back empty. `readForm`, used by `guide:new` for web forms, still has the
  bug (backlog).
- **Backlog:**
  - A model wizard that leaves out an optional field gives that field no step (P05 part 3).
  - The radio group's `aria-labelledby` points at an id no element has.
  - Option values containing commas cannot be told apart in the comma-list encoding.
  - `extractPage` returns ipc.gov.cz as one block.
  - The language detector runs on every keystroke for "Put into Czech" (no debounce).
  - The translator note repeats under each eligible field.

## Decisions made while building

- Stepper "done": every non-file field written, except that an optional field left empty does not hold the step
  back (lane A's reading; the strict reading is available).
- GuideStep does not take `options`: guide files have a fixed key list, and option wording would need the review
  law.
- S3 derives the script rule from the form's language, with no new guide key.
- The text lock covers steps, notes, quotes, field ids and kinds; `instructionsUrl` and `formName` are not locked.
- CLAUDE.md's guide-review paragraph does not yet mention per-language sign-off or `reviewedText`. It was left for
  the owner.
