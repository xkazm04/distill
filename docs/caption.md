# Caption: Distill on the page itself

**Decision (owner, 2026-11-21):** the extension's interface becomes **R2-B "Caption"** from the recompose prototype
rounds. Distill works on the real page, and its only surface is one strip docked at the bottom of the page, like subtitles.
The strip is slim at first sight. It grows upward into a caption during a tour, and into a short sheet at the end.
There is no sidebar.

**Decisions (owner, 2026-11-21):**

1. **The default surface.** The toolbar icon switches from the side panel to the caption once slices 1 to 5 meet the
   live bar.
2. **Cookie walls.** Clean hides a consent wall **without answering it**: Distill never clicks "Accept" or "Reject" for
   the person.
3. **Tours are optional and start only when the person asks for one.** The strip suggests no next step. Once tours
   exist, a manual trigger starts them (in the strip, or in More). Nothing past Clean and Translate starts on its own.

This file is the plan to make it real, and the bar the real thing must meet. It is written to stand on its own: the
prototypes are local-only and are not committed.

**Status:** slice 1 is built behind a build flag:

- Clean, What was removed, Original, the strip and the model state.
- The live-site e2e that measures the strip against the prototype's bar.

The side panel is still what the toolbar icon opens in every shipped build.

## What the person sees (the R2-B target)

| Moment | What is on screen |
| --- | --- |
| **Click on the icon** | Clean runs at once: ads, cookie walls, pop-ups, menus, sidebars, comments and related links fade out (180 ms). The strip slides up from the bottom (240 ms). Then **Translate** runs on its own when the page is not in the reader's language, with a one-tap **Keep Czech**. Nothing else starts by itself. |
| **First sight** | One line saying what Distill did: "Removed 17 distractions · Translated from Czech". Next to it: the source chip ("On this device" / "In the cloud"; its reason shows on hover), **Keep Czech** (from slice 2), **More** and **Original**. No next step is suggested (decision 3). At most 5 controls. Distill takes at most 8% of a 1440x900 window and 15% at 390x844. |
| **A tour (Refocus), when the person starts one** | The tours trigger lists the page's intents ("Just the facts", "Fill it in English", "Just the recipe", "Call or write"); the person picks one. The strip grows into a caption: a step count, the key value large (24 px), one sentence (16 px), Back / Next. The page keeps its full width. The stop gets a highlighter on its exact words (CSS Custom Highlight API), with no dim. Secondary detail is folded behind **Details**: the Czech original, "the page says", the reason it ran where it did. Nothing scrolls inside the caption; a step that does not fit is too long. |
| **Form** | Wizard steps in the caption, one at a time. A whole address step shows its fields in one row along the bottom. Each field shows the English label with the Czech one beside it. Answers are written into the real fields as you go. **Remember my answers on this device** never uses the cloud. |
| **Video** | The sponsor segment is marked and skipped in a beat. Each recipe step seeks the player, with "Play this step" and timers as a chip in the strip. |
| **Old sites** | A magnifier for tiny text (phone numbers in a 9 px footer), tap-to-call, and the hours caveat ("found in a 2024 post; the site was last updated 2019"). |
| **End of a tour** | A short sheet, at most 45% of the window, built from a closed kit of cards (facts, checklist, timeline, steps, contact, hours, table). Every card links back to its source on the page (provenance). |
| **Original** | One tap shows the untouched page. The strip stays, saying "Showing the original page", with **Back to Distill**. |
| **More** | What was removed (each item can come back, or all of them), the model state with "Download the model", the full side panel, and "Close Distill on this page". |

Motion is quiet: short distances, one thing moving at a time. With reduced motion every change is an instant swap.

## Architecture

```
toolbar click ──> service worker (background.ts)
                   activeTab grant -> chrome.scripting.executeScript(content.js) -> "distill:caption:open"
                        │
                        ▼
content script (content.ts -> caption/page.ts), in the page
   - <distill-caption> fixed at the bottom, closed shadow root, z-index max
       └─ <iframe src="chrome-extension://…/caption.html?tabId=N">   (web_accessible_resources)
   - a spacer at the end of <body>, so the page's last lines scroll clear of the strip
   - page changes, all reversible: [data-distill-hide] (Clean), html[data-distill-original] (Original),
     html[data-distill-unlock] (scroll after a cookie wall); later: text replacement (Translate/Simplify),
     CSS highlights (tours), field writes (Wayfill)
                        ▲  chrome.tabs.sendMessage(tabId, req, { frameId: 0 })   (never window.postMessage)
                        │
caption frame (caption.html -> src/caption/frame/main.tsx), an extension page
   - React, the brand theme roles, self-hosted fonts: the page's CSS and scripts cannot reach it
   - AI through @distill/web/ai (Firebase AI Logic hybrid inference, route()), exactly as the side panel does today
```

