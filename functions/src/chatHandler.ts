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
import { GuardContext, GuardRequest } from "./guard";
import { GateError } from "./gate";
import { UsageRecord, buildUsageRecord, usageFromChunks } from "./usageLog";

export interface GeminiChunk {
  text?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface GenerateRequest {
  model: string;
  contents: Array<{ role?: string; parts: Array<{ text?: string }> }>;
  config: { systemInstruction?: unknown };
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
}

export interface ChatDeps {
  guard: (req: GuardRequest) => Promise<GuardContext>;
  ai: GeminiClient;
  logUsage: (record: UsageRecord) => Promise<void>;
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

function sendGate(res: HttpResponse, error: GateError) {
  if (res.headersSent) return;
  console.warn(`chatProxy denied code=${error.code}`);
  res.status(error.status).json({ error: error.message, code: error.code });
}

async function safeLog(deps: ChatDeps, ctx: GuardContext, model: string, promptTokens: number, completionTokens: number) {
  if (!ctx.uid) return;
  try {
    await deps.logUsage(buildUsageRecord({
      uid: ctx.uid,
      sessionId: ctx.sessionId,
      feature: ctx.feature,
      model,
      promptTokens,
      completionTokens,
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
    const requestConfig = { systemInstruction: body.systemInstruction };

    if (body.stream) {
      let opened: {
        model: string;
        iterator: AsyncIterator<GeminiChunk>;
        first: IteratorResult<GeminiChunk>;
      } | null = null;

      for (const model of chain) {
        try {
          const responseStream = await deps.ai.models.generateContentStream({
            model,
            contents,
            config: requestConfig,
          });
          const iterator = responseStream[Symbol.asyncIterator]();
          const first = await iterator.next();
          opened = { model, iterator, first };
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

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

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

      try {
        if (!opened.first.done) writeChunk(opened.first.value);
        while (true) {
          const next = await opened.iterator.next();
          if (next.done) break;
          writeChunk(next.value);
        }
        const usage = usageFromChunks(seen);
        await safeLog(deps, ctx, opened.model, usage.promptTokens, usage.completionTokens);
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

    for (const model of chain) {
      try {
        const response = await deps.ai.models.generateContent({
          model,
          contents,
          config: requestConfig,
        });
        responseText = response.text || "";
        activeModel = model;
        const usage = usageFromChunks([response]);
        promptTokens = usage.promptTokens;
        completionTokens = usage.completionTokens;
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

    await safeLog(deps, ctx, activeModel, promptTokens, completionTokens);
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
