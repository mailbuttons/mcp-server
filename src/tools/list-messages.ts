import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../client.js";
import { guard, ok, requireApiKey } from "./shared.js";

const inputSchema = {
  inbox_id: z
    .number()
    .int()
    .describe("Inbox (mailbox) id. Must be in scope for the token."),
  query: z
    .string()
    .optional()
    .describe("Optional full-text/sender filter passed through to JMAP search."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque pagination cursor from a previous call's next_cursor."),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Max messages to return (default backend-defined)."),
};

const messageSummary = z.object({
  id: z.string(),
  thread_id: z.string(),
  from: z.string(),
  subject: z.string(),
  received_at: z.string(),
  status: z.string().describe('Always "delivered"; rejected mail is never stored.'),
});

const outputSchema = {
  messages: z.array(messageSummary),
  next_cursor: z.string().nullish(),
};

export function registerListMessages(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_list_messages",
    {
      title: "List inbox messages",
      description:
        "List delivered messages in a scoped inbox (id, thread, sender, subject, " +
        "received time). Read-only; only policy-passed mail is returned. Requires " +
        "the `read` capability.",
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
        const result = await client.listMessages(args);
        return ok(result as unknown as Record<string, unknown>);
      });
    },
  );
}
