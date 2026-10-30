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
  /** Optional so existing fakes stay valid. `get` should be case-insensitive, as Fetch Headers is. */
  headers?: { get(name: string): string | null };
}

/** Total attempts for one interview or judge call, including the first. */
export const OPENROUTER_MAX_ATTEMPTS = 6;
const BACKOFF_BASE_MS = 2_000;
/** A Retry-After or jittered backoff longer than this is capped so one call cannot stall the run. */
export const OPENROUTER_MAX_RETRY_AFTER_MS = 60_000;

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
  /** Upstream that served this call. Absent on some responses. */
  provider?: unknown;
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

export function readProvider(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Wait before the next attempt. `attempt` is the 1-based index of the attempt that just failed.
 * The base schedule is 2s, 4s, 8s, 16s, 32s. `random` in [0, 1] applies ±20% jitter.
 * A parseable Retry-After replaces that base and is still jittered, then capped at 60s.
 * Pass `random` of 0.5 in tests for the exact base delay.
 */
export function retryDelayMs(
  attempt: number,
  retryAfter: string | null,
  nowMs: number = Date.now(),
  random: () => number = () => 0.5,
): number {
  const exponential = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  const headerMs = parseRetryAfterMs(retryAfter, nowMs);
  const base = headerMs === null ? exponential : headerMs;
  const unit = Math.min(1, Math.max(0, random()));
  const factor = 0.8 + unit * 0.4;
  return Math.min(Math.round(base * factor), OPENROUTER_MAX_RETRY_AFTER_MS);
}

function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, parsed - nowMs);
}

function retryAfterHeader(response: FetchResult): string | null {
  const value = response.headers?.get('retry-after');
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  if (request.provider) {
    payload.provider = {
      ...(request.provider.order ? { order: request.provider.order } : {}),
      ...(request.provider.allow_fallbacks !== undefined ? { allow_fallbacks: request.provider.allow_fallbacks } : {}),
    };
  }
  return payload;
}

function defaultFetch(url: string, init: FetchInit): Promise<FetchResult> {
  if (process.env.VITEST) {
    throw new OpenRouterError('Refusing live HTTP during tests. Pass a mock fetch.');
  }
  return fetch(url, init);
}

type AttemptOutcome =
  | { kind: 'done'; response: ChatResponse }
  | { kind: 'retry'; status: number; detail: string; retryAfter: string | null; usage: { promptTokens: number; completionTokens: number } | null };

async function attemptOnce(options: {
  request: ChatRequest;
  apiKey: string;
  endpoint: string;
  fetchImpl: FetchLike;
}): Promise<AttemptOutcome> {
  const payload = requestPayload(options.request);
  let response: FetchResult;
  try {
    response = await options.fetchImpl(options.endpoint, {
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
    if (isRetryableStatus(response.status)) {
      return { kind: 'retry', status: response.status, detail, retryAfter: retryAfterHeader(response), usage };
    }
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
      modelId: options.request.model,
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
    kind: 'done',
    response: {
      content,
      // OpenRouter's `model` is often only the requested id (for example
      // "google/gemini-2.5-flash-lite"), not a dated build. Callers store a
      // recorded_at timestamp beside this string. message.reasoning is ignored.
      modelVersion: typeof body.model === 'string' && body.model.trim() ? body.model : options.request.model,
      promptTokens: usageEstimated ? estimateMessagesTokens(options.request.messages) : (promptTokens as number),
      completionTokens: usageEstimated ? options.request.maxTokens : (completionTokens as number),
      usageEstimated,
      provider: readProvider(body.provider),
    },
  };
}

export function createOpenRouterClient(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: FetchLike;
  /** Test hook. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Test hook for Retry-After HTTP dates. Defaults to Date.now. */
  now?: () => number;
  /** Test hook. Defaults to Math.random so live waits are ±20% of the base delay. */
  random?: () => number;
}): ChatClient {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    async complete(request: ChatRequest): Promise<ChatResponse> {
      let lastRetry: Extract<AttemptOutcome, { kind: 'retry' }> | null = null;
      for (let attempt = 1; attempt <= OPENROUTER_MAX_ATTEMPTS; attempt += 1) {
        const outcome = await attemptOnce({ request, apiKey: options.apiKey, endpoint, fetchImpl });
        if (outcome.kind === 'done') return outcome.response;
        lastRetry = outcome;
        if (attempt === OPENROUTER_MAX_ATTEMPTS) break;
        await sleep(retryDelayMs(attempt, outcome.retryAfter, now(), random));
      }
      const failed = lastRetry as Extract<AttemptOutcome, { kind: 'retry' }>;
      throw new OpenRouterCallError(
        `OpenRouter request failed (${failed.status}) after ${OPENROUTER_MAX_ATTEMPTS} attempts: ${failed.detail}`,
        failed.usage,
      );
    },
  };
}
