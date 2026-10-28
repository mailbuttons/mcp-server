import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../client.js";
import { guard, ok, requireApiKey } from "./shared.js";

const inputSchema = {
  inbox_id: z
    .number()
    .int()
    .describe("Inbox (mailbox) id the proposed sender would be allowed to reach."),
  address: z
    .string()
    .describe("Email address to propose adding to the inbox's allowlist."),
};

const outputSchema = {
  proposal_id: z.string(),
  status: z.string().describe('Always "pending_human_approval".'),
};

export function registerProposeSender(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_propose_sender",
    {
      title: "Propose an allowlisted sender",
      description:
        "Propose adding an address to an inbox's send allowlist. This NEVER grants " +
        "access directly — it files a request for human approval and returns its id. " +
        "Requires the `propose_policy` capability.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const missing = requireApiKey(client.hasApiKey());
      if (missing) return missing;
      return guard(async () => {
        const result = await client.proposeSender(args);
        return ok({
          ...(result as unknown as Record<string, unknown>),
          _hint:
            "Filed for human approval. No access is granted until a reviewer approves; " +
            "check back via mailbuttons_audit_tail or the approval dashboard.",
        });
      });
    },
  );
}
