/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { OpenRouterError } from '../errors';
import { createOpenRouterClient, interviewMessages, type FetchLike } from '../openrouter';
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
});
