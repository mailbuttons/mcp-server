/**
 * Build-time tools — registered ONLY on the stdio server (the local Claude Code
 * skill surface), NEVER on the remote HTTP server. These tools write local files
 * (`generate_policy`, `scaffold_integration`) or orchestrate the runtime client
 * in sandbox (`run_selftest`). Like everything in this skill they are
 * sandbox-only: none enable external send, promote, or widen a token's scope.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../../client.js";

import { registerGeneratePolicy } from "./generate-policy.js";
import { registerScaffoldIntegration } from "./scaffold-integration.js";
import { registerRunSelftest } from "./run-selftest.js";

/** Register the 3 build-time tools. Call this from the stdio server only. */
export function registerBuildTools(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  registerGeneratePolicy(server);
  registerScaffoldIntegration(server);
  registerRunSelftest(server, client);
}
