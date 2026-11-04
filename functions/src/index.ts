import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { allowedCorsOrigins } from "./cors";
import { handleChat, GeminiClient } from "./chatHandler";
import { handleJudge } from "./judgeHandler";
import { defaultGuardDeps, guardChat, guardJudge } from "./guard";
import { loadGateConfig } from "./params";
import { writeUsageRecord } from "./adminStore";
import { UsageRecord } from "./usageLog";

const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT_ID,
  location: "us-central1",
});

const cors = allowedCorsOrigins();

async function logUsage(record: UsageRecord): Promise<void> {
  try {
    await writeUsageRecord(record);
  } catch {
    console.error("usage_server write failed");
  }
}

function guardDeps() {
  return defaultGuardDeps({ config: () => loadGateConfig() });
}

export const chatProxy = onRequest({ cors, timeoutSeconds: 120 }, async (req, res) => {
  const deps = guardDeps();
  await handleChat(req, res, {
    guard: (incoming) => guardChat(incoming, deps),
    ai: ai as unknown as GeminiClient,
    logUsage,
  });
});

export const judgeProxy = onRequest({ cors, timeoutSeconds: 30 }, async (req, res) => {
  const deps = guardDeps();
  await handleJudge(req, res, {
    guard: (incoming) => guardJudge(incoming, deps),
    fetchImpl: fetch,
    apiKey: process.env.TYPESAFE_API_KEY,
    logUsage,
  });
});
