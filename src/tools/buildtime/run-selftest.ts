/**
 * Build-time tool: `mailbuttons_run_selftest`.
 *
 * Exercises the sandbox loop end to end using the runtime client: send an
 * INTERNAL test message, poll for it to arrive, then read + parse it. It reports
 * pass/fail per stage rather than throwing, so a missing key or an unreachable
 * backend comes back as a clean, actionable result instead of a stack trace.
 *
 * This genuinely needs a live backend to go green. With no backend it returns
 * `backend_reachable: false` and marks the later stages "skip" — that is the
 * expected offline outcome, not a crash. It only ever sends INTERNALLY; it can
 * never trigger an external send or any escalation.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MailbuttonsApiError, type MailbuttonsClient } from "../../client.js";
import { ok, requireApiKey } from "../shared.js";

const inputSchema = {
  inbox_id: z
    .number()
    .int()
    .describe("The sandbox inbox id to run the loop against."),
  self_address: z
    .string()
    .optional()
    .describe(
      "The inbox's own address, used as the internal recipient for the loopback " +
        "send. If omitted, the send stage is skipped (the loop can't address itself).",
    ),
  timeout_ms: z
    .number()
    .int()
    .optional()
    .describe("How long to poll for the test message to arrive. Default 8000ms."),
};

const stageSchema = z.object({
  name: z.string(),
  status: z.enum(["pass", "fail", "skip"]),
  detail: z.string(),
});

const outputSchema = {
  ok: z.boolean().describe("True only if every non-skipped stage passed."),
  backend_reachable: z
    .boolean()
    .describe("False means the backend could not be contacted at all."),
  stages: z.array(stageSchema),
  inbox_id: z.number(),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A thrown error that is NOT a MailbuttonsApiError means we never got a governed
 * HTTP response — i.e. the backend is unreachable (DNS / connection refused /
 * timeout). A MailbuttonsApiError means the backend answered and governed us.
 */
function isUnreachable(err: unknown): boolean {
  return !(err instanceof MailbuttonsApiError);
}

