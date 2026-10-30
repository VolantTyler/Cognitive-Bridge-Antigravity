/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RELATIVE_RANKING_NOTE, matchModels } from '../../../scripts/benchmark/match';
import { buildScoreFile, type CompletedModelRun } from '../../../scripts/benchmark/scorefile';
import { HYPOTHESIS_LABEL, type MatchResult, type ScoreFile } from '../../../scripts/benchmark/types';
import { agreeablenessTieView, realScoreFile, sampleEntry, sampleView } from '../__fixtures__/joinSamples';
import {
  EXTROVERSION_WHY_BODY,
  EXTROVERSION_WHY_TITLE,
  EXTROVERSION_SHORT,
  NO_TESTED_STRATEGY,
  STATUS_LABEL,
} from '../copy';
import { buildView, deriveSection, displayRunLabel, fewerRunsTag, formatTestedOn } from '../derive';
import ModelMatchSection from '../ModelMatchSection';
import type { ModelMatchState } from '../loadRuns';

const ZONE = 'America/New_York';
const OLD_REASON = 'between 55 and 61';

function renderView(view: ReturnType<typeof sampleView>, onOpen = vi.fn()) {
  const state: ModelMatchState = { status: 'ready', view };
  const retry = vi.fn();
  const result = render(
    <ModelMatchSection state={state} onRetry={retry} onOpenLeaderboard={onOpen} timeZone={ZONE} />,
  );
  return { ...result, onOpen, retry };
}

function article(modelId: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 4, name: modelId });
  const node = heading.closest('article');
  if (!node) throw new Error(`no article for ${modelId}`);
  return node;
}

describe('tested-on dates', () => {
  it('formats the UTC timestamp in the viewer time zone', () => {
    expect(formatTestedOn('2026-10-30T01:24:51.795Z', 'America/New_York')).toBe('tested on Oct 29, 2026');
    expect(formatTestedOn('2026-10-30T01:24:51.795Z', 'UTC')).toBe('tested on Oct 30, 2026');
  });

  it('hides a missing, default, or unlabeled run label', () => {
    expect(displayRunLabel(undefined)).toBeNull();
    expect(displayRunLabel('default')).toBeNull();
    expect(displayRunLabel('unlabeled')).toBeNull();
    expect(displayRunLabel('original four')).toBe('original four');
  });

  it('builds the fewer-runs tag from scored runs and the run repeat count', () => {
    expect(fewerRunsTag(4, 5, true)).toBe('4 of 5 runs');
    expect(fewerRunsTag(9, 10, true)).toBe('9 of 10 runs');
    expect(fewerRunsTag(5, 5, false)).toBeNull();
  });
});

