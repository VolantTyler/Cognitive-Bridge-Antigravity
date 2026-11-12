import {
  ModelFailure,
  buildModelChain,
  chainExhaustedMessage,
  classifyModelError,
  dominantFailureKind,
  httpStatusForKind,
  isRequestableModel,
  normalizeModelName,
} from "./modelRouter";
import { GuardContext, GuardRequest, sanitizeReservationId } from "./guard";
import { GateError } from "./gate";
import { mirrorThinkingBudget, ThinkingDecision } from "./mirrorThinking";
import { UsageRecord, buildUsageRecord, usageFromChunks } from "./usageLog";

export interface GeminiChunk {
  text?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface GenerateRequest {
  model: string;
  contents: Array<{ role?: string; parts: Array<{ text?: string }> }>;
  config: {
    systemInstruction?: unknown;
    thinkingConfig?: { thinkingBudget: number };
  };
}

export interface GeminiClient {
  models: {
    generateContent(request: GenerateRequest): Promise<GeminiChunk>;
    generateContentStream(request: GenerateRequest): Promise<AsyncIterable<GeminiChunk>>;
  };
}

export interface HttpResponse {
  headersSent: boolean;
  status(code: number): { json: (body: unknown) => void; send: (body: unknown) => void };
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: string): void;
  end(): void;
  /** Optional. Node and the Functions response can flush headers past a proxy buffer. */
  flushHeaders?(): void;
  flush?(): void;
}

export interface ChatDeps {
  guard: (req: GuardRequest) => Promise<GuardContext>;
  ai: GeminiClient;
  logUsage: (record: UsageRecord) => Promise<void>;
  /** Set after a provider accepts the interview call. Failures before that do not count. */
  markInterviewStarted?: (ctx: GuardContext) => Promise<void>;
}

function sendTerminalError(res: HttpResponse, failures: ModelFailure[], error: unknown) {
  const kind = dominantFailureKind(failures);
  const message = failures.length > 0
    ? chainExhaustedMessage(failures)
    : (error as { message?: string })?.message || String(error);
  const status = failures.length > 0 ? httpStatusForKind(kind) : 500;
  const body = {
    error: message,
    fallbacksExhausted: true,
    code: status,
    failures,
  };

  if (res.headersSent) {
    res.write(`data: ${JSON.stringify(body)}\n\n`);
    res.end();
    return;
  }
  res.status(status).json(body);
}

function beginSse(res: HttpResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  // A body byte so Hosting's 60s request cap is not spent waiting on the model.
  res.write(": keep-alive\n\n");
  res.flush?.();
}

function sendGate(res: HttpResponse, error: GateError) {
  if (res.headersSent) return;
  console.warn(`chatProxy denied code=${error.code}`);
  res.status(error.status).json({ error: error.message, code: error.code });
}

async function noteInterviewStarted(deps: ChatDeps, ctx: GuardContext) {
  if (!deps.markInterviewStarted || !ctx.uid) return;
  try {
    await deps.markInterviewStarted(ctx);
  } catch {
    console.error("interview start mark failed");
  }
}

function generationConfig(
  systemInstruction: unknown,
  decision: ThinkingDecision,
): GenerateRequest["config"] {
  if (decision.thinkingBudget === undefined) return { systemInstruction };
  return {
    systemInstruction,
    thinkingConfig: { thinkingBudget: decision.thinkingBudget },
  };
}

async function safeLog(
  deps: ChatDeps,
  ctx: GuardContext,
  model: string,
  usage: { promptTokens: number; completionTokens: number; thoughtsTokenCount: number },
  thinkingBudget: number | null,
) {
  if (!ctx.uid) return;
  try {
    await deps.logUsage(buildUsageRecord({
      uid: ctx.uid,
      sessionId: ctx.sessionId,
      reservationId: sanitizeReservationId(ctx.reservationId),
      feature: ctx.feature,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      thoughtsTokenCount: usage.thoughtsTokenCount,
      thinkingBudget,
    }));
  } catch {
    console.error("usage_server write failed");
  }
}

