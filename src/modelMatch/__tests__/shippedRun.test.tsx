/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The shipped file is whichever schema-4 score file index.json lists.
 * These assertions do not name model ids except where the real frontier
 * file's known cases are checked: Grok's fewer runs, Opus's wide range,
 * and one provider per model.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EXTROVERSION_EXCLUSION_REASON, LEGACY_EXTROVERSION_EXCLUSION_REASONS, matchModels } from '../../../scripts/benchmark/match';
import { SCORE_FILE_SCHEMA_VERSION, type ScoreFile, type StrategyRow } from '../../../scripts/benchmark/types';
import indexJson from '../../benchmark-runs/index.json';
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

function indexedFile(): ScoreFile {
  const index = parseRunIndex(indexJson);
  if (!index) throw new Error('unreadable run index');
  const entry = selectNewestEntry(index);
  if (!entry) throw new Error('empty run index');
  const read = readScoreFile(entry, filesByBasename(bundled));
  if (read.ok === true) return read.file;
  throw new Error(read.failure);
}

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
    const short = read.file.models.filter((model) => model.fewer_runs === true);
    expect(complete.length).toBeGreaterThan(0);

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
    for (const model of short) {
      const heading = screen.getByRole('heading', { level: 4, name: model.id });
      const card = heading.closest('article');
      expect(card).toBeTruthy();
      if (!card) return;
      expect(within(card).getByText(`${model.scored_runs} of ${read.file.repeats} runs`)).toBeInTheDocument();
      expect(within(card).queryByText(headerCount)).toBeNull();
    }
  });

  it('stores the current extroversion sentence, not the legacy one, and does not print it', () => {
    const file = indexedFile();
    const legacy = LEGACY_EXTROVERSION_EXCLUSION_REASONS[0];
    const reasons = file.strategy_table.filter((row) => row.trait === 'extroversion').map((row) => row.exclusion_reason);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((reason) => reason === EXTROVERSION_EXCLUSION_REASON)).toBe(true);
    expect(JSON.stringify(file)).not.toContain(legacy);

    const direct = matchModels(highExtroversion, file);
    const state = loadBundledModelMatch(highExtroversion);
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(direct.models).toHaveLength(4);
    expect(state.view.match.models).toHaveLength(4);
    expect(state.view.context.runLabel).toBe('frontier');
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
        tested_at: '2026-11-02T16:03:28.019Z',
        repeats: 10,
      }],
    };
    const withReason = (reason: string) => {
      const file = structuredClone(indexedFile());
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

  it('renders Grok fewer-runs, Opus wide range, and one provider on the real file', () => {
    const file = indexedFile();
    const grok = file.models.find((model) => model.id === 'x-ai/grok-4.7');
    const opus = file.models.find((model) => model.id === 'anthropic/claude-opus-5.5');
    expect(grok?.fewer_runs).toBe(true);
    expect(grok?.scored_runs).toBe(7);
    expect(opus?.wide_range).toBe(true);
    expect(opus?.traits.conscientiousness.wide_range).toBe(true);
    expect(opus?.fewer_runs).not.toBe(true);

    const profile = {
      openness: 85,
      conscientiousness: 85,
      extroversion: 50,
      agreeableness: 70,
      neuroticism: 40,
    };
    const state = loadBundledModelMatch(profile);
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    render(
      <ModelMatchSection state={state} onRetry={() => undefined} onOpenLeaderboard={() => undefined} timeZone="America/New_York" />,
    );

    const grokCard = screen.getByRole('heading', { level: 4, name: 'x-ai/grok-4.7' }).closest('article');
    expect(grokCard).toBeTruthy();
    if (!grokCard) return;
    expect(within(grokCard).getByText('7 of 10 runs')).toBeInTheDocument();
    expect(within(grokCard).queryByText('10 repeats')).toBeNull();
    expect(within(grokCard).queryByText('7 repeats')).toBeNull();
    expect(grokCard.querySelector('[data-dashed="true"]')).toBeTruthy();
    expect(within(grokCard).getByText('frontier')).toBeInTheDocument();

    const opusCard = screen.getByRole('heading', { level: 4, name: 'anthropic/claude-opus-5.5' }).closest('article');
    expect(opusCard).toBeTruthy();
    if (!opusCard) return;
    expect(within(opusCard).getByText('Wide range')).toBeInTheDocument();
    expect(opusCard.querySelector('[data-trait="conscientiousness"] [data-hatched="true"]')).toBeTruthy();
    expect(within(opusCard).getByText('10 repeats')).toBeInTheDocument();
    expect(within(opusCard).queryByText(/of 10 runs/)).toBeNull();
    expect(within(opusCard).queryByText('Close call: one or more test runs landed exactly on the midpoint.')).toBeNull();

    for (const model of file.models) {
      expect(model.providers_seen).toHaveLength(1);
      const card = screen.getByRole('heading', { level: 4, name: model.id }).closest('article');
      expect(card).toBeTruthy();
      if (!card) return;
      expect(card.textContent).not.toMatch(/Served by/);
      fireEvent.click(within(card).getByRole('button', { name: 'Details' }));
      const seen = model.providers_seen?.[0];
      expect(card.textContent).toContain(`Served by ${seen?.provider} (${seen?.count}).`);
      expect(card.textContent).not.toMatch(/more than one provider/);
    }
  });
});