describe('sample A, the normal section', () => {
  it('shows the hypothesis label, driving-trait rows, and the three real-file cards', () => {
    renderView(sampleView('A'));
    const section = screen.getByRole('region', { name: 'Models that fit your profile' });

    expect(document.querySelectorAll('[data-hypothesis-chip]')).toHaveLength(1);
    const hypothesis = document.querySelector('[data-hypothesis-chip]');
    expect(hypothesis).toHaveTextContent(STATUS_LABEL);
    expect(hypothesis).toHaveTextContent(HYPOTHESIS_LABEL);
    expect(screen.getByText(/hasn't been tested with real users yet/)).toBeVisible();
    expect(section.textContent).not.toMatch(/%/);
    expect(section.textContent).not.toMatch(/best model/i);
    expect(section.textContent).not.toContain(OLD_REASON);
    expect(section.querySelector('[data-run-label]')).toBeNull();

    const strong = screen.getByRole('list', { name: 'Strong fit' });
    expect(within(strong).getByRole('heading', { level: 4, name: 'anthropic/claude-haiku-4.5' })).toBeInTheDocument();
    expect(within(strong).getByRole('heading', { level: 4, name: 'x-ai/grok-4.3' })).toBeInTheDocument();
    expect(within(strong).queryByRole('heading', { name: 'google/gemini-2.5-flash-lite' })).toBeNull();

    const haiku = article('anthropic/claude-haiku-4.5');
    expect(within(haiku).getByText('9 of 10 runs')).toBeInTheDocument();
    expect(within(haiku).getByText('Strong fit')).toBeInTheDocument();
    expect(within(haiku).getByText('Matches you on openness and conscientiousness.')).toBeInTheDocument();
    expect(within(haiku).getByText('tested on Oct 29, 2026')).toBeInTheDocument();
    expect(haiku.querySelectorAll('[data-dashed="true"]').length).toBeGreaterThan(0);
    expect(within(haiku).getByText('Mean 84, runs 75 to 90')).toBeInTheDocument();
    expect(within(haiku).getByText('Mean 74, runs 60 to 85')).toBeInTheDocument();

    const nano = article('openai/gpt-5-nano');
    expect(within(nano).getByText('Wide range')).toBeInTheDocument();
    expect(within(nano).getByText('Decent fit')).toBeInTheDocument();
    expect(within(nano).getByText('Matches you on average, but some runs crossed the midpoint on openness.')).toBeInTheDocument();
    expect(within(nano).queryByText(/conscientiousness/i)).toBeNull();
    expect(nano.querySelector('[data-hatched="true"]')).toBeTruthy();
    expect(nano.querySelector('[data-trait="openness"]')).toBeTruthy();
    expect(nano.querySelector('[data-trait="conscientiousness"]')).toBeNull();
    const opennessBar = nano.querySelector('[data-trait="openness"] [role="img"]');
    expect(opennessBar).toHaveAttribute('aria-label', expect.stringMatching(/mean 79, minimum 40, maximum 85/));

    const gemini = article('google/gemini-2.5-flash-lite');
    const notEnough = screen.getByRole('list', { name: 'Not enough data' });
    expect(notEnough).toContainElement(gemini);
    expect(within(gemini).queryByText('Strong fit')).toBeNull();
    expect(within(gemini).queryByText('Decent fit')).toBeNull();
    expect(within(gemini).queryByText('Poor fit')).toBeNull();
    expect(within(gemini).getByText('Only 4 of 10 test runs finished, so we can\'t place this model yet.')).toBeInTheDocument();
    expect(within(gemini).getByText('4 of 10 runs')).toBeInTheDocument();
    expect(within(gemini).getByText('Missing scores for openness and conscientiousness.')).toBeInTheDocument();
    expect(gemini.querySelector('[data-band]')).toBeNull();
    expect(gemini.textContent).not.toMatch(/429/);
    fireEvent.click(within(gemini).getByRole('button', { name: 'Details' }));
    expect(gemini.textContent).toMatch(/429/);
    expect(gemini.textContent).not.toContain(OLD_REASON);
  });

  it('keeps every control in tab order and does not offer the deferred table toggle', () => {
    renderView(sampleView('A'));
    const section = screen.getByRole('region', { name: 'Models that fit your profile' });
    const controls = [
      ...within(section).getAllByRole('button'),
      ...within(section).getAllByRole('link'),
    ];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.tabIndex).toBeGreaterThanOrEqual(0);
      control.focus();
      expect(document.activeElement).toBe(control);
    }
    expect(within(section).queryByRole('button', { name: /view as table/i })).toBeNull();

    const measured = within(section).getByRole('button', { name: 'How we measured this' });
    expect(measured).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(measured);
    expect(measured).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Tiers come from this run only/)).toBeVisible();
    expect(screen.getByText(/about 10 points sits inside the run-to-run noise/)).toBeVisible();
  });
});

