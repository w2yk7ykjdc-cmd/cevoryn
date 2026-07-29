import OpenAI from "openai";

let client: OpenAI | undefined;

export function getOpenAIClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}
