/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The shipped file is whichever schema-4 score file index.json lists.
 * These assertions stay true for any valid 4-model file matchModels accepts.
 * They do not name the original-four model ids.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { matchModels } from '../../../scripts/benchmark/match';
import { SCORE_FILE_SCHEMA_VERSION } from '../../../scripts/benchmark/types';
import indexJson from '../../benchmark-runs/index.json';
import ModelMatchSection from '../ModelMatchSection';
import {
  filesByBasename,
  loadBundledModelMatch,
  parseRunIndex,
  readScoreFile,
  selectNewestEntry,
} from '../loadRuns';

const bundled = import.meta.glob('../../benchmark-runs/*.json', { eager: true, import: 'default' });

/** High openness, so a file with trait stats still produces one card per model. */
const preset = {
  openness: 90,
  conscientiousness: 50,
  extroversion: 50,
  agreeableness: 50,
  neuroticism: 50,
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

    const direct = matchModels(preset, read.file);
    const state = loadBundledModelMatch(preset);
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
});
