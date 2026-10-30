/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One committed folder of per-run score files, plus index.json.
 * The newest index entry is the run the Bridge shows. Tiers are computed
 * for that file only. A missing file or an unknown schema_version is a
 * load error, and an older run is not substituted in its place.
 */

import { matchModels } from '../../scripts/benchmark/match';
import {
  HYPOTHESIS_LABEL,
  SCORE_FILE_SCHEMA_VERSION,
  UNLABELED_RUN_LABEL,
  type ScoreFile,
} from '../../scripts/benchmark/types';
import type { OceanScores } from '../types';
import { buildView, type ModelMatchView } from './derive';

export interface RunIndexEntry {
  id: string;
  /** Basename inside the runs folder. Not a path. */
  file: string;
  run_label: string;
  /** UTC timestamp used only to choose the newest run. */
  tested_at: string;
  repeats: number;
}

export interface RunIndex {
  runs: RunIndexEntry[];
}

export type LoadFailure = 'missing-file' | 'unknown-schema' | 'unreadable' | 'match-rejected';

export type ModelMatchState =
  | { status: 'loading' }
  | { status: 'error'; failure: LoadFailure }
  | { status: 'ready'; view: ModelMatchView };

const modules = import.meta.glob('../benchmark-runs/*.json', { eager: true, import: 'default' });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function filesByBasename(source: Record<string, unknown>): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(source)) {
    const base = path.split('/').pop() ?? path;
    if (base === 'index.json') continue;
    files[base] = value;
  }
  return files;
}

export function parseRunIndex(value: unknown): RunIndex | null {
  if (!isRecord(value) || !Array.isArray(value.runs)) return null;
  const runs: RunIndexEntry[] = [];
  for (const entry of value.runs) {
    if (!isRecord(entry)) return null;
    if (typeof entry.id !== 'string' || entry.id.trim() === '') return null;
    if (typeof entry.file !== 'string' || entry.file.trim() === '') return null;
    if (typeof entry.run_label !== 'string') return null;
    if (typeof entry.tested_at !== 'string' || Number.isNaN(Date.parse(entry.tested_at))) return null;
    if (typeof entry.repeats !== 'number' || !Number.isFinite(entry.repeats)) return null;
    runs.push({
      id: entry.id,
      file: entry.file,
      run_label: entry.run_label,
      tested_at: entry.tested_at,
      repeats: entry.repeats,
    });
  }
  return { runs };
}

/** Newest tested_at. Equal timestamps break ties by id, ascending, so the choice is stable. */
export function selectNewestEntry(index: RunIndex): RunIndexEntry | null {
  if (index.runs.length === 0) return null;
  return [...index.runs].sort((a, b) => {
    const byDate = b.tested_at.localeCompare(a.tested_at);
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  })[0];
}

function fileNameAllowed(file: string): boolean {
  return file !== 'index.json' && !file.includes('/') && !file.includes('\\') && !file.includes('..');
}

/**
 * Schema is checked before any tier is computed. schema_version other than 4
 * never reaches matchModels.
 */
export function readScoreFile(
  entry: RunIndexEntry,
  files: Record<string, unknown>,
): { ok: true; file: ScoreFile } | { ok: false; failure: LoadFailure } {
  if (!fileNameAllowed(entry.file)) return { ok: false, failure: 'missing-file' };
  const raw = files[entry.file];
  if (raw == null) return { ok: false, failure: 'missing-file' };
  if (!isRecord(raw)) return { ok: false, failure: 'unreadable' };
  if (raw.schema_version !== SCORE_FILE_SCHEMA_VERSION) {
    return { ok: false, failure: 'unknown-schema' };
  }
  if (raw.label !== HYPOTHESIS_LABEL || !Array.isArray(raw.models)) {
    return { ok: false, failure: 'unreadable' };
  }
  const file = structuredClone(raw) as unknown as ScoreFile;
  if (typeof file.run_label !== 'string' || file.run_label.trim() === '') {
    file.run_label = UNLABELED_RUN_LABEL;
  }
  return { ok: true, file };
}

export function resolveModelMatch(
  scores: OceanScores,
  index: RunIndex,
  files: Record<string, unknown>,
): ModelMatchState {
  const entry = selectNewestEntry(index);
  if (!entry) return { status: 'error', failure: 'missing-file' };
  const read = readScoreFile(entry, files);
  if (read.ok === false) return { status: 'error', failure: read.failure };
  try {
    const match = matchModels(scores, read.file);
    return { status: 'ready', view: buildView(match, read.file) };
  } catch {
    return { status: 'error', failure: 'match-rejected' };
  }
}

function bundledIndex(): unknown {
  for (const [path, value] of Object.entries(modules)) {
    if (path.endsWith('index.json')) return value;
  }
  return undefined;
}

export function loadBundledModelMatch(scores: OceanScores): ModelMatchState {
  const index = parseRunIndex(bundledIndex());
  if (!index) return { status: 'error', failure: 'unreadable' };
  return resolveModelMatch(scores, index, filesByBasename(modules));
}
