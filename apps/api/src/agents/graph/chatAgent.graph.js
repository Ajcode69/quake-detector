/**
 * LangGraph ReAct agent for general chat Q&A.
 */

import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { SystemMessage, ToolMessage } from "@langchain/core/messages";
import { createChatModel } from "../llm.js";
import { webSearchTool } from "../tools/webSearch.tool.js";
import { dbQueryTool } from "../tools/dbQuery.tool.js";
import { postgisQueryTool } from "../tools/postgisQuery.tool.js";
import { buildChatSystemPrompt } from "../prompts/chat.system.js";
import { config } from "../../../../../shared/config.js";

const TOOLS = [webSearchTool, dbQueryTool, postgisQueryTool];
const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

let _graph = null;

function buildGraph() {
  if (_graph) return _graph;

  const model = createChatModel().bindTools(TOOLS);

  async function agentNode(state) {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  }

  async function toolsNode(state) {
    const lastMessage = state.messages.at(-1);
    const toolMessages = [];

    for (const toolCall of lastMessage.tool_calls || []) {
      const tool = TOOLS_BY_NAME[toolCall.name];
      if (!tool) {
        toolMessages.push(
          new ToolMessage({
            content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
            tool_call_id: toolCall.id,
          })
        );
        continue;
      }

      const result = await tool.invoke(toolCall.args);
      toolMessages.push(
        new ToolMessage({
          content: typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: toolCall.id,
        })
      );
    }

    return { messages: toolMessages };
  }

  function shouldContinue(state) {
    const lastMessage = state.messages.at(-1);
    if (lastMessage?.tool_calls?.length > 0) {
      return "tools";
    }
    return END;
  }

  _graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent")
    .compile();

  return _graph;
}

export async function invokeChatAgent({ message, userId = 1 }) {
  const graph = buildGraph();
  const systemPrompt = buildChatSystemPrompt({ userId });

  const result = await graph.invoke(
    { messages: [new SystemMessage(systemPrompt), message] },
    { recursionLimit: config.agentMaxIterations * 2 + 2 }
  );

  return result;
}

export function extractFinalAssistantText(result) {
  const messages = result.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg._getType?.() === "ai" || msg.constructor?.name === "AIMessage") {
      const content = msg.content;
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
      if (Array.isArray(content)) {
        const text = content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        if (text.trim()) return text.trim();
      }
    }
  }
  return "I couldn't generate a response. Please try again.";
}
