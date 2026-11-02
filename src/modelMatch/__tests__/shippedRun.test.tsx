/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The shipped file is whichever schema-4 score file index.json lists.
 * These assertions do not name the original-four model ids.
 * That file still stores the legacy extroversion exclusion sentence, and
 * matchModels accepts it on read. New files stamp the current sentence.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EXTROVERSION_EXCLUSION_REASON, LEGACY_EXTROVERSION_EXCLUSION_REASONS, matchModels } from '../../../scripts/benchmark/match';
import { SCORE_FILE_SCHEMA_VERSION, type ScoreFile, type StrategyRow } from '../../../scripts/benchmark/types';
import indexJson from '../../benchmark-runs/index.json';
import shipped from '../../benchmark-runs/2026-10-30-original-four.json';
import {
  EXTROVERSION_SHORT,
  EXTROVERSION_WHY_BODY,
  EXTROVERSION_WHY_TITLE,
} from '../copy';
import { repeatCountLabel } from '../derive';
import ModelMatchSection from '../ModelMatchSection';
import {
  filesByBasename,
  loadBundledModelMatch,
  parseRunIndex,
  readScoreFile,
  resolveModelMatch,
  selectNewestEntry,
} from '../loadRuns';

const bundled = import.meta.glob('../../benchmark-runs/*.json', { eager: true, import: 'default' });

/** High openness, so a file with trait stats still produces one card per model. */
const openness = {
  openness: 90,
  conscientiousness: 50,
  extroversion: 50,
  agreeableness: 50,
  neuroticism: 50,
};

/** First Mirror preset: High Extroversion and Neuroticism. Shows the extroversion note. */
const highExtroversion = {
  openness: 50,
  conscientiousness: 50,
  extroversion: 90,
  agreeableness: 50,
  neuroticism: 85,
};

describe('shipped run', () => {
  it('loads the indexed 4-model schema-4 file without depending on model ids', () => {
    const index = parseRunIndex(indexJson);
    expect(index).not.toBeNull();
    if (!index) return;
    const entry = selectNewestEntry(index);
    expect(entry).not.toBeNull();
    if (!entry) return;
    const read = readScoreFile(entry, filesByBasename(bundled));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.file.schema_version).toBe(SCORE_FILE_SCHEMA_VERSION);
    expect(read.file.models).toHaveLength(4);

    const direct = matchModels(openness, read.file);
    const state = loadBundledModelMatch(openness);
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(state.view.match.models).toHaveLength(4);

    const fileIds = read.file.models.map((model) => model.id).sort();
    const matchedIds = state.view.match.models.map((model) => model.model_id).sort();
    expect(matchedIds).toEqual(fileIds);
    expect(direct.models.map((model) => model.model_id).sort()).toEqual(fileIds);
    for (const model of state.view.match.models) {
      const fromFile = direct.models.find((item) => item.model_id === model.model_id);
      expect(fromFile?.tier).toBe(model.tier);
    }

    render(
      <ModelMatchSection state={state} onRetry={() => undefined} onOpenLeaderboard={() => undefined} />,
    );
    expect(screen.getByRole('heading', { name: 'Models that fit your profile' })).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load benchmark scores/)).toBeNull();
    expect(screen.queryByText(/EXAMPLE DATA/)).toBeNull();
    const show = screen.queryByRole('button', { name: 'Show model cards' });
    if (show) fireEvent.click(show);
    const headings = screen.getAllByRole('heading', { level: 4 }).map((node) => node.textContent);
    expect(headings.slice().sort()).toEqual(fileIds);
  });

  it('shows the configured repeat count on a complete model and no second count', () => {
    const index = parseRunIndex(indexJson);
    expect(index).not.toBeNull();
    if (!index) return;
    const entry = selectNewestEntry(index);
    expect(entry).not.toBeNull();
    if (!entry) return;
    const read = readScoreFile(entry, filesByBasename(bundled));
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const complete = read.file.models.filter(
      (model) => model.fewer_runs !== true && model.scored_runs === read.file.repeats,
    );
    expect(complete.length).toBe(read.file.models.length);

    const state = loadBundledModelMatch(openness);
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    render(
      <ModelMatchSection state={state} onRetry={() => undefined} onOpenLeaderboard={() => undefined} />,
    );
    const headerCount = repeatCountLabel(read.file.repeats);
    for (const model of complete) {
      const heading = screen.getByRole('heading', { level: 4, name: model.id });
      const card = heading.closest('article');
      expect(card).toBeTruthy();
      if (!card) return;
      expect(within(card).getByText(headerCount)).toBeInTheDocument();
      expect(within(card).queryByText(new RegExp(`of ${read.file.repeats} runs`))).toBeNull();
    }
  });

  it('loads the shipped file through the legacy extroversion sentence and does not print it', () => {
    const legacy = LEGACY_EXTROVERSION_EXCLUSION_REASONS[0];
    expect(JSON.stringify(shipped.strategy_table)).toContain(legacy);
    expect(JSON.stringify(shipped)).not.toContain(EXTROVERSION_EXCLUSION_REASON);

    const direct = matchModels(highExtroversion, shipped as ScoreFile);
    const state = loadBundledModelMatch(highExtroversion);
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(direct.models).toHaveLength(4);
    expect(state.view.match.models).toHaveLength(4);
    expect(state.view.context.runLabel).toBe('default');
    expect(state.view.context.repeats).toBe(10);

    render(
      <ModelMatchSection state={state} onRetry={() => undefined} onOpenLeaderboard={() => undefined} />,
    );
    expect(screen.getByText(EXTROVERSION_SHORT)).toBeVisible();
    expect(document.body.textContent).not.toContain(legacy);
    expect(document.body.textContent).not.toContain(EXTROVERSION_EXCLUSION_REASON);
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
    const current = resolveModelMatch(highExtroversion, index, { 'fresh.json': withReason(EXTROVERSION_EXCLUSION_REASON) });
    expect(current.status).toBe('ready');
    if (current.status !== 'ready') return;
    expect(current.view.match.models).toHaveLength(4);
    expect(current.view.match.strategy_table.filter((row) => row.trait === 'extroversion').every((row) => row.exclusion_reason === EXTROVERSION_EXCLUSION_REASON)).toBe(true);

    const other = 'Excluded from tiering: a different hypothesis. Means are still reported.';
    const rejected = withReason(other);
    expect(resolveModelMatch(highExtroversion, index, { 'fresh.json': rejected })).toEqual({ status: 'error', failure: 'match-rejected' });
    expect(() => matchModels(highExtroversion, rejected)).toThrow(/Any other exclusion wording fails this check/);
  });
});
