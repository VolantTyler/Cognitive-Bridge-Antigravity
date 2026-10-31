/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EXTROVERSION_EXCLUSION_REASON, LEGACY_EXTROVERSION_EXCLUSION_REASONS, matchModels } from '../../../scripts/benchmark/match';
import type { ScoreFile, StrategyRow } from '../../../scripts/benchmark/types';
import shipped from '../../benchmark-runs/2026-10-30-original-four.json';
import {
  EXTROVERSION_SHORT,
  EXTROVERSION_WHY_BODY,
  EXTROVERSION_WHY_TITLE,
} from '../copy';
import ModelMatchSection from '../ModelMatchSection';
import { loadBundledModelMatch, resolveModelMatch } from '../loadRuns';

/** First Mirror preset: High Extroversion and Neuroticism. */
const preset = {
  openness: 50,
  conscientiousness: 50,
  extroversion: 90,
  agreeableness: 50,
  neuroticism: 85,
};

describe('shipped 2026-10-30 original-four run', () => {
  it('loads the real file through the loader and matchModels and renders the section', () => {
    const direct = matchModels(preset, shipped as ScoreFile);
    const state = loadBundledModelMatch(preset);

    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(state.view.context.repeats).toBe(10);
    expect(state.view.context.partial).toBe(false);
    expect(state.view.context.runLabel).toBe('default');
    expect(direct.models).toHaveLength(4);
    expect(state.view.match.models).toHaveLength(4);

    for (const model of state.view.match.models) {
      expect(model.tier).not.toBe('not_scored');
      expect(model.missing_traits).toEqual([]);
      const stats = state.view.statsById[model.model_id];
      expect(stats.scored_runs).toBe(10);
      expect(stats.failed_runs).toBe(0);
      expect(stats.fewer_runs).toBe(false);
      const fromMatch = direct.models.find((item) => item.model_id === model.model_id);
      expect(fromMatch?.tier).toBe(model.tier);
    }

    render(
      <ModelMatchSection state={state} onRetry={() => undefined} onOpenLeaderboard={() => undefined} />,
    );
    expect(screen.getByRole('heading', { name: 'Models that fit your profile' })).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load benchmark scores.")).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Not enough data' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(4);
    expect(screen.queryByText(/EXAMPLE DATA/)).toBeNull();
    const legacy = LEGACY_EXTROVERSION_EXCLUSION_REASONS[0];
    expect(JSON.stringify(shipped.strategy_table)).toContain(legacy);
    expect(JSON.stringify(shipped)).not.toContain(EXTROVERSION_EXCLUSION_REASON);
    expect(screen.getByText(EXTROVERSION_SHORT)).toBeVisible();
    expect(document.body.textContent).not.toContain(legacy);
    fireEvent.click(screen.getByRole('button', { name: EXTROVERSION_WHY_TITLE }));
    expect(screen.getByText(EXTROVERSION_WHY_BODY)).toBeVisible();
  });

  it('loads a file that stores the current exclusion sentence and rejects any other sentence', () => {
    const index = {
      runs: [{
        id: 'fresh',
        file: 'fresh.json',
        run_label: 'frontier',
        tested_at: '2026-10-31T00:00:00.000Z',
        repeats: 10,
      }],
    };
    const withReason = (reason: string) => {
      const file = structuredClone(shipped) as ScoreFile;
      for (const row of file.strategy_table as StrategyRow[]) {
        if (row.trait === 'extroversion') row.exclusion_reason = reason;
      }
      return file;
    };
    const current = resolveModelMatch(preset, index, { 'fresh.json': withReason(EXTROVERSION_EXCLUSION_REASON) });
    expect(current.status).toBe('ready');
    if (current.status !== 'ready') return;
    expect(current.view.match.models).toHaveLength(4);
    expect(current.view.match.strategy_table.filter((row) => row.trait === 'extroversion').every((row) => row.exclusion_reason === EXTROVERSION_EXCLUSION_REASON)).toBe(true);

    const other = 'Excluded from tiering: a different hypothesis. Means are still reported.';
    const rejected = withReason(other);
    expect(resolveModelMatch(preset, index, { 'fresh.json': rejected })).toEqual({ status: 'error', failure: 'match-rejected' });
    expect(() => matchModels(preset, rejected)).toThrow(/Any other exclusion wording fails this check/);
  });
});
