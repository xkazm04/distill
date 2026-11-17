# Handrail

Lets your own coding agent read the Distill page you are on and propose values for a form. Nothing is written until you
press Accept in the page. Protocol and the security argument: [PROTOCOL.md](./PROTOCOL.md).

## Set up

```sh
npm install
npm run build -w @distill/handrail
npm run install-host -w @distill/handrail -- --extension-id <your extension id>   # or set DISTILL_EXTENSION_ID
```

The extension id is on `chrome://extensions`. The installer writes the native messaging manifest
(`dev.distill.handrail`) with `allowed_origins` for that one extension: on Windows under
`HKCU\Software\Google\Chrome\NativeMessagingHosts`, on macOS in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`,
on Linux in `~/.config/google-chrome/NativeMessagingHosts`. Remove it with `-- --uninstall`.

## Connect an agent

Use the absolute path of `dist/bin/handrail-mcp.js` in this folder.

Claude Code:

```sh
claude mcp add handrail -- node /absolute/path/to/tools/handrail/dist/bin/handrail-mcp.js
```

Antigravity CLI (`agy`; its `mcp add` takes `<name> <command> [args...]`, flags before the name; checked with `agy mcp add --help`):

```sh
agy mcp add handrail node /absolute/path/to/tools/handrail/dist/bin/handrail-mcp.js
```

I confirmed the `agy mcp add` syntax from its help text; I did not run it against a live Distill page.

Then open a page with a form in Chrome with the Distill extension, and ask the agent to help fill it. The tools are
`distill_read`, `wayfill_schema`, `wayfill_propose` and `wayfill_next`. Every proposal waits in the page for your answer.

## What it never does

It never writes a field. Handrail only creates proposals; the page applies a value after you accept it.
