/**
 * Test plumbing: spin up the real MCP server in-process (via the SDK's
 * in-memory transport) wired to a MailbuttonsClient whose `fetch` we control,
 * so tool behaviour is exercised end-to-end without a live backend.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
// Import the built output so vitest never has to resolve NodeNext `.js`
// specifiers back to `.ts` sources.
import { createServer, MailbuttonsClient } from "../dist/server.js";

export type ToolResult = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

/** A fetch stub that returns a fixed status + JSON body and records the URL. */
export function stubFetch(
  status: number,
  body: unknown,
): { fetchImpl: typeof fetch; calls: Array<{ url: string; method?: string }> } {
  const calls: Array<{ url: string; method?: string }> = [];
  const fetchImpl = (async (input: unknown, init?: { method?: string }) => {
    calls.push({ url: String(input), method: init?.method });
    return new Response(body === undefined ? "" : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** Connect an MCP client to a fresh server backed by the given REST client. */
export async function connect(mb: MailbuttonsClient): Promise<Client> {
  const server = createServer({ client: mb });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

/** Build a MailbuttonsClient with a stub fetch and (by default) a valid key. */
export function mbClient(opts: {
  apiKey?: string;
  status?: number;
  body?: unknown;
}): { mb: MailbuttonsClient; calls: Array<{ url: string; method?: string }> } {
  const { fetchImpl, calls } = stubFetch(opts.status ?? 200, opts.body ?? {});
  const mb = new MailbuttonsClient({
    apiKey: opts.apiKey ?? "mb_test_token",
    fetchImpl,
  });
  return { mb, calls };
}

export function textOf(res: ToolResult): string {
  return (res.content ?? []).map((c) => c.text ?? "").join("\n");
}

export const TOOL_NAMES = [
  "mailbuttons_list_messages",
  "mailbuttons_get_message",
  "mailbuttons_get_thread",
  "mailbuttons_get_attachment_text",
  "mailbuttons_send_email",
  "mailbuttons_propose_sender",
  "mailbuttons_request_promotion",
  "mailbuttons_audit_tail",
] as const;
