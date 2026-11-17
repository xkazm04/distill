# Handrail, extension side

Authoritative protocol: `tools/handrail/PROTOCOL.md` section 3 (native messaging). This file only says where the
extension implements it. Envelope everywhere: `{ id, type, payload }`; payload types are the `types.ts` names.

```
handrail-host --native messaging--> background.js (relay) --chrome.runtime port "handrail"--> side panel --> page
```

- `background.js` calls `chrome.runtime.connectNative("dev.distill.handrail")` when the side panel opens the port
  `handrail`, forwards frames both ways unchanged, and sends the panel `{ type: "status", payload: { connected: false,
  reason } }` when the native host disconnects (the only message that is not in PROTOCOL.md; it never leaves the browser).
- The side panel (`apps/web/src/ui/HandrailPanel.tsx`, shared UI) answers host requests with `tool.result` under the
  request's id:

| Host request | Answer `payload` |
| --- | --- |
| `page.read` | `{ ok: true, result: PageModel }` |
| `form.schema` | `{ ok: true, result: { structure, wizard } }`: the open Wayfill guide, or a basic one built from the structure. Never values. |
| `wizard.next` | `{ ok: true, result: WizardStep }`: moves the open guide forward; `{ ok: false, error }` when no guide is open |
| `proposal.create` | `{ ok: true, result: {} }` once the proposal is on screen, undecided |

  Errors are `{ ok: false, error: { code, message } }` with code `extension_error`.
- On Accept the panel calls `writeValues` for that one field, outlines it, then sends `proposal.verdict
  { proposalId, verdict: "accepted" }`. If the write fails the proposal stays pending and nothing is sent. On Reject it
  sends `verdict: "rejected"` and changes nothing. Handrail has no message that writes a field.
- Content scripts and pages never produce `tool.result` or `proposal.verdict`; only the panel's own UI does.
