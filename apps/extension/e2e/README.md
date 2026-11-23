# The extension, end to end

These tests load the built extension into a real Chromium and drive a real tab with it: the side panel reads the page
through the content script, fills the form in the tab, follows tab switches and refuses pages it may not read.

## Run it

```sh
npm run e2e -w @distill/extension
```

That builds the extension, type-checks this folder and runs the tests (about 25 seconds after the build; the first run
on a machine takes longer while Chromium starts). It is not part of `npm run check`.

First time on a machine, if Playwright's Chromium is missing: `npx playwright install chromium` (from the repository root).

- **Browser.** Playwright's own Chromium, headless (its new headless mode runs extensions). `E2E_HEADED=1` shows the
  window. `E2E_CHANNEL=msedge` uses the installed Microsoft Edge, which also works. Branded Google Chrome does not:
  since Chrome 137 it ignores `--load-extension`.
- **Output.** Each scenario saves the panel (420 x 800) and the tab as screenshots, and every console error of the
  panel, the tab and the service worker, to `e2e/out/` (git-ignored): `<scenario>-panel.png`, `<scenario>-tab.png`,
  `<scenario>-console.json`. A scenario fails on any console error that is not in `ALLOWED_CONSOLE_ERRORS` in
  `harness.ts` (empty today).

## How it works

- The harness builds `dist-e2e` (`npm run build:e2e`, no `.env`, never the `dist` a person loads) and copies it to a temporary folder and adds `host_permissions: ["<all_urls>"]` to the copy's manifest.
  This is for the tests only: it stands in for the click on the toolbar icon (the activeTab grant), which a test cannot
  give. The real `dist` is never changed. `test.use({ grantHelper: true })` also grants the optional `nativeMessaging`.
- The agent scenarios play the helper program in the service worker: the e2e build (`vite --mode e2e`) has a fake
  helper there (`__distillFakeHelper`, dropped from every other build) that the test switches on before it opens the
  panel. Handrail's real `Host` runs in the test process and trades envelopes with it, so no native host is needed and
  none is started, even on a machine where Handrail is installed.
