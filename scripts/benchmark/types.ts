/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OceanScores } from '../../src/types';

export const SCORE_FILE_SCHEMA_VERSION = 4;

/** Joins distinct interview upstreams stored on one scored repeat. */
export const PROVIDER_LIST_SEPARATOR = ', ';

/** Used when a score file written before run_label is loaded. */
export const UNLABELED_RUN_LABEL = 'unlabeled';

export const DEFAULT_RUN_LABEL = 'default';

export const RUN_LABEL_MAX_LENGTH = 80;

/** OpenRouter `reasoning.effort` values. The benchmark sends one value to every model. */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

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

/**
 * OpenRouter request `provider` object. Only the fields this benchmark pins.
 * Names are copied from a previous run's providers_seen, not invented here.
 */
export interface ProviderRoute {
  order?: string[];
  allow_fallbacks?: boolean;
}

export interface ModelConfig {
  id: string;
  enabled: boolean;
  /** USD per 1,000,000 input tokens. Null skips the model. */
  inputPerMillionUsd: number | null;
  /** USD per 1,000,000 output tokens. Null skips the model. */
  outputPerMillionUsd: number | null;
  /** Interview-only routing pin. Omitted means OpenRouter's default routing. */
  provider?: ProviderRoute;
}

export interface BenchmarkConfig {
  priceDate: string;
  baseUrl: string;
  interview: {
    /** Null means no system message is sent to candidate models. */
    systemPrompt: string | null;
    temperature: number;
    /** Shared completion cap for every interview model. Reasoning tokens count against it. */
    maxOutputTokens: number;
    /** One retry cap, identical for every model, used only after finish_reason length. */
    retryMaxOutputTokens: number;
    /** Sent as OpenRouter `reasoning.effort` on every interview and judge call. */
    reasoningEffort: ReasoningEffort;
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
  /** How many models may have `enabled: true` in one run. */
  maxEnabledModels: number;
  /**
   * Minimum gap between calls to the judge model id, including interview calls
   * to that same id. Zero disables the gap.
   */
  judgeMinIntervalMs: number;
  /** Short name for this run, copied onto the score file. */
  runLabel: string;
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
  /** Uniform OpenRouter reasoning effort. Omitted only in tests that do not set it. */
  reasoningEffort?: ReasoningEffort;
  scenarioId?: string;
  repeat?: number;
  /** Interview routing pin. Omitted on judge calls and when the model has no pin. */
  provider?: ProviderRoute;
}

export interface ChatResponse {
  content: string;
  /** Exact model id/version string returned by the API. */
  modelVersion: string;
  promptTokens: number;
  completionTokens: number;
  usageEstimated: boolean;
  /**
   * OpenRouter's top-level `provider` (the upstream that answered).
   * Null when the body omits it.
   */
  provider: string | null;
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
  /** True when successful runs are fewer than the configured repeat count. */
  fewer_runs: boolean;
}

export interface ScoreRun {
  repeat: number;
  model_version: string;
  /** `model` string from the judge response. Often the requested id, not a dated build. */
  judge_version: string;
  /** UTC time of this scoring call, stored beside the judge version string. */
  recorded_at: string;
  /** Highest max_tokens actually sent for this repeat, including a length retry. */
  max_output_tokens: number;
  /** OpenRouter reasoning.effort sent with this repeat. */
  reasoning_effort: ReasoningEffort;
  /**
   * Upstream named by OpenRouter `provider` on the interview calls in this repeat.
   * Unique values are joined when scenarios differ. Null when every response omitted it.
   * Omitted entirely on score files written before this field existed.
   */
  provider?: string | null;
  scores: OceanScores;
}

export interface ModelFailure {
  repeat: number;
  scenario_id: string | null;
  kind: 'interview' | 'judge';
  reason: string;
  max_output_tokens: number;
  reasoning_effort: ReasoningEffort;
}

export interface StrategyRow {
  trait: OceanTrait;
  threshold: 'high' | 'low';
  strategy: AlignmentStrategy;
  target_direction: TargetDirection | null;
  confidence: Confidence;
  exclude_from_tiering: boolean;
  /** Why this row is left out of tiering. Null when the row still counts. */
  exclusion_reason: string | null;
}

export interface ModelScore {
  id: string;
  version: string;
  timestamp: string;
  cost_usd: number;
  wide_range: boolean;
  /** Successful scored repeats are below the configured repeat count. */
  fewer_runs: boolean;
  scored_runs: number;
  failed_runs: number;
  /** Set when failed repeats are more than half of the configured repeats. */
  not_scored_reason: string | null;
  failures: ModelFailure[];
  traits: Record<OceanTrait, TraitStats>;
  /**
   * Distinct interview upstreams across scored repeats, with how many repeats named each.
   * Absent on score files written before this field. The judge's provider is not included.
   */
  providers_seen?: Array<{ provider: string; count: number }>;
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
  /**
   * Config run_label for this file. Files written before the field existed omit it;
   * validation fills those in as unlabeled.
   */
  run_label: string;
  price_date: string;
  interview_temperature: number;
  repeats: number;
  partial: boolean;
  /** Caps and reasoning effort actually configured for this file. Same values for every model. */
  output_budget: {
    max_output_tokens: number;
    retry_max_output_tokens: number;
    reasoning_effort: ReasoningEffort;
  };
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
  /** Set when this active trait is reported but does not count toward the tier. */
  exclusion_reason: string | null;
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
  /** Present when the model failed more than half its runs. */
  not_scored_reason?: string;
  /** 1 is closest to the target profile. Set only when spread_warning is true. */
  relative_rank?: number;
  traits: Partial<Record<OceanTrait, MatchTraitResult>>;
}

export interface MatchResult {
  label: typeof HYPOTHESIS_LABEL;
  recommendation: 'tiers' | 'no strong recommendation';
  targets: AppliedTarget[];
  strategy_table: StrategyRow[];
  /**
   * Active traits that are still reported, including extroversion when it is excluded from tiering.
   * Neuroticism-low stays off this list because that row is not scored.
   * UI cards should read each model's driving_traits for the tier, and exclusion_reason for an excluded trait.
   */
  active_traits: OceanTrait[];
  /** Set when spread_warning is true and at least one model was ranked. */
  ranking_note: string | null;
  models: MatchModelResult[];
}
