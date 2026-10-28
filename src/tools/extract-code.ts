import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../client.js";
import { guard, ok, requireApiKey } from "./shared.js";

const inputSchema = {
  inbox_id: z
    .number()
    .int()
    .describe("Inbox (mailbox) id. Must be in scope for the token."),
  from: z
    .string()
    .optional()
    .describe("Optional sender filter (the expected code sender)."),
  max_age_minutes: z
    .number()
    .int()
    .optional()
    .describe("Ignore messages older than this many minutes."),
};

export function registerExtractCode(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_extract_code",
    {
      title: "Extract a verification code",
      description:
        "Extract a one-time / verification code (a 4–8 digit number) from recent " +
        "mail in a scoped inbox. GOVERNED: codes are only ever read from senders " +
        "ALLOWLISTED in the mailbox policy — mail from any other sender is ignored, " +
        'never scanned. Returns {status:"found", code, from, message_id} or ' +
        '{status:"not_found"}. Read-only; requires the `read` capability.',
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
        ok((await client.extractCode(args)) as unknown as Record<string, unknown>),
      );
    },
  );
}