- A small local server serves `apps/web/public/demo/*.html`, at `/<page>.html` and also at `/demo/<page>.html` (the
  address the web app gives them, where the guide library's demo guide applies).
- The side panel is opened as an ordinary extension page, `sidepanel.html?tabId=<n>`, pinned to the demo tab. The tab id
  comes from the service worker (`chrome.tabs.query`).
- The tab-switch scenario opens the panel without the pin, so it follows the active tab through
  `chrome.tabs.onActivated` as the real side panel does; the test switches tabs from the service worker.
- The build in a worktree has no Firebase config, so AI is off: the tests prove the no-AI paths.

## What it proves

- Read: the panel reads the real page (title, "N blocks read", the article text without the banner, menu and advert),
  and says AI is off.
- Fill a form: the no-AI guide with the form's own Czech labels; an answer typed in the panel lands in the tab's field,
  with the filled outline; Back and Next keep the answers.
- A form in a frame: the demo form embedded in a same-origin iframe (`/framed-form.html`) is read and filled from the
  top frame's content script, with no permission beyond activeTab and scripting; the answer lands in the frame's
  field with the filled outline. (A cross-origin frame is out of reach without host access to its origin; the
  engine skips it.)
- New layout: without AI it says so and shows the focus view.
- Tab switch: the panel follows the active tab, both ways.
- Pages no extension may read (`chrome://`, `about:blank`): "Browser pages cannot be read.", with no button and no error.
- Access: with the shipped manifest (no host access) the panel shows "Distill needs your OK to read this page." with
  "Allow on all sites", instead of an error.
- Agent: with no helper program installed, the Agent view says it is not running (or, where nativeMessaging is an
  optional permission not yet given, offers "Connect your helper program").
- Your agent is the AI (`agent.spec.ts`): a scripted agent, the MCP SDK's own client on Handrail's own MCP server and
  host, drives the real panel. The person chooses "My agent"; the panel shows "Waiting for your agent..."; the agent
  takes the simplify task with `distill_tasks`, a first answer naming no block is refused with its reason, the second
  is accepted and the Read view shows it with the chip "Made by your agent"; the Agent view's trail lists every
  request. An answer after the page changed is refused (`stale_page`). Page actions: `page_actions` lists the tab's
  controls by label (never the value typed into the tab's field); a submit card says "This sends the form." and Reject
  sends nothing; Accept clicks the tab's button; a stale pageToken is refused. Mid-scenario screenshots are saved as
  `e2e/out/moment-*.png`.
- Following the page: a single-page app's new content is read again; a form that changed under the guide says so; a
  reload keeps the guide's step and puts the passed answers back into the form; the next form on the same site gets a
  same-label answer, marked "Carried over from the previous page"; pointing at a block in Read outlines its source in
  the tab.
- The guide library (guides/README.md): the guided demo form at `/demo/guided-form.html` (a separate made-up form)
  gets the library's example guide, labelled "Example guide" with no AI chip, read exactly as written (no changed-form
  notice), its steps fill the tab, a step quotes the form's own words in Czech; and no http(s) request leaves the
  browser apart from the tab's own page (the library is inside the extension). The same form at `/guided-form.html`
  gets no guide. The original demo form at `/demo/form.html` gets no guide either: it stays on the model path (here,
  with no model, "No AI used").

- The caption (`caption.spec.ts`, docs/caption.md): the toolbar click's path (started through the e2e build's
  `__distillCaption` hook in the service worker) puts the strip on the demo article. First sight says "Removed 6
  distractions" with "No AI used", More and Original (no next step: tours start only when asked for). The cookie banner, menu, ads and footer are hidden
  and the article is whole. The strip takes at most 8% of 1440x900 (15% of 390x844) and nothing covers it. More lists
  what was removed and brings one item back. Original shows everything; Back to Distill hides it again. A second click
  takes Distill off the page and leaves nothing behind. On the Czech demo form nothing is removed and
  the strip suggests nothing. The same measurements run on real sites with `npm run e2e:live` (see `live/README.md`).

