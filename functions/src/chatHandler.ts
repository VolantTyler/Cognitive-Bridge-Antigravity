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
    abortSignal?: AbortSignal;
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
  writableEnded?: boolean;
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
  abortSignal?: AbortSignal,
): GenerateRequest["config"] {
  const config: GenerateRequest["config"] = { systemInstruction };
  if (abortSignal) config.abortSignal = abortSignal;
  if (decision.thinkingBudget !== undefined) {
    config.thinkingConfig = { thinkingBudget: decision.thinkingBudget };
  }
  return config;
}

async function safeLog(
  deps: ChatDeps,
  ctx: GuardContext,
  model: string,
  usage: { promptTokens: number; completionTokens: number; thoughtsTokenCount: number },
  thinkingBudget: number | null,
  aborted = false,
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
      aborted,
    }));
  } catch {
    console.error("usage_server write failed");
  }
}

interface ClosableRequest extends GuardRequest {
  on?(event: "close", listener: () => void): void;
  off?(event: "close", listener: () => void): void;
}

function watchClient(req: ClosableRequest, res: HttpResponse, abort: AbortController) {
  let settled = false;
  let disconnected = false;
  const onClose = () => {
    if (settled || res.writableEnded) return;
    disconnected = true;
    abort.abort();
  };
  req.on?.("close", onClose);
  return {
    get disconnected() {
      return disconnected;
    },
    settle() {
      settled = true;
    },
    stop() {
      settled = true;
      req.off?.("close", onClose);
    },
  };
}

export async function handleChat(req: ClosableRequest, res: HttpResponse, deps: ChatDeps): Promise<void> {
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
    const abort = new AbortController();
    const client = watchClient(req, res, abort);
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
            config: generationConfig(body.systemInstruction, decision, abort.signal),
          });
          opened = {
            model,
            iterator: responseStream[Symbol.asyncIterator](),
            thinkingBudget: decision.thinkingBudget ?? null,
          };
          break;
        } catch (error) {
          if (client.disconnected) {
            client.settle();
            await safeLog(deps, ctx, model, {
              promptTokens: 0,
              completionTokens: 0,
              thoughtsTokenCount: 0,
            }, decision.thinkingBudget ?? null, true);
            client.stop();
            return;
          }
          const kind = classifyModelError(error);
          failures.push({ model, kind });
          console.warn(`chatProxy stream open failed for ${model} (${kind})`);
          if (kind === "quota" || kind === "auth" || kind === "other") {
            client.settle();
            client.stop();
            sendTerminalError(res, failures, error);
            return;
          }
        }
      }

      if (!opened) {
        client.stop();
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

      const finishAborted = async () => {
        client.settle();
        try {
          await opened?.iterator.return?.();
        } catch {
          // The abort already stopped the iterator.
        }
        await safeLog(deps, ctx, opened.model, usageFromChunks(seen), opened.thinkingBudget, true);
      };

      try {
        while (!client.disconnected) {
          const next = await opened.iterator.next();
          if (client.disconnected) {
            if (!next.done) writeChunk(next.value);
            break;
          }
          if (next.done) break;
          await noteOnce();
          writeChunk(next.value);
        }
        if (client.disconnected) {
          await finishAborted();
          return;
        }
        await noteOnce();
        client.settle();
        await safeLog(deps, ctx, opened.model, usageFromChunks(seen), opened.thinkingBudget, false);
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (error) {
        if (client.disconnected) {
          await finishAborted();
          return;
        }
        client.settle();
        const kind = classifyModelError(error);
        failures.push({ model: opened.model, kind });
        console.warn(`chatProxy stream failed mid-response for ${opened.model} (${kind})`);
        sendTerminalError(res, failures, error);
      } finally {
        client.stop();
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
          config: generationConfig(body.systemInstruction, decision, abort.signal),
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
        if (client.disconnected) {
          client.settle();
          await safeLog(deps, ctx, model, {
            promptTokens: 0,
            completionTokens: 0,
            thoughtsTokenCount: 0,
          }, decision.thinkingBudget ?? null, true);
          client.stop();
          return;
        }
        const kind = classifyModelError(error);
        failures.push({ model, kind });
        console.warn(`chatProxy generate failed for ${model} (${kind})`);
        if (kind === "quota" || kind === "auth" || kind === "other") {
          client.stop();
          sendTerminalError(res, failures, error);
          return;
        }
      }
    }

    if (!succeeded) {
      client.stop();
      sendTerminalError(res, failures, new Error("No Gemini model accepted the request."));
      return;
    }

    await noteInterviewStarted(deps, ctx);
    client.settle();
    client.stop();
    await safeLog(deps, ctx, activeModel, { promptTokens, completionTokens, thoughtsTokenCount }, thinkingBudget, false);
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
