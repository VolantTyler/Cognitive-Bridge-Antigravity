import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import { allowedCorsOrigins } from "./cors";
import { handleChat, GeminiClient } from "./chatHandler";
import { handleJudge } from "./judgeHandler";
import { isInterviewFeature } from "./gate";
import { defaultGuardDeps, guardChat, guardJudge } from "./guard";
import {
  completeInterviewSlot,
  markInterviewStarted,
  readAccessView,
  reserveInterviewSlot as reserveInterviewInStore,
} from "./interviewStore";
import {
  handleAccessStatus,
  handleCompleteInterview,
  handleReserveInterview,
  InterviewHttpDeps,
} from "./interviewHttp";
import { loadGateConfig } from "./params";
import { verifyAppCheckToken, writeUsageRecord, addDailyCostFromUsage } from "./adminStore";
import { UsageRecord } from "./usageLog";
import { verifyIdTokenWithAdmin } from "./auth";
import { loadCheckoutConfig } from "./checkoutConfig";
import {
  handleCheckoutStatus,
  handleCreateCheckout,
  handleRestorePurchase,
  handleStripeWebhook,
  productionCheckoutLogger,
} from "./checkoutHttp";
import { createFirestoreBillingStore } from "./checkoutStore";
import { createStripeGateway } from "./stripeGateway";

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
  try {
    await addDailyCostFromUsage(record);
  } catch {
    console.error("daily cost increment failed");
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
    markInterviewStarted: async (ctx) => {
      if (!ctx.uid || !isInterviewFeature(ctx.feature)) return;
      await markInterviewStarted(ctx.uid);
    },
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

// Test-mode keys only. Values live in Secret Manager, not in the repo.
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

function checkoutHttpDeps() {
  return {
    config: () => loadCheckoutConfig(),
    secretKey: () => stripeSecretKey.value(),
    webhookSecret: () => stripeWebhookSecret.value(),
    store: createFirestoreBillingStore(),
    verifyIdToken: verifyIdTokenWithAdmin,
    verifyAppCheck: verifyAppCheckToken,
    enforceAppCheck: () => loadGateConfig().enforceAppCheck,
    now: () => Date.now(),
    gateway: () => createStripeGateway(stripeSecretKey.value()),
    logger: productionCheckoutLogger(),
  };
}

export const createCheckout = onRequest({
  cors,
  secrets: [stripeSecretKey],
  timeoutSeconds: 30,
}, (req, res) => handleCreateCheckout(req, res, checkoutHttpDeps()));

export const restorePurchase = onRequest({
  cors,
  secrets: [stripeSecretKey],
  timeoutSeconds: 60,
}, (req, res) => handleRestorePurchase(req, res, checkoutHttpDeps()));

export const checkoutStatus = onRequest({
  cors,
  timeoutSeconds: 15,
}, (req, res) => handleCheckoutStatus(req, res, checkoutHttpDeps()));

export const stripeWebhook = onRequest({
  secrets: [stripeSecretKey, stripeWebhookSecret],
  timeoutSeconds: 60,
}, (req, res) => handleStripeWebhook(req, res, checkoutHttpDeps()));

function interviewHttpDeps(): InterviewHttpDeps {
  return {
    verifyIdToken: verifyIdTokenWithAdmin,
    verifyAppCheck: verifyAppCheckToken,
    enforceAppCheck: () => loadGateConfig().enforceAppCheck,
    now: () => Date.now(),
    readAccess: (uid) => readAccessView(uid),
    reserve: (uid, now) => reserveInterviewInStore(uid, now),
    complete: (uid, reservationId, now) => completeInterviewSlot(uid, reservationId, now),
  };
}

export const accessStatus = onRequest({ cors, timeoutSeconds: 15 }, (req, res) => {
  return handleAccessStatus(req, res, interviewHttpDeps());
});

export const reserveInterviewSlot = onRequest({ cors, timeoutSeconds: 15 }, (req, res) => {
  return handleReserveInterview(req, res, interviewHttpDeps());
});

export const completeInterview = onRequest({ cors, timeoutSeconds: 15 }, (req, res) => {
  return handleCompleteInterview(req, res, interviewHttpDeps());
});
