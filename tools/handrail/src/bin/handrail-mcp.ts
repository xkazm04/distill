#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { channelCaller, createMcpServer } from "../mcp.js";

await createMcpServer(channelCaller()).connect(new StdioServerTransport());
