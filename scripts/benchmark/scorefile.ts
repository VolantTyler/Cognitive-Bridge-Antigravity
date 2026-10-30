/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import type { OceanScores } from '../../src/types';
import { aggregateTraits, failedMostRuns, hasWideRange, spreadWarning, traitSpreads } from './aggregate';
import { JudgeMixError, ScoreFileSchemaError } from './errors';
import { STRATEGY_TABLE } from './match';
import {
  HYPOTHESIS_LABEL,
  OCEAN_TRAITS,
  SCORE_FILE_SCHEMA_VERSION,
  type Confidence,
  type ModelScore,
  type OceanTrait,
  type ReasoningEffort,
  type ScoreFile,
  type ScoreRun,
  type StrategyRow,
} from './types';

const CONFIDENCE_VALUES: Confidence[] = ['normal', 'low', 'not_scored'];

export interface AttemptFailure {
  repeat: number;
  scenarioId: string | null;
  kind: 'interview' | 'judge';
  reason: string;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
}

export interface CompletedModelRun {
  id: string;
  repeats: Array<{
    repeat: number;
    modelVersion: string;
    judgeVersion: string;
    recordedAt?: string;
    maxOutputTokens?: number;
    reasoningEffort?: ReasoningEffort;
    scores: OceanScores;
  }>;
  failures?: AttemptFailure[];
  configuredRepeats?: number;
  costUsd: number;
  timestamp: string;
}

export function assertJudgeMixAllowed(options: {
  stored: { modelId: string; version: string } | null;
  configJudge: { modelId: string; version: string | null };
  rescoreAll: boolean;
}): void {
  if (!options.stored || options.rescoreAll) return;
  const storedLabel = `${options.stored.version} (${options.stored.modelId})`;
  if (options.stored.modelId !== options.configJudge.modelId) {
    throw new JudgeMixError(
      `Stored judge version "${storedLabel}" differs from the current config (${options.configJudge.modelId}). Refusing to mix scores. Re-run with --rescore-all.`,
    );
  }
  if (options.configJudge.version && options.stored.version !== options.configJudge.version) {
    throw new JudgeMixError(
      `Stored judge version "${options.stored.version}" differs from the current config (${options.configJudge.version}). Refusing to mix scores. Re-run with --rescore-all.`,
    );
  }
}

export function versionsAgree(observed: string | null, next: string): void {
  if (observed !== null && observed !== next) {
    throw new JudgeMixError(
      `Stored judge version "${observed}" differs from the judge version just returned ("${next}"). Refusing to mix scores. Re-run with --rescore-all.`,
    );
  }
}

function summarizeVersion(runs: ScoreRun[]): string {
  const unique: string[] = [];
  for (const run of runs) {
    if (!unique.includes(run.model_version)) unique.push(run.model_version);
  }
  return unique.join(', ');
}

