import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MailbuttonsClient } from "../client.js";

import { registerListMessages } from "./list-messages.js";
import { registerGetMessage } from "./get-message.js";
import { registerGetThread } from "./get-thread.js";
import { registerGetAttachmentText } from "./get-attachment-text.js";
import { registerSendEmail } from "./send-email.js";
import { registerListDrafts } from "./list-drafts.js";
import { registerGetDraft } from "./get-draft.js";
import { registerExtractCode } from "./extract-code.js";
import { registerProposeSender } from "./propose-sender.js";
import { registerRequestPromotion } from "./request-promotion.js";
import { registerAuditTail } from "./audit-tail.js";
import { registerExportAudit } from "./export-audit.js";

/** Register all 12 Mailbuttons MCP tools on the given server. */
export function registerAllTools(
  server: McpServer,
  client: MailbuttonsClient,
): void {
  registerListMessages(server, client);
  registerGetMessage(server, client);
  registerGetThread(server, client);
  registerGetAttachmentText(server, client);
  registerSendEmail(server, client);
  registerListDrafts(server, client);
  registerGetDraft(server, client);
  registerExtractCode(server, client);
  registerProposeSender(server, client);
  registerRequestPromotion(server, client);
  registerAuditTail(server, client);
  registerExportAudit(server, client);
}