Why an extension frame and not UI drawn in a shadow root in the content script:

- **Isolation.** No page CSS reaches the strip; the live e2e checks the strip's font on every site.
- **Reuse.** `ai.ts`, the theme, the fonts and the Wayfill logic run unchanged in an extension page.
- **Privacy.** The page's scripts cannot read what the person types into the strip before it is written into a field.

Messages between the frame and the page side use `chrome.tabs.sendMessage` to the top frame only. The page can
forge a `window.postMessage`; it cannot forge an extension message. The contract is `src/messages.ts`
(`distill:caption:*`).

The flag: `VITE_SURFACE=caption` in `.env` makes a developer's own build open the caption from the icon. The public
build and every test build open the panel. The caption code is in every build; the e2e build starts it through a
service-worker hook (`__distillCaption`, e2e mode only), because a test cannot click the toolbar.

## From the prototype to the product

| Prototype feature (R2-B) | Real pieces | Slice |
| --- | --- | --- |
| Start: Clean at once | `background.ts` startCaption; engine `findClutter` (clutter.ts); `caption/page.ts` clean | **1 (built)** |
| What was removed, each item restorable | CleanReport; More in the frame | **1 (built)** |
| Original always one tap away | `html[data-distill-original]` | **1 (built)** |
| One status line, at most 5 controls, model state | `caption/frame/main.tsx` | **1 (built)** |
| Translate on its own, "Keep Czech", Czech per block in Details | New engine task `translateBlocks` (`types.ts` Task, page class, `route()`, prompt, schema, door). The page side replaces text node by node, keeps the originals and restores them on Keep Czech / Original. Chip from the SDK's `inferenceSource`. | 2 |
| Re-apply after the page changes (a single-page app re-renders, lazy comments arrive) | `pageWatch.ts` -> re-run Clean on new nodes only; translate new blocks | 2 |
| Simplify: As written / Plain | Existing `simplifyBlocks`, the same text replacement as Translate | 3 |
| Refocus: intents behind a manual trigger (no suggested next step), tours with a highlighter on exact words, caption grows, Back/Next, arrows/Esc | New engine task `buildTour`: intents plus stops `{blockId, quote, key, say}`. It passes one door like `validateAndRepair`: the quote must be found verbatim in its block, unknown kinds are dropped and counted. The highlight uses `CSS.highlights` ranges over the quote. | 4 |
| End-of-tour sheet from a closed kit of cards, with provenance | `RecastNode` kinds plus contact/hours cards, `sourceBlockIds` -> highlight the source | 4 |
| Form wizard in the caption: one step, the fields in a row, writes real fields, Remember answers (device only) | The Wayfill engine is unchanged (guides, `buildWizard`, `writeValues`, `values` routing). New: a compact step layout in the frame. | 5 |
| Video: chapters, sponsor skip, play a step, timers | A site adapter (YouTube: transcript and chapters from the page DOM; sponsor segments need a source; **open question**) | 6 |
| Old sites: magnifier, tap-to-call, hours caveat | The magnifier is a frame-drawn zoom of a page rect. `tel:` detection. The caveat compares the page's dates. | 6 |
| Agent (Handrail), Layout, the full Read view | They stay in the side panel, under More > "Open the full Distill panel", until the caption covers them | — |
| The icon opens the caption by default | Decided: switch once slices 1 to 5 meet the live bar (decision 1) | 7 |

Product law holds in every slice:

- **Say where it ran:** chips from the SDK response, and "No AI used" for Clean.
- **Values never leave the device:** the wizard and Remember answers use `values` routing.
- **Model output is untrusted:** one door per task; what is dropped is counted on screen.
- **The original is never lost.**
- **Provenance:** every card and stop names its blocks.

## Quality bar

