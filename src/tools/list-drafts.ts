import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../client.js";
import { guard, ok, requireApiKey } from "./shared.js";

const inputSchema = {
  inbox_id: z
    .number()
    .int()
    .optional()
    .describe("Optional inbox filter; omit for all in-scope drafts."),
  status: z
    .enum(["pending", "sent"])
    .optional()
    .describe("Optional status filter."),
  limit: z.number().int().optional().describe("Max drafts to return."),
};

export function registerListDrafts(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_list_drafts",
    {
      title: "List held drafts",
      description:
        "List sends held for human approval (an external recipient on a sandbox " +
        'token, or mode="draft"). Scoped to the token\'s customer and inbox set. ' +
        "Read-only; requires the `read` capability. A human releases a draft " +
        "out-of-band — the agent cannot send it.",
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
        ok((await client.listDrafts(args)) as unknown as Record<string, unknown>),
      );
    },
  );
}
