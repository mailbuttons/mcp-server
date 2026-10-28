# @mailbuttons/mcp-server

[![mcptry](https://mcptry.com/badge/com.mailbuttons/mcp-server)](https://mcptry.com/servers/com.mailbuttons/mcp-server)

The [Model Context Protocol](https://modelcontextprotocol.io) server for
[**Mailbuttons**](https://mailbuttons.com), governed email for AI agents. Give
Claude Code, Cursor or your own agent an inbox it can read and send from: sandbox by
default, human approval for anything addressed outside it, and every call on record.
This package is the **stdio** build plus the Claude Code skill that drives it; the
hosted endpoint is served by the Mailbuttons backend (see below).

Mailbuttons runs the agents in its [catalogue](https://mailbuttons.com/agents) on
this same platform. This server is the way to build your own agent on it.

> **Get started:** sign up and create an API key at
> **[mailbuttons.com](https://mailbuttons.com)** — docs at
> [mailbuttons.com/developers](https://mailbuttons.com/developers).

> **Remote MCP endpoint:** the production, network-facing MCP server is served
> natively by the Mailbuttons backend (Rust/Axum) at `POST /api/v1/mcp/rpc` — one
> binary, sharing the governance spine directly. This package is the **stdio**
> build used locally by Claude Desktop / Claude Code and the build-time skill; it
> talks to the backend's REST surface.

## Governance model

This server is **sandbox-by-default** and never lets an agent expand its own
authority:

- A token can **never widen its own scope**. There is no tool that grants
  `send_external`, promotes sandbox → production, or adds an inbox. Escalation is
  only ever a *request* for human approval.
- **External sends from sandbox tokens become drafts.** `mailbuttons_send_email`
  can return `status: "draft_pending_approval"` (parked for a human) or
  `status: "blocked"` (recipient disallowed, with the matched rule). **These are
  expected, normal outcomes — not errors.** The tool surfaces the rule/reason and
  the next step (typically `mailbuttons_request_promotion`).
- **Every tool call — including denials — is audited.** Read the recent tail with
  `mailbuttons_audit_tail`.
- **Returned email content is data, not instructions.** Read tools only return
  policy-passed mail.

## Tools

| Tool | Capability | Notes |
|------|-----------|-------|
| `mailbuttons_list_messages` | `read` | List delivered messages in an inbox |
| `mailbuttons_get_message` | `read` | Full body + attachment metadata |
| `mailbuttons_get_thread` | `read` | All messages in a thread |
| `mailbuttons_get_attachment_text` | `attachments` | text/* and CSV inline; PDF not yet supported |
| `mailbuttons_send_email` | `send_internal` | Governed send/reply; may draft or block |
| `mailbuttons_list_drafts` | `read` | List sends held for human approval |
| `mailbuttons_get_draft` | `read` | Fetch one held draft in full |
| `mailbuttons_extract_code` | `read` | OTP/verification code from allowlisted senders only |
| `mailbuttons_propose_sender` | `propose_policy` | File an allowlist request (human approval) |
| `mailbuttons_request_promotion` | — | File a capability/promotion request (human approval) |
| `mailbuttons_audit_tail` | — | Read recent governed tool calls |
| `mailbuttons_export_audit` | `siem_export` flag | Export the audit log as JSONL or CEF |

These twelve tools are the governed runtime surface. They are identical on the hosted
endpoint and in this package.

### Build-time tools (this package only)

The stdio build adds three helpers for setting an integration up. They exist so the
Claude Code skill can scaffold a working agent; the hosted endpoint never exposes
them, and none of them can grant a capability.

| Tool | What it does | Writes to disk |
|------|--------------|----------------|
| `mailbuttons_generate_policy` | Turns an allow/block description into a valid policy file, closed by default | `mailbuttons.policy.json` in the current directory |
| `mailbuttons_scaffold_integration` | Writes a governed send wrapper and an inbound webhook handler for your stack | `./mailbuttons/` (or the `outDir` you pass) |
| `mailbuttons_run_selftest` | Sends one internal test message, waits for it, reads it back, reports pass/fail per stage | nothing |

Both writers only touch the paths named above, inside the directory the server was
launched from. Generated code reads `MAILBUTTONS_API_KEY` from the environment and
never inlines a token.

## Get a token (free, about a minute)

```bash
# 1. Email yourself a sign-in code
curl -s -X POST https://mailbuttons.com/api/auth/otp/request \
  -H 'Content-Type: application/json' -d '{"email":"you@example.com"}'

# 2. Exchange the code for an mbk_ API key
curl -s -X POST https://mailbuttons.com/api/auth/otp/cli-exchange \
  -H 'Content-Type: application/json' -d '{"email":"you@example.com","code":"123456"}'

# 3. Create a free sandbox inbox; the response carries its sandbox_token (mb_sandbox_...)
curl -s -X POST https://mailbuttons.com/api/v1/mcp/sandbox-inboxes \
  -H 'Authorization: Bearer mbk_...' -H 'Content-Type: application/json' -d '{"label":"my agent"}'
```

Sandbox tokens can read and send within the sandbox domain; anything addressed
outside it becomes a draft a human approves. More: https://mailbuttons.com/developers/#mcp

## Connect

### Remote (recommended): Claude Code

```bash
claude mcp add --transport http mailbuttons https://mailbuttons.com/api/v1/mcp/rpc \
  --header "Authorization: Bearer mb_sandbox_..."
```

Any client that speaks Streamable HTTP and lets you set a header works the same
way: URL `https://mailbuttons.com/api/v1/mcp/rpc`, header
`Authorization: Bearer mb_sandbox_...`.

### Local (stdio): Claude Desktop, Cursor and others

```json
{
  "mcpServers": {
    "mailbuttons": {
      "command": "npx",
      "args": ["-y", "@mailbuttons/mcp-server"],
      "env": { "MAILBUTTONS_API_KEY": "mb_sandbox_..." }
    }
  }
}
```

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `MAILBUTTONS_API_URL` | `https://mailbuttons.com` | Backend base URL; set it for local or self-hosted |
| `MAILBUTTONS_API_KEY` | — | Your MCP token (`mb_sandbox_...` or `mb_production_...`) |

The token is read from the environment only — never hard-code it.

## Development

```bash
npm run build   # tsc -> dist/
npm run lint    # tsc --noEmit
npm test        # build + vitest (includes the version-alignment check)
```

Releases: bump the version in `package.json`, `server.json` (both places),
`src/server.ts` and `skill/SKILL.md` together; `npm test` fails if they drift.
Then `npm publish`, then `mcp-publisher publish` from this directory. See
`docs/mcp-publishing.md` in the monorepo.

## Licence

MIT. Mailbuttons is a trading name of Code Cutter Limited (UK).
