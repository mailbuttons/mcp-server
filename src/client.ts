/**
 * Tiny REST client over `fetch` for the Mailbuttons governed MCP backend.
 *
 * Base URL comes from `MAILBUTTONS_API_URL` (default https://mailbuttons.com) and
 * the bearer token from `MAILBUTTONS_API_KEY`. The token is a scoped, short-lived
 * `mb_<env>_...` MCP token — it is NEVER hard-coded; it is read from the env only.
 *
 * One method per endpoint in the REST contract (`/api/v1/mcp/*`). The backend
 * returns governed outcomes (e.g. a send that is `blocked` or
 * `draft_pending_approval`) as HTTP 200 bodies — those are returned as data, not
 * thrown. Scope/capability/auth failures arrive as non-2xx with
 * `{ error, next_step }` and are surfaced as a typed {@link MailbuttonsApiError}.
 */

/** Shape of the backend's structured error body: `{ error, next_step }`. */
export class MailbuttonsApiError extends Error {
  readonly status: number;
  /** Machine-readable error code from the backend (e.g. `inbox_out_of_scope`). */
  readonly code: string;
  /** Human/agent next step the backend suggests, if any. */
  readonly nextStep?: string;

  constructor(status: number, code: string, nextStep?: string) {
    super(
      `Mailbuttons API error (${status}): ${code}` +
        (nextStep ? ` — next step: ${nextStep}` : ""),
    );
    this.name = "MailbuttonsApiError";
    this.status = status;
    this.code = code;
    this.nextStep = nextStep;
  }
}

// ---- Response shapes (mirror the REST contract) -----------------------------

export interface MessageSummary {
  id: string;
  thread_id: string;
  from: string;
  subject: string;
  received_at: string;
  /** Always "delivered" — rejected mail is never stored. */
  status: string;
}

export interface ListMessagesResult {
  messages: MessageSummary[];
  next_cursor?: string | null;
}

export interface AttachmentMeta {
  blob_id: string;
  filename: string;
  content_type: string;
  size: number;
}

export interface FullMessage {
  id: string;
  thread_id: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  received_at: string;
  attachments: AttachmentMeta[];
}

export interface ThreadResult {
  thread_id: string;
  messages: FullMessage[];
}

export interface AttachmentTextResult {
  filename: string;
  content_type: string;
  text?: string;
  /** Present when extraction is not supported (e.g. PDF). */
  error?: string;
  next_step?: string;
}

export interface SendPolicy {
  decision: string;
  matched_rule?: string | null;
}

export interface SendResult {
  message_id?: string | null;
  status: "sent" | "queued" | "draft_pending_approval" | "blocked";
  policy: SendPolicy;
  reason?: string | null;
}

export interface ProposeSenderResult {
  proposal_id: string;
  status: string;
}

export interface RequestPromotionResult {
  request_id: string;
  approval_url: string;
  status: string;
}

export interface AuditEntry {
  ts: string;
  tool: string;
  decision: string;
  reason?: string | null;
  cost?: unknown;
}

export interface AuditTailResult {
  entries: AuditEntry[];
}

export interface DraftSummary {
  draft_id: number;
  inbox_id: number;
  recipients: string[];
  subject: string;
  reason?: string | null;
  status: string;
  created_at: string;
}

export interface ListDraftsResult {
  drafts: DraftSummary[];
}

export interface DraftDetail extends DraftSummary {
  body_text?: string | null;
  body_html?: string | null;
  thread_id?: string | null;
  sent_at?: string | null;
}

export interface ExtractCodeResult {
  status: "found" | "not_found";
  code?: string;
  from?: string;
  message_id?: string;
  reason?: string;
}

/** SIEM audit export (Business — requires the token's siem_export flag). */
export interface ExportAuditResult {
  format?: string;
  /** JSONL export: the audit events incl. entry_hash/prev_hash for verification. */
  events?: Array<Record<string, unknown>>;
  /** CEF export: newline-delimited CEF event lines. */
  cef?: string;
  [k: string]: unknown;
}

// ---- Request bodies ---------------------------------------------------------

export interface SendRequest {
  inbox_id: number;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  thread_id?: string;
  mode?: "send" | "draft";
}

export interface RequestPromotionRequest {
  inbox_id?: number;
  grant_capabilities: string[];
  promote_to?: "production";
}

