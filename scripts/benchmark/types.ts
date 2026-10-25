/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OceanScores } from '../../src/types';

export const SCORE_FILE_SCHEMA_VERSION = 2;

export const HYPOTHESIS_LABEL = 'design hypothesis based on research';

export const OCEAN_TRAITS = [
  'openness',
  'conscientiousness',
  'extroversion',
  'agreeableness',
  'neuroticism',
] as const;

export type OceanTrait = (typeof OCEAN_TRAITS)[number];

export type Confidence = 'normal' | 'low' | 'not_scored';

export type TargetDirection = 'high' | 'low';

export type AlignmentStrategy = 'congruent' | 'complementary' | 'compensatory';

export type Tier = 'strong' | 'decent' | 'poor' | 'not_scored';

export interface ModelConfig {
  id: string;
  enabled: boolean;
  /** USD per 1,000,000 input tokens. Null skips the model. */
  inputPerMillionUsd: number | null;
  /** USD per 1,000,000 output tokens. Null skips the model. */
  outputPerMillionUsd: number | null;
}

export interface BenchmarkConfig {
  priceDate: string;
  baseUrl: string;
  interview: {
    /** Null means no system message is sent to candidate models. */
    systemPrompt: string | null;
    temperature: number;
    maxOutputTokens: number;
    repeats: number;
  };
  judge: {
    modelId: string;
    temperature: number;
    maxOutputTokens: number;
    /** Optional pin. When set, a stored score file with a different version cannot be mixed. */
    version: string | null;
  };
  limits: {
    warnPerRunUsd: number;
    hardStopPerRunUsd: number;
    warnPerMonthUsd: number;
  };
  wideRangeThreshold: number;
  spreadThreshold: number;
  /** Published confidence copied onto each model's trait stats in the score file. */
  traitConfidence: Record<OceanTrait, Confidence>;
  paths: {
    scoreFile: string;
    ledger: string;
  };
  models: ModelConfig[];
}

export interface Scenario {
  id: string;
  text: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  kind: 'interview' | 'judge';
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  scenarioId?: string;
  repeat?: number;
}

export interface ChatResponse {
  content: string;
  /** Exact model id/version string returned by the API. */
  modelVersion: string;
  promptTokens: number;
  completionTokens: number;
  usageEstimated: boolean;
}

export interface ChatClient {
  complete(request: ChatRequest): Promise<ChatResponse>;
}

export interface PricedModel {
  id: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export interface TraitStats {
  mean: number | null;
  low: number | null;
  high: number | null;
  runs: number;
  confidence: Confidence;
  /** True when this trait's high-low range meets the wide-range threshold. */
  wide_range: boolean;
}

export interface ScoreRun {
  repeat: number;
  model_version: string;
  /** `model` string from the judge response. Often the requested id, not a dated build. */
  judge_version: string;
  /** UTC time of this scoring call, stored beside the judge version string. */
  recorded_at: string;
  scores: OceanScores;
}

export interface StrategyRow {
  trait: OceanTrait;
  threshold: 'high' | 'low';
  strategy: AlignmentStrategy;
  target_direction: TargetDirection | null;
  confidence: Confidence;
  exclude_from_tiering: boolean;
}

export interface ModelScore {
  id: string;
  version: string;
  timestamp: string;
  cost_usd: number;
  wide_range: boolean;
  traits: Record<OceanTrait, TraitStats>;
  runs: ScoreRun[];
}

export interface ScoreFile {
  schema_version: number;
  label: typeof HYPOTHESIS_LABEL;
  spread_warning: boolean;
  spread_threshold: number;
  wide_range_threshold: number;
  trait_spread: Record<OceanTrait, number | null>;
  generated_at: string;
  price_date: string;
  interview_temperature: number;
  repeats: number;
  partial: boolean;
  judge: {
    model_id: string;
    /** Value of the OpenRouter response `model` field. */
    version: string;
    /** UTC time of this benchmark run. The version string may not change across runs. */
    recorded_at: string;
    temperature: number;
  };
  strategy_table: StrategyRow[];
  confidence_policy: {
    published_trait_confidence: Record<OceanTrait, Confidence>;
  };
  models: ModelScore[];
}

export interface LedgerEntry {
  ts: string;
  run_id: string;
  model_id: string;
  kind: 'interview' | 'judge';
  scenario_id: string | null;
  repeat: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  estimated: boolean;
}

export interface AppliedTarget extends StrategyRow {
  user_score: number;
}

export interface MatchTraitResult {
  strategy: AlignmentStrategy;
  target_direction: TargetDirection | null;
  confidence: Confidence;
  included_in_tier: boolean;
  user_score: number;
  model_mean: number | null;
  model_low: number | null;
  model_high: number | null;
}

export interface MatchModelResult {
  model_id: string;
  tier: Tier;
  /** Traits that set this model's tier, not every active trait. */
  driving_traits: OceanTrait[];
  /** Active traits with no usable model score. Non-empty only when tier is not_scored. */
  missing_traits: OceanTrait[];
  /** 1 is closest to the target profile. Set only when spread_warning is true. */
  relative_rank?: number;
  traits: Partial<Record<OceanTrait, MatchTraitResult>>;
}

export interface MatchResult {
  label: typeof HYPOTHESIS_LABEL;
  recommendation: 'tiers' | 'no strong recommendation';
  targets: AppliedTarget[];
  strategy_table: StrategyRow[];
  /** Active traits that are eligible for tiering. Per-model driving_traits is the subset that set that tier. */
  driving_traits: OceanTrait[];
  /** Set when spread_warning is true and at least one model was ranked. */
  ranking_note: string | null;
  models: MatchModelResult[];
}
