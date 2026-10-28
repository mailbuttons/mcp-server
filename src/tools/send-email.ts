import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient, SendResult } from "../client.js";
import { guard, ok, requireApiKey } from "./shared.js";

const inputSchema = {
  inbox_id: z
    .number()
    .int()
    .describe("Sending inbox (mailbox) id. Must be in scope for the token."),
  to: z
    .array(z.string())
    .min(1)
    .describe("Recipient addresses. External recipients on a sandbox token become drafts."),
  subject: z.string().describe("Email subject."),
  text: z.string().optional().describe("Plain-text body."),
  html: z.string().optional().describe("Optional HTML body."),
  thread_id: z
    .string()
    .optional()
    .describe("If set, send as a threaded reply rather than a fresh message."),
  mode: z
    .enum(["send", "draft"])
    .optional()
    .describe('"send" (default) attempts delivery; "draft" always parks for approval.'),
};

const outputSchema = {
  message_id: z.string().nullish(),
  status: z
    .enum(["sent", "queued", "draft_pending_approval", "blocked"])
    .describe("Governed outcome. blocked/draft_pending_approval are NORMAL, not errors."),
  policy: z.object({
    decision: z.string(),
    matched_rule: z.string().nullish(),
  }),
  reason: z.string().nullish(),
};

/**
 * Add an agent-facing hint to governed (non-delivered) outcomes so the model
 * knows the send did not go out and what to do next. These are expected results,
 * never surfaced as tool errors.
 */
function summarize(result: SendResult): Record<string, unknown> {
  const out = result as unknown as Record<string, unknown>;
  if (result.status === "blocked") {
    out._hint =
      `NOT SENT. Send blocked by policy rule "${result.policy.matched_rule ?? "unknown"}"` +
      `${result.reason ? `: ${result.reason}` : ""}. The token cannot reach these recipients. ` +
      "To gain external-send scope, call mailbuttons_request_promotion (human approval required).";
  } else if (result.status === "draft_pending_approval") {
    out._hint =
      `NOT SENT. Parked as a draft pending human approval` +
      `${result.reason ? ` (${result.reason})` : ""}. A reviewer must approve before it leaves. ` +
      "To enable autonomous external send, call mailbuttons_request_promotion.";
  }
  return out;
}

export function registerSendEmail(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_send_email",
    {
      title: "Send an email (governed)",
      description:
        "Send or reply from a scoped inbox, subject to send policy. Sandbox tokens can " +
        "never deliver to external recipients — such sends return " +
        "`draft_pending_approval`; disallowed recipients return `blocked` with the " +
        "matched rule. Both are EXPECTED governed outcomes, not errors. Requires the " +
        "`send_internal` capability.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const missing = requireApiKey(client.hasApiKey());
      if (missing) return missing;
      return guard(async () => {
        const result = await client.send(args);
        return ok(summarize(result));
      });
    },
  );
}
