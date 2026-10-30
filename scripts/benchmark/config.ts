/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConfigError } from './errors';
import {
  DEFAULT_RUN_LABEL,
  OCEAN_TRAITS,
  REASONING_EFFORTS,
  RUN_LABEL_MAX_LENGTH,
  type BenchmarkConfig,
  type Confidence,
  type ModelConfig,
  type OceanTrait,
  type PricedModel,
  type ProviderRoute,
  type ReasoningEffort,
} from './types';

const BENCHMARK_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(BENCHMARK_DIR, '../..');
export const DEFAULT_CONFIG_PATH = path.join(BENCHMARK_DIR, 'config.json');

const CONFIDENCE_VALUES: Confidence[] = ['normal', 'low', 'not_scored'];

export function resolveRepoPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`${label} must be a finite number`);
  }
  return value;
}

function parseModel(value: unknown, index: number): ModelConfig {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new ConfigError(`models[${index}].id is required`);
  }
  if (typeof value.enabled !== 'boolean') {
    throw new ConfigError(`models[${index}].enabled must be a boolean`);
  }
  const provider = parseProviderRoute(value.provider, index);
  return {
    id: value.id,
    enabled: value.enabled,
    inputPerMillionUsd: parsePrice(value.inputPerMillionUsd, `models[${index}].inputPerMillionUsd`),
    outputPerMillionUsd: parsePrice(value.outputPerMillionUsd, `models[${index}].outputPerMillionUsd`),
    ...(provider ? { provider } : {}),
  };
}

function parseProviderRoute(value: unknown, index: number): ProviderRoute | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new ConfigError(`models[${index}].provider must be an object`);
  }
  const allowed = new Set(['order', 'allow_fallbacks']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ConfigError(`models[${index}].provider.${key} is not supported. Use order and allow_fallbacks.`);
    }
  }
  const route: ProviderRoute = {};
  if ('order' in value) {
    if (!Array.isArray(value.order) || value.order.length === 0) {
      throw new ConfigError(`models[${index}].provider.order must be a non-empty array of provider names`);
    }
    const order: string[] = [];
    for (const entry of value.order) {
      if (typeof entry !== 'string' || entry.trim() === '') {
        throw new ConfigError(`models[${index}].provider.order entries must be non-empty strings`);
      }
      const name = entry.trim();
      if (order.includes(name)) {
        throw new ConfigError(`models[${index}].provider.order repeats ${name}`);
      }
      order.push(name);
    }
    route.order = order;
  }
  if ('allow_fallbacks' in value) {
    if (typeof value.allow_fallbacks !== 'boolean') {
      throw new ConfigError(`models[${index}].provider.allow_fallbacks must be a boolean`);
    }
    route.allow_fallbacks = value.allow_fallbacks;
  }
  if (route.order === undefined && route.allow_fallbacks === undefined) {
    throw new ConfigError(`models[${index}].provider needs order or allow_fallbacks`);
  }
  return route;
}

function parseRunLabel(value: unknown): string {
  if (value === undefined) return DEFAULT_RUN_LABEL;
  if (typeof value !== 'string') {
    throw new ConfigError('run_label must be a string');
  }
  const label = value.trim();
  if (label.length === 0) {
    throw new ConfigError('run_label must be a non-empty string');
  }
  if (label.length > RUN_LABEL_MAX_LENGTH) {
    throw new ConfigError(`run_label must be at most ${RUN_LABEL_MAX_LENGTH} characters`);
  }
  if (/[\r\n]/.test(label)) {
    throw new ConfigError('run_label must be a single line');
  }
  return label;
}

function parseJudgeMinIntervalMs(value: unknown): number {
  if (value === undefined) return 750;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 60_000) {
    throw new ConfigError('judgeMinIntervalMs must be an integer from 0 through 60000');
  }
  return value;
}

function parsePrice(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ConfigError(`${label} must be a non-negative number or null`);
  }
  return value;
}

