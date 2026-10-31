/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turns one run's match result plus that same file's per-model stats into
 * the section model. Ties and "all poor" are derived from tiers. Nothing
 * here compares a tier with a tier from another run.
 */

import type {
  Confidence,
  MatchModelResult,
  MatchResult,
  OceanTrait,
  ScoreFile,
  TargetDirection,
  Tier,
} from '../../scripts/benchmark/types';
import { OCEAN_TRAITS } from '../../scripts/benchmark/types';
import {
  BALANCED_PROFILE,
  CLOSE_CALL_NOTE,
  DECENT_SENTENCE,
  EXTROVERSION_ONLY,
  NO_RECOMMENDATION,
  NO_TESTED_STRATEGY,
  NOT_ENOUGH_DATA,
  TIER_LABEL,
} from './copy';

const TRAIT_NAME: Record<OceanTrait, string> = {
  openness: 'Openness',
  conscientiousness: 'Conscientiousness',
  extroversion: 'Extroversion',
  agreeableness: 'Agreeableness',
  neuroticism: 'Neuroticism',
};

const COUNT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;

export function traitLabel(trait: OceanTrait): string {
  return TRAIT_NAME[trait];
}

export function formatPoint(value: number): string {
  return String(Math.round(value));
}

/** Timestamps are UTC. The formatted day follows the viewer's time zone. */
export function formatTestedOn(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'tested on an unknown date';
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(date);
  return `tested on ${formatted}`;
}

export function repeatCountLabel(repeats: number): string {
  return repeats === 1 ? '1 repeat' : `${repeats} repeats`;
}

/** A chip is shown only for a real label. "default" and a missing label stay blank. */
export function displayRunLabel(label: string | null | undefined): string | null {
  if (label == null) return null;
  const trimmed = label.trim();
  if (trimmed === '' || trimmed === 'default' || trimmed === 'unlabeled') return null;
  return trimmed;
}