describe('states from the samples', () => {
  it('collapses every scored card when they are all poor, and still shows the not-scored model', () => {
    renderView(sampleView('B'));
    expect(screen.getByText('None of the models we tested fit this part of your profile.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'openai/gpt-5-nano' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'google/gemini-2.5-flash-lite' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show model cards' }));
    const nano = article('openai/gpt-5-nano');
    expect(within(nano).getByText('Poor fit')).toBeInTheDocument();
    expect(nano.querySelector('[data-band]')).toBeTruthy();
    expect(screen.getAllByText(/Falls outside your target on/).length).toBeGreaterThan(0);
  });

  it('shows Charlie\'s extroversion copy and no cards when that is the only target', () => {
    const entry = sampleEntry('C');
    expect(entry.result.active_traits).toEqual(['extroversion']);
    expect(entry.result.models).toEqual([]);
    renderView(sampleView('C'));
    expect(screen.getByText('Extroversion: not used')).toBeVisible();
    expect(screen.getByText(EXTROVERSION_SHORT)).toBeVisible();
    expect(screen.getByText(/Your strongest trait is extroversion/)).toBeVisible();
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
    expect(document.body.textContent).not.toContain(OLD_REASON);
    expect(document.body.textContent).not.toContain('no benchmarked model scored extroversion below 50');
    const why = screen.getByRole('button', { name: EXTROVERSION_WHY_TITLE });
    expect(why).toHaveAttribute('aria-expanded', 'false');
    expect(EXTROVERSION_WHY_BODY).not.toMatch(/\d/);
    fireEvent.click(why);
    expect(screen.getByText(EXTROVERSION_WHY_BODY)).toBeVisible();
  });

  it('draws the low-neuroticism chip from targets when active_traits is empty', () => {
    const entry = sampleEntry('D');
    expect(entry.result.active_traits).toEqual([]);
    expect(entry.result.targets.map((target) => target.trait)).toEqual(['neuroticism']);
    renderView(sampleView('D'));
    expect(screen.getByText('Neuroticism: not used')).toBeVisible();
    expect(screen.getByText(NO_TESTED_STRATEGY)).toBeVisible();
    expect(screen.queryByText('Extroversion: not used')).toBeNull();
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
    expect(document.body.textContent).not.toContain(OLD_REASON);
  });

  it('derives an agreeableness tie from the real file without calling matchModels', () => {
    const view = agreeablenessTieView();
    const section = deriveSection(view);
    const scored = view.match.models.filter((model) => model.tier !== 'not_scored');
    expect(scored.every((model) => model.tier === 'strong')).toBe(true);
    expect(section.tieBanner).toMatch(/All three models fit you about equally/);
    expect(section.tieBanner).toMatch(/We don't rank them/);
    renderView(view);
    expect(screen.getByText(/All three models fit you about equally/)).toBeVisible();
    expect(screen.queryByText(/Closest to your target/)).toBeNull();
    const list = screen.getByRole('list', { name: 'Strong fit' });
    expect(list).toHaveAttribute('data-ordered', 'model-id');
    const ids = within(list).getAllByRole('heading', { level: 4 }).map((node) => node.textContent);
    expect(ids).toEqual(['anthropic/claude-haiku-4.5', 'openai/gpt-5-nano', 'x-ai/grok-4.3']);
  });
});

