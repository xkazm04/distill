# The caption on live sites

This checks whether the caption keeps the quality of the R2-B prototype on the web as it is. The prototype ran on
made-up pages; this runs real ones. See `docs/caption.md` for the plan and the quality bar.

## Run it

```sh
npm run e2e:live -w @distill/extension                       # every site in sites.json
E2E_LIVE_SITES=news npm run e2e:live -w @distill/extension    # one use case (news, form, video, company) or site ids
E2E_HEADED=1 npm run e2e:live -w @distill/extension           # watch it
E2E_PROBES=1 npm run e2e:live -w @distill/extension           # also the per-feature probes (live/probes/), minutes more
```

The probes under `live/probes/` measure one round-1 feature each (layout, motion, find, translate) on the sites they
name, before and after, and save their screenshots and `metrics.json` under `e2e/out/live/probes/<feature>/`. They run
only with `E2E_PROBES=1`, or when named: `npx playwright test -c e2e/playwright.live.config.ts probes/find`.

It builds the e2e extension (the same `dist-e2e` that `npm run e2e` uses) and opens each site in Playwright's Chromium,
with the locale `cs-CZ`, at 1440x900.

It needs the network and takes about 20 to 40 seconds per site. It is **opt-in**: never part of `npm run check` or
`npm run e2e`, because a live site can change or go down under it.

## What it does per site

1. It opens the URL with no cookies (a first visit) and waits for late pop-ups (`settleMs`, default 3 s). Screenshot:
   `start.png`.
2. It marks the main text's long paragraphs and the headline, to find them again afterwards.
3. It starts the caption the way the toolbar click does: the e2e build's `__distillCaption.start(tabId)` in the
   service worker. It times the wait until the strip says what Clean did. Screenshot: `first.png`.
4. It measures:
   - the strip's share of the window, and whether it is on top;
   - the main text, the headline and the main picture or video still on screen;
   - sideways scroll;
   - overlays left;
   - whether the page scrolls.
5. It opens **More** (`more.png`), then **Original**: everything Clean hid must be back (`original.png`). Then
   **Back to Distill**, and it reads the strip's font.
6. At 390x844 it measures the share again and checks for sideways scroll against the page's own width at that size
   (`first-390.png`).
7. It records a video of the whole visit (`run.webm`).

Results go to `e2e/out/live/<site>/metrics.json`, and one page for review: **`e2e/out/live/report.html`**. That page
shows every site with its screenshots and each check against the bar. A check over its hard limit fails the test; a
soft one only marks the report. A site that does not answer is skipped, not failed.

## sites.json

Each site has:

- an `id` and a `useCase` (`news`, `form`, `video` or `company`);
- the `url`, the page `lang`, `why` it is a hard page, and `notes`;
- optionally `cookies` to set before the visit, and `settleMs`.

Pick pages that stay online: an evergreen explainer, not breaking news. When a site changes or goes away, replace it
and note the date in `notes`.

## What it cannot prove

- **Gemini Nano**: there is no on-device model in Playwright's Chromium. The owner checks AI by hand (see
  `../README.md`).
- **The real toolbar click and its activeTab grant**: the test manifest grants host access up front.
- **A site's own errors**: they are not Distill's, so only errors from `chrome-extension://` count.
