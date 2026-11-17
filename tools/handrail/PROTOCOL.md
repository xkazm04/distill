# Handrail protocol

Handrail lets the person's own coding agent operate a Distill page. The agent can read and propose; only the person,
in the page, can change a field. This file is authoritative for the two links below.

```
agent (Claude Code / agy) --MCP stdio--> handrail-mcp --channel--> handrail-host --native messaging--> extension --> page
```

## 1. Tools (agent <-> handrail-mcp, MCP stdio)

Names are exactly the `HandrailTool` union in `packages/engine/src/types.ts`. Every result is one text block holding JSON.

| Tool | Input | Result |
| --- | --- | --- |
| `distill_read` | none | the active tab's `PageModel` |
| `wayfill_schema` | none | `{ structure: FormStructure, wizard: Wizard, ...extension fields, proposals: [{proposalId, fieldId, verdict}] }`; `proposals` is added by the host |
| `wayfill_propose` | `{ fieldId, value, rationale, waitSeconds? }` (value <= 2000, rationale <= 500 chars, waitSeconds 0-120) | `{ proposalId, verdict }`, verdict `pending` \| `accepted` \| `rejected` |
| `wayfill_next` | none | the wizard step now shown (`WizardStep`) |

Errors come back as an MCP tool error whose text is `<code>: <plain message>`. Codes: `not_running` (Distill is not
open), `bad_request`, `too_many_pending` (20 undecided proposals at most), `extension_timeout` (30 s), `extension_error`,
`closed`, `unknown_tool`, `internal`.

## 2. Channel (handrail-mcp <-> handrail-host)

The host is the server: Chrome starts it when the extension calls `connectNative("dev.distill.handrail")`, and it exits
when Chrome closes its stdin. The MCP server is the client; the agent starts it, possibly before Chrome, so it connects
lazily on the first tool call and reconnects after a drop.

**Transport.** A Windows named pipe `\\.\pipe\distill-handrail-<24 hex>` or, on macOS and Linux, a unix domain socket
`h-<24 hex>.sock` in a mode-0700 directory (`$XDG_RUNTIME_DIR/distill-handrail`, else `~/.distill/handrail`), socket mode 0600.
The name is random per host run.

**Discovery.** At start the host writes `channel.json` (`%LOCALAPPDATA%\Distill\handrail\` on Windows) with
`{ "v": 1, "endpoint": "<pipe or socket>", "token": "<32 random bytes, base64url>", "pid": n }`, mode 0600, and deletes it on
exit. `HANDRAIL_CHANNEL_FILE` overrides the path (tests, unusual profiles).

**Framing.** UTF-8 JSON, one object per line (`\n`), at most 1 MiB per line.

**Handshake.** The first message on every connection must be `{ "type": "hello", "token": "...", "v": 1 }`. A wrong token, any
other first message, or no hello within 3 s closes the connection without a reply (the token is compared in constant time).
The server then answers `{ "type": "hello.ok", "v": 1 }`.

**Calls.** client -> server `{ "id": "1", "type": "call", "tool": "<HandrailTool>", "args": { ... } }`; server -> client
`{ "id": "1", "type": "result", "ok": true, "result": ... }` or `{ ..., "ok": false, "error": { "code", "message" } }`.
Calls may overlap; answers are matched by `id`.

### Why a web page cannot reach it

1. **No TCP port exists.** A web page can only open connections through `fetch`/XHR/WebSocket/WebRTC, and all of them name a
   URL with a host and TCP port. None can name a named pipe (`\\.\pipe\...`) or a unix socket file, so there is no address a
   page could even try. There is no HTTP server on a fixed port (or any port) for a tab, a DNS-rebinding attack, or a
   cross-origin request to call.
2. **The name is unguessable and the token is secret.** Even a local program must read `channel.json`, which lives in the
   user's own profile directory (the user, SYSTEM and administrators on Windows; mode 0600 inside a 0700 directory elsewhere).
   Pipe name and token are random per run, so another local user cannot connect without that file, and the first message
   is rejected without the token.
3. **The browser side is pinned to one extension.** Chrome starts the host only for the extension ids listed in the manifest's
   `allowed_origins`, and a web page cannot use `chrome.runtime.connectNative` at all. Web pages never talk to the host;
   the extension's own service worker does, and it must not relay page-originated messages as tool calls (see section 3).

Limits: a process running as the same user (including the person's own agent, which is the point) can read the file and
connect. Handrail defends against pages and other users, not against code already running as the person.

## 3. Native messaging (handrail-host <-> extension)

Chrome framing: a 4-byte little-endian length, then that many bytes of UTF-8 JSON. Host -> extension is capped at 1 MiB by
Chrome, extension -> host at 64 MiB. stdout carries only frames; the host logs to stderr.

Every message is an envelope `{ "id": string, "type": string, "payload": any }`.

Host -> extension (requests; the extension answers each with a `tool.result` carrying the same `id`):

| `type` | `payload` | answer `payload.result` |
| --- | --- | --- |
| `page.read` | `{}` | `PageModel` |
| `form.schema` | `{}` | `{ structure: FormStructure, wizard: Wizard }` (no values) |
| `wizard.next` | `{}` | the new `WizardStep` |
| `proposal.create` | `HandrailProposal` | `{}`: the proposal is now on screen, undecided |

Extension -> host:

| `type` | `id` | `payload` |
| --- | --- | --- |
| `tool.result` | the request's id | `{ ok: true, result }` or `{ ok: false, error: { code, message } }` |
| `proposal.verdict` | any fresh id | `{ proposalId, verdict: "accepted" \| "rejected" }`, sent when the person presses Accept or Reject |

Rules for the extension side:

- The page shows the proposal with its `rationale` and writes the field only when the person presses Accept; the extension
  then sends `proposal.verdict`. Handrail has no message that writes a field, and the host never sends one.
- A verdict is final: the host keeps the first one per `proposalId` and ignores any later one, unknown ids, and `pending`.
- Requests are only ever issued by the host on behalf of an authenticated channel client. The extension must not turn
  messages from content scripts or pages into `tool.result` or `proposal.verdict` envelopes except from its own Accept/Reject UI.
- `wayfill_schema` must not include values the person typed (privacy law). The host adds only proposal ids, field ids and verdicts.

## 4. Proposal state machine

`pending` -> `accepted` | `rejected`. Nothing else. At most 20 proposals may be `pending` at once; `value` and `rationale`
are length-capped and `rationale` is required so the person can see why. `waitSeconds` makes `wayfill_propose` hold its
answer until a verdict or the deadline, whichever is first; on the deadline it returns `pending` and the verdict can be seen
later in `wayfill_schema`.
