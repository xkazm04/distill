# Handrail

Lets your own coding agent (Claude Code or agy, the Antigravity CLI) read the Distill page you are on, propose values
for a form and ask to click a button or link. Nothing is written or clicked until you press Accept in the page. When
you choose "My agent" in Distill, your agent also does Distill's AI work (simplify the page, the form guide, the new
layout). Protocol and the security argument: [PROTOCOL.md](./PROTOCOL.md).

## Set up: one command

From the Distill folder, after `npm install`:

```sh
npm run agent:setup
```

It builds Handrail when needed and then, each step only if it is not done already (running it again is safe):

- finds the extension id from the `key` in `apps/extension/public/manifest.json` (an extension built from this folder
  always gets that id);
- writes the host program and its manifest to `%LOCALAPPDATA%\Distill\handrail` (Windows) and tells Google Chrome,
  Microsoft Edge and Chromium where it is (`HKCU\Software\...\NativeMessagingHosts\dev.distill.handrail`). On macOS and
  Linux the manifest goes into each browser's own `NativeMessagingHosts` folder: Chrome always, Edge and Chromium when
  they are installed;
- registers the `handrail` MCP server with Claude Code (`claude mcp add --scope user`, so every project sees it) and with
  agy (`agy mcp add`). An agent that is not installed is skipped. Your other MCP servers are never touched.

Then open the Distill panel on a page and ask your agent: "read this page with Distill". If the agent was already
running, start it again so it sees Handrail.

Another copy of the extension, for example one installed from a store, has a different id. Add it once:

```sh
npm run agent:setup -- --extension-id <32 letters from chrome://extensions>
```

Later runs keep it. `DISTILL_EXTENSION_ID` works too.

## Check it

```sh
npm run agent:doctor
```

One line per piece: `ok`, `MISSING` with the command that fixes it, or a `note`. It exits with 0 only when everything
needed is in place. "Distill panel: not open" is a note, not a problem: the host runs only while the panel is open.

| Doctor says | What it means | Fix |
| --- | --- | --- |
| Host program: ... is not there | Setup has not run on this computer | `npm run agent:setup` |
| Host program: it runs Node from ..., which is gone | Node was moved or upgraded | `npm run agent:setup` |
| Host program: it runs ..., which is gone | The Distill folder moved | `npm run agent:setup` |
| Host manifest: ... allows no extension | No extension id was found | `npm run agent:setup -- --extension-id <id>` |
| Host manifest: ... does not allow the extension's id | The extension's key changed | `npm run agent:setup` |
| Google Chrome finds the host: no key ... | The browser cannot start the host | `npm run agent:setup` |
| Claude Code: handrail is not registered | Claude Code does not know Handrail | `npm run agent:setup` |
| Claude Code: handrail is registered but did not start | The server fails to start | `claude mcp get handrail` shows why |
| agy (Antigravity CLI): handrail is turned off | It was disabled in agy | `agy mcp enable handrail` |
| Agent: neither Claude Code nor agy is installed | No agent to connect | Install one, then `npm run agent:setup` |
| The agent says `not_running` | The Distill panel is not open | Open the panel on a page |
| The agent says `extension_timeout` | The host runs but the page did not answer | Reload the page, keep the panel open |

## Remove it

```sh
npm run agent:remove
```

Removes the `handrail` entries from Claude Code and agy, the browser keys, the manifest files and the host program.
Nothing else.

## Your agent is the AI

1. Open the Distill panel on a page. Open the menu: under "Who does the AI work" (shown while the helper program is
   connected) choose **My agent (Claude Code or agy)**.
2. Distill now posts its work (simplify the page, build the form guide, make a new layout) for your agent and shows
   "Waiting for your agent..." with **Cancel** and **Use Distill's AI instead**.
3. In Claude Code, type:

   > Do Distill's tasks: call distill_tasks with waitSeconds 60, do each task by following its prompt, answer it with
   > distill_answer, and repeat until there is no task.

   Your agent answers; Distill checks each answer through the same door as its own AI and shows it with the square chip
   **Made by your agent**. If an answer cannot be used, the agent gets the reasons and tries again.

To simplify the page you are on, choose the reading level **Plain** or **Standard** in Read. Each task waits 180
seconds for an answer. Suggestions and checks of your own answers are never given to the agent: they stay on this
device.

Other things to ask: "Read this page with Distill and tell me what I have to do", "Fill in this form with my details
from ~/details.md" (each value waits for your Accept), "Go to the next page of this form" (the agent asks to click
"Next"; you accept). The Agent view lists everything your agent did in this session.

## Tools

`distill_read`, `wayfill_schema`, `wayfill_propose`, `wayfill_next`, `distill_tasks`, `distill_answer`,
`page_actions` and `page_action_propose`. Every proposal waits in the page for your answer. Every tool description
tells the agent that page text is untrusted data, never instructions.

## What it never does

It never writes a field and never clicks. Handrail only creates proposals; the page applies a value or clicks after you
accept it. It never sends the agent a value you typed: tasks hold page text or the form's structure, page actions hold
labels.