export function parseConfig(value: unknown): BenchmarkConfig {
  if (!isRecord(value)) {
    throw new ConfigError('Benchmark config must be a JSON object');
  }
  if (typeof value.priceDate !== 'string' || !value.priceDate.trim()) {
    throw new ConfigError('priceDate is required');
  }
  const runLabel = parseRunLabel(value.run_label);
  const judgeMinIntervalMs = parseJudgeMinIntervalMs(value.judgeMinIntervalMs);
  if (typeof value.baseUrl !== 'string' || !value.baseUrl.startsWith('https://')) {
    throw new ConfigError('baseUrl must be an https URL');
  }
  if (!isRecord(value.interview)) {
    throw new ConfigError('interview settings are required');
  }
  const systemPromptRaw = value.interview.systemPrompt;
  if (systemPromptRaw !== null && typeof systemPromptRaw !== 'string') {
    throw new ConfigError('interview.systemPrompt must be a string or null');
  }
  const systemPrompt: string | null = typeof systemPromptRaw === 'string' ? systemPromptRaw : null;
  const temperature = requireNumber(value.interview.temperature, 'interview.temperature');
  if (temperature === 0) {
    throw new ConfigError(
      'interview.temperature must not be 0; identical greedy samples would make repeats meaningless',
    );
  }
  if (temperature < 0 || temperature > 2) {
    throw new ConfigError('interview.temperature must be between 0 and 2, excluding 0');
  }
  const maxOutputTokens = requireNumber(value.interview.maxOutputTokens, 'interview.maxOutputTokens');
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new ConfigError('interview.maxOutputTokens must be a positive integer');
  }
  const retryMaxOutputTokens = requireNumber(value.interview.retryMaxOutputTokens, 'interview.retryMaxOutputTokens');
  if (!Number.isInteger(retryMaxOutputTokens) || retryMaxOutputTokens <= maxOutputTokens) {
    throw new ConfigError('interview.retryMaxOutputTokens must be an integer greater than interview.maxOutputTokens');
  }
  const reasoningEffort = value.interview.reasoningEffort;
  if (typeof reasoningEffort !== 'string' || !REASONING_EFFORTS.includes(reasoningEffort as ReasoningEffort)) {
    throw new ConfigError(`interview.reasoningEffort must be one of ${REASONING_EFFORTS.join(', ')}`);
  }
  const repeats = requireNumber(value.interview.repeats, 'interview.repeats');
  if (!Number.isInteger(repeats) || repeats <= 0) {
    throw new ConfigError('interview.repeats must be a positive integer');
  }

  if (!isRecord(value.judge)) {
    throw new ConfigError('judge settings are required');
  }
  const judgeModelId = value.judge.modelId;
  if (typeof judgeModelId !== 'string' || !judgeModelId.trim()) {
    throw new ConfigError('judge.modelId is required');
  }
  const judgeTemperature = requireNumber(value.judge.temperature, 'judge.temperature');
  const judgeMaxOutputTokens = requireNumber(value.judge.maxOutputTokens, 'judge.maxOutputTokens');
  if (!Number.isInteger(judgeMaxOutputTokens) || judgeMaxOutputTokens <= 0) {
    throw new ConfigError('judge.maxOutputTokens must be a positive integer');
  }
  if (judgeMaxOutputTokens !== maxOutputTokens) {
    throw new ConfigError(
      'judge.maxOutputTokens must equal interview.maxOutputTokens so every model and the judge share one output cap',
    );
  }
  const judgeVersionRaw = value.judge.version;
  if (judgeVersionRaw !== null && typeof judgeVersionRaw !== 'string') {
    throw new ConfigError('judge.version must be a string or null');
  }
  const judgeVersion: string | null = typeof judgeVersionRaw === 'string' ? judgeVersionRaw : null;

  if (!isRecord(value.limits)) {
    throw new ConfigError('limits are required');
  }
  const warnPerRunUsd = requireNumber(value.limits.warnPerRunUsd, 'limits.warnPerRunUsd');
  const hardStopPerRunUsd = requireNumber(value.limits.hardStopPerRunUsd, 'limits.hardStopPerRunUsd');
  const warnPerMonthUsd = requireNumber(value.limits.warnPerMonthUsd, 'limits.warnPerMonthUsd');
  if (hardStopPerRunUsd < 0 || warnPerRunUsd < 0 || warnPerMonthUsd < 0) {
    throw new ConfigError('cost limits must be non-negative');
  }

  const maxEnabledModels = requireNumber(value.maxEnabledModels, 'maxEnabledModels');
  if (!Number.isInteger(maxEnabledModels) || maxEnabledModels < 1) {
    throw new ConfigError('maxEnabledModels must be a positive integer');
  }

  const wideRangeThreshold = requireNumber(value.wideRangeThreshold, 'wideRangeThreshold');
  const spreadThreshold = requireNumber(value.spreadThreshold, 'spreadThreshold');
  if (!isRecord(value.traitConfidence)) {
    throw new ConfigError('traitConfidence map is required');
  }
  const traitConfidence = {} as Record<OceanTrait, Confidence>;
  for (const trait of OCEAN_TRAITS) {
    const confidence = value.traitConfidence[trait];
    if (typeof confidence !== 'string' || !CONFIDENCE_VALUES.includes(confidence as Confidence)) {
      throw new ConfigError(`traitConfidence.${trait} must be normal, low, or not_scored`);
    }
    traitConfidence[trait] = confidence as Confidence;
  }

  if (!isRecord(value.paths)) {
    throw new ConfigError('paths.scoreFile and paths.ledger are required');
  }
  const scoreFile = value.paths.scoreFile;
  const ledger = value.paths.ledger;
  if (typeof scoreFile !== 'string' || typeof ledger !== 'string') {
    throw new ConfigError('paths.scoreFile and paths.ledger are required');
  }
  if (!Array.isArray(value.models) || value.models.length === 0) {
    throw new ConfigError('models must be a non-empty array');
  }
  const models = value.models.map((model, index) => parseModel(model, index));
  const ids = new Set<string>();
  for (const model of models) {
    if (ids.has(model.id)) {
      throw new ConfigError(`duplicate model id ${model.id}`);
    }
    ids.add(model.id);
  }
  const enabledCount = models.filter((model) => model.enabled).length;
  if (enabledCount > maxEnabledModels) {
    throw new ConfigError(
      `At most ${maxEnabledModels} models may be enabled (found ${enabledCount}).`,
    );
  }

  const config: BenchmarkConfig = {
    priceDate: value.priceDate,
    baseUrl: value.baseUrl.replace(/\/$/, ''),
    interview: {
      systemPrompt: systemPrompt === null || systemPrompt.trim() === '' ? null : systemPrompt,
      temperature,
      maxOutputTokens,
      retryMaxOutputTokens,
      reasoningEffort: reasoningEffort as ReasoningEffort,
      repeats,
    },
    judge: {
      modelId: judgeModelId,
      temperature: judgeTemperature,
      maxOutputTokens: judgeMaxOutputTokens,
      version: judgeVersion,
    },
    limits: { warnPerRunUsd, hardStopPerRunUsd, warnPerMonthUsd },
    maxEnabledModels,
    judgeMinIntervalMs,
    runLabel,
    wideRangeThreshold,
    spreadThreshold,
    traitConfidence,
    paths: {
      scoreFile,
      ledger,
    },
    models,
  };
  priceOf(config, config.judge.modelId);
  return config;
}

