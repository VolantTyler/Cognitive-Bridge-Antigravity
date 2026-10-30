/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { OceanScores } from '../../../src/types';
import { parseConfig } from '../config';
import type { BenchmarkConfig, ChatClient, ChatRequest, ChatResponse, OceanTrait } from '../types';
import { OCEAN_TRAITS } from '../types';

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cb-benchmark-'));
}

export function neutralScores(overrides: Partial<OceanScores> = {}): OceanScores {
  return {
    openness: 50,
    conscientiousness: 50,
    extroversion: 50,
    agreeableness: 50,
    neuroticism: 50,
    ...overrides,
  };
}

export function scoresFor(trait: OceanTrait, values: number[]): OceanScores[] {
  return values.map((value) => neutralScores({ [trait]: value }));
}

export function testConfig(patch?: {
  models?: BenchmarkConfig['models'];
  repeats?: number;
  temperature?: number;
  systemPrompt?: string | null;
  maxOutputTokens?: number;
  retryMaxOutputTokens?: number;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
  judgeMaxOutputTokens?: number;
  judgeVersion?: string | null;
  judgeModelId?: string;
  hardStopPerRunUsd?: number;
  warnPerRunUsd?: number;
  warnPerMonthUsd?: number;
  maxEnabledModels?: number;
  judgeMinIntervalMs?: number;
  runLabel?: string;
  wideRangeThreshold?: number;
  spreadThreshold?: number;
  traitConfidence?: BenchmarkConfig['traitConfidence'];
}): BenchmarkConfig {
  const traitConfidence = patch?.traitConfidence ?? {
    openness: 'normal' as const,
    conscientiousness: 'normal' as const,
    extroversion: 'normal' as const,
    agreeableness: 'normal' as const,
    neuroticism: 'normal' as const,
  };
  return parseConfig({
    priceDate: '2026-10-05',
    baseUrl: 'https://openrouter.ai/api/v1',
    interview: {
      systemPrompt: patch?.systemPrompt === undefined ? null : patch.systemPrompt,
      temperature: patch?.temperature ?? 0.8,
      maxOutputTokens: patch?.maxOutputTokens ?? 32,
      retryMaxOutputTokens: patch?.retryMaxOutputTokens ?? ((patch?.maxOutputTokens ?? 32) * 2),
      reasoningEffort: patch?.reasoningEffort ?? 'minimal',
      repeats: patch?.repeats ?? 1,
    },
    judge: {
      modelId: patch?.judgeModelId ?? 'google/gemini-2.5-flash-lite',
      temperature: 0,
      maxOutputTokens: patch?.judgeMaxOutputTokens ?? patch?.maxOutputTokens ?? 32,
      version: patch?.judgeVersion ?? null,
    },
    limits: {
      warnPerRunUsd: patch?.warnPerRunUsd ?? 10,
      hardStopPerRunUsd: patch?.hardStopPerRunUsd ?? 15,
      warnPerMonthUsd: patch?.warnPerMonthUsd ?? 40,
    },
    maxEnabledModels: patch?.maxEnabledModels ?? 12,
    judgeMinIntervalMs: patch?.judgeMinIntervalMs ?? 0,
    run_label: patch?.runLabel,
    wideRangeThreshold: patch?.wideRangeThreshold ?? 40,
    spreadThreshold: patch?.spreadThreshold ?? 10,
    traitConfidence,
    paths: { scoreFile: 'unused.json', ledger: 'unused.jsonl' },
    models: patch?.models ?? [
      { id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 },
      { id: 'google/gemini-2.5-flash-lite', enabled: true, inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
    ],
  });
}

export function scoreText(scores: OceanScores): string {
  return `JSON_SCORES:\n${JSON.stringify(scores)}`;
}

export function recordingClient(options?: {
  scores?: OceanScores;
  judgeVersion?: string;
  promptTokens?: number;
  completionTokens?: number;
  judgeContent?: (callIndex: number, request: ChatRequest) => string;
}): { client: ChatClient; calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  let judges = 0;
  const client: ChatClient = {
    async complete(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request);
      const promptTokens = options?.promptTokens ?? 10;
      const completionTokens = options?.completionTokens ?? 20;
      if (request.kind === 'judge') {
        judges += 1;
        const content = options?.judgeContent
          ? options.judgeContent(judges, request)
          : scoreText(options?.scores ?? neutralScores({ openness: 80 }));
        return {
          content,
          modelVersion: options?.judgeVersion ?? 'google/gemini-2.5-flash-lite-2026-10-05',
          promptTokens,
          completionTokens,
          usageEstimated: false,
          provider: null,
        };
      }
      return {
        content: 'I would cancel the demo and fix the root cause before anyone sees it.',
        modelVersion: `${request.model}-2026-10-05`,
        promptTokens,
        completionTokens,
        usageEstimated: false,
        provider: null,
      };
    },
  };
  return { client, calls };
}

export const ALL_TRAITS: OceanTrait[] = [...OCEAN_TRAITS];
