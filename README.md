# Distill

**Only what matters on the page.**

Distill turns a cluttered web page, a form in a language you don't read, or an official letter into only the part you
need: a calm focus view, an English step-by-step wizard that fills in the original form, and a layout built for the
content (a comparison table, a checklist, a timeline). The AI runs on your device first with Gemini Nano through
**Firebase AI Logic hybrid inference** and reaches the cloud only when it has to. What you type into a form never
leaves your device.

> Status: in active development for #BuildHybridAI 2026. This README grows with the product.

## Who it is for

People who face bureaucracy in a language or register that isn't theirs: immigrants filling in residence, tax and
benefits forms; older people reading dense official letters; anyone whose reading is slowed by clutter, jargon or
cognitive load.

## What it does

| Feature | What you get | Where the AI runs |
| --- | --- | --- |
| **Distill** | the page reduced to its content, at your reading level, one switch back to the original | on device; long documents in the cloud |
| **Wayfill** | a form in any language becomes an English wizard, one question at a time, and your answers are written back into the original fields in the format they expect | the wizard is built from the form's structure (device or cloud); your values stay on the device, always |
| **Recast** | the page redrawn as the layout its content wants (comparison, checklist, steps, timeline, key facts) from a closed set of safe components | on device; large pages in the cloud |
| **Handrail** | your own agent (Claude Code, Antigravity CLI) can read the page and propose answers; nothing is written until you accept | the agent's own; Distill shares only what the page shows |
| **Envelope** (Android) | photograph or share a letter or paper form: what it says, the deadline, what to do, a reply wizard | on device first, cloud fallback |

## Install

- **Web app**: nothing to install. It is hosted on Firebase Hosting and will be served at
  `https://distill-hybrid-ai.web.app` from its first deploy. Until then, run it locally: `npm install`, then
  `npm run dev -w @distill/web`.
- **Chrome extension**: build it yourself while the core is in development. There is no download yet, because the
  extension's App Check token must never be published. Follow [apps/extension/README.md](apps/extension/README.md):
  your own Firebase project, your own debug token, `npm run build -w @distill/extension`, then Load unpacked in
  `chrome://extensions`.

## How it uses Firebase

- **Firebase AI Logic** hybrid inference (`prefer_on_device`) for page and structure tasks, `only_on_device` for any
  prompt that carries a person's values, and every result labelled with the SDK's `inferenceSource`.
- **App Check** on every AI Logic call.
- **Authentication** (anonymous first, link Google later) and **Firestore** for settings, a personal glossary and shared
  form guides (structure and explanations only, never values).
- **Remote Config** for prompt versions, the cloud model and the enabled Recast components.

## Repository

```
packages/engine   pure TypeScript: page and form extraction, the routing policy, prompts, validation
apps/web          hosted web app (Firebase Hosting)
apps/extension    Chrome extension (side panel)
apps/android      Envelope, Kotlin + Jetpack Compose
tools/handrail    local MCP server + native messaging host
```

Run `npm install` then `npm run check`. Setup for Firebase and each app is documented in its folder.

## License

Apache-2.0.
