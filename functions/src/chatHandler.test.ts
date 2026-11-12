import { describe, expect, it, vi } from "vitest";
import { handleChat, GeminiClient } from "./chatHandler";
import { handleJudge } from "./judgeHandler";
import { GateError } from "./gate";
import { costMicrosForUsage } from "./pricing";
import { usageFromChunks, buildUsageRecord, usageLogLine, UsageRecord } from "./usageLog";

function mockRes() {
  let statusCode = 0;
  let payload: unknown;
  let headersSent = false;
  const chunks: string[] = [];
  return {
    get headersSent() {
      return headersSent;
    },
    status(code: number) {
      statusCode = code;
      return {
        json(body: unknown) {
          payload = body;
        },
        send(body: unknown) {
          payload = body;
        },
      };
    },
    writeHead(code: number) {
      statusCode = code;
      headersSent = true;
    },
    write(chunk: string) {
      chunks.push(chunk);
    },
    end() {},
    snapshot() {
      return { statusCode, payload, chunks, headersSent };
    },
  };
}

describe("usage records", () => {
  it("keeps the last usageMetadata and drops message content", () => {
    expect(usageFromChunks([
      { text: "secret prompt", usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } },
      { usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, thoughtsTokenCount: 7 } },
    ])).toEqual({ promptTokens: 9, completionTokens: 11, thoughtsTokenCount: 7 });

    const record = buildUsageRecord({
      uid: "u",
      sessionId: "s",
      reservationId: "iv_1",
      feature: "mirror",
      model: "gemini-2.5-flash",
      promptTokens: 9,
      completionTokens: 4,
    });
    expect(Object.keys(record).sort()).toEqual([
      "completionTokens",
      "costMicros",
      "feature",
      "model",
      "promptTokens",
      "reservationId",
      "sessionId",
      "thinkingBudget",
      "thoughtsTokenCount",
      "uid",
    ]);
    expect(record.thoughtsTokenCount).toBe(0);
    expect(record.thinkingBudget).toBeNull();
    expect(record.costMicros).toBe(costMicrosForUsage({
      model: "gemini-2.5-flash",
      promptTokens: 9,
      completionTokens: 4,
    }));
    expect(JSON.stringify(record)).not.toContain("secret");
    const dirty = {
      ...record,
      apiKey: "typesafe-test-key",
      content: "secret prompt",
    } as UsageRecord;
    const line = usageLogLine(dirty);
    expect(Object.keys(line).sort()).toEqual([
      "completionTokens",
      "costMicros",
      "feature",
      "model",
      "promptTokens",
      "reservationId",
      "thinkingBudget",
      "thoughtsTokenCount",
      "uid",
    ]);
    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("typesafe-test-key");
    expect(serialized).not.toContain("\n");
  });
});

