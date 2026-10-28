/**
 * Shared plumbing for Mailbuttons MCP tools.
 *
 * Every tool follows the same shape: a Zod input schema, a Zod output schema,
 * honest annotations, and a handler that returns `structuredContent`. Governed
 * outcomes from the backend (a `blocked` or `draft_pending_approval` send) are
 * NORMAL data — they are returned, not raised. Only genuine failures (scope /
 * capability / auth / network) become tool errors, and those name the policy
 * rule or missing capability plus the next step the agent should take.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MailbuttonsApiError } from "../client.js";

/** A successful result: JSON text content + matching structuredContent. */
export function ok(structured: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
  };
}

/**
 * An actionable tool error. The message names the policy rule / missing
 * capability and the next step, so the agent can self-correct rather than
 * retrying blindly.
 */
export function fail(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/**
 * Wrap a tool handler so backend errors become actionable MCP errors. Unknown
 * errors are reported without leaking internals or secrets.
 */
export async function guard(
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MailbuttonsApiError) {
      const next = err.nextStep
        ? ` Next step: ${err.nextStep}`
        : " Check the token's scope and capabilities, or request escalation via mailbuttons_request_promotion.";
      return fail(
        `Request denied by Mailbuttons governance (HTTP ${err.status}): ${err.code}.${next}`,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    return fail(`Mailbuttons MCP tool failed: ${detail}`);
  }
}

/** Guard that the configured client actually has an API key before any call. */
export function requireApiKey(hasKey: boolean): CallToolResult | undefined {
  if (hasKey) return undefined;
  return fail(
    "No Mailbuttons API token configured. Set MAILBUTTONS_API_KEY to a scoped " +
      "`mb_<env>_...` token before calling Mailbuttons tools.",
  );
}
