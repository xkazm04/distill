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
- A small local server serves `apps/web/public/demo/*.html`.
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

Expected failures (`test.fail`, shown with a cross but counted as passing) are bugs the harness found; each carries the
reason. When the bug is fixed the test reports "expected to fail, but passed": remove the `test.fail` line. There are
none today.

Without host access Chrome hides every tab's URL from the extension, so `tabIdOf` takes the newly opened (active) tab
whose URL is hidden.

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
4. Open the demo form, **Fill a form**: the steps are in English and the chip says where they ran.
5. Type an answer, press **Check this answer**: the reply's chip says **On this device** (a value never goes to the
   cloud).
6. Turn off the network (DevTools, Network, Offline) and press **Check this answer** again: it still answers, on this
   device.
7. **New layout** on the pricing demo: a layout appears, with the count of dropped parts if any, and its chip.
8. Note anything odd with a screenshot of the panel in the wave's report.
