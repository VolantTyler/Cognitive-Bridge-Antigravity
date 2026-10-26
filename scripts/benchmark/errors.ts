/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class ConfigError extends Error {
  readonly code = 'CONFIG';
}

export class HardStopError extends Error {
  readonly code = 'HARD_STOP';
}

export class JudgeMixError extends Error {
  readonly code = 'JUDGE_MIX';
}

export class OpenRouterError extends Error {
  readonly code = 'OPENROUTER';
}

/** HTTP 200 whose assistant text is empty because the completion cap was spent. */
export class TruncatedOutputError extends OpenRouterError {
  readonly modelId: string;
  readonly finishReason: string;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly reasoningTokens: number | null;

  constructor(details: {
    modelId: string;
    finishReason: string;
    promptTokens: number | null;
    completionTokens: number | null;
    reasoningTokens: number | null;
  }) {
    super(
      `OpenRouter truncated ${details.modelId}: finish_reason ${details.finishReason}, ` +
        `completion_tokens ${details.completionTokens ?? 'unknown'}, ` +
        `reasoning_tokens ${details.reasoningTokens ?? 'unknown'}. The response had no assistant text.`,
    );
    this.name = 'TruncatedOutputError';
    this.modelId = details.modelId;
    this.finishReason = details.finishReason;
    this.promptTokens = details.promptTokens;
    this.completionTokens = details.completionTokens;
    this.reasoningTokens = details.reasoningTokens;
  }
}

/** A call failed and, when the body included usage, those token counts are attached. */
export class OpenRouterCallError extends OpenRouterError {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly usageKnown: boolean;

  constructor(message: string, usage?: { promptTokens: number; completionTokens: number } | null) {
    super(message);
    this.name = 'OpenRouterCallError';
    this.promptTokens = usage?.promptTokens ?? null;
    this.completionTokens = usage?.completionTokens ?? null;
    this.usageKnown = usage != null;
  }
}

export class AllModelsFailedError extends Error {
  readonly code = 'ALL_MODELS_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'AllModelsFailedError';
  }
}

export interface KnownUsage {
  promptTokens: number;
  completionTokens: number;
}

export function usageFromError(error: unknown): KnownUsage | null {
  if (error instanceof TruncatedOutputError) {
    if (error.promptTokens === null || error.completionTokens === null) return null;
    return { promptTokens: error.promptTokens, completionTokens: error.completionTokens };
  }
  if (error instanceof OpenRouterCallError && error.usageKnown && error.promptTokens !== null && error.completionTokens !== null) {
    return { promptTokens: error.promptTokens, completionTokens: error.completionTokens };
  }
  return null;
}

export class ScoreFileSchemaError extends Error {
  readonly code = 'SCORE_FILE_SCHEMA';
}