export function joinTraitNames(traits: OceanTrait[]): string {
  const names = traits.map((trait) => traitLabel(trait).toLowerCase());
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function fewerRunsTag(scoredRuns: number, repeats: number, fewerRuns: boolean): string | null {
  if (!fewerRuns) return null;
  return `${scoredRuns} of ${repeats} runs`;
}

export interface TraitQuality {
  wide_range: boolean;
  fewer_runs: boolean;
  confidence: Confidence;
}

export interface ModelStats {
  timestamp: string;
  fewer_runs: boolean;
  scored_runs: number;
  failed_runs: number;
  not_scored_reason: string | null;
  providers: Array<{ provider: string; count: number }>;
  reasoningEfforts: string[];
  traits: Partial<Record<OceanTrait, TraitQuality>>;
  ranges: Partial<Record<OceanTrait, { mean: number | null; low: number | null; high: number | null; runs: number }>>;
}

export interface RunContext {
  runLabel: string;
  /** Score-file `label`. The chip hides this when it is the generic hypothesis line. */
  hypothesisLabel: string;
  repeats: number;
  generatedAt: string;
  partial: boolean;
  spreadWarning: boolean;
  judgeModelId: string;
  reasoningEffort: string;
}

export interface ModelMatchView {
  match: MatchResult;
  context: RunContext;
  statsById: Record<string, ModelStats>;
}

export function snapshotModels(file: ScoreFile): Record<string, ModelStats> {
  const statsById: Record<string, ModelStats> = {};
  for (const model of file.models) {
    const efforts: string[] = [];
    for (const run of model.runs ?? []) {
      const effort = run.reasoning_effort;
      if (typeof effort === 'string' && effort && !efforts.includes(effort)) efforts.push(effort);
    }
    const traits: ModelStats['traits'] = {};
    const ranges: ModelStats['ranges'] = {};
    for (const trait of OCEAN_TRAITS) {
      const stats = model.traits?.[trait];
      if (!stats) continue;
      traits[trait] = {
        wide_range: stats.wide_range === true,
        fewer_runs: stats.fewer_runs === true,
        confidence: stats.confidence,
      };
      ranges[trait] = {
        mean: stats.mean,
        low: stats.low,
        high: stats.high,
        runs: stats.runs,
      };
    }
    statsById[model.id] = {
      timestamp: model.timestamp,
      fewer_runs: model.fewer_runs === true,
      scored_runs: model.scored_runs,
      failed_runs: model.failed_runs,
      not_scored_reason: model.not_scored_reason ?? null,
      providers: Array.isArray(model.providers_seen) ? model.providers_seen : [],
      reasoningEfforts: efforts,
      traits,
      ranges,
    };
  }
  return statsById;
}

export function contextFromScoreFile(file: ScoreFile): RunContext {
  const runLabel = typeof file.run_label === 'string' && file.run_label.trim() !== ''
    ? file.run_label
    : 'unlabeled';
  return {
    runLabel,
    hypothesisLabel: typeof file.label === 'string' ? file.label : '',
    repeats: file.repeats,
    generatedAt: file.generated_at,
    partial: file.partial === true,
    spreadWarning: file.spread_warning === true,
    judgeModelId: file.judge?.model_id ?? 'unknown judge',
    reasoningEffort: file.output_budget?.reasoning_effort ?? 'unknown',
  };
}

export function buildView(match: MatchResult, file: ScoreFile): ModelMatchView {
  return {
    match,
    context: contextFromScoreFile(file),
    statsById: snapshotModels(file),
  };
}

export interface TargetChipModel {
  key: string;
  primary: string;
  /** Strategy name. Omitted on muted chips so it is not read as a matching instruction. */
  secondary: string | null;
  muted: boolean;
}

export interface RowModel {
  trait: OceanTrait;
  label: string;
  caption: string;
  mean: number;
  low: number;
  high: number;
  direction: TargetDirection;
  wideRange: boolean;
  lowConfidence: boolean;
  dashed: boolean;
  ariaLabel: string;
}

export interface CardModel {
  modelId: string;
  tier: Tier;
  showTierChip: boolean;
  sentence: string;
  rows: RowModel[];
  fewerRunsTag: string | null;
  /** Set on a Decent card when every driving-trait low is exactly 50. */
  closeCallNote: string | null;
  missingTraitLabel: string | null;
  /** matchModels rank across every scored model. Not shown. */
  sourceRank: number | null;
  relativeRankLabel: string | null;
  timestampIso: string;
  runLabelChip: string | null;
  repeats: number;
  technicalDetail: string | null;
  providerDetail: string | null;
  reasoningDetail: string | null;
}

export interface GroupModel {
  id: 'strong' | 'decent' | 'poor' | 'not_scored';
  heading: string;
  models: CardModel[];
  /** All-poor cards stay closed until the reader asks for them. */
  collapsed: boolean;
}

export type EmptyKind = 'extroversion' | 'neuroticism' | 'balanced' | 'excluded';

export interface SectionModel {
  chips: TargetChipModel[];
  showExtroversionNote: boolean;
  showNeuroticismNote: boolean;
  emptyState: { kind: EmptyKind; message: string } | null;
  tieBanner: string | null;
  allPoor: boolean;
  groups: GroupModel[];
  rankingNote: string | null;
  orderedBy: 'model-id' | 'relative-rank';
  context: RunContext;
}

function countWord(count: number): string {
  return COUNT_WORD[count] ?? String(count);
}

export function tieBanner(count: number, spreadWarning: boolean): string {
  const models = `All ${countWord(count)} models fit you about equally on your traits. The differences between them are smaller than the run-to-run noise.`;
  const alike = 'These models behave alike on the traits that matter to you, so cost and speed may matter more than a winner.';
  if (spreadWarning) {
    return `${models} ${alike} The order in each group is only a relative ranking, because the models cluster.`;
  }
  return `${models} ${alike} We don't rank them.`;
}

function fitSentence(tier: 'strong' | 'decent' | 'poor', traits: OceanTrait[]): string {
  if (tier === 'decent') return DECENT_SENTENCE;
  const names = joinTraitNames(traits);
  if (tier === 'strong') return `Matches you on ${names}.`;
  return `Falls outside your target on ${names}.`;
}

/**
 * Decent only. Strong fails when a driving trait's low is not strictly above 50.
 * The close-call note is for the case where that low is exactly 50 on every
 * driving trait, so no run scored below the midpoint. A low under 50 is not a close call.
 */
export function closeCallFromDrivingLows(lows: number[]): boolean {
  return lows.length > 0 && lows.every((low) => low === 50);
}

function notScoredSentence(stats: ModelStats | undefined, repeats: number, missing: OceanTrait[]): string {
  if (stats?.fewer_runs) {
    return `Only ${stats.scored_runs} of ${repeats} test runs finished, so we can't place this model yet.`;
  }
  if (missing.length > 0) {
    return `We don't have a score for ${joinTraitNames(missing)}, so we can't place this model yet.`;
  }
  return "We can't place this model yet.";
}

function providerDetail(providers: Array<{ provider: string; count: number }>): string | null {
  if (providers.length === 0) return null;
  const counts = providers.map((entry) => `${entry.provider} (${entry.count})`).join(', ');
  if (providers.length > 1) return `Served by more than one provider: ${counts}.`;
  return `Served by ${counts}.`;
}

function reasoningDetail(efforts: string[]): string | null {
  if (efforts.length < 2) return null;
  return `This model ran with more than one reasoning effort: ${efforts.join(', ')}.`;
}

function chipForTarget(target: MatchResult['targets'][number]): TargetChipModel {
  const name = traitLabel(target.trait);
  const muted = target.exclude_from_tiering || target.target_direction == null || target.confidence === 'not_scored';
  if (muted) {
    const primary = target.trait === 'extroversion'
      ? 'Extroversion: not used'
      : target.trait === 'neuroticism'
        ? 'Neuroticism: not used'
        : `${name}: not used`;
    return { key: `${target.trait}-${target.threshold}`, primary, secondary: null, muted: true };
  }
  return {
    key: `${target.trait}-${target.threshold}`,
    primary: `${name}: ${target.threshold}, so models should be ${target.target_direction}`,
    secondary: target.strategy,
    muted: false,
  };
}

function emptyStateFor(match: MatchResult): SectionModel['emptyState'] {
  if (match.models.length > 0) return null;
  if (match.targets.length === 0) {
    return { kind: 'balanced', message: BALANCED_PROFILE };
  }
  const onlyExtroversion = match.targets.every((target) => target.trait === 'extroversion');
  if (onlyExtroversion) return { kind: 'extroversion', message: EXTROVERSION_ONLY };
  const onlyLowNeuroticism = match.targets.every(
    (target) => target.trait === 'neuroticism' && target.threshold === 'low',
  );
  if (onlyLowNeuroticism) return { kind: 'neuroticism', message: NO_TESTED_STRATEGY };
  return { kind: 'excluded', message: NO_RECOMMENDATION };
}

/**
 * Order and label stay inside one tier. matchModels numbers every scored model
 * in one list, so a decent model can have a better global rank than a strong one.
 * The displayed "N of M" counts only this group.
 */
function orderGroup(models: CardModel[], byRank: boolean): CardModel[] {
  const copy = [...models];
  if (!byRank) {
    copy.sort((a, b) => a.modelId.localeCompare(b.modelId));
    return copy.map((card) => ({ ...card, relativeRankLabel: null }));
  }
  copy.sort((a, b) => {
    if (a.sourceRank == null && b.sourceRank == null) return a.modelId.localeCompare(b.modelId);
    if (a.sourceRank == null) return 1;
    if (b.sourceRank == null) return -1;
    return a.sourceRank - b.sourceRank || a.modelId.localeCompare(b.modelId);
  });
  const total = copy.filter((card) => card.sourceRank != null).length;
  let place = 0;
  return copy.map((card) => {
    if (card.sourceRank == null) return { ...card, relativeRankLabel: null };
    place += 1;
    return { ...card, relativeRankLabel: `rank ${place} of ${total} in this group` };
  });
}

function cardFor(model: MatchModelResult, view: ModelMatchView): CardModel {
  const stats = view.statsById[model.model_id];
  const repeats = view.context.repeats;
  const fewerTag = stats ? fewerRunsTag(stats.scored_runs, repeats, stats.fewer_runs) : null;
  const sourceRank = view.context.spreadWarning && model.tier !== 'not_scored' && model.relative_rank != null
    ? model.relative_rank
    : null;
  const rows: RowModel[] = [];
  if (model.tier !== 'not_scored') {
    for (const trait of model.driving_traits) {
      const result = model.traits[trait];
      if (!result || result.model_mean == null || result.model_low == null || result.model_high == null) continue;
      if (result.target_direction == null) continue;
      const quality = stats?.traits[trait];
      const dashed = stats?.fewer_runs === true || quality?.fewer_runs === true;
      const wideRange = quality?.wide_range === true;
      const lowConfidence = quality?.confidence === 'low';
      const meanText = formatPoint(result.model_mean);
      const lowText = formatPoint(result.model_low);
      const highText = formatPoint(result.model_high);
      const zone = result.target_direction === 'high' ? 'above 50' : 'below 50';
      const label = `${traitLabel(trait)}, wants ${result.target_direction}`;
      rows.push({
        trait,
        label,
        caption: `Mean ${meanText}, runs ${lowText} to ${highText}`,
        mean: result.model_mean,
        low: result.model_low,
        high: result.model_high,
        direction: result.target_direction,
        wideRange,
        lowConfidence,
        dashed,
        ariaLabel: `${label}: mean ${meanText}, minimum ${lowText}, maximum ${highText}. Target zone is ${zone}.`,
      });
    }
  }
  const missing = model.missing_traits;
  const sentence = model.tier === 'not_scored'
    ? notScoredSentence(stats, repeats, missing)
    : fitSentence(model.tier, model.driving_traits);
  const closeCallNote = model.tier === 'decent' && closeCallFromDrivingLows(rows.map((row) => row.low))
    ? CLOSE_CALL_NOTE
    : null;
  return {
    modelId: model.model_id,
    tier: model.tier,
    showTierChip: model.tier !== 'not_scored',
    sentence,
    rows,
    fewerRunsTag: fewerTag,
    closeCallNote,
    missingTraitLabel: model.tier === 'not_scored' && missing.length > 0
      ? `Missing scores for ${joinTraitNames(missing)}.`
      : null,
    sourceRank,
    relativeRankLabel: null,
    timestampIso: stats?.timestamp || view.context.generatedAt,
    runLabelChip: displayRunLabel(view.context.runLabel),
    repeats,
    technicalDetail: model.tier === 'not_scored' ? (model.not_scored_reason ?? stats?.not_scored_reason ?? null) : null,
    providerDetail: stats ? providerDetail(stats.providers) : null,
    reasoningDetail: stats ? reasoningDetail(stats.reasoningEfforts) : null,
  };
}

const GROUP_ORDER = ['strong', 'decent', 'poor', 'not_scored'] as const;

export function deriveSection(view: ModelMatchView): SectionModel {
  const { match, context } = view;
  const chips = match.targets.map(chipForTarget);
  const showExtroversionNote = match.targets.some((target) => target.trait === 'extroversion' && target.exclude_from_tiering);
  const neuroticismExcluded = match.targets.some(
    (target) => target.trait === 'neuroticism' && (target.exclude_from_tiering || target.target_direction == null || target.confidence === 'not_scored'),
  );
  // The nothing-to-match banner already says this. Don't print it twice.
  const showNeuroticismNote = neuroticismExcluded && match.models.length > 0;
  const emptyState = emptyStateFor(match);
  const scored = match.models.filter((model) => model.tier !== 'not_scored');
  const distinctTiers = new Set(scored.map((model) => model.tier));
  const allPoor = scored.length > 0 && scored.every((model) => model.tier === 'poor');
  const allTie = scored.length > 1 && distinctTiers.size === 1 && !allPoor;
  const byRank = context.spreadWarning && match.ranking_note != null
    && match.models.some((model) => model.tier !== 'not_scored' && model.relative_rank != null);
  const cards = match.models.map((model) => cardFor(model, view));
  const groups: GroupModel[] = [];
  for (const id of GROUP_ORDER) {
    const models = orderGroup(
      cards.filter((card) => (id === 'not_scored' ? card.tier === 'not_scored' : card.tier === id)),
      byRank && id !== 'not_scored',
    );
    if (models.length === 0) continue;
    groups.push({
      id,
      heading: id === 'not_scored' ? NOT_ENOUGH_DATA : TIER_LABEL[id],
      models,
      collapsed: allPoor && id === 'poor',
    });
  }
  return {
    chips,
    showExtroversionNote,
    showNeuroticismNote,
    emptyState,
    tieBanner: allTie ? tieBanner(scored.length, context.spreadWarning) : null,
    allPoor,
    groups,
    rankingNote: byRank ? match.ranking_note : null,
    orderedBy: byRank ? 'relative-rank' : 'model-id',
    context,
  };
}
