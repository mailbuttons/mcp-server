#!/usr/bin/env node
/**
 * Mailbuttons MCP server over stdio. Intended to be launched by an MCP client
 * (Claude Desktop / Claude Code) as a child process.
 *
 * Env: MAILBUTTONS_API_URL (default https://mailbuttons.com), MAILBUTTONS_API_KEY.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MailbuttonsClient } from "./client.js";
import { createServer } from "./server.js";
import { registerBuildTools } from "./tools/buildtime/index.js";

async function main(): Promise<void> {
  // The stdio build is the local Claude Code skill surface, so it carries the
  // build-time tools (generate_policy / scaffold_integration / run_selftest) on
  // TOP of the 12 governed runtime tools. The HTTP server never registers these.
  // Share one client so run_selftest exercises the same configured backend.
  const client = new MailbuttonsClient();
  const server = createServer({ client });
  registerBuildTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr so they never corrupt the stdio JSON-RPC stream.
  console.error("[mailbuttons-mcp] stdio transport ready (12 runtime + 3 build tools)");
}

main().catch((err) => {
  console.error("[mailbuttons-mcp] fatal:", err);
  process.exit(1);
});