export function registerRunSelftest(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  server.registerTool(
    "mailbuttons_run_selftest",
    {
      title: "Run the sandbox send/receive/parse self-test",
      description:
        "Build-time, sandbox-only. Sends an INTERNAL test message, polls for it to " +
        "arrive, then reads and parses it, reporting pass/fail per stage. Needs a " +
        "live backend to go green; with none it reports backend_reachable:false and " +
        "skips the later stages rather than throwing. Never sends externally.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const stages: z.infer<typeof stageSchema>[] = [];
      const inbox_id = args.inbox_id;
      const timeout = args.timeout_ms ?? 8000;

      // Stage: auth ---------------------------------------------------------
      const missing = requireApiKey(client.hasApiKey());
      if (missing) {
        stages.push({
          name: "auth",
          status: "fail",
          detail:
            "MAILBUTTONS_API_KEY is not set. Set a scoped sandbox token before running the self-test.",
        });
        stages.push({ name: "connect", status: "skip", detail: "No API key." });
        stages.push({ name: "send", status: "skip", detail: "No API key." });
        stages.push({ name: "receive", status: "skip", detail: "No API key." });
        stages.push({ name: "parse", status: "skip", detail: "No API key." });
        return ok({ ok: false, backend_reachable: false, stages, inbox_id });
      }
      stages.push({ name: "auth", status: "pass", detail: "API key present." });

      // Stage: connect (also our reachability probe) ------------------------
      let reachable = true;
      try {
        await client.listMessages({ inbox_id, limit: 1 });
        stages.push({
          name: "connect",
          status: "pass",
          detail: "Backend reachable and inbox in scope.",
        });
      } catch (err) {
        if (isUnreachable(err)) {
          reachable = false;
          stages.push({
            name: "connect",
            status: "fail",
            detail: `Backend unreachable: ${err instanceof Error ? err.message : String(err)}. Is the API running at MAILBUTTONS_API_URL?`,
          });
        } else {
          const e = err as MailbuttonsApiError;
          stages.push({
            name: "connect",
            status: "fail",
            detail: `Backend reachable but rejected the probe (HTTP ${e.status}): ${e.code}. ${e.nextStep ?? "Check the token scope and inbox_id."}`,
          });
        }
        // Either way we can't run the loop; skip the rest.
        for (const name of ["send", "receive", "parse"]) {
          stages.push({ name, status: "skip", detail: "connect stage did not pass." });
        }
        return ok({ ok: false, backend_reachable: reachable, stages, inbox_id });
      }

      // Stage: send (internal loopback) -------------------------------------
      if (!args.self_address) {
        stages.push({
          name: "send",
          status: "skip",
          detail:
            "No self_address provided — cannot address the inbox to itself. Pass the inbox's own sandbox address to run the full loop.",
        });
        stages.push({ name: "receive", status: "skip", detail: "send was skipped." });
        stages.push({ name: "parse", status: "skip", detail: "send was skipped." });
        return ok({ ok: false, backend_reachable: true, stages, inbox_id });
      }

      const token = `selftest-${Date.now()}`;
      const subject = `Mailbuttons self-test ${token}`;
      try {
        const result = await client.send({
          inbox_id,
          to: [args.self_address],
          subject,
          text: `Automated sandbox self-test. Token: ${token}`,
          mode: "send",
        });
        if (result.status === "sent" || result.status === "queued") {
          stages.push({
            name: "send",
            status: "pass",
            detail: `Internal send accepted (${result.status}).`,
          });
        } else {
          // blocked / draft_pending_approval: the recipient isn't internal to
          // this sandbox, so the loop can't complete — report it honestly.
          stages.push({
            name: "send",
            status: "fail",
            detail:
              `Send returned "${result.status}" (rule: ${result.policy.matched_rule ?? "n/a"}). ` +
              "self_address must be an internal address this sandbox can deliver to.",
          });
          stages.push({ name: "receive", status: "skip", detail: "send did not deliver." });
          stages.push({ name: "parse", status: "skip", detail: "send did not deliver." });
          return ok({ ok: false, backend_reachable: true, stages, inbox_id });
        }
      } catch (err) {
        const detail =
          err instanceof MailbuttonsApiError
            ? `Send denied (HTTP ${err.status}): ${err.code}. ${err.nextStep ?? ""}`
            : `Send failed: ${err instanceof Error ? err.message : String(err)}`;
        stages.push({ name: "send", status: "fail", detail });
        stages.push({ name: "receive", status: "skip", detail: "send failed." });
        stages.push({ name: "parse", status: "skip", detail: "send failed." });
        return ok({ ok: false, backend_reachable: true, stages, inbox_id });
      }

      // Stage: receive (poll for arrival) -----------------------------------
      const deadline = Date.now() + timeout;
      let foundId: string | undefined;
      while (Date.now() < deadline && !foundId) {
        try {
          const list = await client.listMessages({ inbox_id, query: token, limit: 10 });
          foundId = list.messages.find((m) => m.subject.includes(token))?.id;
        } catch {
          // Transient read error during polling — keep trying until the deadline.
        }
        if (!foundId) await sleep(1000);
      }
      if (!foundId) {
        stages.push({
          name: "receive",
          status: "fail",
          detail: `Test message did not arrive within ${timeout}ms. Inbound delivery may be delayed or the policy quarantined it.`,
        });
        stages.push({ name: "parse", status: "skip", detail: "message not received." });
        return ok({ ok: false, backend_reachable: true, stages, inbox_id });
      }
      stages.push({ name: "receive", status: "pass", detail: "Test message delivered and listed." });

      // Stage: parse --------------------------------------------------------
      try {
        const msg = await client.getMessage({ email_id: foundId, inbox_id });
        if (msg.text && msg.text.includes(token)) {
          stages.push({ name: "parse", status: "pass", detail: "Body fetched and matched the token." });
        } else {
          stages.push({
            name: "parse",
            status: "fail",
            detail: "Message fetched but body did not contain the expected token.",
          });
        }
      } catch (err) {
        const detail =
          err instanceof MailbuttonsApiError
            ? `Read denied (HTTP ${err.status}): ${err.code}.`
            : `Read failed: ${err instanceof Error ? err.message : String(err)}`;
        stages.push({ name: "parse", status: "fail", detail });
      }

      const allOk = stages.every((s) => s.status !== "fail");
      return ok({ ok: allOk, backend_reachable: true, stages, inbox_id });
    },
  );
}
