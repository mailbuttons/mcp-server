import { describe, it, expect } from "vitest";
import { MailbuttonsClient, MailbuttonsApiError } from "../dist/client.js";

/** A fetch stub that records the request and returns a fixed response. */
function recordingFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; method?: string; headers?: unknown; body?: unknown }> = [];
  const fetchImpl = (async (input: unknown, init?: { method?: string; headers?: unknown; body?: unknown }) => {
    calls.push({ url: String(input), method: init?.method, headers: init?.headers, body: init?.body });
    return new Response(body === undefined ? "" : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("MailbuttonsClient construction", () => {
  it("reports hasApiKey based on the configured token", () => {
    expect(new MailbuttonsClient({ apiKey: "mb_test_x" }).hasApiKey()).toBe(true);
    expect(new MailbuttonsClient({ apiKey: "" }).hasApiKey()).toBe(false);
  });

  it("strips a trailing slash from the base URL", async () => {
    const { fetchImpl, calls } = recordingFetch(200, { messages: [] });
    const client = new MailbuttonsClient({
      apiKey: "mb_test_x",
      baseUrl: "http://localhost:9999/",
      fetchImpl,
    });
    await client.listMessages({ inbox_id: 3 });
    expect(calls[0].url.startsWith("http://localhost:9999/api/v1/mcp/messages")).toBe(true);
  });
});

describe("governed outcomes are returned as data", () => {
  it("returns a blocked SendResult on HTTP 200 without throwing", async () => {
    const { fetchImpl } = recordingFetch(200, {
      status: "blocked",
      policy: { decision: "deny", matched_rule: "no_external_recipients" },
      reason: "external recipient",
    });
    const client = new MailbuttonsClient({ apiKey: "mb_test_x", fetchImpl });
    const result = await client.send({
      inbox_id: 1,
      to: ["x@external.com"],
      subject: "hi",
    });
    expect(result.status).toBe("blocked");
    expect(result.policy.matched_rule).toBe("no_external_recipients");
  });

  it("returns a draft_pending_approval SendResult on HTTP 200", async () => {
    const { fetchImpl } = recordingFetch(200, {
      status: "draft_pending_approval",
      policy: { decision: "park", matched_rule: "sandbox_external_to_draft" },
    });
    const client = new MailbuttonsClient({ apiKey: "mb_test_x", fetchImpl });
    const result = await client.send({ inbox_id: 1, to: ["x@y.com"], subject: "hi" });
    expect(result.status).toBe("draft_pending_approval");
  });
});

describe("error responses become typed MailbuttonsApiError", () => {
  it("throws with status, code and nextStep from the backend body", async () => {
    const { fetchImpl } = recordingFetch(403, {
      error: "inbox_out_of_scope",
      next_step: "Request a token scoped to this inbox.",
    });
    const client = new MailbuttonsClient({ apiKey: "mb_test_x", fetchImpl });
    await expect(client.listMessages({ inbox_id: 99 })).rejects.toBeInstanceOf(
      MailbuttonsApiError,
    );
    try {
      await client.listMessages({ inbox_id: 99 });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MailbuttonsApiError);
      const e = err as MailbuttonsApiError;
      expect(e.status).toBe(403);
      expect(e.code).toBe("inbox_out_of_scope");
      expect(e.nextStep).toBe("Request a token scoped to this inbox.");
    }
  });

  it("falls back to a synthetic code when the body has no error field", async () => {
    const { fetchImpl } = recordingFetch(500, {});
    const client = new MailbuttonsClient({ apiKey: "mb_test_x", fetchImpl });
    await expect(client.auditTail({})).rejects.toMatchObject({
      status: 500,
      code: "http_500",
    });
  });
});

describe("requests carry auth and target the REST contract paths", () => {
  it("sends a Bearer token and hits the messages endpoint with query params", async () => {
    const { fetchImpl, calls } = recordingFetch(200, { messages: [] });
    const client = new MailbuttonsClient({ apiKey: "mb_secret_token", fetchImpl });
    await client.listMessages({ inbox_id: 5, query: "invoice", limit: 10 });
    const call = calls[0];
    expect(call.method).toBe("GET");
    expect(call.url).toContain("/api/v1/mcp/messages");
    expect(call.url).toContain("inbox_id=5");
    expect(call.url).toContain("query=invoice");
    expect(call.url).toContain("limit=10");
    expect((call.headers as Record<string, string>).Authorization).toBe(
      "Bearer mb_secret_token",
    );
  });

  it("POSTs send requests with a JSON body to /mcp/send", async () => {
    const { fetchImpl, calls } = recordingFetch(200, {
      status: "sent",
      message_id: "M1",
      policy: { decision: "allow" },
    });
    const client = new MailbuttonsClient({ apiKey: "mb_test_x", fetchImpl });
    await client.send({ inbox_id: 2, to: ["a@b.com"], subject: "s", text: "t" });
    const call = calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toContain("/api/v1/mcp/send");
    expect(JSON.parse(String(call.body))).toMatchObject({
      inbox_id: 2,
      to: ["a@b.com"],
      subject: "s",
    });
  });
});
