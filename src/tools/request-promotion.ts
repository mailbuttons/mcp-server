import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../client.js";
import { guard, ok, requireApiKey } from "./shared.js";

const inputSchema = {
  inbox_id: z
    .number()
    .int()
    .optional()
    .describe("Optional inbox to scope the requested grant to."),
  grant_capabilities: z
    .array(z.string())
    .min(1)
    .describe(
      "Capabilities to request, e.g. send_external, attachments. A token can never " +
        "widen its own scope — this only files a request.",
    ),
  promote_to: z
    .literal("production")
    .optional()
    .describe("Request promotion of a sandbox token to production."),
};

const outputSchema = {
  request_id: z.string(),
  approval_url: z.string(),
  status: z.string().describe('Always "pending".'),
};

export function registerRequestPromotion(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_request_promotion",
    {
      title: "Request capability / environment promotion",
      description:
        "File a human-approval request to grant additional capabilities (e.g. " +
        "send_external) or promote a sandbox token to production. The token CANNOT " +
        "widen its own scope; this only opens a request and returns an approval URL.",
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
        const result = await client.requestPromotion(args);
        return ok({
          ...(result as unknown as Record<string, unknown>),
          _hint:
            "Pending human approval. Share the approval_url with an authorised reviewer; " +
            "no capability is active until they approve.",
        });
      });
    },
  );
}