export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): BenchmarkConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new ConfigError(`Could not read benchmark config at ${configPath}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`Benchmark config is not valid JSON: ${(error as Error).message}`);
  }
  return parseConfig(parsed);
}

export function isPriced(model: ModelConfig): model is ModelConfig & PricedModel {
  return (
    model.enabled &&
    model.inputPerMillionUsd !== null &&
    model.outputPerMillionUsd !== null &&
    Number.isFinite(model.inputPerMillionUsd) &&
    Number.isFinite(model.outputPerMillionUsd)
  );
}

export function runnableModels(config: BenchmarkConfig): PricedModel[] {
  return config.models.filter(isPriced).map((model) => ({
    id: model.id,
    inputPerMillionUsd: model.inputPerMillionUsd as number,
    outputPerMillionUsd: model.outputPerMillionUsd as number,
  }));
}

export function skippedModels(config: BenchmarkConfig): Array<{ id: string; reason: string }> {
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const model of config.models) {
    if (!model.enabled) {
      skipped.push({ id: model.id, reason: 'disabled' });
      continue;
    }
    if (model.inputPerMillionUsd === null || model.outputPerMillionUsd === null) {
      skipped.push({ id: model.id, reason: 'no price' });
    }
  }
  return skipped;
}

export function priceOf(config: BenchmarkConfig, modelId: string): PricedModel {
  const model = config.models.find((candidate) => candidate.id === modelId);
  if (!model || model.inputPerMillionUsd === null || model.outputPerMillionUsd === null) {
    throw new ConfigError(`No USD price configured for ${modelId}; the model is skipped and cannot be called`);
  }
  return {
    id: model.id,
    inputPerMillionUsd: model.inputPerMillionUsd,
    outputPerMillionUsd: model.outputPerMillionUsd,
  };
}
