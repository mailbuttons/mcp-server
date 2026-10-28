import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../client.js";
import { guard, ok, requireApiKey } from "./shared.js";

const inputSchema = {
  inbox_id: z.number().int().optional().describe("Optional inbox filter."),
  since: z
    .string()
    .optional()
    .describe(
      "Inclusive lower bound on created_at (RFC3339) — pass the last export's high-water mark for incremental pulls.",
    ),
  until: z
    .string()
    .optional()
    .describe("Inclusive upper bound on created_at (RFC3339)."),
  limit: z.number().int().optional().describe("Max entries to export."),
  format: z
    .enum(["jsonl", "cef"])
    .optional()
    .describe("Export format (default jsonl)."),
};

export function registerExportAudit(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_export_audit",
    {
      title: "Export the audit log (Business)",
      description:
        "Export the customer's tamper-evident audit log for a SIEM, including the " +
        "hash-chain fields (entry_hash, prev_hash) so a recipient can verify " +
        "integrity. Business-tier only: requires the token's `siem_export` flag, " +
        "otherwise returns `siem_export_not_enabled`. Read-only.",
      inputSchema,
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
      return guard(async () =>
        ok((await client.exportAudit(args)) as unknown as Record<string, unknown>),
      );
    },
  );
}
