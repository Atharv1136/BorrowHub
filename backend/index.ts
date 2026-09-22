import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env.local from project root
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) {
  throw new Error("AI_GATEWAY_API_KEY is not set in .env.local");
}

// Point the OpenAI provider at the Vercel AI Gateway
const openai = createOpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey,
});

async function main() {
  console.log("Calling Vercel AI Gateway with model openai/gpt-5.5 ...\n");

  const { text } = await generateText({
    model: openai("gpt-5.5"),
    prompt:
      "Invent a brand-new holiday that has never existed before. Give it a creative name, explain when it is celebrated, who celebrates it, and describe at least three unique traditions associated with it.",
  });

  console.log("=== AI Response ===\n");
  console.log(text);
  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
