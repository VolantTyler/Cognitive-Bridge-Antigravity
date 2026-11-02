/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HYPOTHESIS_LABEL, type MatchResult, type ScoreFile } from '../../../scripts/benchmark/types';
import { realScoreFile } from '../__fixtures__/joinSamples';
import { CLOSE_CALL_NOTE, DECENT_SENTENCE } from '../copy';
import { buildView, closeCallFromDrivingLows } from '../derive';
import ModelMatchSection from '../ModelMatchSection';

const file = { ...realScoreFile, run_label: 'default' } as ScoreFile;

function trait(low: number, high: number, mean: number, direction: 'high' | 'low' = 'high') {
  return {
    strategy: 'congruent' as const,
    target_direction: direction,
    confidence: 'normal' as const,
    included_in_tier: true,
    exclusion_reason: null,
    user_score: 90,
    model_mean: mean,
    model_low: low,
    model_high: high,
  };
}

function viewFor(
  tier: 'strong' | 'decent' | 'poor',
  traits: MatchResult['models'][number]['traits'],
  driving: MatchResult['models'][number]['driving_traits'],
) {
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
      model_id: 'example/model',
      tier,
      driving_traits: driving,
      missing_traits: [],
      traits,
    }],
  };
  return buildView(match, file);
}

function renderCard(view: ReturnType<typeof viewFor>) {
  render(
    <ModelMatchSection
      state={{ status: 'ready', view }}
      onRetry={() => undefined}
      onOpenLeaderboard={() => undefined}
      timeZone="UTC"
    />,
  );
  const show = screen.queryByRole('button', { name: 'Show model cards' });
  if (show) fireEvent.click(show);
  const heading = screen.getByRole('heading', { level: 4, name: 'example/model' });
  const article = heading.closest('article');
  if (!article) throw new Error('missing card');
  return article;
}

describe('closeCallFromDrivingLows', () => {
  it('is true only when every driving low is exactly 50', () => {
    expect(closeCallFromDrivingLows([50])).toBe(true);
    expect(closeCallFromDrivingLows([50, 50])).toBe(true);
    expect(closeCallFromDrivingLows([50, 40])).toBe(false);
    expect(closeCallFromDrivingLows([40])).toBe(false);
    expect(closeCallFromDrivingLows([])).toBe(false);
  });
});

describe('Decent close-call wording', () => {
  it('shows Close call and the Charlie sentence when the blocking low is exactly 50', () => {
    const card = renderCard(viewFor('decent', {
      openness: trait(50, 90, 70),
    }, ['openness']));
    expect(within(card).getByText(DECENT_SENTENCE)).toBeInTheDocument();
    expect(within(card).getByText(CLOSE_CALL_NOTE)).toBeInTheDocument();
    expect(card.querySelector('[data-close-call]')).toHaveTextContent(CLOSE_CALL_NOTE);
    expect(within(card).getByText('Decent fit')).toBeInTheDocument();
  });

  it('shows the Charlie sentence and no close-call note when a run is below 50', () => {
    const card = renderCard(viewFor('decent', {
      openness: trait(40, 90, 70),
    }, ['openness']));
    expect(within(card).getByText(DECENT_SENTENCE)).toBeInTheDocument();
    expect(within(card).queryByText(CLOSE_CALL_NOTE)).toBeNull();
    expect(card.querySelector('[data-close-call]')).toBeNull();
    expect(card.textContent).not.toMatch(/Close call/);
  });

  it('does not say a run at exactly 50 crossed the midpoint', () => {
    const card = renderCard(viewFor('decent', {
      openness: trait(50, 90, 70),
    }, ['openness']));
    expect(card.textContent).not.toMatch(/crossed the midpoint/);
    expect(screen.getByRole('region').textContent).not.toMatch(/crossed the midpoint/);
  });

  it('leaves Strong and Poor cards unchanged', () => {
    const { unmount } = render(
      <ModelMatchSection
        state={{ status: 'ready', view: viewFor('strong', { openness: trait(60, 90, 80) }, ['openness']) }}
        onRetry={() => undefined}
        onOpenLeaderboard={() => undefined}
      />,
    );
    const strong = screen.getByRole('heading', { level: 4, name: 'example/model' }).closest('article');
    expect(strong).toBeTruthy();
    expect(within(strong as HTMLElement).getByText('Matches you on openness.')).toBeInTheDocument();
    expect(within(strong as HTMLElement).getByText('Strong fit')).toBeInTheDocument();
    expect(within(strong as HTMLElement).queryByText(DECENT_SENTENCE)).toBeNull();
    expect(within(strong as HTMLElement).queryByText(CLOSE_CALL_NOTE)).toBeNull();
    expect((strong as HTMLElement).textContent).not.toMatch(/crossed the midpoint/);
    unmount();

    const poor = renderCard(viewFor('poor', { openness: trait(20, 40, 30) }, ['openness']));
    expect(within(poor).getByText('Falls outside your target on openness.')).toBeInTheDocument();
    expect(within(poor).getByText('Poor fit')).toBeInTheDocument();
    expect(within(poor).queryByText(DECENT_SENTENCE)).toBeNull();
    expect(within(poor).queryByText(CLOSE_CALL_NOTE)).toBeNull();
    expect(poor.textContent).not.toMatch(/crossed the midpoint/);
  });

  it('wraps the close-call note at the card width', () => {
    const card = renderCard(viewFor('decent', {
      openness: trait(50, 90, 70),
    }, ['openness']));
    const note = card.querySelector('[data-close-call]');
    expect(note).toBeTruthy();
    expect(note?.className).toMatch(/break-words/);
    expect(note?.className).toMatch(/max-w-full/);
    expect(note?.className).not.toMatch(/whitespace-nowrap/);
    expect(note?.className).not.toMatch(/overflow-x/);
    expect(card.className).toMatch(/min-w-0/);
    const section = screen.getByRole('region', { name: 'Models that fit your profile' });
    expect(section.className).toMatch(/min-w-0/);
    expect(section.className).not.toMatch(/overflow-x/);
  });

  it('withholds the note when any driving trait scores below 50', () => {
    const card = renderCard(viewFor('decent', {
      openness: trait(50, 90, 70),
      conscientiousness: trait(45, 88, 72),
    }, ['openness', 'conscientiousness']));
    expect(within(card).getByText(DECENT_SENTENCE)).toBeInTheDocument();
    expect(within(card).queryByText(CLOSE_CALL_NOTE)).toBeNull();
  });

  it('does not treat a low-target high of 50 as a close call when the low is below 50', () => {
    const card = renderCard(viewFor('decent', {
      openness: trait(30, 50, 40, 'low'),
    }, ['openness']));
    expect(within(card).getByText(DECENT_SENTENCE)).toBeInTheDocument();
    expect(within(card).queryByText(CLOSE_CALL_NOTE)).toBeNull();
  });
});
