# Chrome Web Store listing - Distill (the on-device public build)

The text to paste into the Chrome Web Store developer dashboard for the package made by `npm run pack:store`
(`apps/extension/release/distill-extension-<version>-store.zip`, the manifest `key` stripped). Only the public build is
ever uploaded: it runs AI only on the device and holds no credential. Keep this file in step with
`apps/web/public/privacy.html` (hosted at https://distill-hybrid-ai.web.app/privacy.html).

## Store listing

**Name** (manifest `name`): Distill

**Short description** (manifest `description`, 132 characters at most):

> Only what matters on the page: a clear reading view and an English step-by-step guide for forms. Your answers stay on your device.

**Category**: Make Chrome Yours > Accessibility (second choice: Productivity > Tools)

**Language**: English

**Long description**:

> Distill makes the page you are on easier to read and its forms easier to fill in. It opens in Chrome's side panel,
> next to the page.
>
> - **Read**: the main text of the page without the clutter - menus, ads, cookie banners and pop-ups are left out. You
>   can ask for simpler words, or read the page as written.
> - **Fill a form**: an English step-by-step guide for a form in any language. Distill explains each question in plain
>   words, one at a time, and fills in the page's own form as you answer. Each field it fills is marked on the page.
> - **New layout**: the page's key facts, steps and dates, arranged as a short, clear summary.
>
> **Private by design.** This version of Distill uses only Gemini Nano, the AI model built into Chrome, on your own
> computer. Nothing is sent to the cloud. What you type into a form stays on your device and is never saved online.
> There is no account, no analytics and no advertising.
>
> **What you need.** Chrome 138 or newer on a computer that can run Chrome's built-in AI model. Distill shows the
> model's state in the side panel and lets you start its download. Without the model, Distill still shows the page as
> written, a simple guide for forms, and the reading view.
>
> **For people who use AI agents.** Distill can connect to a helper program on your computer (Handrail), so an AI agent
> you run can read the page in Distill and propose answers. Nothing changes in a form until you accept it. Distill asks
> for your permission before it connects.
>
> Distill is open source (Apache-2.0): https://github.com/xkazm04/distill

## Privacy practices tab

**Single purpose**:

> Distill makes the web page in the current tab easier to understand and its forms easier to fill in, in the side
> panel: a clear reading view, an English step-by-step form guide, and a short summary layout.

**Permission justifications**:

| Permission | Why Distill needs it |
| --- | --- |
| `sidePanel` | Distill's whole interface is the side panel next to the page. |
| `activeTab` | When you click the Distill icon, Distill may read the page in that tab: its text, its form fields, and its colours and fonts. No standing access to any site. |
| `scripting` | To run Distill's page reader in the tab you opened it on: it reads the text and form fields, fills in the answers you accepted, and marks the fields it filled. |
| `storage` | To keep your settings (reading level, language) and your place in a form guide on your device, so a page reload does not lose them. Answers are kept only for the browser session and cleared when the tab closes. |
| `offscreen` | Only on a site that blocks on-device AI inside frames: Distill runs its on-device AI model in a hidden page of its own, so a translation of that page still runs on your device. The hidden page closes once no page needs it. It opens no window and sends nothing anywhere. |
| Optional host access `<all_urls>` | Asked for only when you choose it: "Read this page" for one site, or "Allow on all sites" so Distill can follow you from tab to tab and page to page without a click each time. You can take it back at any time in Chrome's extension settings. |
| Optional `nativeMessaging` | Asked for only when you choose "Connect your helper program": it connects Distill to Handrail, a program you installed on your own computer, so an AI agent you run can propose form answers. Nothing changes until you accept. |

**Remote code**: No, I am not using remote code. Every script is in the package; the extension page loads no script,
font or style from the network.

**Data usage** - what Distill collects (sends off the device): nothing. Tick none of the data types.

| Data type | Collected? | Notes |
| --- | --- | --- |
| Personally identifiable information | No | |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | |
| Personal communications | No | |
| Location | No | |
| Web history | No | Distill does not keep a list of pages you visit. |
| User activity | No | No analytics, no click or keystroke tracking. |
| Website content | No | Page text and form fields are read on the device, for the side panel, and processed only by the AI model on the device. They are not sent anywhere. |

**Certifications** (tick all three):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**: https://distill-hybrid-ai.web.app/privacy.html

## Screenshots (1280 x 800, PNG, up to five)

Taken from the built public extension (the end-to-end harness in `apps/extension/e2e` can make them), on the demo
pages in `apps/web/public/demo/`, with the model ready:

1. **Read** on the news article demo: the clean reading view beside the cluttered page, the "On this device" chip.
2. **Fill a form** on the form demo: one step of the English guide, the field it filled marked on the page.
3. **New layout** on the pricing demo: the key facts and steps summary.
4. **The model card**: "This version of Distill works only with the AI model on this device", the model's state.
5. **A page in a dark theme**: the side panel taking the page's look, with readable colours.

Small promo tile (440 x 280): the Distill wordmark on the brand paper, with the line "Only what matters on the page".

## Before each upload

1. `npm run check` green, then `npm run pack:store` (it builds the public variant, runs `check-dist`, scans the zip's
   bytes, strips `key`).
2. Bump `version` in `apps/extension/public/manifest.json` first: the store refuses a version it already has.
3. The store gives the uploaded item its own extension id (not the one from the repository's `key`). Add
   `chrome-extension://<store id>/` to Handrail's native host `allowed_origins` next to the repository id.
