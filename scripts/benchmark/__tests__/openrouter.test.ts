/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { OpenRouterError, TruncatedOutputError } from '../errors';
import { createOpenRouterClient, interviewMessages, type FetchLike } from '../openrouter';
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
});
