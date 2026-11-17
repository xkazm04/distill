# Handrail, extension side

Authoritative protocol: `tools/handrail/PROTOCOL.md` section 3 (native messaging). This file only says where the
extension implements it. Envelope everywhere: `{ id, type, payload }`; payload types are the `types.ts` names.

```
handrail-host --native messaging--> background.js (relay) --chrome.runtime port "handrail"--> side panel --> page
```

- `background.js` calls `chrome.runtime.connectNative("dev.distill.handrail")` when the side panel opens the port
  `handrail`, forwards frames both ways unchanged, and sends the panel `{ type: "status", payload: { connected: false,
  reason } }` when the native host disconnects (the only message that is not in PROTOCOL.md; it never leaves the browser).
- The side panel answers host requests with `tool.result` under the request's id. The handler is `useHandrail` in
  `apps/web/src/ui/HandrailPanel.tsx` (shared UI), called once by the Workspace, so it answers whichever view is open;
  `HandrailPanel` only shows the proposals it holds. While the person is on another view, the Agent tab shows how many
  proposals wait, and a notice above the view says so.

| Host request | Answer `payload` |
| --- | --- |
| `page.read` | `{ ok: true, result: PageModel }` |
| `form.schema` | `{ ok: true, result: { structure, wizard } }`: the form read from the page now, with the open Wayfill guide when it is for that form, else a basic one built from the structure. Never values. |
| `wizard.next` | `{ ok: true, result: WizardStep }`: moves the open guide forward; `{ ok: false, error }` when no guide is open. Once the person opens "Fill a form", the guide stays mounted (hidden on other views) until the page changes. |
| `proposal.create` | `{ ok: true, result: {} }` once the proposal is on screen, undecided. Refused with `bad_request` when it has no `fingerprint`, and with `stale_form` when the form on the page now has another fingerprint (or there is none). |

  Other errors are `{ ok: false, error: { code, message } }` with code `extension_error`.
- On Accept the panel reads the form again; when its fingerprint differs from the proposal's it writes nothing, says
  the page changed, and the card stays undecided with Accept turned off. Otherwise it calls `writeValues` for that one
  field, outlines it, then sends `proposal.verdict { proposalId, verdict: "accepted" }`. If the write fails the proposal
  stays pending and nothing is sent. On Reject it sends `verdict: "rejected"` and changes nothing. Handrail has no
  message that writes a field.
- The panel re-reads the page only when the tab it is showing finishes loading or the person switches tabs
  (`src/sidepanel/tabEvents.ts`); another tab loading never resets the guide.
- Content scripts and pages never produce `tool.result` or `proposal.verdict`; only the panel's own UI does.
