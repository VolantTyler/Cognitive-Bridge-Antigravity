/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenRouterError } from './errors';
import { estimateMessagesTokens } from './tokens';
import type { ChatClient, ChatMessage, ChatRequest, ChatResponse } from './types';

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResult>;

export function interviewMessages(systemPrompt: string | null, scenarioText: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (systemPrompt !== null && systemPrompt.trim() !== '') {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: scenarioText });
  return messages;
}

export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join('[redacted]');
}

interface OpenRouterBody {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function defaultFetch(url: string, init: FetchInit): Promise<FetchResult> {
  if (process.env.VITEST) {
    throw new OpenRouterError('Refusing live HTTP during tests. Pass a mock fetch.');
  }
  return fetch(url, init);
}

export function createOpenRouterClient(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
}): ChatClient {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    async complete(request: ChatRequest): Promise<ChatResponse> {
      const payload = {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      };
      let response: FetchResult;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://cognitive-bridge-ai.web.app',
            'X-Title': 'Cognitive Bridge Benchmark',
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        const message = redactSecret((error as Error).message, options.apiKey);
        throw new OpenRouterError(`OpenRouter request failed before a response: ${message}`);
      }

      const rawText = await response.text();
      const safeText = redactSecret(rawText, options.apiKey);
      if (!response.ok) {
        throw new OpenRouterError(`OpenRouter request failed (${response.status}): ${safeText.slice(0, 500)}`);
      }

      let body: OpenRouterBody;
      try {
        body = JSON.parse(rawText) as OpenRouterBody;
      } catch {
        throw new OpenRouterError('OpenRouter response was not valid JSON');
      }
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new OpenRouterError('OpenRouter response did not include assistant text');
      }
      const promptTokens = body.usage?.prompt_tokens;
      const completionTokens = body.usage?.completion_tokens;
      const usageEstimated = !Number.isFinite(promptTokens) || !Number.isFinite(completionTokens);
      return {
        content,
        // OpenRouter's `model` is often only the requested id (for example
        // "google/gemini-2.5-flash-lite"), not a dated build. Callers store a
        // recorded_at timestamp beside this string.
        modelVersion: typeof body.model === 'string' && body.model.trim() ? body.model : request.model,
        promptTokens: usageEstimated ? estimateMessagesTokens(request.messages) : (promptTokens as number),
        completionTokens: usageEstimated ? request.maxTokens : (completionTokens as number),
        usageEstimated,
      };
    },
  };
}
