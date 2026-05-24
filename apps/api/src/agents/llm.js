/**
 * Azure OpenAI LLM factory for LangGraph agents.
 */

import { AzureChatOpenAI } from "@langchain/openai";
import { config } from "../../../../shared/config.js";

export function isAgentConfigured() {
  return Boolean(
    config.azureOpenAI.apiKey &&
      config.azureOpenAI.endpoint &&
      config.azureOpenAI.deployment
  );
}

export function createChatModel({ temperature } = {}) {
  if (!isAgentConfigured()) {
    throw new Error("Azure OpenAI is not configured");
  }

  const options = {
    azureOpenAIApiKey: config.azureOpenAI.apiKey,
    azureOpenAIEndpoint: config.azureOpenAI.endpoint,
    azureOpenAIApiDeploymentName: config.azureOpenAI.deployment,
    azureOpenAIApiVersion: config.azureOpenAI.apiVersion,
  };

  // Some models (e.g. gpt-5.3-chat) only support the default temperature.
  if (temperature != null) {
    options.temperature = temperature;
  }

  return new AzureChatOpenAI(options);
}
