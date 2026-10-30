/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { matchModels } from '../../../scripts/benchmark/match';
import type { ScoreFile } from '../../../scripts/benchmark/types';
import shipped from '../../benchmark-runs/2026-10-30-original-four.json';
import ModelMatchSection from '../ModelMatchSection';
import { loadBundledModelMatch } from '../loadRuns';

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
  });
});