export function buildScoreFile(input: {
  models: CompletedModelRun[];
  judge: { modelId: string; version: string; temperature: number; recordedAt?: string };
  interviewTemperature: number;
  repeats: number;
  generatedAt: string;
  priceDate: string;
  wideRangeThreshold: number;
  spreadThreshold: number;
  traitConfidence: Record<OceanTrait, Confidence>;
  partial?: boolean;
  strategyTable?: StrategyRow[];
  outputBudget?: { maxOutputTokens: number; retryMaxOutputTokens: number; reasoningEffort: ReasoningEffort };
}): ScoreFile {
  const strategyTable = input.strategyTable ?? STRATEGY_TABLE;
  const outputBudget = input.outputBudget ?? {
    maxOutputTokens: 8192,
    retryMaxOutputTokens: 16384,
    reasoningEffort: 'minimal' as const,
  };
  const models: ModelScore[] = input.models.map((model) => {
    const failures = model.failures ?? [];
    const configuredRepeats = model.configuredRepeats ?? input.repeats;
    const failedRepeats = new Set(failures.map((failure) => failure.repeat));
    const runs: ScoreRun[] = model.repeats.map((repeat) => ({
      repeat: repeat.repeat,
      model_version: repeat.modelVersion,
      judge_version: repeat.judgeVersion,
      recorded_at: repeat.recordedAt ?? model.timestamp,
      max_output_tokens: repeat.maxOutputTokens ?? outputBudget.maxOutputTokens,
      reasoning_effort: repeat.reasoningEffort ?? outputBudget.reasoningEffort,
      scores: repeat.scores,
    }));
    const traits = aggregateTraits(
      runs.map((run) => run.scores),
      input.traitConfidence,
      input.wideRangeThreshold,
      configuredRepeats,
    );
    const failedRuns = failedRepeats.size;
    const majorityFailed = failedMostRuns(failedRuns, configuredRepeats);
    if (majorityFailed) {
      for (const trait of OCEAN_TRAITS) {
        traits[trait] = { ...traits[trait], confidence: 'not_scored' };
      }
    }
    const reasonText = failures.map((failure) => failure.reason).filter((reason, index, all) => all.indexOf(reason) === index);
    return {
      id: model.id,
      version: summarizeVersion(runs) || model.id,
      timestamp: model.timestamp,
      cost_usd: model.costUsd,
      wide_range: hasWideRange(traits),
      fewer_runs: runs.length < configuredRepeats,
      scored_runs: runs.length,
      failed_runs: failedRuns,
      not_scored_reason: majorityFailed
        ? `Failed ${failedRuns} of ${configuredRepeats} runs. ${reasonText.join(' ') || 'No successful scored repeat.'}`
        : null,
      failures: failures.map((failure) => ({
        repeat: failure.repeat,
        scenario_id: failure.scenarioId,
        kind: failure.kind,
        reason: failure.reason,
        max_output_tokens: failure.maxOutputTokens,
        reasoning_effort: failure.reasoningEffort,
      })),
      traits,
      runs,
    };
  });
  const spreads = traitSpreads(models.filter((model) => model.not_scored_reason === null).map((model) => model.traits));
  return {
    schema_version: SCORE_FILE_SCHEMA_VERSION,
    label: HYPOTHESIS_LABEL,
    spread_warning: spreadWarning(spreads, input.spreadThreshold),
    spread_threshold: input.spreadThreshold,
    wide_range_threshold: input.wideRangeThreshold,
    trait_spread: spreads,
    generated_at: input.generatedAt,
    price_date: input.priceDate,
    interview_temperature: input.interviewTemperature,
    repeats: input.repeats,
    partial: input.partial ?? false,
    output_budget: {
      max_output_tokens: outputBudget.maxOutputTokens,
      retry_max_output_tokens: outputBudget.retryMaxOutputTokens,
      reasoning_effort: outputBudget.reasoningEffort,
    },
    judge: {
      model_id: input.judge.modelId,
      version: input.judge.version,
      recorded_at: input.judge.recordedAt ?? input.generatedAt,
      temperature: input.judge.temperature,
    },
    strategy_table: strategyTable,
    confidence_policy: {
      published_trait_confidence: input.traitConfidence,
    },
    models,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireField(record: Record<string, unknown>, key: string, context: string): unknown {
  if (!(key in record)) {
    throw new ScoreFileSchemaError(`${context} is missing ${key}`);
  }
  return record[key];
}

export function validateScoreFile(value: unknown): asserts value is ScoreFile {
  if (!isRecord(value)) {
    throw new ScoreFileSchemaError('Score file must be a JSON object');
  }
  if (value.schema_version !== SCORE_FILE_SCHEMA_VERSION) {
    throw new ScoreFileSchemaError(
      `schema_version must be ${SCORE_FILE_SCHEMA_VERSION} (found ${String(value.schema_version)}). Delete the existing scores.json and re-run the benchmark. This run does not merge an older score file.`,
    );
  }
  if (value.label !== HYPOTHESIS_LABEL) {
    throw new ScoreFileSchemaError('label must be the design-hypothesis label');
  }
  if (typeof value.spread_warning !== 'boolean') {
    throw new ScoreFileSchemaError('spread_warning must be a boolean');
  }
  if (!Array.isArray(value.strategy_table) || value.strategy_table.length === 0) {
    throw new ScoreFileSchemaError('strategy_table is required');
  }
  for (const row of value.strategy_table) {
    if (!isRecord(row) || typeof row.exclude_from_tiering !== 'boolean') {
      throw new ScoreFileSchemaError('each strategy_table row needs exclude_from_tiering');
    }
    if (row.exclusion_reason !== null && typeof row.exclusion_reason !== 'string') {
      throw new ScoreFileSchemaError(
        'each strategy_table row needs exclusion_reason (string or null). Delete the existing scores.json and re-run the benchmark.',
      );
    }
  }
  if (!isRecord(value.confidence_policy) || !isRecord(value.confidence_policy.published_trait_confidence)) {
    throw new ScoreFileSchemaError('confidence_policy.published_trait_confidence is required');
  }
  if (!isRecord(value.judge) || typeof value.judge.model_id !== 'string' || typeof value.judge.version !== 'string') {
    throw new ScoreFileSchemaError('judge.model_id and judge.version are required');
  }
  if (typeof value.judge.temperature !== 'number') {
    throw new ScoreFileSchemaError('judge.temperature is required');
  }
  if (typeof value.judge.recorded_at !== 'string' || !value.judge.recorded_at) {
    throw new ScoreFileSchemaError('judge.recorded_at is required alongside judge.version');
  }
  if (!isRecord(value.output_budget)) {
    throw new ScoreFileSchemaError('output_budget is required');
  }
  if (typeof value.output_budget.max_output_tokens !== 'number' || typeof value.output_budget.retry_max_output_tokens !== 'number') {
    throw new ScoreFileSchemaError('output_budget max_output_tokens and retry_max_output_tokens are required');
  }
  if (typeof value.output_budget.reasoning_effort !== 'string' || !value.output_budget.reasoning_effort) {
    throw new ScoreFileSchemaError('output_budget.reasoning_effort is required');
  }
  if (!Array.isArray(value.models)) {
    throw new ScoreFileSchemaError('models must be an array');
  }
  for (const model of value.models) {
    if (!isRecord(model) || typeof model.id !== 'string' || typeof model.version !== 'string') {
      throw new ScoreFileSchemaError('each model needs id and version');
    }
    if (typeof model.timestamp !== 'string' || typeof model.cost_usd !== 'number' || typeof model.wide_range !== 'boolean') {
      throw new ScoreFileSchemaError(`model ${String(model.id)} needs timestamp, cost_usd, and wide_range`);
    }
    if (typeof model.fewer_runs !== 'boolean' || typeof model.scored_runs !== 'number' || typeof model.failed_runs !== 'number') {
      throw new ScoreFileSchemaError(`model ${String(model.id)} needs fewer_runs, scored_runs, and failed_runs`);
    }
    if (model.not_scored_reason !== null && typeof model.not_scored_reason !== 'string') {
      throw new ScoreFileSchemaError(`model ${String(model.id)} not_scored_reason must be a string or null`);
    }
    if (!Array.isArray(model.failures)) {
      throw new ScoreFileSchemaError(`model ${String(model.id)} failures must be an array`);
    }
    if (!isRecord(model.traits)) {
      throw new ScoreFileSchemaError(`model ${model.id} is missing traits`);
    }
    for (const trait of OCEAN_TRAITS) {
      const stats = requireField(model.traits, trait, `model ${model.id}`);
      if (!isRecord(stats)) {
        throw new ScoreFileSchemaError(`model ${model.id} trait ${trait} must be an object`);
      }
      for (const key of ['mean', 'low', 'high', 'runs', 'confidence'] as const) {
        requireField(stats, key, `model ${model.id} trait ${trait}`);
      }
      if (typeof stats.runs !== 'number') {
        throw new ScoreFileSchemaError(`model ${model.id} trait ${trait} runs must be a number`);
      }
      if (typeof stats.confidence !== 'string' || !CONFIDENCE_VALUES.includes(stats.confidence as Confidence)) {
        throw new ScoreFileSchemaError(`model ${model.id} trait ${trait} confidence is invalid`);
      }
      if (typeof stats.wide_range !== 'boolean') {
        throw new ScoreFileSchemaError(`model ${model.id} trait ${trait} wide_range must be a boolean`);
      }
      if (typeof stats.fewer_runs !== 'boolean') {
        throw new ScoreFileSchemaError(`model ${model.id} trait ${trait} fewer_runs must be a boolean`);
      }
      const measured = stats.confidence !== 'not_scored' && stats.runs > 0;
      for (const key of ['mean', 'low', 'high'] as const) {
        const numeric = stats[key];
        if (measured && typeof numeric !== 'number') {
          throw new ScoreFileSchemaError(`model ${model.id} trait ${trait} ${key} must be a number when scored`);
        }
      }
    }
    if (!Array.isArray(model.runs)) {
      throw new ScoreFileSchemaError(`model ${model.id} runs must be an array`);
    }
    for (const run of model.runs) {
      if (!isRecord(run) || typeof run.model_version !== 'string' || typeof run.judge_version !== 'string') {
        throw new ScoreFileSchemaError(`model ${model.id} runs must record model_version and judge_version`);
      }
      if (typeof run.recorded_at !== 'string' || !run.recorded_at) {
        throw new ScoreFileSchemaError(`model ${model.id} runs must record recorded_at beside judge_version`);
      }
      if (typeof run.max_output_tokens !== 'number' || typeof run.reasoning_effort !== 'string' || !run.reasoning_effort) {
        throw new ScoreFileSchemaError(`model ${model.id} runs must record max_output_tokens and reasoning_effort`);
      }
      if (!isRecord(run.scores)) {
        throw new ScoreFileSchemaError(`model ${model.id} run is missing scores`);
      }
      for (const trait of OCEAN_TRAITS) {
        if (typeof run.scores[trait] !== 'number') {
          throw new ScoreFileSchemaError(`model ${model.id} run scores.${trait} must be a number`);
        }
      }
    }
  }
}

export function readScoreFile(filePath: string): ScoreFile | null {
  if (!fs.existsSync(filePath)) return null;
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateScoreFile(parsed);
  return parsed;
}

export function writeScoreFile(filePath: string, scoreFile: ScoreFile): void {
  validateScoreFile(scoreFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(scoreFile, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}
