import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../client.js";
import { guard, ok, requireApiKey } from "./shared.js";

const inputSchema = {
  draft_id: z
    .number()
    .int()
    .describe("Id of the held draft (from mailbuttons_list_drafts)."),
};

export function registerGetDraft(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_get_draft",
    {
      title: "Get a held draft",
      description:
        "Fetch one held draft in full (recipients, subject, body, the reason it " +
        "was held, status). Scoped to the token's customer and inbox set. " +
        "Read-only; requires the `read` capability.",
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
        ok((await client.getDraft(args)) as unknown as Record<string, unknown>),
      );
    },
  );
}