These are the prototype's numbers, now checked on real pages. They live in `apps/extension/e2e/caption.ts` (`BAR`).

| Check | Bar | Prototype R2-B |
| --- | --- | --- |
| Distill's share of the window at first sight, 1440x900 | <= 8% | 5.9% |
| Same, 390x844 | <= 15% | 14.1% |
| The strip is on top (5 points along it hit the strip) | always | yes |
| Click to first sight | warn > 1.5 s, fail > 5 s | about 1 s |
| Long paragraphs of the main text still on screen after Clean | warn < 95%, fail < 85% | 100% |
| The headline still on screen | yes | yes |
| The page's main picture or video still on screen (not the site logo) | yes | yes |
| No sideways scroll added (1440 and 390) | none | none |
| Removed distractions | warn at 0 | 11 to 17 per page |
| Big overlays left (fixed boxes over a quarter of the window) | warn above 0 | 0 |
| The page scrolls (a cookie wall's scroll lock is undone) | yes | yes |
| Original brings back what Clean hid | warn < 100%, fail < 90% | 100% |
| The strip draws in Distill's font (the page's CSS does not reach it) | yes | yes |
| Errors from Distill in the console | 0 | 0 |

Each later slice adds its own rows:

- Translate: time to translated, share of blocks translated, Keep Czech restores every text.
- Tours: every stop's quote is highlighted on the page, and the caption at 1440 has no inner scroll.
- Wizard: the fields are filled in the real form, and no value leaves the device. That is already proven by the payload-privacy test; the e2e adds a network check.

## First live run (2026-11-21)

Nine pages from `e2e/live/sites.json`: the demo article, two Czech news explainers (Deník, Aktuálně), two village
fault-report forms (Štáhlavy, Přáslavice), two Czech YouTube recipes (one as a first visit with the consent pop-up,
one with consent given) and two 2000s small-business sites (a FrontPage car repair shop, a trailer rental). **All nine
meet the hard bar.**

| | |
| --- | --- |
| Distill's share at first sight | 5.1% at 1440x900 on every site; 10.3 to 12.4% at 390x844 |
| Click to first sight | 0.8 to 1.3 s; YouTube 1.9 to 2.8 s (warn: Clean on a very large DOM) |
| Removed | 15 on Deník (ad wallpaper, menus, region picker, trending, sidebar), 10 on Aktuálně, 14 on Štáhlavy, 4 on Přáslavice (the cookie bar among them), 2 to 4 on YouTube (masthead, guide, recommendations, consent backdrop) |

The first runs caught six faults that the demo pages never showed. Each is now fixed in `findClutter` and has a
unit test:

1. YouTube's player box carries `ad-*` classes, and the video went as an "Advert". Fixed: media the host names
   (`protect`) is untouchable.
2. The recommendation column stayed, because the page reader took it in as one paragraph. Fixed: a block that names
   itself related or comments is judged too, and a mostly-links column goes.
3. The consent dialog went but its grey backdrop stayed. Fixed: an empty fixed box over 30% of the window is a
   pop-up.
4. Aktuálně lost its lead paragraph, its lead photo and the byline, which sit between the headline and the text the
   reader chose. Fixed: that corridor is the article's own; only self-named clutter goes from it.
5. The headline itself was not protected, because the reader drops an h1 that repeats the title. Fixed: the first
   visible h1 is always kept.
6. On the car repair site the services menu went, and it is the only way to the content. Fixed: a page with under
   400 characters of text and no form or video is "thin", and there only self-named clutter goes.

The measurements had their own faults, also fixed:

- A cookie bar's paragraphs were counted as main text.
- A page that Clean made short was reported as "does not scroll".
- A site logo was counted as the main picture.

What the run says for the next slices:

- **Translate must detect the language from the text.** The car repair site has no `lang` attribute, so no
  "Page in Czech" appears and Translate would not start.
- **Clean leaves the layout's holes.** Deník keeps an empty right column where the sidebar was. Widening the main
  column after Clean is a candidate for slice 2 (only by CSS, reversible).
- **Old sites need Refocus more than Clean.** "Nothing to remove" is right for the two small-business sites; their
  value is the "Call or write" / "Are they open?" tours of slice 6.
- **Clean on YouTube takes about 2 s.** It must get faster (one style read per element, not several) before Translate
  is added on top.

