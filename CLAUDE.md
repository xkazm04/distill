# Distill - project guidance

Distill turns any page, foreign-language form or official letter into only what matters: a focus view (Distill), an
English step-by-step wizard that fills the original form (Wayfill), a generated layout from a closed component kit
(Recast), a local agent bridge with confirm-every-write (Handrail) and an Android app for photographed letters
(Envelope). AI runs through Firebase AI Logic hybrid inference, on the device first. Entry to #BuildHybridAI 2026
(Devpost deadline 2026-11-30 14:00 PT), built and maintained through the bp product blueprint (sibling checkout `../bp`).

## Law

- **The wire contract is `packages/engine/src/types.ts`.** Type, field, enum and key names there are exact and shared
  by web, extension, Handrail and Android (via exported JSON Schema). Absent optional fields are omitted, never `null`.
- **Values never leave the device.** A person's typed values (`FormValues`) and the autofill profile live only in device
  storage. Cloud-eligible prompts take `FormStructure`, which has no value field. A `values`-class task routes
  `only_on_device` and has no cloud fallback; when no local model exists, the feature says so instead of degrading.
  Firestore never stores a value. The payload-privacy test guards this; never weaken it to make something pass.
- **Say where it ran.** Every AI result shows its `inferenceSource` (on device / in cloud) from the SDK response, and the
  local model state (`unavailable | downloadable | downloading | available`) while it matters.
- **Model output is untrusted input.** Recast specs and wizards pass ONE validation door (`validateAndRepair`,
  `parseWizard`): closed vocabulary, no HTML, unknown kinds dropped AND counted on screen; nothing valid -> fall back to
  the focus view. Agent (Handrail) writes are proposals; nothing changes a field until the person accepts.
- **The original page is never lost.** Distill overlays; one control always returns to the untouched original.
- **Secrets.** Firebase config comes from `.env` (see `.env.example`); `.env*`, keys, keystores and
  `google-services.json` are git-ignored. `npm run secret-scan` runs in `npm run check` and before every push.

## Gates

`npm run check` (typecheck, tests, secret scan) at the root. Android: `apps/android/gradlew assembleDebug`.

## Git

Small atomic commits on `master`; push verified work to the public GitHub repo (owner approved public-from-start,
2026-11-17). Never force-push or rewrite pushed history.
