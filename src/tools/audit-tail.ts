import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../client.js";
import { guard, ok, requireApiKey } from "./shared.js";

const inputSchema = {
  inbox_id: z
    .number()
    .int()
    .optional()
    .describe("Optional inbox filter; omit for all the customer's recent tool calls."),
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe("Max entries to return (default backend-defined)."),
};

const auditEntry = z.object({
  ts: z.string(),
  tool: z.string(),
  decision: z.string(),
  reason: z.string().nullish(),
  cost: z.unknown().optional(),
});

const outputSchema = {
  entries: z.array(auditEntry),
};

export function registerAuditTail(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_audit_tail",
    {
      title: "Read the audit tail",
      description:
        "Read the most recent governed tool calls for this customer (every call, " +
        "including denials and drafts, is logged). Read-only.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const missing = requireApiKey(client.hasApiKey());
      if (missing) return missing;
      return guard(async () => {
        const result = await client.auditTail(args);
        return ok(result as unknown as Record<string, unknown>);
      });
    },
  );
}
