# Caption: Distill on the page itself

**Decision (owner, 2026-11-21):** the extension's interface becomes **R2-B "Caption"** from the recompose prototype
rounds. Distill works on the real page, and its only surface is one strip docked at the bottom of the page, like subtitles.
The strip is slim at first sight. It grows upward into a caption during a tour, and into a short sheet at the end.
There is no sidebar.

**Decisions (owner, 2026-11-21):**

1. **The default surface.** The toolbar icon switches from the side panel to the caption once slices 1 to 5 meet the
   live bar.
2. **Cookie walls.** Clean hides a consent wall **without answering it**: Distill never clicks "Accept" or "Reject" for
   the person. *Changed in round 3 (card r3-04, owner's Go):* where the banner has a reject-everything-not-needed button,
   Distill presses it once per page load (switch in More, on by default); Accept is still never pressed.
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
   search suggestions (`searchEntryPoint`, an HTML snippet); the strip renders no model HTML. Closed in round 3
   (r3-02, below): the suggestions show in a sealed-off frame, never in the strip's own document.

## Round 3: main text, sealed suggestions, the proof page, and seven more (2026-11-23)

All ten cards built (owner's verdicts: Go on all, no notes). r3-02, r3-03, r3-04 and r3-06 have their own sections
below. Built by seven builders in worktrees after a contract commit (f9f8374); merged and integrated on master.

- **r3-01 Main text that is only the text** (`engine/boiler.ts`, `page.ts`, `clutter.ts`, `caption/translate.ts`
  `mainTextBlocks`). The headline is the title, not a block; photo credits, captions, "read also" boxes, Google promos
  and ad labels are left out of the main text. Clean also removes empty ad slots labelled by CSS ("Reklama") and the
  "prefer us in Google" box (new clutter kind `promo`). Deník: 32 -> 25 blocks, first block the lead, 6 ad labels -> 0.
- **r3-05 Who wrote this, and when** (`engine/byline.ts`). JSON-LD (arrays, `@graph`, `mainEntity`), microdata, meta
  tags, then the visible byline; published and updated told apart. The strip line shows only when they differ by more
  than a week. The web check sends the published day (`source-published`), nothing else of the byline.
- **r3-07 Prices and dates in your terms** (`engine/money.ts`, `dates.ts`, `caption/terms.ts`, `rates.ts`). Additions
  drawn by CSS after a wrapped span (never page text). ECB rates once a day, optional host permission asked on a click,
  `credentials: "omit"`, no referrer. Translate, Plain, Original and the main-text readers run inside `termsAside`;
  every split or rejoin fires `distill:textsplit` (`caption/textSplit.ts`) so the claims' and actions' highlights are
  found again (found while merging: a mark's range ran on to the end of the paragraph).
- **r3-08 Ask this page** (task `askPage`, class `values`: device only, no fallback; door `engine/ask.ts`). The answer
  must quote a sentence of the main text, else "This page does not say". The question is never stored or sent.
- **r3-09 What this page asks of you** (`engine/actions.ts`, `caption/actions.ts`). Deadlines, sums with a checked
  Czech account or IBAN, what to bring, contacts and hours; patterns only. Highlights, Show me, Copy, Call or Write.
- **r3-10 Loose ends**: Keep <language> holds the translation (`held`, nothing sent until Show English); a form of only
  radios or checkboxes with no action or submit is not a page form (Wikipedia's appearance panel); link notes by
  keyboard; G5 fixed at its cause (the test clicked while the strip was still sliding down; it now waits and checks the
  next story arrived; 30/30); YouTube: forms read once, a cheap error-word check first, `unstick` skips hidden parts,
  one main-text read shared by claims and the gist.
- A cookie banner Distill answered carries `data-distill-answered`; the live check of Original does not count it (the
  site removes it itself once told no).

Tests after round 3: unit 1261, browser tests on demo pages 93/93, live 9/9.

Open after round 3:
- Real model quality and the real grounded check (with Google's real search suggestions): run the proof page (r3-03).
- YouTube first sight 1.6-1.7 s median, above 1.5 s (status line about 0.9 s; the rest is YouTube's own scripts and
  the frame loading).
- Didomi's reject press not yet seen live (its notice never showed to the test browser).
- Village offices show 0 things to do: their contacts sit only in parts Clean hid.
- Dark page does not follow parts that change class later (a menu opening).
- Ask is not offered on sites that block the model in frames (the offscreen door refuses values tasks by design).
- A small empty grey bar between Deník's paragraphs (no ad label, so kept).

## Round 3, r3-02: Google's search suggestions, sealed off (2026-11-23)

- **What it is.** Under a claim checked on the web, a small "Search on Google" area shows the answer's
  `groundingMetadata.searchEntryPoint.renderedContent`, unchanged, as Google's grounding terms ask.
- **The door.** `entryPointOf` in `@distill/web/ai`: only a non-empty string of at most 32,000 characters
  (`ENTRY_POINT_MAX`) passes. Anything else there is refused and counted in "Distill left out N parts". An answer
  without suggestions shows no frame.
- **The seal** (`frame/SearchSuggestions.tsx`):
  - an iframe with `sandbox="allow-popups allow-popups-to-escape-sandbox"`: no scripts, no same origin, no top
    navigation, no forms;
  - the snippet arrives as `srcdoc`, behind its own `Content-Security-Policy` (`default-src 'none'`, inline CSS and
    https images only);
  - `<base target="_blank">`, so Google's links open in a new tab.
  It cannot run code in the strip, read the page or reach `chrome.*`. The strip's document still holds no HTML from
  an AI answer.
- **Proof.** `ClaimCheck.test.ts` (the frame's attributes, the door's count) and `e2e/caption-suggestions.spec.ts`:
  - a hostile stand-in snippet (a script, an `onerror`, a `javascript:` link, a `target=_top` link, a meta refresh)
    changes neither the strip nor the page and does not move the tab;
  - Chromium's own console lines say it refused each one;
  - the frame's origin is `null` and it has no `chrome.runtime`;
  - a chip opens in a new tab.
  Screenshot: `r3-02-suggestions.jpg` (stand-in snippet).
- **Not yet seen with the real service:** the real snippet's height. The frame is one row high (52 px) and cannot size
  itself without scripts; Google's chips scroll sideways inside it.

## Round 3, r3-03: the proof page (developer build only)

One click in your own Chrome runs Translate, the claims, the gist, plain words and the web check with the REAL models
on saved copies of three real pages:
- a Deník article;
- an Aktuálně article;
- Přáslavice's fault-report page (a form: no claims, no gist, so no check).

It runs them through the strip's own code (`src/proof/run.ts`): Clean's reading (`readForClean`), `runTranslate`,
`runTask` (claims, gist, plain words) and `checkClaim` (`runGrounded`), with the real prompts and doors. For each task
the report records the answer, where it ran (`inferenceSource`), how long it took, what the door left out and any
error. The copies are in `apps/extension/proof/fixtures/` (trimmed to the main HTML; no scripts, images, ads, form
values or private persons' data). The page is in the developer ("own") build only: `vite.config.ts` `inputsOf`
leaves it out of the public build, and `check-dist` fails a public build that carries `proof.html` or its report
marker.

**Steps for the owner:**
1. Build your own copy: `npm run build -w @distill/extension`. It reads Firebase from the root `.env`, as always.
2. In `chrome://extensions`, reload Distill (loaded unpacked from `apps/extension/dist`).
3. Open `chrome-extension://pbmfhppffaiedhljpgpigancfhknohol/proof.html` (the id is fixed by the manifest key).
4. Press **Run**. It takes a minute or two with the device model. The web check sends three claims per article, with
   each page's title and address, to Google.
5. Press **Save report (JSON)** and **Save report (Markdown)**, and send both files back.

In e2e (`e2e/proof.spec.ts`) the page runs with the stand-in model. That proves the page and the report work, not the
models: screenshot `r3-03-proof.jpg`.

## Round 3, r3-04 and r3-06: cookie banners answered, dark page (2026-11-23)

- **r3-04 A cookie banner answered for you** (`caption/consent.ts`, hooked into `page.ts`; `frame/Consent.tsx`). After
  Clean, in the top frame, at most once per page load, Distill presses the banner's own reject-everything-not-needed
  button. It finds the button in one of two ways:
  - by the known ids and classes of OneTrust, Didomi, Cookiebot, Quantcast / InMobi, Usercentrics (open shadow root),
    Sourcepoint (only when its frame is the site's own), TrustArc, CookieConsent, Complianz, CookieYes and Seznam;
  - or by a plain button inside a banner whose whole text is a reject phrase (en, cs, sk, de, fr, pl).

  A button whose words say yes is never pressed, even with a reject id, and neither is a link to another page. A
  late banner is answered when Stay clean finds it. A banner without a reject button is only hidden, as before.
  `CleanReport.consent` records the outcome (`rejected | hidden | none | off`), and the strip says "Cookies: rejected".
  The switch in More is kept in `chrome.storage.local` under `distill:consent` (`{ on?, sites }`): one setting for
  this site, one for every site, on by default.
- **r3-06 Dark page** (`caption/dark.ts`, `frame/Dark.tsx` with `useDark` in `main.tsx`):
  - A light background turns dark with the same hue.
  - Text below 4.5:1 on its new background turns light, only as far as needed (engine `contrast.ts`). Text over a
    picture keeps its colour.
  - Light gradients are darkened in place.
  - img, video, canvas, svg, iframe and background pictures are never marked or filtered.
  - The changes are one stylesheet plus a `data-distill-dark` attribute on each changed element, under
    `html[data-distill-dark-on]:not([data-distill-original])`. Off and close remove both.
  - A page whose background under its text blocks (median) is dark is left alone (`alreadyDark`).
  - Turning the switch on once stores `distill:dark {auto:true}`. After that the page goes dark by itself whenever
    Chrome is in dark mode. Turning it off stops that.

Live, 2026-11-23:
- **Consent**, probe `consent.live.ts`, fresh profile:
  - YouTube (Pohlreich): the "Odmítnout vše" button of the consent dialog was pressed. It was the only click. After a
    reload the dialog did not come back, and SOCS was set.
  - Deník and Aktuálně: Didomi did not show its notice in these headless runs, so nothing was pressed. Deník reports
    `hidden` from a cookie item Clean hid.
  - Přáslavice and the demo article: only hidden (no reject button). Štáhlavy: none.
- **Dark**, probe `dark.live.ts`, 9 sites plus cs.wikipedia under a light and a dark scheme:
  - Every darkened page had 0 main-text elements below 4.5:1.
  - The lowest minimums were Wikipedia's links at 4.8 and Deník at 7.75.
  - Dymáček counts as dark already, correctly.
  - cs.wikipedia does not switch to its own dark mode under a dark scheme for an anonymous reader, so Distill darkens
    it.

## Round 4: loose ends, speed, tuned AI, forms, explain, video, products, tours (2026-11-23)

Eight cards built (owner's verdicts: Go on r4-01 to 08; No on Compare two pages and Print). r4-02 and r4-03 have their
own sections below. Contract 405c158; seven builders; merged and integrated on master.

- **r4-01 Round 3's loose ends**: contacts in parts Clean hid count as things to do on form and letter pages (marked,
  Show me opens the original); dark page follows class, style, hidden and open changes; `findEmptySpace` removes empty
  in-flow boxes of the main column ("Empty space", clutter kind `space`); Didomi answered in two steps (its own
  settings button, then "Zamítnout vše"; never a yes); an address over several lines is highlighted.
- **r4-04 A form in your language** (`caption/formText.ts`): labels, hints, placeholders, options, legends and buttons
  of the page's main form go through `translateBlocks`; values, option values, live regions and anything marked as an
  error are never read for it. Errors only through `translateErrors` (values: device only). Option values and a named
  submit button are pinned so the form submits the same data.
- **r4-05 Explain this word** (`engine/explain.ts`, `caption/explain.ts`, `frame/Explain.tsx`): `spelledOut` answers an
  abbreviation from the page (Schwartz-Hearst); otherwise task `explainTerm` (values: device only), door
  `parseExplanation`. A note in a closed shadow root; keyboard reachable.
- **r4-06 Video chapters** (`engine/chapters.ts`, `caption/video.ts`, `frame/Video.tsx`): times listed in the
  description (YouTube: the whole description from the served player data, for the video in the address bar only);
  Skip while a part the description names as a sponsor plays.
- **r4-07 Product facts** (`engine/product.ts`, `caption/product.ts`, `frame/Product.tsx`): schema.org Product/Offer,
  microdata, then the page's labels (Czech and English); Show me for facts read from the page.
- **r4-08 Tours** (`caption/tour.ts`, `frame/Tours.tsx`): Just the facts, Call or write, Before you go; started by hand,
  steps over what Distill already found; things to do in hidden parts are left out.

Tests after round 4: unit 1415, browser tests on demo pages 107/107, live 9/9.

Open after round 4:
- The web check and Google's real search suggestions never answered: the Firebase project is on the free tier
  (15 requests a minute; 429 on every grounded call). Real Gemini Nano quality: the owner's run of the proof page.
- YouTube first sight about 1.8-1.9 s (YouTube's own long tasks before the click).
- An error message a site writes with no error marking and no link from a field could be read as form words and sent
  to the cloud-capable translator (r4-04).
- Skip sponsor and dark page's follow-up are proven on demo pages only; tours do not open hidden parts.

## Round 4, r4-03: the AI tuned from the proof report (2026-11-23)

The Director ran the proof page with the owner's own build and Firebase project in Playwright's Chromium. That browser
has no Gemini Nano, so every task ran in the cloud (`gemini-3.5-flash-lite`). Evidence, with every attempt:
`.spark/Spark/evidence/r4/r4-03-*`. The before and after answers side by side: `r4-03-compare.md`.

What the real answers showed, and what changed:
- **Plain words** (Deník in Czech): near copies with misspellings ("tísíc", "mávají", "nensí", "kter½"), all passed by
  the facts check. `parsePlain` now also asks `notPlainer`. A symbol the source does not have, or a near copy (80% of
  the words the same) with a word misspelled inside it (start and end kept, a letter or two changed), is refused and
  counted. A block sent back unchanged is left alone. A changed ending (a Czech case) or a hard word swapped for an
  easy one still passes.
- **Claims**: "Tvrdí to ministr..." ("The minister says so"), the tail of a two-sentence quote, and the sums of one
  example household. `wholeQuotes` joins a quote over several sentences with who said it (`quoteEnds` reads „…“, “…”,
  «…» and straight quotes). The prompt asks for sentences that make sense on their own and no worked examples. Each kept
  claim carries the model's `rank`, and the strip's automatic check takes `topClaims(claims, AUTO_TOP)`, not the first
  three in the page.
- **Gist**: a point rested on a quote that did not say it. The prompt asks for a sentence that states the point.
- **Translate**: good where it answered; unchanged. **Limits** (`TASK_CHARS`): unchanged.
- **The web check never answered**: a 429 from the project's free-tier quota on every attempt. The proof page now shows
  a check's Search Suggestions in the strip's sealed frame, for the run that gets them.

What a run on this project meets, whatever the code:
- 500 "high demand" on flash-lite.
- 429 at 15 requests a minute (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`). An article page alone makes
  about 10 to 14 calls: two translate batches, claims, gist, three checks and the retries.
- After a 5xx, Chromium throttles the extension's requests, and the strip then says "something went wrong", not "busy".

## Round 4, r4-02: first sight sooner (2026-11-23)

The order of work changed, never what is found (the removed, unstuck and widened lists are the same on all 9 sites).

- **The consent switch is read while the page is judged** (`page.ts` `cleanOnce`, `consent.ts` `consentAfterClean(...,
  prefs)`). It used to be read from chrome.storage after the page was cleaned: 20-350 ms on YouTube, where the
  answer queued behind YouTube's own tasks.
- **The strip slides in before the reading** (`page.ts` `open`). Reading a large page holds its thread for 150-400 ms,
  and a transition starts only when a frame is drawn. Clean now starts one frame later, so the slide runs on the
  compositor during the reading and ends before the line shows. (Skipping the frame wait on small pages was tried and
  was slower on the demo article and Půjčovna Šmíd, so every page waits the one frame.)
- **A page that took 100 ms or more to read fades in 90 ms instead of 180** (`data-distill-fade="busy"`).
- **The strip's later reads wait their turn** (`page.ts` `afterFirstSight`, `content.ts` `AFTER_FIRST_SIGHT`). These
  are the main text for claims and the gist, the byline, things to do, and prices and dates in your terms. On YouTube
  they hold the page's thread for 250-300 ms together, and all of them arrived as the line appeared. Now each waits
  until Clean has answered, then runs in its own idle period (at most 500 ms each). Two seconds after first sight they
  run at once again. Translate and the form check are not delayed.

The probe `e2e/live/probes/speed.live.ts` can now time two builds side by side (`E2E_SPEED_BUILDS`, the order
swapped each round, because other browsers on the machine make sequential runs noisy). It also has an opt-in trace
(`E2E_SPEED_TRACE`). `settled()` and the timing itself did not change.

Live, 9 sites, 11 runs per build, interleaved, medians in ms, click to first sight (evidence `r4-02-speed-*.json`):

| Site | Before | After |
| --- | --- | --- |
| demo article | 862 | 928 |
| Deník | 1307 | 1016 |
| Aktuálně | 1317 | 1051 |
| Štáhlavy | 1118 | 937 |
| Přáslavice | 1430 | 1103 |
| YouTube, Pohlreich | 2212 | 1769 |
| YouTube, Kubíček | 2180 | 1908 |
| Dymáček | 1126 | 1064 |
| Půjčovna Šmíd | 1110 | 1037 |

Timing on this machine was noisy: other builders ran browsers at the same time. In a separate run, the same YouTube
code gave medians of 2007 and 1382 ms in two interleaved groups of 7 runs. A second YouTube-only run of 11 runs per
build, on a busier machine, gave Pohlreich 2429 -> 2355 and Kubíček 2300 -> 1851 (`r4-02-speed-yt-*.json`). Pooled
over both runs (22 per build): Pohlreich 2262 -> 2029 and Kubíček 2262 -> 1908.

Still open: YouTube is above 1.5 s in the main run. Its status line now shows at about 0.9-1.1 s (it was 1.5-1.6 s).
From the line to first sight takes 500-600 ms there, against 350-400 ms on the other sites. That time is
`settled()`'s 300 ms of quiet, measured from inside a page whose own thread is busy: YouTube's own long tasks took
0.9-1.3 s of the 2 s before the click, when nothing of Distill runs (trace field `busyBefore2s`). On the other traced
sites (Deník, the demo article, Dymáček, Půjčovna Šmíd) that figure was 0.

## Round 5, r5-07: highlights that belong together (2026-11-23)

Every mark Distill puts on the page now takes its look from one module, `caption/marks.ts`:

- **Quiet marks** sit in the text while you read.
  - A claim to check is underlined in the text's own colour. Once checked, the line's style gives the verdict:
    dotted unchecked, solid supported, wavy disputed, dashed mixed, double nothing found. "Nothing found" was dashed
    like "mixed" before. Now no two states share a style, so colour is never needed to tell them apart.
  - A thing to do gets a light wash of the system's find-in-page colour (`Mark`). The wash is the strongest (32% at
    most, 6% at least) that keeps the text on it at 4.5:1, or as readable as the page's own text when that is fainter
    (`washFor`). It is weighed on the page as it looks (`washOn`: the colour behind the marked words) when the marks
    are painted, and again when Dark page turns on or off.
  - Words laid over a picture are left out of that weighing. That covers a background image, and text positioned
    over an `<img>`, as on Dymáček.
- **The active mark** says "here it is": Show me (claims, the gist, things to do), a tour's current step, and the
  outline on a place (a contact, a product fact, a form field, a block whose words changed).
  - On words: `Mark` under `MarkText`, as before.
  - On a place: a ring, a `MarkText` line inside a `Mark` line. It replaces the shared outline's blue (#0b5fff, a
    colour of Distill's own: 5.1:1 on white, 3.5:1 on a dark page) and the tour's yellow-only outline (1.07:1 on
    white). One of the ring's two lines stands out at 4.4:1 or more on any background.
  - The active mark paints over the quiet ones (highlight priority 2 against 0).
- **Notes** (where a link goes, explain this word) share one box (`NOTE_CSS`): the same border, radius, type, title,
  line, source line and button, in closed shadow roots, in system colours.
- **A key in More**: "On the page:" with a sample of each mark, in the Things to do section (the wash) and the Claims
  section (the five line styles), each with the active mark. It is one component (`frame/MarksKey.tsx`) that wave B
  can move. A screen reader hears how each sample looks ("wavy underline: disputed").
- Colours are CSS system colours only (`Mark`, `MarkText`, `Canvas`, `CanvasText`, `GrayText`, `ButtonFace`,
  `Highlight`). In Chromium, `Mark` is yellow and `MarkText` black in both light and dark schemes; the e2e checks
  this.
- Close takes a ring that is still up off at once (`contact.ts` `clearPlace`), instead of 2.4 s later.

**Contrast** (WCAG ratios, from `markContrast` on the colours measured under the first marked block;
`caption-marks.spec.ts` and `live/probes/marks.live.ts`):

| Page | Background / text | Text (= claim underline) | Wash | Text on wash | Active words (MarkText on Mark) | Active fill vs page | Ring |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Demo notice, light | white / rgb(29,42,29) | 14.99 | 32% | 14.39 | 19.56 | 1.07 | 21 |
| Demo notice, Dark page | rgb(23,23,23) / rgb(213,226,213) | 13.38 | 32% | 4.84 | 19.56 | 16.70 | 16.70 |
| Demo notice dark already, grey text | rgb(30,30,30) / rgb(150,150,150) | 5.64 | 8% | 4.54 (2.04 at the old fixed 32%) | 19.56 | 15.52 | 15.52 |
| Aktuálně (live) | white / rgb(5,23,31) | 18.28 | 32% | 17.55 | 19.56 | 1.07 | 21 |
| Deník (live; claims only, the wash is what it would be) | white / rgb(28,30,31) | 16.73 | 32% | 16.07 | 19.56 | 1.07 | 21 |
| Deník, Dark page (live; as above) | rgb(23,23,23) / rgb(224,226,227) | 13.79 | 32% | 4.99 | 19.56 | 16.70 | 16.70 |
| Dymáček (live, dark already) | black text over a yellow-black picture | not computable | 32% (left as it is) | not computable | 19.56 | not computable | not computable |

The active fill against a white page is 1.07:1. That is the find-in-page yellow's own trait: the yellow tells it from
the page by hue, and the words on it read at 19.56:1. Where it must stand out by lightness (a place, not words), the
ring does.

Still open:
- Dymáček's text sits on a picture, so no contrast can be computed there. The wash is left at full strength, and the
  active mark on its yellow banner differs from the picture mostly by its edge.
- Verdict styles are checked in the style sheet and the key. No hermetic e2e paints a checked claim, because the web
  check is a cloud call.

## Round 5, r5-04 and r5-09: one look for found data; waiting, empty and failed said calmly (2026-11-23)

Every section of More is built from one small kit, `apps/extension/src/caption/frame/kit.tsx` (styles in `kit.css`).
Its API is documented at the top of the file; wave B (More grouped, chips, the phone sheet) builds on it.

- **Parts.** `Section` (a section with its `ListHeader`: the title and a count pill read as "(3)"), `Facts`/`FactRow`
  (label, value, where it came from: a word such as "From data", or Show me), `Rows`/`ActionRow` (the kind, the words,
  a quieter line, the buttons `ShowMe`, `CopyButton`, `ReachLink` for Call or Write), `Switch`, `Note`, and the three
  states `Waiting`, `Empty`, `Failed`. `useCopy` holds a section's Copy state and its one refusal line.
- **Scales.** Type 13 / 14 / 15 / 17 px (`--k-fs-xs`, `--k-fs-sm`, `--k-fs`, `--k-fs-lg`); space 2 / 4 / 8 / 12 / 16 /
  24 px (`--k-sp-1..6`); a row is at least 34 px, a kind label 112 px.
- **Icons.** 21 line icons, 16 px, stroked in `currentColor` (no colour of their own): deadline, payment, bring, phone,
  e-mail, address, hours, contact page; price, stock, delivery, warranty, returns, spec; chapter, sponsor; published,
  updated, author; claim; and `alert` for a failed line. Decorative (`aria-hidden`): the words beside them say what
  they are.
- **Colours.** Theme roles only. `npm run check-tokens` now scans the strip (`apps/extension/src/caption/frame`) as well
  as the web app, and fails if `kit.css` drops out of its scan.
- **Sections moved onto the kit.** Actions, Contact, Byline, Product, Video, Claims, ClaimCheck's controls, Gist, Ask,
  Tours (the list in More), FormCheck, Comfort, Calm, Tables and links, Terms, Dark, Consent, Remember. Every data-testid
  stayed; the old class names e2e and the live probes read (`.claim-text`, `.gist-text`, `.video-title`,
  `.byline-rows > div`) stayed on the kit's elements. "What was removed" and the Distill column are left for wave B.

r5-09, one way to wait, be empty and fail:

- **Waiting** is a quiet placeholder in the shape of what is coming: grey bars (`color-mix` of `--fg`), three rows for
  the gist and the claims, two lines for Ask's answer, one short bar beside "Checking..." for a web check. The words
  are shown, small, and read once (`role=status`; the section is `aria-busy`). No spinner. The bars breathe (opacity)
  only under `prefers-reduced-motion: no-preference`.
- **Empty** is either nothing (the section is not shown) or one short line where it matters ("No date on this page.",
  "Finding the claims worth checking needs an AI model, and none can run here.").
- **Failed** is one line with a small alert icon that says why in plain words, and Try again where trying again can
  help: when the AI error says so (`toAiError(e).retry`: busy, a garbled answer) or the door refused the whole answer.
  A missing model or an AI switched off gets no Try again. Where: the gist (`cap-gist-retry`), the claims
  (`cap-claims-retry`), Ask (`cap-ask-retry`, the same question again, still on this device only), each web check
  (`cap-check-retry`, as before), Translate (`cap-translate-retry`, in the row; the status line says why) and the
  rates download in Prices and dates. Plain's own button is its Try again. Translate's busy words are now "the AI is
  busy right now" (no "try again later" beside a Try again button).
- Explain's note on the page (`caption/explain.ts`) keeps its words ("Explaining on this device...", "Not explained:
  ..."); its look belongs to r5-07 (notes in one shape).

Tests: `frame/kit.test.ts` (the parts, the icons in `currentColor`, no colour literal in `kit.css`, motion only when
welcome, the focus ring) and `e2e/caption-states.spec.ts` (each AI section's placeholder then its answer; the failed
line and Try again working once the stand-in model answers again; Translate's Try again; reduced motion). Evidence:
`e2e/caption-kit-shots.spec.ts` (opt-in, `E2E_KIT_SHOTS=before|after`) pictures each section in light and dark;
`e2e/live/probes/kit.live.ts` does the same on Přáslavice and Aktuálně (run once on the round-4 strip, once on the
kit). Its `E2E_KIT_SLOW=1` did not catch a placeholder live: on these Czech pages Translate runs first, so the gist and
the claims have not started when the picture is taken; the waiting pictures are the hermetic ones.
## Round 5, r5-05 and r5-06: the cleaned page typeset, and its pictures (2026-11-23)

**r5-05, typeset** (`caption/typeset.ts`, called from `comfort.ts`, numbers in engine `reading.ts`). Part of the
reading layer: the "Easier to read" switch and Original take it back, Close removes it (`data-distill-comfort-type`).
Only spacing and sizes, never fonts or colours, and only outside the comfortable range:

- line height follows the size (`leadingFor`: 1.5 up to 18 px, 1.3 from 32 px); paragraphs above 2.2 are pulled in;
- a heading closer to the text before it than to its own text, or cramped, gets about 1.6 lines above and half a line
  below (`headingSpace`; equal space, the browser's default, is left alone); a wrapped heading whose line height is
  under 1.0 or over 1.7 gets 1.25;
- paragraphs that touch (gap under 0.4 em) get 0.8 em; list items that wrap get a paragraph's line height;
- a list whose markers hang out of the column gets 1.4 em of inset; a quote nothing sets apart gets an inset and a
  rule in its own text colour (`color-mix` of `currentColor`);
- data tables (round 2's `dataTable`) with a numeric column get `tabular-nums` and that column right-aligned
  (`numericColumns`: 80% of filled cells are amounts, counts, shares or measurements; a dash counts as empty).

The measure (75 characters past 85) and the 16 px floor are round 1's and did not change.

**r5-06, pictures** (`caption/media.ts`, wired in `page.ts`). The layout part runs in Clean's own frame (one move,
not two); the network part (`wakeMedia`) after first sight; both again when Stay clean follows and on a resize.

- A picture wider than the column gets `max-width: 100%` (and `height: auto` when it is not `object-fit`), boxes around
  it set wider than the column too; a stretched one (5% off its own proportions) gets `height: auto`.
- A caption under 14 px gets 14 px, at least 1.4 line height, and a little room from its picture.
- A gallery (4+ children, each a picture with little text, side by side) shows its first item (the whole row in a grid
  or flex row, when its file is big enough) and a button "+N photos" that opens the rest in place and moves the focus
  to the first one opened. Opened galleries stay open through Stay clean.
- A lazy picture showing a stand-in (no src, data:, a blank/spacer file, a 1-2 px picture) gets the page's own
  `data-src`/`data-srcset` (http(s) only); a native lazy one with no box yet loads now. Its space is reserved first from
  its width and height (or `data-width`/`data-height`), explicitly for stand-ins (a loaded 1x1 gif makes
  `auto w / h` square).
- A picture that never loaded, has nothing to load and shows no alt text loses its box.
- Logos and icons stay: under 120 px both ways, named logo/icon/avatar/badge..., or in the header, menu or footer.
- Close puts back every attribute set, the stand-in addresses included (unless the page changed them since).

Live, both builds side by side (`e2e/live/probes/typeset-media.live.ts`, metrics in
`e2e/out/live/probes/typeset-media/metrics.json`, pictures `r5-05-*` and `r5-06-*` in the r5 evidence folder): the
same items were removed on all 9 sites with both builds. Most sites already read within the range, so the pass leaves
them as they were: Deník (75 characters, line height 1.56, 1.33 em between paragraphs), Aktuálně (72, 1.71, 1.41),
Přáslavice and the demo article are unchanged by r5-05, and no picture there needed fitting. Půjčovna Šmíd gets its
squashed photos back in shape (5 pictures), 25 typeset marks, and no layout shift after Clean. CLS during Clean was
the same with both builds on 7 sites; after Clean (3 s idle and a scroll through the page) it was the same on all 9
(0 on 8; YouTube Pohlreich 0.167 with both builds, YouTube's own). The demo page `caption-media.html` (e2e
`caption-media.spec.ts`) has every case, with CLS after Clean under 0.01.

Still open: the site's banner on Půjčovna Šmíd (`logo11.jpg`) is squeezed at 390 px and stays so (its file is named
logo); Přáslavice has one 135-character paragraph that the measure does not reach (round 1's rule, unchanged); no live
site had a gallery or a never-loaded lazy picture in its main column, so those are proven on the demo page only.

## Round 5, r5-02, r5-03 and r5-08: More in parts, a first line of chips, the strip on a phone (2026-11-23)

**More in parts (r5-02).** More is one small tab row over five parts (`frame/More.tsx`, `frame/parts.ts`):

- **This page:** the gist, Ask, who wrote it, the product facts or the chapters.
- **Do:** things to do, contact, the form, tours.
- **Check:** the claims and the web check controls.
- **Settings:** reading, dark page, prices and dates, tables and links, cookie banners, motion, this site.
- **What was removed:** the list and the Distill links (the full panel, Close Distill on this page, the model line),
  moved out of `main.tsx` onto the kit (`frame/Removed.tsx`).

Every part is rendered and the hidden ones carry `hidden`; a part whose panel holds no section gets no tab (watched with
a MutationObserver, so a part appears when its AI answer does). More opens on the part with the most to say: Check on
an article while claims are being looked for or were found, Do on a form or letter (or a page with a form of 4 fields
or more) that asks things of the reader, otherwise This page; if that part has nothing, the first part that has. Until
a part is asked for it follows what the page holds. The person's tab choice is kept per site on the device
(`chrome.storage.local`, `distill:moreParts`, keyed by origin like `caption/sites.ts`; a chip does not count as a
choice). Proper ARIA tabs: `role=tablist/tab/tabpanel`, roving `tabindex`, arrows wrap, Home and End. While More is
open its body keeps the height of the tallest part shown so far, so the tab row does not move under the pointer. Every
section kept its data-testid; the e2e helpers `showPart(frame, testid)` and `openMoreAt(frame, testid)` open the part
that holds a section, and the specs that look inside More call them.

**The first line (r5-03).** `cap-status` keeps the full status text (`status.ts`, unchanged), visually hidden and read
out (`role=status`): every spec that reads it reads the same words. What the eye reads is `cap-line`
(`frame/FirstLine.tsx`, `frame/lineParts.ts`): a short sentence ("Page cleaned", "Cleaned · in English", "Showing plain
words", "Cookies rejected · nothing else to remove") plus chips with a number: `7 removed`, `6 claims`, `4 to do`,
`published 3 years ago` (when updated well after), `cookies rejected`, `paused 1 video`. Each chip is a button that
opens More on its part. The line measures itself (a hidden copy of every piece, a ResizeObserver on the row): chips
that do not fit fold from the end into one `+n` chip (it opens the first folded chip's part), never a cut word. On a
phone the sentence shortens first ("Cleaned"); on a wide strip the last chips fold first while the long sentence keeps
one chip beside it. The AI chip (`cap-chip`) stays where it was, with its testid and data attributes. "Tour running" is
not a chip: while a tour runs the row is the tour's own row (r4-08).

**The strip on a phone (r5-08).** At most 560 px (the frame's own width), More is a bottom sheet: a handle and Full
screen / Close buttons on top, then the row's other controls (Translate, Plain, the form check, video skip, moved out of
the row, which keeps More and Original), then the tabs. It opens at half the window, drags up to full (92%) and down to
close (pointer events on the handle, `touch-action: none`; let go above 72% full, under 28% closed, else half), and the
keyboard works it through the buttons and ArrowUp / ArrowDown on the handle. The frame asks for its share of the window
(`distill:caption:size` carries `sheet` and `drag`, and answers the window's height); `page.ts` sizes it up to
`SHEET_MAX_SHARE` (0.92) and drops the height easing while a finger drags and under reduced motion. Every button, link,
tab and switch is at least 44 x 44 px there (the AI chip is 44 px tall with its pill drawn inside). Desktop keeps More
above the row and the 45% cap.

Tests: `frame/parts.test.ts`, `frame/lineParts.test.ts`, and `e2e/caption-parts.spec.ts` on the demo page
`caption-parts.html` (an article with clutter, a cookie banner with its own reject, claims, an old byline updated
lately, a side video): each section in its part, empty parts without a tab, the part More opens on (article, a form
that asks things, a product page), the choice kept per site, arrows / Home / End; each chip opening its part; the line
uncut from 1440 to 320 px; the sheet at half and full, dragged by a finger (CDP touch events) up to full and down to
closed, the buttons, reduced motion, and the 44 px check. Live: `e2e/live/probes/strip5.live.ts`.

## Code map

| File | Role |
| --- | --- |
| `packages/engine/src/clutter.ts` | `findClutter`, `clutterSummary`, `CLUTTER_LABELS` (pure DOM reading, unit-tested) |
| `apps/extension/src/caption/page.ts` | The page side: mount, spacer, Clean, restore, Original, resize, close |
| `apps/extension/src/caption/frame/main.tsx`, `caption.css`, `caption.html` | The strip |
| `apps/extension/src/caption/frame/More.tsx`, `parts.ts`, `Removed.tsx`, `more.css` | r5-02 More in parts behind ARIA tabs (the per-site choice in `distill:moreParts`), r5-08 the phone sheet |
| `apps/extension/src/caption/frame/FirstLine.tsx`, `lineParts.ts` | r5-03 the first line: the sentence, the chips, the measured fold into `+n` |
| `apps/extension/src/caption/frame/kit.tsx`, `kit.css` | r5-04/r5-09 the strip's kit: sections, facts, rows, icons, switch, and waiting / empty / failed (API at the top of kit.tsx) |
| `apps/extension/src/messages.ts` | `distill:caption:*`, `CleanReport` |
| `apps/extension/src/background.ts` | `startCaption`, the `VITE_SURFACE` switch, the e2e hook |
| `apps/extension/e2e/caption.ts` | `BAR` and the measurements shared by both runs |
| `apps/extension/src/caption/marks.ts`, `frame/MarksKey.tsx`, `e2e/marks.ts` | r5-07 the one mark system: quiet, active and note CSS, the wash and contrast numbers, the key in More, the e2e and probe readers |
| `apps/extension/e2e/caption.spec.ts` | Hermetic scenarios on the demo pages |
| `apps/extension/e2e/live/` | The live run: `sites.json`, `caption.live.ts`, `report.ts`, `README.md` |
| `apps/extension/src/caption/sites.ts`, `sitePermission.ts`, `autoOpen.ts`, `frame/Remember.tsx` | r2-08 Remember this site: `distill:sites` in chrome.storage.local, the one `<origin>/*` permission asked from the strip's frame, the service worker's automatic open (tabs.onUpdated, no new permission; top frame only; not after Close until the next load; dropped on `permissions.onRemoved`) |
| `apps/extension/src/caption/frame/SearchSuggestions.tsx`, `apps/web/src/ai.ts` `entryPointOf` | r3-02 Google's search suggestions: the door (string, at most 32,000 characters) and the sealed-off frame (sandbox without scripts or same origin, srcdoc behind its own CSP, links to a new tab) |
| `apps/extension/proof.html`, `src/proof/`, `proof/fixtures/` | r3-03 the proof page (own build only): the page tasks with the real models on saved copies of three real pages, through the strip's code; the report as JSON and Markdown |
| `apps/extension/src/caption/typeset.ts`, engine `reading.ts` (`leadingFor`, `headingSpace`, `paragraphGap`, `numericColumns`) | r5-05 the typesetter's pass of the reading layer |
| `apps/extension/src/caption/media.ts` | r5-06 pictures in the cleaned page: fit, captions, galleries, lazy pictures |
