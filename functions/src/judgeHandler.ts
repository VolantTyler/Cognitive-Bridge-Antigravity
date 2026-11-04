import { GuardContext, GuardRequest } from "./guard";
import { GateError } from "./gate";
import { UsageRecord, judgeUsageRecord } from "./usageLog";
import { HttpResponse } from "./chatHandler";

const TYPESAFE_DECIDE_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
const MAX_STATE_CHARS = 20000;
const MAX_QUESTIONS = 12;
const MAX_INSTRUCTION_CHARS = 800;
const MAX_CRITERIA = 8;
const MAX_CRITERION_CHARS = 400;

type JudgeQuestion = {
  type?: string;
  instructions?: unknown;
  criteria?: unknown;
};

export interface JudgeDeps {
  guard: (req: GuardRequest) => Promise<GuardContext>;
  fetchImpl: typeof fetch;
  apiKey: string | undefined;
  logUsage: (record: UsageRecord) => Promise<void>;
}

function isJudgeQuestion(value: JudgeQuestion): boolean {
  if (typeof value.instructions !== "string" || value.instructions.length === 0 || value.instructions.length > MAX_INSTRUCTION_CHARS) {
    return false;
  }
  if (value.type === "noul") {
    return value.criteria === undefined;
  }
  if (value.type === "choice") {
    if (!value.criteria || typeof value.criteria !== "object" || Array.isArray(value.criteria)) {
      return false;
    }
    const entries = Object.entries(value.criteria as Record<string, unknown>);
    if (entries.length < 2 || entries.length > MAX_CRITERIA) return false;
    return entries.every(([key, text]) =>
      key.length > 0 && key.length <= 64 && typeof text === "string" && text.length > 0 && text.length <= MAX_CRITERION_CHARS
    );
  }
  if (value.type === "score") {
    if (!Array.isArray(value.criteria)) return false;
    if (value.criteria.length < 2 || value.criteria.length > 10) return false;
    return value.criteria.every((text) => typeof text === "string" && text.length > 0 && text.length <= MAX_CRITERION_CHARS);
  }
  return false;
}

function sendGate(res: HttpResponse, error: GateError) {
  console.warn(`judgeProxy denied code=${error.code}`);
  res.status(error.status).json({ error: error.message, code: error.code });
}

export async function handleJudge(req: GuardRequest, res: HttpResponse, deps: JudgeDeps): Promise<void> {
  let ctx: GuardContext;
  try {
    ctx = await deps.guard(req);
  } catch (error) {
    if (error instanceof GateError) {
      if (error.code === "method_not_allowed") {
        res.status(405).json({ unavailable: true, reason: "method_not_allowed" });
        return;
      }
      sendGate(res, error);
      return;
    }
    res.status(500).json({ unavailable: true, reason: "upstream_error" });
    return;
  }

  if (!deps.apiKey) {
    res.status(503).json({ unavailable: true, reason: "missing_key" });
    return;
  }

  const body = (req.body ?? {}) as { state?: unknown; questions?: unknown };
  const state = body.state;
  const questions = body.questions;
  if (typeof state !== "string" || state.length === 0 || state.length > MAX_STATE_CHARS) {
    res.status(400).json({ unavailable: true, reason: "bad_state" });
    return;
  }
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) {
    res.status(400).json({ unavailable: true, reason: "bad_questions" });
    return;
  }

  const entries = Object.entries(questions as Record<string, JudgeQuestion>);
  if (entries.length === 0 || entries.length > MAX_QUESTIONS) {
    res.status(400).json({ unavailable: true, reason: "bad_questions" });
    return;
  }
  if (!entries.every(([key, question]) => key.length > 0 && key.length <= 64 && isJudgeQuestion(question))) {
    res.status(400).json({ unavailable: true, reason: "bad_questions" });
    return;
  }

  try {
    const response = await deps.fetchImpl(TYPESAFE_DECIDE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state,
        questions,
      }),
    });

    if (response.status === 402) {
      res.status(402).json({ unavailable: true, reason: "payment_required" });
      return;
    }
    if (!response.ok) {
      console.error("Jev judge HTTP error:", response.status);
      res.status(502).json({ unavailable: true, reason: "upstream_error" });
      return;
    }

    const payload = await response.json() as { answers?: unknown; model?: unknown };
    if (!payload.answers || typeof payload.answers !== "object") {
      res.status(502).json({ unavailable: true, reason: "bad_upstream" });
      return;
    }
    const model = typeof payload.model === "string" ? payload.model : JEV_MODEL;
    if (ctx.uid) {
      try {
        await deps.logUsage(judgeUsageRecord({ uid: ctx.uid, sessionId: ctx.sessionId, model }));
      } catch {
        console.error("usage_server write failed");
      }
    }
    res.status(200).json({
      answers: payload.answers,
      model,
    });
  } catch (error) {
    console.error("Jev judge proxy error:", error instanceof Error ? error.message : "unknown");
    res.status(502).json({ unavailable: true, reason: "upstream_error" });
  }
}
