# Tiger backlog

## Kept, not chosen

- **L3 Ground AI steps in the PDF's own printed instructions** (P09, P02, P20) - 2026-11-25-wayfill. Peers 4-5/10; on-device quota and relevance not measured.
- **P15 Two change-of-address notices from one move** - needs reviewed field mappings first.
- **P21 VZP conditional representative section** - needs a reviewed VZP guide first.
- **Review mode inside Wayfill with attestation export** (P01 part 2) - L; the guides:review sheet covers review today.

## Found while building (2026-11-25-wayfill)

- `readForm` (guide:new for web forms): happy-dom stops at `<style>` inside inline SVG - fixed only in readInstructions.
- A model wizard that omits an optional field gives it no step; add basic steps and an "AI covered N of M" count (P05 part 3).
- Radio group `aria-labelledby` points at a missing id (Wayfill FieldInput).
- Comma-list encoding cannot represent option values containing commas.
- `extractPage` returns ipc.gov.cz as one block (site form makes it look like a form page).
- "Put into Czech": detector call per keystroke (debounce); translator note repeats per eligible field (once per step?).
- L2 real-hardware check: Translator quality on a 50-term corridor glossary (en->cs, uk->cs), gesture rule for pack download.
- L1: a person checks `packages/engine/test/fixtures/papers-concepts.json` (20/116 fields mapped; OP/pasu/povolení -> passport number is a judgement call).
- CLAUDE.md guide-review paragraph: mention per-language sign-off (`reviewedLangs`) and `reviewedText` - owner's call.
- Next real step outside code: a Czech-reading person runs `npm run guides:review -- cz/oznameni-zmen` and signs off the first guide.