describe("handleChat", () => {
  it("stops before Gemini when the gate denies the caller", async () => {
    const generateContent = vi.fn();
    const res = mockRes();
    await handleChat({ method: "POST", body: { messages: [] } }, res, {
      guard: async () => {
        throw new GateError(401, "unauthenticated", "Sign in to save your progress.");
      },
      ai: { models: { generateContent, generateContentStream: vi.fn() } },
      logUsage: vi.fn(),
    });
    expect(generateContent).not.toHaveBeenCalled();
    expect(res.snapshot().statusCode).toBe(401);
    expect(res.snapshot().payload).toEqual({ error: "Sign in to save your progress.", code: "unauthenticated" });
  });

  it("logs the model that answered, including a fallback", async () => {
    const logUsage = vi.fn(async () => {});
    const generateContent = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("404 not found"), { status: 404 }))
      .mockResolvedValueOnce({
        text: "answered",
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
      });
    const res = mockRes();
    await handleChat({
      method: "POST",
      body: {
        messages: [{ role: "user", content: "private diary text" }],
        modelName: "gemini-2.5-pro",
        feature: "mirror",
        sessionId: "sess-1",
      },
    }, res, {
      guard: async () => ({
        uid: "user-1",
        email: "a@example.com",
        email_verified: true,
        feature: "mirror",
        sessionId: "sess-1",
        reservationId: "iv_mirror_1",
      }),
      ai: { models: { generateContent, generateContentStream: vi.fn() } } as GeminiClient,
      logUsage,
    });
    expect(res.snapshot().payload).toMatchObject({ text: "answered", model: "gemini-2.5-flash" });
    expect(generateContent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      model: "gemini-2.5-pro",
      config: { systemInstruction: undefined },
    }));
    expect(generateContent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      model: "gemini-2.5-flash",
      config: { systemInstruction: undefined, thinkingConfig: { thinkingBudget: 0 } },
    }));
    expect(logUsage).toHaveBeenCalledWith({
      uid: "user-1",
      sessionId: "sess-1",
      reservationId: "iv_mirror_1",
      feature: "mirror",
      model: "gemini-2.5-flash",
      promptTokens: 12,
      completionTokens: 3,
      thoughtsTokenCount: 0,
      thinkingBudget: 0,
      costMicros: costMicrosForUsage({
        model: "gemini-2.5-flash",
        promptTokens: 12,
        completionTokens: 3,
      }),
    });
    expect(JSON.stringify(logUsage.mock.calls)).not.toContain("private diary");
  });

  it("reads usageMetadata from the last stream chunk", async () => {
    const logUsage = vi.fn(async () => {});
    async function* chunks() {
      yield { text: "Hello", usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 } };
      yield { text: " there", usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 6 } };
    }
    const res = mockRes();
    await handleChat({
      method: "POST",
      body: { messages: [{ role: "user", content: "hi" }], stream: true, modelName: "gemini-2.5-flash" },
    }, res, {
      guard: async () => ({
        uid: "user-1",
        email: null,
        email_verified: false,
        feature: "playground-aligned",
        sessionId: null,
        reservationId: "bad id",
      }),
      ai: {
        models: {
          generateContent: vi.fn(),
          generateContentStream: vi.fn(async () => chunks()),
        },
      },
      logUsage,
    });
    expect(res.snapshot().chunks.join("")).toContain("[DONE]");
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-2.5-flash",
      promptTokens: 8,
      completionTokens: 6,
      thoughtsTokenCount: 0,
      thinkingBudget: null,
      feature: "playground-aligned",
      sessionId: null,
      reservationId: null,
    }));
  });

  it("uses budget 0 on a mirror flash question turn and the env budget on the scoring turn", async () => {
    const previous = process.env.MIRROR_FINAL_THINKING_BUDGET;
    process.env.MIRROR_FINAL_THINKING_BUDGET = "256";
    try {
      const logUsage = vi.fn(async () => {});
      const generateContentStream = vi.fn(async () => (async function* () {
        yield {
          text: "next",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 5 },
        };
      })());
      const guard = async () => ({
        uid: "user-1",
        email: null,
        email_verified: false,
        feature: "mirror",
        sessionId: "sess",
        reservationId: "iv_1",
      });
      const ai = { models: { generateContent: vi.fn(), generateContentStream } } as GeminiClient;

      const question = mockRes();
      await handleChat({
        method: "POST",
        body: {
          stream: true,
          modelName: "gemini-2.5-flash",
          feature: "mirror",
          turnIndex: 5,
          isFinalTurn: true,
          messages: [{ role: "user", content: "only one answer" }],
        },
      }, question, { guard, ai, logUsage });
      expect(generateContentStream).toHaveBeenLastCalledWith(expect.objectContaining({
        config: expect.objectContaining({ thinkingConfig: { thinkingBudget: 0 } }),
      }));
      expect(logUsage).toHaveBeenLastCalledWith(expect.objectContaining({
        thinkingBudget: 0,
        thoughtsTokenCount: 5,
        completionTokens: 7,
        costMicros: costMicrosForUsage({
          model: "gemini-2.5-flash",
          promptTokens: 10,
          completionTokens: 7,
        }),
      }));

      const scoring = mockRes();
      await handleChat({
        method: "POST",
        body: {
          stream: true,
          modelName: "gemini-2.5-flash",
          feature: "mirror",
          turnIndex: 1,
          isFinalTurn: false,
          messages: Array.from({ length: 5 }, () => ({ role: "user", content: "answer" })),
        },
      }, scoring, { guard, ai, logUsage });
      expect(generateContentStream).toHaveBeenLastCalledWith(expect.objectContaining({
        config: expect.objectContaining({ thinkingConfig: { thinkingBudget: 256 } }),
      }));
      expect(logUsage).toHaveBeenLastCalledWith(expect.objectContaining({
        thinkingBudget: 256,
        thoughtsTokenCount: 5,
        completionTokens: 7,
      }));
    } finally {
      if (previous === undefined) delete process.env.MIRROR_FINAL_THINKING_BUDGET;
      else process.env.MIRROR_FINAL_THINKING_BUDGET = previous;
    }
  });
});

describe("handleJudge", () => {
  it("logs a judge call without token counts or conversation state", async () => {
    const logUsage = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ answers: { openness: { type: "noul" } }, model: "jev-latest" }),
    }));
    const res = mockRes();
    await handleJudge({
      method: "POST",
      body: {
        state: "the user said something private",
        questions: { openness: { type: "noul", instructions: "Check the score." } },
        feature: "mirror",
        sessionId: "sess-9",
      },
    }, res, {
      guard: async () => ({
        uid: "user-1",
        email: "a@example.com",
        email_verified: true,
        feature: "mirror",
        sessionId: "sess-9",
        reservationId: "iv_mirror_1",
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: "typesafe-test-key",
      logUsage,
    });
    expect(res.snapshot().statusCode).toBe(200);
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      feature: "judge",
      model: "jev-latest",
      promptTokens: 0,
      completionTokens: 0,
      costMicros: 0,
      sessionId: "sess-9",
      reservationId: "iv_mirror_1",
      uid: "user-1",
    }));
    expect(JSON.stringify(logUsage.mock.calls)).not.toContain("private");
    expect(JSON.stringify(logUsage.mock.calls)).not.toContain("typesafe-test-key");
  });

  it("does not call Typesafe when the gate returns 401", async () => {
    const fetchImpl = vi.fn();
    const res = mockRes();
    await handleJudge({ method: "POST", body: { state: "x", questions: {} } }, res, {
      guard: async () => {
        throw new GateError(401, "unauthenticated", "Sign in to save your progress.");
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: "typesafe-test-key",
      logUsage: vi.fn(),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.snapshot().payload).toMatchObject({ code: "unauthenticated" });
  });
});
