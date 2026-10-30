/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { STRATEGY_TABLE, matchModels } from '../../../scripts/benchmark/match';
import {
  HYPOTHESIS_LABEL,
  OCEAN_TRAITS,
  SCORE_FILE_SCHEMA_VERSION,
  type OceanTrait,
  type ScoreFile,
} from '../../../scripts/benchmark/types';
import { realScoreFile } from '../__fixtures__/joinSamples';
import {
  filesByBasename,
  loadBundledModelMatch,
  parseRunIndex,
  readScoreFile,
  resolveModelMatch,
  selectNewestEntry,
  type RunIndex,
} from '../loadRuns';

const neutral = {
  openness: 85,
  conscientiousness: 50,
  extroversion: 50,
  agreeableness: 50,
  neuroticism: 50,
};

function traitStats(mean: number) {
  return {
    mean,
    low: mean - 5,
    high: mean + 5,
    runs: 5,
    confidence: 'normal' as const,
    wide_range: false,
    fewer_runs: false,
  };
}

function tinyFile(id: string, mean: number, runLabel = 'original four'): ScoreFile {
  const traits = Object.fromEntries(OCEAN_TRAITS.map((trait: OceanTrait) => [trait, traitStats(mean)])) as ScoreFile['models'][number]['traits'];
  return {
    schema_version: SCORE_FILE_SCHEMA_VERSION,
    label: HYPOTHESIS_LABEL,
    spread_warning: false,
    spread_threshold: 10,
    wide_range_threshold: 40,
    trait_spread: {
      openness: null,
      conscientiousness: null,
      extroversion: null,
      agreeableness: null,
      neuroticism: null,
    },
    generated_at: '2026-11-02T00:00:00.000Z',
    run_label: runLabel,
    price_date: '2026-10-05',
    interview_temperature: 0,
    repeats: 5,
    partial: false,
    output_budget: { max_output_tokens: 8192, retry_max_output_tokens: 16384, reasoning_effort: 'minimal' },
    judge: { model_id: 'google/gemini-2.5-flash-lite', version: 'judge', recorded_at: '2026-11-02T00:00:00.000Z', temperature: 0 },
    strategy_table: STRATEGY_TABLE,
    confidence_policy: {
      published_trait_confidence: {
        openness: 'normal',
        conscientiousness: 'normal',
        extroversion: 'normal',
        agreeableness: 'normal',
        neuroticism: 'normal',
      },
    },
    models: [{
      id,
      version: id,
      timestamp: '2026-11-02T00:00:00.000Z',
      cost_usd: 0,
      wide_range: false,
      fewer_runs: false,
      scored_runs: 5,
      failed_runs: 0,
      not_scored_reason: null,
      failures: [],
      traits,
      runs: [],
    }],
  };
}

const entry = (id: string, file: string, tested_at: string) => ({
  id,
  file,
  run_label: 'original four',
  tested_at,
  repeats: 5,
});

describe('run index', () => {
  it('picks the newest tested_at and does not fall through when that file is missing', () => {
    const index: RunIndex = {
      runs: [
        entry('older', 'older.json', '2026-10-01T00:00:00.000Z'),
        entry('newer', 'newer.json', '2026-11-01T00:00:00.000Z'),
      ],
    };
    expect(selectNewestEntry(index)?.id).toBe('newer');
    const missing = resolveModelMatch(neutral, index, {
      'older.json': tinyFile('old/model', 80),
    });
    expect(missing).toEqual({ status: 'error', failure: 'missing-file' });
  });

  it('loads only the newest file', () => {
    const index: RunIndex = {
      runs: [
        entry('older', 'older.json', '2026-10-01T00:00:00.000Z'),
        entry('newer', 'newer.json', '2026-11-01T00:00:00.000Z'),
      ],
    };
    const state = resolveModelMatch(neutral, index, {
      'older.json': tinyFile('old/model', 80),
      'newer.json': tinyFile('new/model', 80),
    });
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(state.view.match.models.map((model) => model.model_id)).toEqual(['new/model']);
    expect(state.view.context.runLabel).toBe('original four');
  });

  it('treats an unknown schema_version as a load error and does not match', () => {
    const file = { ...tinyFile('new/model', 80), schema_version: 3 };
    const state = resolveModelMatch(neutral, { runs: [entry('bad', 'bad.json', '2026-11-01T00:00:00.000Z')] }, {
      'bad.json': file,
    });
    expect(state).toEqual({ status: 'error', failure: 'unknown-schema' });
    expect(readScoreFile(entry('bad', 'bad.json', '2026-11-01T00:00:00.000Z'), { 'bad.json': file }).ok).toBe(false);
  });

  it('rejects a file name that is not a basename in the runs folder', () => {
    const result = readScoreFile(
      entry('escape', '../secret.json', '2026-11-01T00:00:00.000Z'),
      { '../secret.json': tinyFile('x', 80) },
    );
    expect(result).toEqual({ ok: false, failure: 'missing-file' });
  });

  it('parses an empty index and the committed folder has no run', () => {
    expect(parseRunIndex({ runs: [] })).toEqual({ runs: [] });
    expect(parseRunIndex({ runs: [{ id: 1 }] })).toBeNull();
    const names = filesByBasename({
      '/src/benchmark-runs/index.json': { runs: [] },
      '/src/benchmark-runs/original-four.json': { schema_version: 4 },
    });
    expect(names['index.json']).toBeUndefined();
    expect(names['original-four.json']).toEqual({ schema_version: 4 });
    expect(resolveModelMatch(neutral, { runs: [] }, {})).toEqual({ status: 'empty' });
    const bundled = loadBundledModelMatch(neutral);
    expect(bundled).toEqual({ status: 'empty' });
  });
});

describe('2026-10-29 score file', () => {
  it('is schema 4 and has no run_label', () => {
    expect(realScoreFile.schema_version).toBe(4);
    expect(realScoreFile.label).toBe(HYPOTHESIS_LABEL);
    expect('run_label' in realScoreFile).toBe(false);
    expect(realScoreFile.repeats).toBe(10);
  });

  it('is rejected by matchModels because the extroversion exclusion_reason still quotes 55 and 61', () => {
    expect(JSON.stringify(realScoreFile.strategy_table)).toContain('between 55 and 61');
    expect(() => matchModels(neutral, realScoreFile)).toThrow(
      /Score file strategy_table does not match the in-code STRATEGY_TABLE, including a changed exclusion_reason/,
    );
  });

  it('surfaces that rejection as a load error with no view', () => {
    const state = resolveModelMatch(
      neutral,
      { runs: [entry('ten', 'scores-10run-2026-10-29.json', '2026-10-30T01:41:29.307Z')] },
      { 'scores-10run-2026-10-29.json': realScoreFile },
    );
    expect(state).toEqual({ status: 'error', failure: 'match-rejected' });
  });
});
