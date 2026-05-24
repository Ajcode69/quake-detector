/**
 * Agent orchestration — chat Q&A with timeout and error handling.
 */

import { HumanMessage } from "@langchain/core/messages";
import { createLogger } from "../../../../../shared/logger.js";
import { config } from "../../../../../shared/config.js";
import { isAgentConfigured } from "../llm.js";
import { invokeChatAgent, extractFinalAssistantText } from "../graph/chatAgent.graph.js";

const log = createLogger("agent:service");

export function isChatAgentConfigured() {
  return isAgentConfigured();
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Agent timeout")), ms)
    ),
  ]);
}

export async function runChatAgent({ message, userId = 1, chatId }) {
  if (!isChatAgentConfigured()) {
    return "AI assistant is not configured. Set AZURE_OPENAI_* environment variables.";
  }

  const start = Date.now();
  log.info({ chatId, userId, messagePreview: message.slice(0, 80) }, "chat agent started");

  try {
    const result = await withTimeout(
      invokeChatAgent({
        message: new HumanMessage(message),
        userId,
      }),
      config.agentTimeoutMs
    );

    const answer = extractFinalAssistantText(result);
    const toolCount = (result.messages || []).filter(
      (m) => m._getType?.() === "tool" || m.constructor?.name === "ToolMessage"
    ).length;

    log.info(
      { chatId, durationMs: Date.now() - start, toolCalls: toolCount },
      "chat agent completed"
    );

    return answer;
  } catch (err) {
    log.error({ err, chatId, durationMs: Date.now() - start }, "chat agent failed");

    if (err.message === "Agent timeout") {
      return "Sorry, that took too long. Please try a simpler question.";
    }

    return "Sorry, I couldn't process that right now. Try /help for available commands.";
  }
}
