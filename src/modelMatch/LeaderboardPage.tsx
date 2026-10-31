/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { LOAD_ERROR, MATCH_REJECTED_DETAIL, RETRY_LABEL } from './copy';
import { displayRunLabel, formatPoint, formatTestedOn, repeatCountLabel, traitLabel, type ModelMatchView } from './derive';
import type { ModelMatchState } from './loadRuns';
import { OCEAN_TRAITS } from '../../scripts/benchmark/types';

interface LeaderboardPageProps {
  state: ModelMatchState;
  onBack: () => void;
  onRetry: () => void;
  focusModelId?: string;
  timeZone?: string;
}

function anchorId(modelId: string): string {
  return `model-${modelId.replace(/[^a-z0-9]+/gi, '-')}`;
}

export default function LeaderboardPage({ state, onBack, onRetry, focusModelId, timeZone }: LeaderboardPageProps) {
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!focusModelId) return;
    document.getElementById(anchorId(focusModelId))?.scrollIntoView({ block: 'start' });
  }, [focusModelId]);

  const view: ModelMatchView | null = state.status === 'ready' ? state.view : null;
  const label = view ? displayRunLabel(view.context.runLabel) : null;

  return (
    <div id="benchmark-scores" className="model-match min-w-0 max-w-full">
      <button
        ref={backRef}
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-text-primary underline underline-offset-2"
      >
        Back to the Bridge
      </button>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight text-text-primary">Benchmark scores</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-secondary">
        Raw scores for the newest run. This page does not rank models, and it does not switch runs.
      </p>

      {state.status === 'loading' && <p className="mt-6 text-sm text-text-muted">Loading benchmark scores</p>}

      {state.status === 'error' && (
        <div className="mt-6 rounded-lg border border-border-primary bg-bg-secondary p-4" role="alert" data-failure={state.failure}>
          <p className="text-sm font-medium text-text-primary">{LOAD_ERROR}</p>
          {state.failure === 'match-rejected' && (
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{MATCH_REJECTED_DETAIL}</p>
          )}
          <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-button-brand px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white">
            {RETRY_LABEL}
          </button>
        </div>
      )}

      {view && (
        <div className="mt-6 space-y-8">
          <p className="text-sm text-text-muted">
            {formatTestedOn(view.context.generatedAt, timeZone)}. {repeatCountLabel(view.context.repeats)}.
            {label ? ` Run label: ${label}.` : ' No run label.'}
            {' '}Judge: {view.context.judgeModelId}.
          </p>
          {view.match.models.length === 0 && (
            <p className="text-sm text-text-secondary">Your profile isn't being matched. These are the raw scores from this run.</p>
          )}
          {Object.keys(view.statsById).sort((a, b) => a.localeCompare(b)).map((modelId) => {
            const stats = view.statsById[modelId];
            return (
              <section key={modelId} aria-labelledby={anchorId(modelId)} className="min-w-0">
                <h3 id={anchorId(modelId)} className="break-all font-mono text-sm font-semibold text-text-primary" tabIndex={-1}>
                  {modelId}
                </h3>
                <p className="mt-1 text-xs text-text-muted">
                  {stats ? formatTestedOn(stats.timestamp, timeZone) : 'tested on an unknown date'}
                  {stats?.fewer_runs ? ` · ${stats.scored_runs} of ${view.context.repeats} runs` : ''}
                </p>
                <div className="mt-3 max-w-full">
                  <table className="w-full table-fixed border-collapse text-left text-sm">
                    <caption className="sr-only">Raw trait scores for {modelId}</caption>
                    <thead>
                      <tr className="border-b border-border-primary text-xs text-text-muted">
                        <th scope="col" className="py-2 pr-3 font-semibold">Trait</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">Mean</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">Lowest</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">Highest</th>
                        <th scope="col" className="py-2 font-semibold">Runs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {OCEAN_TRAITS.map((trait) => {
                        const range = stats?.ranges[trait];
                        const quality = stats?.traits[trait];
                        return (
                          <tr key={trait} className="border-b border-border-primary/70">
                            <th scope="row" className="py-2 pr-3 font-medium break-words text-text-primary">{traitLabel(trait)}</th>
                            <td className="py-2 pr-3 tabular-nums text-text-secondary">{range?.mean == null ? '—' : formatPoint(range.mean)}</td>
                            <td className="py-2 pr-3 tabular-nums text-text-secondary">{range?.low == null ? '—' : formatPoint(range.low)}</td>
                            <td className="py-2 pr-3 tabular-nums text-text-secondary">{range?.high == null ? '—' : formatPoint(range.high)}</td>
                            <td className="py-2 tabular-nums text-text-secondary">
                              {range?.runs ?? '—'}
                              {quality?.wide_range ? ' · wide range' : ''}
                              {quality?.confidence === 'low' ? ' · low confidence' : ''}
                              {quality?.confidence === 'not_scored' ? ' · not scored' : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