## How it is validated

| Run | What | When |
| --- | --- | --- |
| `npm test -w @distill/engine` | `findClutter` on fixtures: kinds, labels, never content, self-named boxes | `npm run check` |
| `npm run e2e -w @distill/extension` | `e2e/caption.spec.ts` on the demo pages, in real Chromium. The icon path, first sight, More and restore, Original, close leaves nothing behind, the phone width. | Before every push that touches the extension |
| `npm run e2e:live -w @distill/extension` | `e2e/live/`: the same measurements on real sites (`sites.json`: Czech news, an official form, a YouTube recipe, an old company site). It writes `e2e/out/live/report.html` with screenshots, a video per site and every check against the bar. | When a slice is done, and before deciding the default surface |
| The owner's Nano check | The e2e has no Gemini Nano. Translate and tours on the device are checked by hand in the owner's Chrome, as described in `apps/extension/e2e/README.md`. | Once per slice from 2 on |

## Risks to retire early

1. **AI in an extension frame inside a web page.** The Prompt API (`LanguageModel`) must be exposed in `caption.html`
   while it sits in a page. A site's `Permissions-Policy` might block it in frames. This is the first task of slice 2.
   If the API is missing there, AI moves to an offscreen document and the frame asks it through `chrome.runtime`
   messages. The chip still comes from the SDK response.
2. **The page covering the strip.** Top-layer dialogs, popovers and fullscreen video sit above any z-index. The live
   e2e checks that the strip is on top on every site. A miss is fixed per mechanism, not per site.
3. **Clean taking content.**
   - The engine keeps every element the page reader took text from, and everything around it. The one exception is
     a self-named box (comments, related, ads) that holds less than half of the text.
   - The live check "main text still on screen" catches the rest.
   - Every item can come back from More.
4. **Pages that re-render** (React and other single-page apps) can undo Clean or a translation. Slice 2 re-applies
   them on changes, using `pageWatch.ts`.
5. **Fingerprinting.** A web-accessible `caption.html` lets a page detect Distill. Once it is verified on live sites,
   turn on `use_dynamic_url` in the manifest.
6. **Store review.** Hiding ads and cookie walls is what reader modes do, but the listing must say so plainly
   (`store/listing.md`).

## Open questions for the owner

These are carried over from the R2 review, to settle when their slices come:

- **The end of a tour:** suggest the next unseen tour? Decision 3 suggests not; to confirm in slice 4.
- **Remember my answers:** show it on every form step, or fold it into Details (slice 5)?
- **A playing recipe step:** should it keep playing on Next (slice 6)?

## Round 1: Distill on any page (2026-11-21)

The owner chose nine use cases from ten proposed (the spark "universal-core"; the review board is an artifact, the
notes are in `.spark/`, not tracked). Each one runs after Clean, changes the page only through what it can take back,
and steps aside for Original. #7 (where am I on a long page) had no verdict and was not built.