describe('acceptance fixtures', () => {
  it('shows the tie banner and does not order four scored models by their means', () => {
    const ids = [
      { id: 'z-high', mean: 96 },
      { id: 'a-low', mean: 72 },
      { id: 'm-mid', mean: 88 },
      { id: 'b-mid', mean: 80 },
    ];
    const models = ids.map((item) => ({
      model_id: item.id,
      tier: 'strong' as const,
      driving_traits: ['agreeableness' as const],
      missing_traits: [],
      traits: {
        agreeableness: {
          strategy: 'congruent' as const,
          target_direction: 'high' as const,
          confidence: 'normal' as const,
          included_in_tier: true,
          exclusion_reason: null,
          user_score: 90,
          model_mean: item.mean,
          model_low: 60,
          model_high: 98,
        },
      },
    }));
    const match: MatchResult = {
      label: HYPOTHESIS_LABEL,
      recommendation: 'tiers',
      targets: [{
        trait: 'agreeableness',
        threshold: 'high',
        strategy: 'congruent',
        target_direction: 'high',
        confidence: 'normal',
        exclude_from_tiering: false,
        exclusion_reason: null,
        user_score: 90,
      }],
      strategy_table: [],
      active_traits: ['agreeableness'],
      ranking_note: null,
      models,
    };
    const file = {
      ...realScoreFile,
      run_label: 'original four',
      spread_warning: false,
      models: realScoreFile.models,
    } as ScoreFile;
    const view = buildView(match, file);
    view.statsById = {};
    const section = deriveSection(view);
    expect(section.tieBanner).toMatch(/All four models fit you about equally/);
    expect(section.orderedBy).toBe('model-id');
    renderView(view);
    const list = screen.getByRole('list', { name: 'Strong fit' });
    const order = within(list).getAllByRole('heading', { level: 4 }).map((node) => node.textContent);
    expect(order).toEqual(['a-low', 'b-mid', 'm-mid', 'z-high']);
    expect(screen.getAllByText('original four')).toHaveLength(4);
    expect(screen.queryByText(/Closest to your target/)).toBeNull();
  });

  it('leaves extroversion off every card when another trait is driving', () => {
    const bad = 'Excluded from tiering: benchmarked models scored extroversion between 55 and 61, and the table needs a model below 50. Means are still reported.';
    const match: MatchResult = {
      label: HYPOTHESIS_LABEL,
      recommendation: 'tiers',
      targets: [
        {
          trait: 'openness',
          threshold: 'high',
          strategy: 'congruent',
          target_direction: 'high',
          confidence: 'normal',
          exclude_from_tiering: false,
          exclusion_reason: null,
          user_score: 90,
        },
        {
          trait: 'extroversion',
          threshold: 'high',
          strategy: 'complementary',
          target_direction: 'low',
          confidence: 'low',
          exclude_from_tiering: true,
          exclusion_reason: bad,
          user_score: 90,
        },
      ],
      strategy_table: [],
      active_traits: ['openness', 'extroversion'],
      ranking_note: null,
      models: [{
        model_id: 'example/model',
        tier: 'strong',
        driving_traits: ['openness'],
        missing_traits: [],
        traits: {
          openness: {
            strategy: 'congruent',
            target_direction: 'high',
            confidence: 'normal',
            included_in_tier: true,
            exclusion_reason: null,
            user_score: 90,
            model_mean: 80,
            model_low: 70,
            model_high: 90,
          },
          extroversion: {
            strategy: 'complementary',
            target_direction: 'low',
            confidence: 'low',
            included_in_tier: false,
            exclusion_reason: bad,
            user_score: 90,
            model_mean: 58,
            model_low: 55,
            model_high: 61,
          },
        },
      }],
    };
    renderView(buildView(match, { ...realScoreFile, run_label: 'default' } as ScoreFile));
    expect(screen.getByText('Extroversion: not used')).toBeVisible();
    expect(screen.getByText(EXTROVERSION_SHORT)).toBeVisible();
    expect(article('example/model').querySelector('[data-trait="extroversion"]')).toBeNull();
    expect(article('example/model').querySelector('[data-trait="openness"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain(OLD_REASON);
    expect(document.body.querySelector('[data-run-label]')).toBeNull();
  });

  it('shows relative rank once when spread_warning is set, without changing the tier', () => {
    const match: MatchResult = {
      label: HYPOTHESIS_LABEL,
      recommendation: 'tiers',
      targets: [{
        trait: 'openness',
        threshold: 'high',
        strategy: 'congruent',
        target_direction: 'high',
        confidence: 'normal',
        exclude_from_tiering: false,
        exclusion_reason: null,
        user_score: 90,
      }],
      strategy_table: [],
      active_traits: ['openness'],
      ranking_note: RELATIVE_RANKING_NOTE,
      models: [
        {
          model_id: 'b/model',
          tier: 'strong',
          driving_traits: ['openness'],
          missing_traits: [],
          relative_rank: 2,
          traits: {
            openness: {
              strategy: 'congruent', target_direction: 'high', confidence: 'normal', included_in_tier: true,
              exclusion_reason: null, user_score: 90, model_mean: 80, model_low: 70, model_high: 90,
            },
          },
        },
        {
          model_id: 'a/model',
          tier: 'decent',
          driving_traits: ['openness'],
          missing_traits: [],
          relative_rank: 1,
          traits: {
            openness: {
              strategy: 'congruent', target_direction: 'high', confidence: 'normal', included_in_tier: true,
              exclusion_reason: null, user_score: 90, model_mean: 70, model_low: 40, model_high: 90,
            },
          },
        },
      ],
    };
    const file = { ...realScoreFile, spread_warning: true, run_label: 'frontier' } as ScoreFile;
    renderView(buildView(match, file));
    expect(screen.getAllByText('Strong fit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Decent fit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('rank 1 of 1 in this group')).toHaveLength(2);
    expect(screen.queryByText(/of 2/)).toBeNull();
    expect(screen.getAllByText(RELATIVE_RANKING_NOTE)).toHaveLength(1);
    const decent = screen.getByRole('list', { name: 'Decent fit' });
    expect(within(decent).getByText('a/model')).toBeInTheDocument();
    expect(within(decent).getByText('rank 1 of 1 in this group')).toBeInTheDocument();
  });

  it('renumbers a global rank inside each tier when that rank crosses tiers', () => {
    const trait = {
      strategy: 'congruent' as const,
      target_direction: 'high' as const,
      confidence: 'normal' as const,
      included_in_tier: true,
      exclusion_reason: null,
      user_score: 90,
    };
    const match: MatchResult = {
      label: HYPOTHESIS_LABEL,
      recommendation: 'tiers',
      targets: [{
        trait: 'openness', threshold: 'high', strategy: 'congruent', target_direction: 'high',
        confidence: 'normal', exclude_from_tiering: false, exclusion_reason: null, user_score: 90,
      }],
      strategy_table: [],
      active_traits: ['openness'],
      ranking_note: RELATIVE_RANKING_NOTE,
      models: [
        {
          model_id: 'a-strong-far',
          tier: 'strong',
          driving_traits: ['openness'],
          missing_traits: [],
          relative_rank: 3,
          traits: { openness: { ...trait, model_mean: 60, model_low: 55, model_high: 65 } },
        },
        {
          model_id: 'z-strong-closer',
          tier: 'strong',
          driving_traits: ['openness'],
          missing_traits: [],
          relative_rank: 2,
          traits: { openness: { ...trait, model_mean: 64, model_low: 58, model_high: 70 } },
        },
        {
          model_id: 'm-decent-closest',
          tier: 'decent',
          driving_traits: ['openness'],
          missing_traits: [],
          relative_rank: 1,
          traits: { openness: { ...trait, model_mean: 70, model_low: 40, model_high: 90 } },
        },
      ],
    };
    const file = { ...realScoreFile, spread_warning: true } as ScoreFile;
    renderView(buildView(match, file));
    const strong = screen.getByRole('list', { name: 'Strong fit' });
    expect(within(strong).getAllByRole('heading', { level: 4 }).map((node) => node.textContent)).toEqual([
      'z-strong-closer',
      'a-strong-far',
    ]);
    expect(within(strong).getByText('rank 1 of 2 in this group')).toBeInTheDocument();
    expect(within(strong).getByText('rank 2 of 2 in this group')).toBeInTheDocument();
    const decent = screen.getByRole('list', { name: 'Decent fit' });
    expect(within(decent).getByText('rank 1 of 1 in this group')).toBeInTheDocument();
    expect(screen.queryByText(/of 3/)).toBeNull();
    expect(screen.getAllByText(RELATIVE_RANKING_NOTE)).toHaveLength(1);
  });

  it('can come from matchModels: a decent model closer to the target outranks a strong one', () => {
    const neutral = {
      openness: 50,
      conscientiousness: 50,
      extroversion: 50,
      agreeableness: 50,
      neuroticism: 50,
    };
    const model = (id: string, openness: number[]): CompletedModelRun => ({
      id,
      costUsd: 0.1,
      timestamp: '2026-11-01T00:00:00.000Z',
      repeats: openness.map((value, index) => ({
        repeat: index + 1,
        modelVersion: id,
        judgeVersion: 'judge-v1',
        scores: { ...neutral, openness: value },
      })),
    });
    const file = buildScoreFile({
      models: [
        model('strong-just-past-midpoint', [58, 60, 62]),
        model('decent-closer-to-target', [45, 72, 75]),
      ],
      judge: { modelId: 'google/gemini-2.5-flash-lite', version: 'judge-v1', temperature: 0 },
      interviewTemperature: 0,
      repeats: 3,
      generatedAt: '2026-11-01T00:00:00.000Z',
      priceDate: '2026-10-05',
      wideRangeThreshold: 40,
      spreadThreshold: 10,
      traitConfidence: {
        openness: 'normal',
        conscientiousness: 'normal',
        extroversion: 'normal',
        agreeableness: 'normal',
        neuroticism: 'normal',
      },
    });
    const result = matchModels({ ...neutral, openness: 90 }, file);
    expect(result.ranking_note).toBe(RELATIVE_RANKING_NOTE);
    const strong = result.models.find((item) => item.model_id === 'strong-just-past-midpoint');
    const decent = result.models.find((item) => item.model_id === 'decent-closer-to-target');
    expect(strong?.tier).toBe('strong');
    expect(decent?.tier).toBe('decent');
    expect(decent?.relative_rank).toBe(1);
    expect(strong?.relative_rank).toBe(2);
    const view = buildView(result, file);
    renderView(view);
    expect(screen.getAllByText('rank 1 of 1 in this group')).toHaveLength(2);
    expect(screen.queryByText('rank 1 of 2 in this group')).toBeNull();
  });

  it('shows no rank when spread_warning is false, even if relative_rank is set', () => {
    const match: MatchResult = {
      label: HYPOTHESIS_LABEL,
      recommendation: 'tiers',
      targets: [{
        trait: 'openness', threshold: 'high', strategy: 'congruent', target_direction: 'high',
        confidence: 'normal', exclude_from_tiering: false, exclusion_reason: null, user_score: 90,
      }],
      strategy_table: [],
      active_traits: ['openness'],
      ranking_note: RELATIVE_RANKING_NOTE,
      models: [
        {
          model_id: 'b-model',
          tier: 'strong',
          driving_traits: ['openness'],
          missing_traits: [],
          relative_rank: 1,
          traits: {
            openness: {
              strategy: 'congruent', target_direction: 'high', confidence: 'normal', included_in_tier: true,
              exclusion_reason: null, user_score: 90, model_mean: 80, model_low: 70, model_high: 90,
            },
          },
        },
        {
          model_id: 'a-model',
          tier: 'strong',
          driving_traits: ['openness'],
          missing_traits: [],
          relative_rank: 2,
          traits: {
            openness: {
              strategy: 'congruent', target_direction: 'high', confidence: 'normal', included_in_tier: true,
              exclusion_reason: null, user_score: 90, model_mean: 75, model_low: 70, model_high: 80,
            },
          },
        },
      ],
    };
    renderView(buildView(match, { ...realScoreFile, spread_warning: false } as ScoreFile));
    expect(screen.queryByText(/in this group/)).toBeNull();
    expect(screen.queryByText(RELATIVE_RANKING_NOTE)).toBeNull();
    const strong = screen.getByRole('list', { name: 'Strong fit' });
    expect(strong).toHaveAttribute('data-ordered', 'model-id');
    expect(within(strong).getAllByRole('heading', { level: 4 }).map((node) => node.textContent)).toEqual([
      'a-model',
      'b-model',
    ]);
  });

  it('tags a low-confidence driving trait from the score file, not the strategy row', () => {
    const match: MatchResult = {
      label: HYPOTHESIS_LABEL,
      recommendation: 'tiers',
      targets: [{
        trait: 'openness',
        threshold: 'high',
        strategy: 'congruent',
        target_direction: 'high',
        confidence: 'normal',
        exclude_from_tiering: false,
        exclusion_reason: null,
        user_score: 90,
      }],
      strategy_table: [],
      active_traits: ['openness'],
      ranking_note: null,
      models: [{
        model_id: 'low/model',
        tier: 'strong',
        driving_traits: ['openness'],
        missing_traits: [],
        traits: {
          openness: {
            strategy: 'congruent', target_direction: 'high', confidence: 'normal', included_in_tier: true,
            exclusion_reason: null, user_score: 90, model_mean: 80, model_low: 70, model_high: 90,
          },
        },
      }],
    };
    const file = structuredClone(realScoreFile);
    file.models = [{
      ...file.models[0],
      id: 'low/model',
      traits: {
        ...file.models[0].traits,
        openness: { ...file.models[0].traits.openness, confidence: 'low', wide_range: false },
      },
    }];
    renderView(buildView(match, file));
    expect(within(article('low/model')).getByText('Low confidence')).toBeInTheDocument();
    expect(screen.queryByText(/fit you about equally/)).toBeNull();
  });
});

describe('load and empty chrome', () => {
  it('shows skeletons and no tiers while loading', () => {
    render(<ModelMatchSection state={{ status: 'loading' }} onRetry={vi.fn()} onOpenLeaderboard={vi.fn()} />);
    expect(screen.getByText('Loading benchmark scores')).toBeInTheDocument();
    expect(screen.queryByText('Strong fit')).toBeNull();
    expect(screen.queryByText(OLD_REASON)).toBeNull();
  });

  it('shows the load-error state and no tiers for an unknown schema', () => {
    const retry = vi.fn();
    render(
      <ModelMatchSection
        state={{ status: 'error', failure: 'unknown-schema' }}
        onRetry={retry}
        onOpenLeaderboard={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load benchmark scores.");
    expect(screen.getByRole('alert')).toHaveAttribute('data-failure', 'unknown-schema');
    expect(screen.queryByText('Strong fit')).toBeNull();
    expect(screen.queryByText('Decent fit')).toBeNull();
    expect(screen.queryByText('Poor fit')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('uses one column until the large breakpoint without clipping overflow', () => {
    renderView(sampleView('A'));
    const section = screen.getByRole('region', { name: 'Models that fit your profile' });
    expect(section.className).not.toMatch(/overflow-x-hidden/);
    expect(section.className).toMatch(/min-w-0/);
    const list = screen.getByRole('list', { name: 'Strong fit' });
    expect(list.className).toMatch(/grid-cols-1/);
    expect(list.className).toMatch(/lg:grid-cols-2/);
  });

  it('renders nothing when the index has no runs', () => {
    const { container } = render(
      <ModelMatchSection state={{ status: 'empty' }} onRetry={vi.fn()} onOpenLeaderboard={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: 'Models that fit your profile' })).toBeNull();
    expect(screen.queryByText(STATUS_LABEL)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it.each(['missing-file', 'unknown-schema', 'match-rejected'] as const)(
    'shows an honest retry for a listed run that fails (%s)',
    (failure) => {
      const retry = vi.fn();
      render(
        <ModelMatchSection state={{ status: 'error', failure }} onRetry={retry} onOpenLeaderboard={vi.fn()} />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load benchmark scores.");
      expect(screen.getByRole('alert')).toHaveAttribute('data-failure', failure);
      expect(screen.queryByText('Strong fit')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledOnce();
    },
  );
});