export async function handleChat(req: GuardRequest, res: HttpResponse, deps: ChatDeps): Promise<void> {
  const failures: ModelFailure[] = [];
  try {
    const ctx = await deps.guard(req);
    const body = (req.body ?? {}) as {
      messages?: Array<{ role?: string; content?: string }>;
      systemInstruction?: unknown;
      modelName?: string;
      stream?: boolean;
      turnIndex?: unknown;
      isFinalTurn?: unknown;
    };
    const messages = body.messages ?? [];
    const requestedModel = normalizeModelName(body.modelName);
    if (!isRequestableModel(requestedModel)) {
      res.status(400).send(`Bad Request: Model '${requestedModel}' is not allowed.`);
      return;
    }

    const contents = messages.map((message) => ({
      role: message.role === "system" ? "user" : message.role,
      parts: [{ text: message.content }],
    }));
    const chain = buildModelChain(requestedModel);
    const thinkingInput = {
      feature: ctx.feature,
      messages,
      turnIndex: body.turnIndex,
      isFinalTurn: body.isFinalTurn,
      envValue: process.env.MIRROR_FINAL_THINKING_BUDGET,
    };

    if (body.stream) {
      let opened: {
        model: string;
        iterator: AsyncIterator<GeminiChunk>;
        thinkingBudget: number | null;
      } | null = null;

      for (const model of chain) {
        const decision = mirrorThinkingBudget({ ...thinkingInput, model });
        try {
          const responseStream = await deps.ai.models.generateContentStream({
            model,
            contents,
            config: generationConfig(body.systemInstruction, decision),
          });
          opened = {
            model,
            iterator: responseStream[Symbol.asyncIterator](),
            thinkingBudget: decision.thinkingBudget ?? null,
          };
          break;
        } catch (error) {
          const kind = classifyModelError(error);
          failures.push({ model, kind });
          console.warn(`chatProxy stream open failed for ${model} (${kind})`);
          if (kind === "quota" || kind === "auth" || kind === "other") {
            sendTerminalError(res, failures, error);
            return;
          }
        }
      }

      if (!opened) {
        sendTerminalError(res, failures, new Error("No Gemini model accepted the stream."));
        return;
      }

      beginSse(res);

      if (opened.model !== requestedModel) {
        res.write(`data: ${JSON.stringify({
          fallback: { from: requestedModel, to: opened.model },
        })}\n\n`);
      }

      const seen: GeminiChunk[] = [];
      const writeChunk = (chunk: GeminiChunk | undefined) => {
        if (chunk) seen.push(chunk);
        const text = chunk?.text || "";
        if (text) {
          res.write(`data: ${JSON.stringify({ text, model: opened?.model })}\n\n`);
        }
      };

      let noted = false;
      const noteOnce = async () => {
        if (noted) return;
        noted = true;
        await noteInterviewStarted(deps, ctx);
      };

      try {
        while (true) {
          const next = await opened.iterator.next();
          if (next.done) break;
          await noteOnce();
          writeChunk(next.value);
        }
        await noteOnce();
        const usage = usageFromChunks(seen);
        await safeLog(deps, ctx, opened.model, usage, opened.thinkingBudget);
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (error) {
        const kind = classifyModelError(error);
        failures.push({ model: opened.model, kind });
        console.warn(`chatProxy stream failed mid-response for ${opened.model} (${kind})`);
        sendTerminalError(res, failures, error);
      }
      return;
    }

    let responseText = "";
    let activeModel = requestedModel;
    let succeeded = false;
    let promptTokens = 0;
    let completionTokens = 0;
    let thoughtsTokenCount = 0;
    let thinkingBudget: number | null = null;

    for (const model of chain) {
      const decision = mirrorThinkingBudget({ ...thinkingInput, model });
      try {
        const response = await deps.ai.models.generateContent({
          model,
          contents,
          config: generationConfig(body.systemInstruction, decision),
        });
        responseText = response.text || "";
        activeModel = model;
        const usage = usageFromChunks([response]);
        promptTokens = usage.promptTokens;
        completionTokens = usage.completionTokens;
        thoughtsTokenCount = usage.thoughtsTokenCount;
        thinkingBudget = decision.thinkingBudget ?? null;
        succeeded = true;
        break;
      } catch (error) {
        const kind = classifyModelError(error);
        failures.push({ model, kind });
        console.warn(`chatProxy generate failed for ${model} (${kind})`);
        if (kind === "quota" || kind === "auth" || kind === "other") {
          sendTerminalError(res, failures, error);
          return;
        }
      }
    }

    if (!succeeded) {
      sendTerminalError(res, failures, new Error("No Gemini model accepted the request."));
      return;
    }

    await noteInterviewStarted(deps, ctx);
    await safeLog(deps, ctx, activeModel, { promptTokens, completionTokens, thoughtsTokenCount }, thinkingBudget);
    res.status(200).json({
      text: responseText,
      model: activeModel,
      fallback: activeModel === requestedModel ? undefined : { from: requestedModel, to: activeModel },
    });
  } catch (error: unknown) {
    if (error instanceof GateError) {
      sendGate(res, error);
      return;
    }
    console.error("Vertex AI Proxy Error");
    sendTerminalError(res, failures, error);
  }
}