- Remember this site (`caption-remember.spec.ts`, r2-08): with the e2e build's stand-in for Chrome's site permission
  (Chrome's prompt cannot be pressed; `__distillRemember` in the service worker), "Always clean this site" grants that
  one origin; a reload opens the strip by itself, Clean runs and an item shown again stays shown; Keep Czech and Easier
  to read off come back; Forget and a permission removed in Chrome's settings stop it; Close holds until the next load;
  never in a frame. `SPARK_EVIDENCE=<folder>` also writes its screenshots there as JPG.

Expected failures (`test.fail`, shown with a cross but counted as passing) are bugs the harness found; each carries the
reason. When the bug is fixed the test reports "expected to fail, but passed": remove the `test.fail` line. There are
none today.

Without host access Chrome hides every tab's URL from the extension, so `tabIdOf` takes the newly opened (active) tab
whose URL is hidden.

## Pictures (the look, r5-01)

`caption-visual.spec.ts` guards how Distill looks. It takes fixed screenshots and compares each with an approved
picture committed in `caption-visual.spec.ts-snapshots/`, so a change to the look is a change someone reviews in git.

- **What it takes (25 pictures).**
  - The strip, as an element screenshot of `distill-caption`, in each state: the first line, More open, a tour running
    (Just the facts, step 2) and Original. Each in light and dark, at 1440x900 and 390x844. These run on the claims demo
    with the stand-in model, so the claims, the gist and the tour are the same every run.
  - Nine cleaned demo pages, the whole window: claims (1440 and 390), actions, comfort, shop (1440 and 390), consent,
    reflow, video.
- **Threshold.** Tight: at most 0.2% of the pixels may differ (`maxDiffPixelRatio: 0.002`, per-pixel `threshold: 0.2`).
- **What keeps the pictures still.**
  - `deviceScaleFactor: 1`.
  - Reduced motion, and `animations: "disabled"`.
  - The caret hidden.
  - Fonts awaited (`document.fonts.ready`, in the page and in the strip).
  - The mouse parked in a corner, and focus taken off the last button clicked.
  - The clock fixed at 2026-11-23 (`context.clock.setFixedTime`). The byline's "3 years ago" and the deadlines are
    dates, and the fixed clock reaches the strip's frame too.
  - The strip awaited until its AI phases are past "finding" and its line and box have held.
  - Videos and embeds masked.
- **Platform.** The pictures carry Playwright's platform suffix (`-win32`): they are approved on the owner's Windows
  machine. Another OS renders fonts differently and needs its own approved set (`--update-snapshots` there).

**When a picture differs** the test fails and Playwright writes the expected, actual and diff pictures to
`e2e/out/test-results/`. They are shown side by side in:
- the HTML report, **`e2e/out/report/index.html`** (open it with `npx playwright show-report e2e/out/report`);
- the gallery, **`e2e/out/visual/index.html`**. It shows every approved picture, and next to any picture that differed
  in the last run it adds that run's actual and diff.

**Approve a change in the look:**

```sh
cd apps/extension
npm run build:e2e
npx playwright test -c e2e/playwright.config.ts --update-snapshots caption-visual
git diff --stat e2e/caption-visual.spec.ts-snapshots   # then look at each changed picture before you commit it
```

**The live sites** (`live/visual.live.ts`) are opt-in, and never part of `npm run e2e` or a plain `npm run e2e:live`.
Run them with `npx playwright test -c e2e/playwright.live.config.ts visual` (add `E2E_LIVE_SITES=<ids>` to run only
some sites).
- **The picture.** One per site after Clean, at 1440x900, compared at a loose threshold (25% of pixels,
  `E2E_VISUAL_RATIO`). Every picture, video and embed on the page is masked, and so are the strip's status line and
  chip. This catches a broken look (the strip missing, covered or unstyled, a blank page), not today's headline.
- **The structure check, exact.** The strip's line holds its parts in order, the strip is in Distill's fonts with the
  theme roles bound, and it is on top and within the size bar.
- **Approve.** The approved pictures are in `live/visual.live.ts-snapshots/`; renew them with `--update-snapshots`, the
  same way as above.

## What it cannot prove

- **Gemini Nano.** The on-device model needs a real Chrome profile with the model downloaded; the owner checks it by
  hand (below).
- **The real side panel.** Chrome's side panel frame (its width, opening from the toolbar icon, staying open across
  tabs) cannot be driven by Playwright; the panel runs here as a page in a tab.
- **The activeTab gesture.** The test manifest grants host access up front, so the "click the icon first" path and its
  messages are not exercised. The access-needed scenario runs the shipped manifest, but cannot press Chrome's
  permission prompt, so a grant is proven by the unit tests (chrome.permissions mocked), not here.

## The owner's Nano check, once per wave

In your own Chrome (138 or newer) with Gemini Nano available (`chrome://on-device-internals` shows the model ready):

1. Build with your `.env`: `npm run build -w @distill/extension`, then in `chrome://extensions` press **Reload** on
   Distill (Developer mode, Load unpacked from `apps/extension/dist` the first time).
2. Open a demo article (the hosted app's `/demo/article.html`), click the Distill icon. The model card at the foot of
   the menu says **Model on this device: ready**.
3. Read, level **Plain**: the text gets simpler and the chip says **On this device**.
4. Open the demo form (`/demo/form.html`), **Fill a form**: the steps are in English and the chip says where they ran.
   The guided demo form (`/demo/guided-form.html`) shows the guide library's **Example guide** instead (no AI ran, so
   no device chip).
5. Type an answer, press **Check this answer**: the reply's chip says **On this device** (a value never goes to the
   cloud).
6. Turn off the network (DevTools, Network, Offline) and press **Check this answer** again: it still answers, on this
   device.
7. **New layout** on the pricing demo: a layout appears, with the count of dropped parts if any, and its chip.
8. Note anything odd with a screenshot of the panel in the wave's report.
