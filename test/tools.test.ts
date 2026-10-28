import { describe, it, expect } from "vitest";
import { connect, mbClient, textOf, TOOL_NAMES, type ToolResult } from "./helpers.js";

describe("tool registration", () => {
  it("exposes the governed runtime tools by name", async () => {
    const { mb } = mbClient({});
    const client = await connect(mb);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    // Assert each expected tool is present (the set may grow over time, so we
    // don't hard-assert an exact count).
    for (const name of TOOL_NAMES) {
      expect(names, `missing tool ${name}`).toContain(name);
    }
    // The HTTP/in-memory server must NOT carry the stdio-only build tools.
    expect(names).not.toContain("mailbuttons_generate_policy");
  });

  it("advertises send_email as a non-readonly, open-world tool", async () => {
    const { mb } = mbClient({});
    const client = await connect(mb);
    const { tools } = await client.listTools();
    const send = tools.find((t) => t.name === "mailbuttons_send_email");
    expect(send).toBeDefined();
    expect(send?.annotations?.readOnlyHint).toBe(false);
    expect(send?.annotations?.openWorldHint).toBe(true);
  });
});

describe("input schema validation (zod)", () => {
  // A rejected zod schema surfaces from the SDK as an `isError` result whose
  // text names the offending arguments — not as a thrown rejection.
  async function expectRejected(
    client: Awaited<ReturnType<typeof connect>>,
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const res = (await client.callTool({ name, arguments: args })) as ToolResult;
    expect(res.isError, `expected ${name} to reject ${JSON.stringify(args)}`).toBe(true);
    expect(textOf(res)).toMatch(/Invalid arguments/i);
  }

  it("rejects list_messages without inbox_id", async () => {
    const { mb } = mbClient({ body: { messages: [] } });
    const client = await connect(mb);
    await expectRejected(client, "mailbuttons_list_messages", {});
  });

  it("rejects list_messages with a non-numeric inbox_id", async () => {
    const { mb } = mbClient({ body: { messages: [] } });
    const client = await connect(mb);
    await expectRejected(client, "mailbuttons_list_messages", {
      inbox_id: "not-a-number",
    });
  });

  it("accepts a well-formed list_messages call", async () => {
    const { mb } = mbClient({ body: { messages: [], next_cursor: null } });
    const client = await connect(mb);
    const res = (await client.callTool({
      name: "mailbuttons_list_messages",
      arguments: { inbox_id: 7 },
    })) as ToolResult;
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ messages: [] });
  });

  it("rejects send_email with an empty recipient list", async () => {
    const { mb } = mbClient({});
    const client = await connect(mb);
    await expectRejected(client, "mailbuttons_send_email", {
      inbox_id: 1,
      to: [],
      subject: "hi",
    });
  });

  it("rejects send_email with an invalid mode enum", async () => {
    const { mb } = mbClient({});
    const client = await connect(mb);
    await expectRejected(client, "mailbuttons_send_email", {
      inbox_id: 1,
      to: ["a@b.com"],
      subject: "hi",
      mode: "yolo",
    });
  });

  it("rejects request_promotion without grant_capabilities", async () => {
    const { mb } = mbClient({});
    const client = await connect(mb);
    await expectRejected(client, "mailbuttons_request_promotion", {});
  });
});

describe("send_email governed outcomes (surfaced as data, not errors)", () => {
  it("returns a `blocked` outcome with an actionable _hint, not isError", async () => {
    const { mb } = mbClient({
      status: 200,
      body: {
        status: "blocked",
        policy: { decision: "deny", matched_rule: "no_external_recipients" },
        reason: "external recipient on sandbox token",
      },
    });
    const client = await connect(mb);
    const res = (await client.callTool({
      name: "mailbuttons_send_email",
      arguments: {
        inbox_id: 1,
        to: ["someone@external.com"],
        subject: "hi",
        text: "hello",
      },
    })) as ToolResult;

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent ?? {};
    expect(sc.status).toBe("blocked");
    expect(String(sc._hint)).toMatch(/NOT SENT/);
    expect(String(sc._hint)).toMatch(/no_external_recipients/);
    expect(String(sc._hint)).toMatch(/mailbuttons_request_promotion/);
  });

  it("returns a `draft_pending_approval` outcome with an approval hint, not isError", async () => {
    const { mb } = mbClient({
      status: 200,
      body: {
        status: "draft_pending_approval",
        policy: { decision: "park", matched_rule: "sandbox_external_to_draft" },
        reason: "sandbox token external send",
      },
    });
    const client = await connect(mb);
    const res = (await client.callTool({
      name: "mailbuttons_send_email",
      arguments: {
        inbox_id: 1,
        to: ["someone@external.com"],
        subject: "hi",
        text: "hello",
      },
    })) as ToolResult;

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent ?? {};
    expect(sc.status).toBe("draft_pending_approval");
    expect(String(sc._hint)).toMatch(/pending human approval/i);
    expect(String(sc._hint)).toMatch(/mailbuttons_request_promotion/);
  });

  it("returns a clean `sent` outcome with no _hint", async () => {
    const { mb } = mbClient({
      status: 200,
      body: {
        message_id: "M123",
        status: "sent",
        policy: { decision: "allow", matched_rule: "internal_allowed" },
      },
    });
    const client = await connect(mb);
    const res = (await client.callTool({
      name: "mailbuttons_send_email",
      arguments: { inbox_id: 1, to: ["teammate@internal"], subject: "hi", text: "x" },
    })) as ToolResult;

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent ?? {};
    expect(sc.status).toBe("sent");
    expect(sc._hint).toBeUndefined();
  });
});

describe("genuine backend denials become actionable tool errors", () => {
  it("surfaces a non-2xx governance denial as isError with the next step", async () => {
    const { mb } = mbClient({
      status: 403,
      body: {
        error: "inbox_out_of_scope",
        next_step: "Request a token scoped to this inbox.",
      },
    });
    const client = await connect(mb);
    const res = (await client.callTool({
      name: "mailbuttons_list_messages",
      arguments: { inbox_id: 99 },
    })) as ToolResult;

    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toMatch(/governance/i);
    expect(text).toMatch(/inbox_out_of_scope/);
    expect(text).toMatch(/Request a token scoped to this inbox/);
  });
});

describe("fail-fast when MAILBUTTONS_API_KEY is unset", () => {
  for (const name of TOOL_NAMES) {
    it(`${name} returns a configuration error before any network call`, async () => {
      const { mb, calls } = mbClient({ apiKey: "" });
      const client = await connect(mb);
      // Minimal valid args per tool so we reach the api-key guard, not schema.
      const argsByTool: Record<string, Record<string, unknown>> = {
        mailbuttons_list_messages: { inbox_id: 1 },
        mailbuttons_get_message: { email_id: "E1", inbox_id: 1 },
        mailbuttons_get_thread: { thread_id: "T1", inbox_id: 1 },
        mailbuttons_get_attachment_text: {
          email_id: "E1",
          blob_id: "B1",
          inbox_id: 1,
        },
        mailbuttons_send_email: {
          inbox_id: 1,
          to: ["a@b.com"],
          subject: "hi",
        },
        mailbuttons_propose_sender: { inbox_id: 1, address: "a@b.com" },
        mailbuttons_request_promotion: { grant_capabilities: ["send_external"] },
        mailbuttons_audit_tail: { inbox_id: 1 },
      };
      const res = (await client.callTool({
        name,
        arguments: argsByTool[name],
      })) as ToolResult;

      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/MAILBUTTONS_API_KEY/);
      // The guard must short-circuit before any HTTP request goes out.
      expect(calls.length).toBe(0);
    });
  }
});
