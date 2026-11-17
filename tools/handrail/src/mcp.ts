import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ChannelClient } from "./channel.js";
import { HandrailError, type HandrailTool } from "./types.js";

export interface Caller {
  call(tool: HandrailTool, args: Record<string, unknown>): Promise<unknown>;
}

/** Connects lazily on the first call and again after the channel drops, so the agent can start before Chrome. */
export function channelCaller(connect: () => Promise<ChannelClient> = () => ChannelClient.connect()): Caller {
  let client: ChannelClient | undefined;
  return {
    async call(tool, args) {
      if (!client || !client.connected) client = await connect();
      return client.call(tool, args);
    },
  };
}

const NOTHING_WRITTEN = "Nothing is written to the page until the person accepts it there.";

function reply(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
function failure(e: unknown) {
  const code = e instanceof HandrailError ? e.code : "internal";
  const message = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text" as const, text: `${code}: ${message}` }] };
}

export function createMcpServer(caller: Caller): McpServer {
  const server = new McpServer({ name: "handrail", version: "0.1.0" });
  const run = (tool: HandrailTool, args: Record<string, unknown>) => caller.call(tool, args).then(reply, failure);

  server.registerTool("distill_read", {
    description: `Read the page the person is looking at in Distill: its title, language, kind and content blocks. Read only. ${NOTHING_WRITTEN}`,
    inputSchema: {},
  }, () => run("distill_read", {}));

  server.registerTool("wayfill_schema", {
    description: `Read the form on the active page: each field with its label, kind, options and format hints, plus the current step-by-step wizard and the state of your earlier proposals. It holds no values the person typed. Read only. ${NOTHING_WRITTEN}`,
    inputSchema: {},
  }, () => run("wayfill_schema", {}));

  server.registerTool("wayfill_propose", {
    description: `Propose one value for one field of the form you read with wayfill_schema, passing that form's fingerprint. The proposal appears in the page with your rationale beside Accept and Reject buttons. ${NOTHING_WRITTEN} Returns a proposalId and the verdict "pending", "accepted" or "rejected". Set waitSeconds to wait for the person's answer (up to 120); otherwise the verdict is "pending" and you can see it later in wayfill_schema.`,
    inputSchema: {
      fieldId: z.string().min(1).describe("The fieldId from wayfill_schema."),
      fingerprint: z.string().min(1).max(128).describe("The structure.fingerprint from wayfill_schema: the form you read. If the page now shows another form, the proposal is refused with stale_form; read the form again."),
      value: z.string().max(2000).describe("The value you propose, in the format the field expects."),
      rationale: z.string().min(1).max(500).describe("Plain words telling the person why this value."),
      waitSeconds: z.number().min(0).max(120).optional().describe("How long to wait for the person's verdict. Default 0."),
    },
  }, (args) => run("wayfill_propose", args));

  server.registerTool("wayfill_next", {
    description: `Move the page's wizard to the next step and return that step: the question, the explanation and the fields it covers. It changes which step the person sees, never a field value. ${NOTHING_WRITTEN}`,
    inputSchema: {},
  }, () => run("wayfill_next", {}));

  return server;
}
