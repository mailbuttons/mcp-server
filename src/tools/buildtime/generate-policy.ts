/**
 * Build-time tool: `mailbuttons_generate_policy`.
 *
 * Turns a plain allow/block description into a valid `MailPolicy` (the camelCase
 * shape from `backend/src/policies.rs`) and WRITES it to `mailbuttons.policy.json`
 * in the working directory (or `outPath`). Sandbox-only and conservative by
 * design:
 *   - `defaultAction` defaults to `"bounce"` — anything not explicitly allowed is
 *     rejected, so an empty allowlist is a closed door, not an open one.
 *   - Send scope is capped at internal-only here; external send is a human
 *     promotion, never something a generated policy can grant.
 *   - A prompt-injection content guard is added by default.
 *   - Senders the user did not name are NEVER invented.
 *
 * This tool only writes a local file. It calls no backend and grants nothing.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok } from "../shared.js";

// ---- MailPolicy shape (mirrors backend/src/policies.rs, camelCase) ----------

interface SenderMatch {
  address?: string;
  domain?: string;
  requireDkim?: boolean;
  requireSpf?: boolean;
}

interface SenderRule {
  match: SenderMatch;
  capabilities: string[];
  passive?: boolean;
}

interface ContentGuard {
  reject: string;
  reason: string;
}

interface MailPolicy {
  defaultAction: "bounce" | "drop";
  senders: SenderRule[];
  contentGuards: ContentGuard[];
  auditLog: { retentionDays: number; includeBodyHash: boolean };
}

/**
 * Default guard against the most common prompt-injection phrasings in inbound
 * mail. Conservative (it only quarantines, it never sends), and the user can
 * edit or remove it in the written file.
 */
const PROMPT_INJECTION_GUARD: ContentGuard = {
  reject:
    "(?i)(ignore (all |any )?(previous|prior|above) instructions|disregard (the )?(system|above)|you are now|new instructions:|reveal your (system )?prompt)",
  reason: "Possible prompt-injection attempt in message body.",
};

const senderInput = z.object({
  address: z
    .string()
    .optional()
    .describe("Exact sender address to allow, e.g. alerts@stripe.com."),
  domain: z
    .string()
    .optional()
    .describe("Sender domain to allow, e.g. stripe.com. Use this OR address."),
  requireDkim: z
    .boolean()
    .optional()
    .describe("Require a passing DKIM signature for this sender."),
  requireSpf: z
    .boolean()
    .optional()
    .describe("Require a passing SPF check for this sender."),
});

const inputSchema = {
  allow: z
    .array(senderInput)
    .describe(
      "Senders the agent should accept mail from. Each entry is matched by " +
        "address OR domain. Only list senders the user actually named — never invent any.",
    ),
  block: z
    .array(senderInput)
    .optional()
    .describe(
      "Senders to explicitly reject. With defaultAction 'bounce' anything not " +
        "allowlisted is already rejected, so these are usually redundant; they are " +
        "surfaced as warnings rather than silently expanding the policy.",
    ),
  sendScope: z
    .enum(["internal_only", "none"])
    .describe(
      "How far the agent may send. 'internal_only' grants send_internal to allowed " +
        "senders; 'none' grants no send capability. External send is NEVER generated — " +
        "it requires a human promotion.",
    ),
  contentGuards: z
    .array(z.object({ reject: z.string(), reason: z.string() }))
    .optional()
    .describe(
      "Extra body-regex guards to add on top of the default prompt-injection guard.",
    ),
  outPath: z
    .string()
    .optional()
    .describe("Where to write the policy. Defaults to ./mailbuttons.policy.json."),
};

const outputSchema = {
  path: z.string().describe("Absolute path the policy file was written to."),
  policy: z
    .object({
      defaultAction: z.enum(["bounce", "drop"]),
      senders: z.array(
        z.object({
          match: z.object({
            address: z.string().optional(),
            domain: z.string().optional(),
            requireDkim: z.boolean().optional(),
            requireSpf: z.boolean().optional(),
          }),
          capabilities: z.array(z.string()),
          passive: z.boolean().optional(),
        }),
      ),
      contentGuards: z.array(z.object({ reject: z.string(), reason: z.string() })),
      auditLog: z.object({
        retentionDays: z.number(),
        includeBodyHash: z.boolean(),
      }),
    })
    .describe("The generated MailPolicy, exactly as written to disk."),
  warnings: z
    .array(z.string())
    .describe("Non-fatal notes (e.g. redundant block entries, empty allowlist)."),
};

/** Build a clean SenderMatch, dropping absent optional flags. */
function toMatch(s: z.infer<typeof senderInput>): SenderMatch {
  const m: SenderMatch = {};
  if (s.address) m.address = s.address;
  if (s.domain) m.domain = s.domain;
  if (s.requireDkim) m.requireDkim = true;
  if (s.requireSpf) m.requireSpf = true;
  return m;
}

export function registerGeneratePolicy(server: McpServer): void {
  server.registerTool(
    "mailbuttons_generate_policy",
    {
      title: "Generate a mailbuttons.policy.json",
      description:
        "Build-time, sandbox-only. Turns an allow/block description into a valid " +
        "MailPolicy and writes mailbuttons.policy.json. Default-bounce (closed by " +
        "default), capped at internal send, with a prompt-injection content guard. " +
        "Never invents senders and never generates external-send capability — going " +
        "external is a human promotion.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const warnings: string[] = [];

      if (args.allow.length === 0) {
        warnings.push(
          "Empty allowlist with defaultAction 'bounce' means the agent will reject " +
            "ALL inbound mail. Add at least one allowed sender if that's not intended.",
        );
      }

      // Validate each allow entry names exactly one of address/domain.
      const senders: SenderRule[] = [];
      const capabilities = args.sendScope === "internal_only" ? ["send_internal"] : [];
      for (const s of args.allow) {
        if (!s.address && !s.domain) {
          warnings.push(
            "Skipped an allow entry with neither address nor domain — nothing to match.",
          );
          continue;
        }
        if (s.address && s.domain) {
          warnings.push(
            `Allow entry for ${s.address} also set a domain; using the address and ignoring the domain.`,
          );
        }
        senders.push({ match: toMatch(s), capabilities: [...capabilities] });
      }

      // The schema has no deny primitive: blocks are enforced by default-bounce.
      // Surface them as warnings rather than expanding the allowlist.
      const allowKeys = new Set(
        senders.map((r) => (r.match.address ?? r.match.domain ?? "").toLowerCase()),
      );
      for (const b of args.block ?? []) {
        const key = (b.address ?? b.domain ?? "").toLowerCase();
        if (allowKeys.has(key)) {
          warnings.push(
            `Block entry "${key}" overlaps an allowed sender. The policy model has no ` +
              "per-address deny inside an allowed domain — narrow the allow rule instead.",
          );
        } else {
          warnings.push(
            `Block entry "${key}" is already covered by defaultAction 'bounce' (anything ` +
              "not allowlisted is rejected); no separate rule was added.",
          );
        }
      }

      const policy: MailPolicy = {
        defaultAction: "bounce",
        senders,
        contentGuards: [PROMPT_INJECTION_GUARD, ...(args.contentGuards ?? [])],
        auditLog: { retentionDays: 90, includeBodyHash: true },
      };

      const path = resolve(args.outPath ?? "mailbuttons.policy.json");
      writeFileSync(path, JSON.stringify(policy, null, 2) + "\n", "utf8");

      return ok({ path, policy, warnings });
    },
  );
}
