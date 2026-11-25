# Verdict - Wayfill hunt 2026-11-25

Judge: the caller session (claude-opus-5-5, the same family as two seats - say so when crediting).
Seats: codex:gpt-6.2-astra@xhigh, claude:claude-opus-5-5@xhigh, claude:claude-fable-5-2@xhigh - all three live, all
completed both rounds. 21 proposals (15 round 1 + 6 fusions), every anchor valid.

The pool was judged from `pool.md` (seats hidden). `pool.json` was opened only after the clusters were fixed, to
name which seats agreed.

## Premises verified in code (at 3043172)

| Claim | Where | Verdict |
|---|---|---|
| A checkbox group renders as one "Yes" box from `options[0]` | `apps/web/src/ui/Wayfill.tsx:856-859` | true |
| The write path then sets every box to the wanted list, so the other boxes are unticked | `packages/engine/src/fill.ts:205-213` | true |
| The page's values are read once, at build | `Wayfill.tsx:328` (only `readValues` call) | true |
| Next sends `""` for every field of the step | `Wayfill.tsx:530-531` | true |
| `writeText("")` clears the field | `fill.ts:158`, `fill.ts:148-153` | true |
| "Forget my answers" empties the answers, so the next Next clears what the page holds | `Wayfill.tsx:579-583` | true |
| Skip moves on with no required check | `Wayfill.tsx:529`, `:784` | true |
| A step counts as done when any of its fields was written | `Wayfill.tsx:682` | true |
| The done card counts from memory | `Wayfill.tsx:797-799` | true |
| The profile is keyed by fieldId | `apps/web/src/ui/profile.ts:16-21` | true |
| `findSentence` folds quotes, dashes and spaces | `packages/engine/src/gist.ts:35-54` | true |
| Drafts are left out of shipped builds | `scripts/guides/library.mjs:37-44` | true |
| drift reads only the form, never `instructionsUrl` | `scripts/guides/drift.mjs:27` | true |
| A guide needs a reviewer for each wizard language | `guides/README.md:59-62` | true - one Czech-English reader cannot release a guide alone |
| The PDF writer draws Cyrillic | `packages/pdf/src/fill.ts:5-7` | true |
| The ministry form asks for Latin block capitals | `guides/cz/oznameni-zmen.json:130` | true |
| The repo uses no Translator API or LanguageDetector | grep over `apps`, `packages` | true |
| The Prompt API does not list cs or uk | external (developer.chrome.com) | not verified here; plausible |

## Clusters (cross-seat agreement)

| Cluster | Members | Seats | Peer mean | Value | Conf. | Effort | Call |
|---|---|---|---|---|---|---|---|
| A. Never erase or untick; tick groups work | P18 (lead), P05, P04 (groups), P14 | Opus, Fable, GPT | 9 / 8.5 / 6.5 | high - silent data loss on a legal form | high (verified) | M | core |
| B. Re-read, bilingual finish account | P07 (lead), P13, P05 (4), P18 (4) | Opus, Fable, GPT | 7.5 / 6.5 / 9 | high - the validation protocol's zero-tolerance claim | high | S-M | core |
| C. Options in the reader's language | P04 (lead), P14 | Fable, GPT | 8.5 / 6.5 | high - choices are where a legal outcome changes | high; translation quality not measured | S | core |
| D. Guide review sheet with machine quote check | P08 (lead), P16 (1-2), P01 (1), P12, P19 (1-3) | Opus, Fable, GPT | 9.5 / 8 / 5 | high - the only route from 0 checked guides | high | S | core |
| E. Text lock for reviewed guides | P01 (3), P16 (3), P19 (4) | Fable, Opus | - | medium - makes the law mechanical | high | S | supporting |
| F. Drift watches the instructions too | P19 (drift), P16 (4) | Opus, Fable | - | medium | high | S | supporting |
| G. Script check (Latin-only forms) | P06 (1) | Fable | 5 (whole P06) | medium - cheap, real bug on the ministry PDF | high | S | supporting |
| H. Per-language sign-off | P16 (3), P08 (4) | Fable, Opus | - | medium-high - lets one bilingual person release | high | S | supporting - **changes the review law, needs the owner's decision** |
| I. Papers by label | P17 (lead), P03, P11, P15 | Fable, Opus, GPT (P15) | 6.5 / 4.5 / 3 | high | medium - wrong-party risk | M (slice) | leap |
| J. On-device Translator for free-text answers | P10 (lead), P06 (2) | Opus, Fable | 6 / 5 | high for the corridor | low-medium - hardware and language packs not measured | M | leap |
| K. Ground steps in the PDF's printed instructions | P09 (lead), P02, P20 | Opus, Fable, GPT | 5 / 4 / - | medium | low - on-device quota, relevance not measured | M | leap |

The peer means are each proposal's own score, in member order, with the seat's own rating excluded. Agreement
between Opus and Fable alone is weaker evidence: E, F, G, H and J have no GPT support.

## Left out, and why

- **P15 two notices from one move:** it needs reviewed field mappings, and none exist; peers gave it 3/10. Kept in
  the backlog as the vault's later destination.
- **P21 VZP conditional section:** it needs a reviewed guide first; it becomes possible after D lands and a person
  reviews the VZP guide.
- **P01 part 2, review mode inside Wayfill (attestation export):** L effort and more UI than the deadline allows.
  The script sheet (D) delivers the same review value. Backlog.
- **P20 bundled public blanks:** it needs an authoring pipeline per form; superseded for now by K's PDF-only v1.

## Dependencies

- B builds on A's `sameAnswer`, so build A before B.
- C and A both touch FieldInput's choice rendering: one lane, A first.
- E and H extend D's guide schema: build after D.
- F reuses D's `readInstructions`.
- G is independent. I is independent of the rest, but its writes go through A's reconciled commit.
