/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenRouterCallError, OpenRouterError, TruncatedOutputError } from './errors';
import { estimateMessagesTokens } from './tokens';
import type { ChatClient, ChatMessage, ChatRequest, ChatResponse, ReasoningEffort } from './types';

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

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

interface OpenRouterMessage {
  content?: unknown;
  reasoning?: unknown;
}

interface OpenRouterBody {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    message?: OpenRouterMessage;
  }>;
  usage?: OpenRouterUsage;
  error?: { message?: string };
}

/**
 * Final answer only. OpenRouter may also return chain-of-thought in
 * `message.reasoning`; that text is never scored.
 */
export function assistantContent(message: OpenRouterMessage | undefined): string | null {
  if (!message || typeof message.content !== 'string') return null;
  return message.content.trim() ? message.content : null;
}

export function reasoningTokenCount(usage: OpenRouterUsage | undefined): number | null {
  const value = usage?.completion_tokens_details?.reasoning_tokens
    ?? usage?.output_tokens_details?.reasoning_tokens
    ?? usage?.reasoning_tokens;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteToken(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readKnownUsage(usage: OpenRouterUsage | undefined): { promptTokens: number; completionTokens: number } | null {
  const promptTokens = finiteToken(usage?.prompt_tokens);
  const completionTokens = finiteToken(usage?.completion_tokens);
  if (promptTokens === null || completionTokens === null) return null;
  return { promptTokens, completionTokens };
}

function requestPayload(request: ChatRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    max_tokens: request.maxTokens,
  };
  if (request.reasoningEffort) {
    payload.reasoning = { effort: request.reasoningEffort satisfies ReasoningEffort };
  }
  return payload;
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
      const payload = requestPayload(request);
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
      let body: OpenRouterBody | null = null;
      try {
        body = JSON.parse(rawText) as OpenRouterBody;
      } catch {
        body = null;
      }
      const usage = readKnownUsage(body?.usage);
      if (!response.ok) {
        const detail = body?.error?.message ? redactSecret(body.error.message, options.apiKey) : safeText.slice(0, 500);
        throw new OpenRouterCallError(`OpenRouter request failed (${response.status}): ${detail}`, usage);
      }
      if (!body) {
        throw new OpenRouterError('OpenRouter response was not valid JSON');
      }

      const choice = body.choices?.[0];
      const content = assistantContent(choice?.message);
      const finishReason = choice?.finish_reason ?? choice?.native_finish_reason ?? 'unknown';
      const truncated = finishReason === 'length' || choice?.native_finish_reason === 'max_output_tokens';
      if (!content && truncated) {
        throw new TruncatedOutputError({
          modelId: request.model,
          finishReason: String(finishReason),
          promptTokens: usage?.promptTokens ?? finiteToken(body.usage?.prompt_tokens),
          completionTokens: usage?.completionTokens ?? finiteToken(body.usage?.completion_tokens),
          reasoningTokens: reasoningTokenCount(body.usage),
        });
      }
      if (!content) {
        throw new OpenRouterCallError(
          `OpenRouter response did not include assistant text (finish_reason ${String(finishReason)})`,
          usage,
        );
      }
      const promptTokens = body.usage?.prompt_tokens;
      const completionTokens = body.usage?.completion_tokens;
      const usageEstimated = !Number.isFinite(promptTokens) || !Number.isFinite(completionTokens);
      return {
        content,
        // OpenRouter's `model` is often only the requested id (for example
        // "google/gemini-2.5-flash-lite"), not a dated build. Callers store a
        // recorded_at timestamp beside this string. message.reasoning is ignored.
        modelVersion: typeof body.model === 'string' && body.model.trim() ? body.model : request.model,
        promptTokens: usageEstimated ? estimateMessagesTokens(request.messages) : (promptTokens as number),
        completionTokens: usageEstimated ? request.maxTokens : (completionTokens as number),
        usageEstimated,
      };
    },
  };
}