export interface MailbuttonsClientOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class MailbuttonsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: MailbuttonsClientOptions = {}) {
    this.baseUrl = (
      opts.baseUrl ??
      process.env.MAILBUTTONS_API_URL ??
      "https://mailbuttons.com"
    ).replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? process.env.MAILBUTTONS_API_KEY ?? "";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Whether an API key is configured. Tools check this to fail fast and clearly. */
  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await this.fetchImpl(url.toString(), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const raw = await res.text();
    let parsed: unknown = undefined;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Non-JSON body — surface as a generic error below.
      }
    }

    if (!res.ok) {
      const obj = (parsed ?? {}) as { error?: string; next_step?: string };
      throw new MailbuttonsApiError(
        res.status,
        obj.error ?? `http_${res.status}`,
        obj.next_step,
      );
    }

    return parsed as T;
  }

  // ---- Endpoints (1:1 with the REST contract) -------------------------------

  listMessages(args: {
    inbox_id: number;
    query?: string;
    cursor?: string;
    limit?: number;
  }): Promise<ListMessagesResult> {
    return this.request<ListMessagesResult>("GET", "/api/v1/mcp/messages", {
      query: {
        inbox_id: args.inbox_id,
        query: args.query,
        cursor: args.cursor,
        limit: args.limit,
      },
    });
  }

  getMessage(args: {
    email_id: string;
    inbox_id: number;
  }): Promise<FullMessage> {
    return this.request<FullMessage>(
      "GET",
      `/api/v1/mcp/messages/${encodeURIComponent(args.email_id)}`,
      { query: { inbox_id: args.inbox_id } },
    );
  }

  getThread(args: {
    thread_id: string;
    inbox_id: number;
  }): Promise<ThreadResult> {
    return this.request<ThreadResult>(
      "GET",
      `/api/v1/mcp/threads/${encodeURIComponent(args.thread_id)}`,
      { query: { inbox_id: args.inbox_id } },
    );
  }

  getAttachmentText(args: {
    email_id: string;
    blob_id: string;
    inbox_id: number;
  }): Promise<AttachmentTextResult> {
    return this.request<AttachmentTextResult>(
      "GET",
      `/api/v1/mcp/messages/${encodeURIComponent(
        args.email_id,
      )}/attachments/${encodeURIComponent(args.blob_id)}/text`,
      { query: { inbox_id: args.inbox_id } },
    );
  }

  send(body: SendRequest): Promise<SendResult> {
    return this.request<SendResult>("POST", "/api/v1/mcp/send", { body });
  }

  proposeSender(body: {
    inbox_id: number;
    address: string;
  }): Promise<ProposeSenderResult> {
    return this.request<ProposeSenderResult>(
      "POST",
      "/api/v1/mcp/propose-sender",
      { body },
    );
  }

  requestPromotion(
    body: RequestPromotionRequest,
  ): Promise<RequestPromotionResult> {
    return this.request<RequestPromotionResult>(
      "POST",
      "/api/v1/mcp/request-promotion",
      { body },
    );
  }

  auditTail(args: {
    inbox_id?: number;
    limit?: number;
  }): Promise<AuditTailResult> {
    return this.request<AuditTailResult>("GET", "/api/v1/mcp/audit-tail", {
      query: { inbox_id: args.inbox_id, limit: args.limit },
    });
  }

  listDrafts(
    args: { inbox_id?: number; status?: "pending" | "sent"; limit?: number } = {},
  ): Promise<ListDraftsResult> {
    return this.request<ListDraftsResult>("GET", "/api/v1/mcp/drafts", {
      query: { inbox_id: args.inbox_id, status: args.status, limit: args.limit },
    });
  }

  getDraft(args: { draft_id: number }): Promise<DraftDetail> {
    return this.request<DraftDetail>(
      "GET",
      `/api/v1/mcp/drafts/${args.draft_id}`,
    );
  }

  extractCode(args: {
    inbox_id: number;
    from?: string;
    max_age_minutes?: number;
  }): Promise<ExtractCodeResult> {
    return this.request<ExtractCodeResult>("GET", "/api/v1/mcp/extract-code", {
      query: {
        inbox_id: args.inbox_id,
        from: args.from,
        max_age_minutes: args.max_age_minutes,
      },
    });
  }

  exportAudit(
    args: {
      inbox_id?: number;
      since?: string;
      until?: string;
      limit?: number;
      format?: "jsonl" | "cef";
    } = {},
  ): Promise<ExportAuditResult> {
    return this.request<ExportAuditResult>("GET", "/api/v1/mcp/export-audit", {
      query: {
        inbox_id: args.inbox_id,
        since: args.since,
        until: args.until,
        limit: args.limit,
        format: args.format,
      },
    });
  }
}
