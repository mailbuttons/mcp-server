import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../client.js";
import { guard, ok, requireApiKey } from "./shared.js";

const inputSchema = {
  email_id: z.string().describe("JMAP email id the attachment belongs to."),
  blob_id: z.string().describe("Attachment blob id (from message attachments meta)."),
  inbox_id: z
    .number()
    .int()
    .describe("Inbox (mailbox) id. Must be in scope for the token."),
};

const outputSchema = {
  filename: z.string().optional(),
  content_type: z.string().optional(),
  text: z
    .string()
    .optional()
    .describe("Extracted text for text/* and text/csv attachments."),
  error: z
    .string()
    .optional()
    .describe('Set when extraction is unsupported, e.g. "pdf_extraction_not_enabled".'),
  next_step: z.string().optional(),
};

export function registerGetAttachmentText(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_get_attachment_text",
    {
      title: "Extract attachment text",
      description:
        "Extract inline text from a message attachment (text/* and text/csv). PDF and " +
        "other binary types are not extracted yet and return an `error` with a next " +
        "step. Read-only; requires the `attachments` capability.",
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
        const result = await client.getAttachmentText(args);
        return ok(result as unknown as Record<string, unknown>);
      });
    },
  );
}
