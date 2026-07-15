# Mailbuttons MCP server

Governed email for AI agents, over the [Model Context Protocol](https://modelcontextprotocol.io).
Give an agent a scoped mailbox where **the server enforces the guardrails, not
the prompt**: sandbox-by-default inboxes, a policy gate on every send, and a
tamper-evident audit log. External sending and scope changes are human-approved,
never granted by the agent itself.

- Registry: [`com.mailbuttons/mcp-server`](https://registry.modelcontextprotocol.io/v0/servers?search=com.mailbuttons)
- npm: [`@mailbuttons/mcp-server`](https://www.npmjs.com/package/@mailbuttons/mcp-server)
- Platform: **[mailbuttons.com](https://mailbuttons.com)** · agent front door: **[mbag.ai](https://mbag.ai)**

## Use it

**Hosted (recommended)** — a streamable-HTTP endpoint served by the platform:

```
https://mailbuttons.com/api/v1/mcp/rpc
Authorization: Bearer <your Mailbuttons MCP token>   # mb_sandbox_... (or mb_prod_...)
```

**Local (stdio)** — run the npm package and let your agent launch it:

```jsonc
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

Get a scoped token from the dashboard or `POST /api/v1/mcp/sandbox-inboxes`.
Sandbox tokens can never send externally until a human promotes them.

## What the server enforces

- **Inbound** — a per-mailbox sender policy, fail-closed: mail from strangers
  bounces by default, so nobody can prompt-inject your agent just by emailing it.
- **Outbound** — a recipient blocklist the agent can read but not change; a
  blocked send returns a normal `{"status":"blocked"}` result, not an error.
- **Caps + audit** — per-account send caps and a hash-chained audit log that
  records refusals too.
- **Escalation** — sending externally or widening scope is propose-only; a
  named human approves. The agent cannot approve its own request.

## Install as an agent skill

This repo ships a root `SKILL.md`, so any skills-aware agent can add it:

```bash
npx skills add mailbuttons/mcp-server
```

## Docs

- Agent signup (for agents): https://mbag.ai/docs/agent-signup.md
- Trust model: https://mbag.ai/docs/trust-model.md
- OpenAPI: https://mbag.ai/api/openapi.json
- Framework recipes: [`references/`](./references) (Claude Agent SDK, LangChain, plain SDK)

Mailbuttons is a trading name of Code Cutter Limited (UK, no. 08453060). MIT licensed.
