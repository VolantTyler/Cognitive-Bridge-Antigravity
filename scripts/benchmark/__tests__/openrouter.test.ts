/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { OpenRouterCallError, OpenRouterError, TruncatedOutputError } from '../errors';
import {
  OPENROUTER_MAX_ATTEMPTS,
  OPENROUTER_MAX_RETRY_AFTER_MS,
  createOpenRouterClient,
  interviewMessages,
  retryDelayMs,
  type FetchLike,
} from '../openrouter';
import { buildInterviewTranscript, parseMirrorScores } from '../scorer';
import type { ChatRequest } from '../types';

const request: ChatRequest = {
  kind: 'interview',
  model: 'openai/gpt-5-nano',
  messages: interviewMessages(null, 'You are 10 minutes away from a demo.'),
  temperature: 0.8,
  maxTokens: 100,
};

describe('OpenRouter client', () => {
  it('sends no system message, the configured temperature, and the chat completions URL', async () => {
    const seen: Array<{ url: string; body: Record<string, unknown>; authorization: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push({
        url,
        body: JSON.parse(init.body) as Record<string, unknown>,
        authorization: init.headers.Authorization,
      });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            model: 'openai/gpt-5-nano-2026-10-05',
            choices: [{ message: { content: 'I would fix it properly.' } }],
            usage: { prompt_tokens: 15, completion_tokens: 9 },
          });
        },
      };
    };
    const client = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl,
    });
    const response = await client.complete(request);
    expect(seen[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(seen[0].body.temperature).toBe(0.8);
    expect(seen[0].body.messages).toEqual([
      { role: 'user', content: 'You are 10 minutes away from a demo.' },
    ]);
    expect(JSON.stringify(seen[0].body.messages)).not.toContain('"role":"system"');
    expect(seen[0].authorization).toBe('Bearer sk-test-secret');
    expect(response.modelVersion).toBe('openai/gpt-5-nano-2026-10-05');
    expect(response.promptTokens).toBe(15);
    expect(response.completionTokens).toBe(9);
    expect(response.usageEstimated).toBe(false);
  });

  it('redacts the API key from errors and refuses a live fetch during tests', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 401,
      async text() {
        return 'invalid key sk-test-secret';
      },
    });
    const client = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl,
    });
    await expect(client.complete(request)).rejects.toThrow(OpenRouterError);
    await expect(client.complete(request)).rejects.toThrow(/\[redacted\]/);
    await expect(client.complete(request)).rejects.not.toThrow(/sk-test-secret/);

    const live = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    await expect(live.complete(request)).rejects.toThrow(/Refusing live HTTP during tests/);
  });

  it('falls back to the max-output estimate when usage is missing', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          model: 'openai/gpt-5-nano',
          choices: [{ message: { content: 'answer' } }],
        });
      },
    });
    const client = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl,
    });
    const response = await client.complete(request);
    expect(response.usageEstimated).toBe(true);
    expect(response.completionTokens).toBe(100);
    expect(response.modelVersion).toBe('openai/gpt-5-nano');
  });

  it('sends one reasoning effort and never returns message.reasoning as the answer', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push(JSON.parse(init.body) as Record<string, unknown>);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            model: 'openai/gpt-5-nano',
            choices: [{
              finish_reason: 'stop',
              message: {
                content: 'I would fix the bug before the demo.',
                reasoning: 'SECRET_REASONING_TEXT JSON_SCORES: {"openness":1}',
              },
            }],
            usage: { prompt_tokens: 12, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 4 } },
          });
        },
      };
    };
    const client = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl,
    });
    const response = await client.complete({ ...request, reasoningEffort: 'minimal', maxTokens: 8192 });
    expect(seen[0].reasoning).toEqual({ effort: 'minimal' });
    expect(seen[0].max_tokens).toBe(8192);
    expect(response.content).toBe('I would fix the bug before the demo.');
    expect(response.content).not.toContain('SECRET_REASONING_TEXT');
    expect(() => parseMirrorScores(response.content)).toThrow(/JSON_SCORES/);
    const transcript = buildInterviewTranscript([{ scenario: { id: 'demo-bug', text: 'question' }, answer: response.content }]);
    expect(transcript).toContain('I would fix the bug before the demo.');
    expect(transcript).not.toContain('SECRET_REASONING_TEXT');
  });

  it('throws a typed length error and does not treat reasoning text as the answer', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          model: 'openai/gpt-5-nano',
          choices: [{
            finish_reason: 'length',
            native_finish_reason: 'max_output_tokens',
            message: { content: null, reasoning: 'SECRET_REASONING_TEXT' },
          }],
          usage: {
            prompt_tokens: 18,
            completion_tokens: 1024,
            completion_tokens_details: { reasoning_tokens: 1024 },
          },
        });
      },
    });
    const client = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl,
    });
    await expect(client.complete(request)).rejects.toBeInstanceOf(TruncatedOutputError);
    try {
      await client.complete(request);
    } catch (error) {
      expect(error).toBeInstanceOf(TruncatedOutputError);
      const truncated = error as TruncatedOutputError;
      expect(truncated.modelId).toBe('openai/gpt-5-nano');
      expect(truncated.finishReason).toBe('length');
      expect(truncated.completionTokens).toBe(1024);
      expect(truncated.reasoningTokens).toBe(1024);
      expect(truncated.promptTokens).toBe(18);
      expect(truncated.message).toContain('openai/gpt-5-nano');
      expect(truncated.message).toContain('length');
      expect(truncated.message).not.toContain('SECRET_REASONING_TEXT');
      expect(truncated.message).not.toContain('sk-test-secret');
    }
  });

  it('sends reasoning.effort for Qwen and Kimi and keeps a normal answer', async () => {
    for (const model of ['qwen/qwen3-235b-a22b-2507', 'moonshotai/kimi-k2-0905'] as const) {
      const seen: Array<Record<string, unknown>> = [];
      const fetchImpl: FetchLike = async (_url, init) => {
        seen.push(JSON.parse(init.body) as Record<string, unknown>);
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              model,
              choices: [{ finish_reason: 'stop', message: { content: 'answer' } }],
              usage: { prompt_tokens: 3, completion_tokens: 4 },
            });
          },
        };
      };
      const client = createOpenRouterClient({
        apiKey: 'sk-test-secret',
        baseUrl: 'https://openrouter.ai/api/v1',
        fetchImpl,
      });
      const response = await client.complete({ ...request, model, kind: 'interview', reasoningEffort: 'minimal' });
      expect(seen).toHaveLength(1);
      expect(seen[0].model).toBe(model);
      expect(seen[0].reasoning).toEqual({ effort: 'minimal' });
      expect(response.content).toBe('answer');
      expect(response.provider).toBeNull();
    }
  });

  it('records the OpenRouter provider when the body includes one', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          model: 'openai/gpt-5-nano',
          provider: '  Google AI Studio  ',
          choices: [{ message: { content: 'answer' } }],
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        });
      },
    });
    const client = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl,
    });
    const response = await client.complete(request);
    expect(response.provider).toBe('Google AI Studio');
  });

  it('retries 429 and 5xx on interview and judge calls, then records the successful response', async () => {
    for (const kind of ['interview', 'judge'] as const) {
      const statuses: number[] = [];
      const delays: number[] = [];
      const fetchImpl: FetchLike = async () => {
        const plan = kind === 'interview' ? [429, 500, 200] : [503, 200];
        const status = plan[statuses.length] ?? 200;
        statuses.push(status);
        if (status !== 200) {
          return {
            ok: false,
            status,
            headers: { get: () => null },
            async text() {
              return JSON.stringify({ error: { message: 'Provider returned error' } });
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              model: 'google/gemini-2.5-flash-lite',
              provider: 'Google',
              choices: [{ message: { content: kind === 'judge' ? 'JSON_SCORES: {"openness":1}' : 'answer' } }],
              usage: { prompt_tokens: 4, completion_tokens: 5 },
            });
          },
        };
      };
      const client = createOpenRouterClient({
        apiKey: 'sk-test-secret',
        baseUrl: 'https://openrouter.ai/api/v1',
        fetchImpl,
        random: () => 0.5,
        sleep: async (ms) => {
          delays.push(ms);
        },
      });
      const response = await client.complete({ ...request, kind, reasoningEffort: 'minimal' });
      expect(response.content).toContain(kind === 'judge' ? 'JSON_SCORES' : 'answer');
      expect(response.provider).toBe('Google');
      expect(statuses).toEqual(kind === 'interview' ? [429, 500, 200] : [503, 200]);
      expect(delays).toEqual(kind === 'interview' ? [2000, 4000] : [2000]);
    }
  });

  it('uses a 2s exponential schedule with jitter, and caps Retry-After at 60s', async () => {
    const nowMs = Date.parse('2026-10-30T12:00:00.000Z');
    const exact = (attempt: number, retryAfter: string | null = null) => retryDelayMs(attempt, retryAfter, nowMs, () => 0.5);
    expect([1, 2, 3, 4, 5].map((attempt) => exact(attempt))).toEqual([2000, 4000, 8000, 16000, 32000]);
    expect(exact(1, '2')).toBe(2000);
    expect(exact(1, new Date(nowMs + 2000).toUTCString())).toBe(2000);
    expect(exact(1, '90')).toBe(OPENROUTER_MAX_RETRY_AFTER_MS);
    expect(retryDelayMs(1, null, nowMs, () => 0)).toBe(1600);
    expect(retryDelayMs(1, null, nowMs, () => 1)).toBe(2400);
    expect(retryDelayMs(1, '90', nowMs, () => 1)).toBe(OPENROUTER_MAX_RETRY_AFTER_MS);
    expect(exact(1, 'not-a-date')).toBe(2000);
    expect(OPENROUTER_MAX_ATTEMPTS).toBe(6);
    expect(OPENROUTER_MAX_RETRY_AFTER_MS).toBe(60_000);
  });

  it('honors Retry-After, caps it, and throws OpenRouterCallError after six 429s', async () => {
    const nowMs = Date.parse('2026-10-30T12:00:00.000Z');

    const delays: number[] = [];
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return {
        ok: false,
        status: 429,
        headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '2' : null) },
        async text() {
          return JSON.stringify({ error: { message: 'Provider returned error' } });
        },
      };
    };
    const client = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl,
      now: () => nowMs,
      random: () => 0.5,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await expect(client.complete(request)).rejects.toBeInstanceOf(OpenRouterCallError);
    await expect(client.complete(request)).rejects.toThrow(/failed \(429\) after 6 attempts: Provider returned error/);
    expect(calls).toBe(OPENROUTER_MAX_ATTEMPTS * 2);
    expect(delays).toEqual(Array(10).fill(2000));
  });

  it('sends provider routing only when the request sets it', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push(JSON.parse(init.body) as Record<string, unknown>);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            model: 'openai/gpt-5-nano',
            choices: [{ message: { content: 'answer' } }],
            usage: { prompt_tokens: 2, completion_tokens: 2 },
          });
        },
      };
    };
    const client = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl,
    });
    await client.complete(request);
    await client.complete({
      ...request,
      kind: 'judge',
      provider: { order: ['ProviderName'], allow_fallbacks: false },
    });
    expect(seen[0].provider).toBeUndefined();
    expect(seen[1].provider).toEqual({ order: ['ProviderName'], allow_fallbacks: false });
    expect(seen[1].reasoning).toBeUndefined();
  });

  it('does not retry a 401 or a length cutoff', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 401,
          async text() {
            return 'invalid key sk-test-secret';
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            model: 'openai/gpt-5-nano',
            choices: [{ finish_reason: 'length', message: { content: null } }],
            usage: { prompt_tokens: 1, completion_tokens: 2 },
          });
        },
      };
    };
    const delays: number[] = [];
    const client = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await expect(client.complete(request)).rejects.toThrow(/failed \(401\)/);
    await expect(client.complete(request)).rejects.toBeInstanceOf(TruncatedOutputError);
    expect(calls).toBe(2);
    expect(delays).toEqual([]);
  });
});