| # | Use case | What it does | Code |
| --- | --- | --- | --- |
| 1 | Fill the hole Clean leaves | Boxes of the main column that had a removed sidebar beside them grow into the freed room, up to about 70 characters a line, centred. Gives the room back when the sidebar is shown again. | `caption/reflow.ts`, engine `reading.ts` |
| 2 | The page's language from its words | `detectLang`: common words and letters for 12 Latin-script languages, script for the rest; Czech without diacritics too. Used when a page has no lang attribute (on a thin page, from its whole text). | engine `lang.ts`, `page.ts` |
| 3 | Stay clean | Watches for new boxes (late pop-ups, lazy ads, a single-page app's new view) and judges them like Clean; never what the person just opened or is typing in. | `caption/watch.ts`, `page.ts` `recheck` |
| 4 | Things that float | New clutter kinds: chat button, feedback tab, floating video, app banner, back-to-top. A sticky header stack over 12% of the window scrolls with the page. | engine `clutter.ts`, `caption/float.ts` |
| 5 | Call, write or find them | Phones, e-mails, addresses, opening hours and the contact page, from the whole page (hidden parts too), in More: Call, Write, Copy, Show on page. | engine `contact.ts`, `caption/contact.ts`, `frame/Contact.tsx` |
| 6 | Comfortable to read | Only where the main text needs it: 16 px, line height 1.5, about 75 characters, WCAG AA contrast (hue kept). A switch in More. | `caption/comfort.ts`, engine `contrast.ts` |
| 8 | Calm the page | Pauses media that started by itself (not the main video), marquees, hover-paused carousels and endless animations; Play again. | `caption/calm.ts`, `frame/Calm.tsx` |
| 9 | Ready to send? | "Form 4 of 7 · Next" in the row (form pages, or forms of 4+ fields), counts in More. Counts only: never a value. | `caption/formCheck.ts`, `frame/FormCheck.tsx` |
| 10 | Translate in place | Slice 2's core: task `translateBlocks` (page class), door `parseTranslation`, text replaced node by node, Keep Czech, the chip from the run. | engine `translate.ts`, `caption/translate.ts`, `frame/Translate.tsx` |

Found on the way and fixed:

- **The caption frame could not reach the on-device model.** A `chrome-extension://` frame in a page is denied the
  `language-model` feature unless its embedder delegates it: `page.ts` now sets `allow="language-model"`. A site that
  forbids the feature for itself by header still blocks it there; that case needs the offscreen document (risk 1).
- **Form reading threw on every plain http page** (`crypto.subtle` needs a secure context), the side panel's included.
  The fingerprint falls back to the engine's own SHA-256 (`sha256.ts`).
- **The e2e build has no stand-in model by default.** Translate's tests switch the dev fake on per session
  (`chrome.storage.session` key `distill:e2e:fakeAi`, e2e build only).

Closed before round 2 (the owner asked, 2026-11-22):

| Gap | Now |
| --- | --- |
| Calm and Clean protected every video 320 px or wider | Only the main video (the largest in the first screen or by the main column, or the player); a second autoplaying video is paused |
| A header brought back from More came back sticky | `restore` runs `unstick` again |
| Clean hid a 2-field comment form | A form in or right after the main column with one visible field is kept (not a search box, a login, or a self-named sign-up) |
| Stay clean did not follow up | After it hides something or a single-page app changes view: widen, unstick, the reading layer (the person's switch kept) and a Calm pass for new moving parts |
| Aktuálně's headline stayed left of the centred column | The headline block follows the widened column (margin and max-width only) |
| Calm's counts lagged after Play again | Zeroed at once |
| An ad inside a box the reader took loose text from stayed | Self-named clutter inside such a box goes when it holds no running text, headline or protected media |
| Clean took 1.5-2.4 s on YouTube | Clean starts when the strip goes on the page (not when its frame asks), and judges with one style read per element: 0.8-1.0 s on every other live site, 1.8-1.9 s on YouTube in the live run of 2026-11-22 (target 1.2 s: missed on YouTube) |
| "Subscribe" was read as a newsletter sign-up | Only with a field to type an address into, or the word newsletter |
| An address without a postcode was not found | Street and number with the town, when the page says it is an address or a phone sits beside it |
| "Required" was read only from attributes | The engine reads a required class, "povinné"/"required" at the end of the label and a star, so the side panel's Wayfill gets it too |
| A phone line was translated | Contact-only blocks are skipped |
| Text added later stayed Czech | The main column is watched while a translation is on; new or rewritten blocks are translated (a block rewritten more than 3 times is left) |
| A site that forbids the model in frames got no on-device translation | Translate (and More's model state) run in an offscreen document; the chip says so |
| More's Reading line said "Larger, darker" for a line-length change | "Easier-to-read text on N parts" |
| The live probes ran with every live run | Only with `E2E_PROBES=1` or when named |

Still open:

- Clean on YouTube is 1.8-1.9 s from click to first sight (bar warns above 1.5 s): reading the page (`extractPage`,
  70-150 ms there), the reading layer, unstick and widen (100-300 ms together) and the strip settling are what is left.
- Real translation quality and the offscreen path need the owner's check with Gemini Nano in Chrome; no site in
  `sites.json` sends a policy that blocks the model in frames (proven on a demo page only).
- Content appended after the article (an infinite scroll's next article) is not translated (main-column rule).

## Round 2: claims, the gist, tables, link notes, Remember (2026-11-23)

Seven cards built (owner's verdicts: Go on r2-01, 02, 04, 05, 07, 08, 10; No on the outline, Copy and Read aloud).
Plain words (r2-04) and the web check (r2-02) have their own sections below.

- **r2-01 Claims to check** (on device). `engine/claims.ts` picks candidate sentences (numbers, dates, quotes,
  "according to"/"podle", studies, causes; Czech and English); task `findClaims` keeps the ones worth checking; door
  `parseClaims` (candidate ids only, `why` from a closed set, at most 12; the text is always the page's own). Marks are
  CSS Custom Highlights over the page's own text nodes (`caption/claims.ts`): no element added, links and Translate's
  swap untouched; re-found after a translation; Original hides them, close removes them. The strip says "N claims to
  check"; More lists them with Show me. No model: nothing is shown as a claim. Main text for round-2 tasks comes from
  `distill:caption:mainText` (ids `m0...`, every language, captions and contact lines left out).
- **r2-10 The gist** (on device). Task `gist`, door `parseGist`: a point whose sentence is not in its block is dropped
  and counted. Top of More, each point with Show me.
- **r2-05 Tables you can read** (`caption/tables.ts`). Only data tables of the main text (a header naming half the
  columns, regular rows, short cells, no nested tables or form fields): header row sticky below the page's own bar,
  wide tables scroll inside themselves, at 480 px or less a table of up to 4 columns becomes one card per row.
  Pujcovna Smid's roof-box price list counts as a data table; its layout tables are left alone.
- **r2-07 Where does this link go** (`engine/links.ts`, `caption/links.ts`). From the address alone, no request:
  site, "Leaves this site", file type, redirects unwrapped (Google, Facebook, Outlook safelinks and others), tracking
  tags removed with Copy clean link. A note in a closed shadow root on hover, focus or a long press.
- **r2-08 Remember this site** (`caption/sites.ts`, `autoOpen.ts`, `sitePermission.ts`). The switch asks Chrome for
  that one origin; on its next loads the service worker opens the strip by itself (top frame only, not after the
  person closed it on that page). Kept on this device: items shown again, Keep <language>, reading comfort off.
  Forget gives back the permission Distill asked for.

Tests after round 2: unit 994, browser tests on demo pages 72 (71 pass in a full run; see the open list), live 9/9,
round-2 probes 14/14.

Open after round 2:
- `caption-lifecycle` G5 ("Stay clean keeps the reading layer..."): the reading layer sometimes never reaches a
  single-page app's next story (fails about 1 run in 3 to 6, also on the commit before round 2). Not caused by round 2;
  not yet understood.
- Real model quality (claims, gist, plain words) and the real grounded web check need the owner's check in Chrome.
- Google's grounding terms ask to show the search suggestions (`searchEntryPoint`, HTML); the strip renders no model
  HTML, so they are not shown yet.
- With "Keep <language>" remembered, the translation still runs and is only hidden.
- The real Chrome permission prompt for Remember was seen to start from the strip's frame but not pressed in a test.
- Deník keeps an empty "REKLAMA" box and the "Chcete upřednostnit v Google" promo after Clean.

## Round 2, r2-04: plain words in place (2026-11-23)

**Plain / As written** in the strip rewrites each main-text block of 8 words or more in short sentences (task
`simplifyBlocks`, prompt `plainBlocks`, on the device first), with Translate's in-place swap. Never by itself.

- **One swap, three texts.** `caption/translate.ts` keeps, per block, the page's values of the text nodes it writes,
  the translation's, and plain words of either. What shows follows from Original, Keep <language>, Plain and whether
  the block was translated (`viewOf`). Plain rewrites the page as shown: a translated block's translation, else the
  page's words. Keep <language> turns Plain off (the page's words as written); Original and close bring every word back.
- **The door** (`parsePlain`): the translation door, then `keepsFacts`: every number (Czech and English digit groups),
  date (numeric, ISO or with a Czech or English month), time, amount (Kč/CZK, €, $, £), percentage, link and
  capitalised name that does not start a sentence must survive, compared normalised (a Czech case ending of a name
  counts as the name). A rewrite that loses one is refused, the block stays as written, and the strip says "N parts
  kept as written: a number would have changed". Refused words are not sent again when Plain is pressed again.
- **Text added later**: handled as Translate handles it. While Plain is on, the page side watches the main column;
  new or rewritten blocks get plain words (on a translated page, once their translation is in); a block the page
  rewrites shows the page's new words.
- The chip says where the plain words ran (and the translation, when one shows). With no model the control is hidden.
- Open: real rewrite quality with Gemini Nano; a name whose Czech case changes its stem ("Praha" / "v Praze") is
  refused (safe, but a lost rewrite); an ambiguous group like "12,500" accepts either reading (12500 or 12.500).

## Round 2, card 2: Check a claim on the web (the strip's first cloud call)

Each claim (card 1) gets a web check: task `checkClaim`, routed `only_in_cloud` by the Sieve, run by `runGrounded`
(`apps/web/src/ai.ts`) with the Google Search tool on the cloud model. What is sent: the claim's sentence, the page's
title and its address without query or fragment (a form sent by GET puts what was typed in the query). Nothing else.

- **Asked once.** Before anything is sent, More asks: "Checking facts sends sentences of this page to Google. Check
  facts?" [Check facts] [Not now]. The answer stays in `chrome.storage.local` (`distill:checks`). "Not now" is not asked
  again by itself; a Check on a claim asks again in its row.
- **After yes.** The first three claims of an article are checked by themselves (once per page) while More may be
  shut; every other claim on its Check, or Check all. The switch "Check the top claims by themselves" in More stops
  the automatic part. The strip's chip says "In the cloud" once a check is done (not "No AI used").
- **One door.** `parseCheck` (`packages/engine/src/check.ts`): a verdict from the closed set, else refused; the reason
  as plain text without links, at most 240 characters; sources only from the response's grounding metadata, https,
  deduped, at most 5. A link the model wrote is never shown. What was refused is counted under the verdict.
- **No JSON schema with search.** The search tool and a response schema do not combine on every model, so the prompt
  asks for JSON in words and the reply is parsed leniently; the door handles the rest.
- **The public build** (on the device only) shows no Check: "Checking on the web needs the cloud; this version of
  Distill uses only the AI on this device."

Checking it for real (owner, own build; e2e and unit tests use a stand-in model and stand-in search results):

1. `.env` with the Firebase config and the App Check debug token (as for the side panel), `VITE_SURFACE=caption`.
2. `npm run build -w @distill/extension`, load `apps/extension/dist` unpacked in Chrome.
3. Open a news article in English, click the Distill icon, open More, answer Check facts.
4. Expect: three verdicts appear without a click, each with "In the cloud" and one to five source links that open the
   article the search found (links go through `vertexaisearch.cloud.google.com/grounding-api-redirect/...`; the text
   shows the page's title or domain). Check a fourth claim. In DevTools (the strip's frame), the network request to
   `firebasevertexai.googleapis.com` carries `tools: [{googleSearch: {}}]` and a prompt with only the sentence, title
   and address.
5. Unverified until then: that the configured cloud model (`cloud_model` in Remote Config) supports the search tool
   through Firebase AI Logic, and the wording of its verdicts. Google's terms for grounded results ask apps to show the
   search suggestions (`searchEntryPoint`, an HTML snippet); the strip renders no model HTML, so this is open.

## Code map

| File | Role |
| --- | --- |
| `packages/engine/src/clutter.ts` | `findClutter`, `clutterSummary`, `CLUTTER_LABELS` (pure DOM reading, unit-tested) |
| `apps/extension/src/caption/page.ts` | The page side: mount, spacer, Clean, restore, Original, resize, close |
| `apps/extension/src/caption/frame/main.tsx`, `caption.css`, `caption.html` | The strip |
| `apps/extension/src/messages.ts` | `distill:caption:*`, `CleanReport` |
| `apps/extension/src/background.ts` | `startCaption`, the `VITE_SURFACE` switch, the e2e hook |
| `apps/extension/e2e/caption.ts` | `BAR` and the measurements shared by both runs |
| `apps/extension/e2e/caption.spec.ts` | Hermetic scenarios on the demo pages |
| `apps/extension/e2e/live/` | The live run: `sites.json`, `caption.live.ts`, `report.ts`, `README.md` |
| `apps/extension/src/caption/sites.ts`, `sitePermission.ts`, `autoOpen.ts`, `frame/Remember.tsx` | r2-08 Remember this site: `distill:sites` in chrome.storage.local, the one `<origin>/*` permission asked from the strip's frame, the service worker's automatic open (tabs.onUpdated, no new permission; top frame only; not after Close until the next load; dropped on `permissions.onRemoved`) |
