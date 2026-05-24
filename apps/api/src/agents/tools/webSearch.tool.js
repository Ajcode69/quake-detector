/**
 * Tavily web search tool for LangGraph agents.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { tavily } from "@tavily/core";
import { config } from "../../../../../shared/config.js";
import { createLogger } from "../../../../../shared/logger.js";

const log = createLogger("agent:web-search");

let _client = null;

function getClient() {
  if (!_client) {
    if (!config.tavilyApiKey) {
      throw new Error("TAVILY_API_KEY is not configured");
    }
    _client = tavily({ apiKey: config.tavilyApiKey });
  }
  return _client;
}

export const webSearchTool = tool(
  async ({ query, searchDepth }) => {
    const start = Date.now();
    log.info({ query, searchDepth }, "web search started");

    const client = getClient();
    const response = await client.search(query, {
      maxResults: 5,
      searchDepth: searchDepth || "basic",
      includeAnswer: true,
    });

    const results = (response.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 500) || "",
    }));

    log.info({ query, resultCount: results.length, durationMs: Date.now() - start }, "web search done");

    return JSON.stringify({
      answer: response.answer || null,
      results,
    });
  },
  {
    name: "web_search",
    description:
      "Search the web for current information about earthquakes, emergency alert systems, tsunami warnings, regional agencies, and related topics. Use when the answer is not in the database.",
    schema: z.object({
      query: z.string().describe("Search query"),
      searchDepth: z
        .enum(["basic", "advanced"])
        .optional()
        .describe("basic for quick lookups, advanced for deeper research"),
    }),
  }
);

export function isWebSearchConfigured() {
  return Boolean(config.tavilyApiKey);
}
