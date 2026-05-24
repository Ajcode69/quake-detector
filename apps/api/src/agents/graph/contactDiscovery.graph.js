/**
 * LangGraph workflow to discover critical emergency contacts for a location.
 */

import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createChatModel } from "../llm.js";
import { webSearchTool } from "../tools/webSearch.tool.js";
import { buildContactDiscoveryPrompt } from "../prompts/contactDiscovery.system.js";
import { config } from "../../../../../shared/config.js";

const TOOLS = [webSearchTool];
const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

export const contactSchema = z.object({
  name: z.string().min(1),
  organization: z.string().min(1),
  role: z.enum([
    "emergency_management",
    "tsunami_warning",
    "seismological_survey",
    "civil_defense",
    "utility",
    "hospital",
    "media_alert",
    "other",
  ]),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  coverageArea: z.string().nullable().optional(),
  alertTypes: z.array(z.string()).default([]),
  priority: z.enum(["critical", "high", "medium"]).default("high"),
  source: z.literal("web_search").default("web_search"),
  sourceUrl: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const contactsArraySchema = z.array(contactSchema);

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
      const result = tool
        ? await tool.invoke(toolCall.args)
        : JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });

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

function parseContactsFromText(text) {
  const trimmed = text.trim();

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.contacts && Array.isArray(parsed.contacts)) return parsed.contacts;
  } catch {
    // fall through
  }

  // Extract JSON array from markdown fence or surrounding text
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // fall through
    }
  }

  return null;
}

export async function invokeContactDiscovery({ label, latitude, longitude }) {
  const graph = buildGraph();
  const systemPrompt = buildContactDiscoveryPrompt({ label, latitude, longitude });

  const result = await graph.invoke(
    {
      messages: [
        new SystemMessage(systemPrompt),
        new HumanMessage(
          `Find official emergency alert contacts for "${label}" at ${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°. Search thoroughly, then return the JSON array.`
        ),
      ],
    },
    { recursionLimit: config.agentMaxIterations * 2 + 2 }
  );

  const messages = result.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg._getType?.() === "ai" || msg.constructor?.name === "AIMessage") {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.filter((c) => c.type === "text").map((c) => c.text).join("")
            : "";

      const raw = parseContactsFromText(content);
      if (raw) {
        const validated = contactsArraySchema.safeParse(raw);
        if (validated.success) {
          return validated.data;
        }
      }
    }
  }

  // Fallback: ask LLM to structure the conversation into JSON
  const extractor = createChatModel();
  const conversation = messages
    .map((m) => {
      const type = m._getType?.() || m.constructor?.name;
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `[${type}]: ${content.slice(0, 2000)}`;
    })
    .join("\n\n");

  const extraction = await extractor.invoke([
    new SystemMessage(
      "Extract emergency contact information from the conversation below. Return ONLY a valid JSON array matching the contact schema. No markdown."
    ),
    new HumanMessage(conversation),
  ]);

  const extractContent =
    typeof extraction.content === "string"
      ? extraction.content
      : Array.isArray(extraction.content)
        ? extraction.content.filter((c) => c.type === "text").map((c) => c.text).join("")
        : "";

  const raw = parseContactsFromText(extractContent);
  if (!raw) return [];

  const validated = contactsArraySchema.safeParse(raw);
  return validated.success ? validated.data : [];
}
