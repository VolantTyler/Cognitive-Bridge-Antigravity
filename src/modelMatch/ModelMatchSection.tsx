/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import {
  ALL_POOR,
  EXPLAINER,
  EXTROVERSION_SHORT,
  EXTROVERSION_WHY_BODY,
  EXTROVERSION_WHY_TITLE,
  HIDE_POOR_CARDS,
  HOW_MEASURED,
  LEADERBOARD_LINK,
  LEGEND_BAND,
  LEGEND_MEAN,
  LEGEND_ZONE,
  LOADING_LABEL,
  LOAD_ERROR,
  NO_TESTED_STRATEGY,
  RETRY_LABEL,
  SECTION_HEADING,
  SHOW_POOR_CARDS,
  STATUS_LABEL,
  TARGETS_HEADING,
  VERBATIM_HYPOTHESIS_LABEL,
} from './copy';
import { deriveSection, displayRunLabel, formatTestedOn, repeatCountLabel, type ModelMatchView } from './derive';
import type { ModelMatchState } from './loadRuns';
import ModelCard from './ModelCard';

interface ModelMatchSectionProps {
  state: ModelMatchState;
  onRetry: () => void;
  onOpenLeaderboard: (modelId?: string) => void;
  /** Tests pin a zone. Omitted in the app so the viewer's zone is used. */
  timeZone?: string;
  /** Screenshot preview opens the all-poor cards. The app leaves them closed. */
  initialPoorOpen?: boolean;
  /** Screenshot preview opens Charlie's extroversion paragraph. */
  initialWhyOpen?: boolean;
}

function Legend() {
  return (
    <ul aria-hidden="true" className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-muted">
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-3.5 border border-[var(--match-zone-edge)] bg-[var(--match-zone)]" />
        {LEGEND_ZONE}
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-3.5 bg-[var(--match-band)]" />
        {LEGEND_BAND}
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-0.5 bg-[var(--match-tick)]" />
        {LEGEND_MEAN}
      </li>
    </ul>
  );
}

export default function ModelMatchSection({ state, onRetry, onOpenLeaderboard, timeZone, initialPoorOpen = false, initialWhyOpen = false }: ModelMatchSectionProps) {
  const [whyOpen, setWhyOpen] = useState(initialWhyOpen);
  const [measuredOpen, setMeasuredOpen] = useState(false);
  const [poorOpen, setPoorOpen] = useState(initialPoorOpen);
  const ready = state.status === 'ready' ? deriveSection(state.view) : null;
  const showBars = ready != null && ready.groups.some((group) => group.models.some((card) => card.rows.length > 0));

  if (state.status === 'empty') return null;

  return (
    <section aria-labelledby="model-match-heading" role="region" className="model-match min-w-0 max-w-full" aria-busy={state.status === 'loading'}>
      <h2 id="model-match-heading" className="text-2xl font-semibold tracking-tight text-text-primary">
        {SECTION_HEADING}
      </h2>
      <p className="mt-2 max-w-full text-sm leading-relaxed break-words text-text-secondary">
        <span data-hypothesis-chip="true" className="mr-2 inline-flex max-w-full flex-wrap items-baseline gap-x-2 rounded border border-current px-2 py-0.5 align-middle text-xs text-text-primary">
          <span className="font-semibold">{STATUS_LABEL}</span>
          <span className="font-normal text-text-muted">{VERBATIM_HYPOTHESIS_LABEL}</span>
        </span>
        {EXPLAINER}{' '}
        <a
          href="#benchmark-scores"
          onClick={(event) => {
            event.preventDefault();
            onOpenLeaderboard();
          }}
          className="font-medium text-text-primary underline underline-offset-2"
        >
          {LEADERBOARD_LINK}
        </a>
      </p>

      {state.status === 'loading' && (
        <>
          <p className="mt-4 text-sm text-text-muted">{LOADING_LABEL}</p>
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden="true">
            <div className="min-h-[280px] rounded-xl border border-border-primary bg-bg-secondary" />
            <div className="min-h-[280px] rounded-xl border border-border-primary bg-bg-secondary" />
          </div>
        </>
      )}

      {state.status === 'error' && (
        <div className="mt-6 rounded-lg border border-border-primary border-l-4 border-l-[var(--match-ink)] bg-bg-secondary p-4" role="alert" data-failure={state.failure}>
          <p className="text-sm font-medium text-text-primary">{LOAD_ERROR}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-lg bg-button-brand px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"
          >
            {RETRY_LABEL}
          </button>
        </div>
      )}

      {ready && (
        <>
          {ready.chips.length > 0 && (
            <>
            <h3 className="mt-6 text-base font-semibold text-text-primary">{TARGETS_HEADING}</h3>
            <ul className="mt-2 flex list-none flex-wrap gap-2 p-0">
              {ready.chips.map((chip) => (
                <li key={chip.key}>
                  <span
                    data-muted={chip.muted ? 'true' : 'false'}
                    className={`inline-flex max-w-full flex-wrap items-baseline gap-x-2 rounded-full border px-3 py-1 text-sm ${chip.muted ? 'border-dashed text-text-muted' : 'border-border-primary bg-bg-secondary text-text-primary'}`}
                  >
                    <span>{chip.primary}</span>
                    {chip.secondary && <span className="text-xs text-text-muted">{chip.secondary}</span>}
                  </span>
                </li>
              ))}
            </ul>
            </>
          )}

          {ready.showExtroversionNote && (
            <div className="mt-3 max-w-3xl text-sm leading-relaxed text-text-muted">
              <p>{EXTROVERSION_SHORT}</p>
              <h3 className="mt-2 text-sm font-semibold text-text-primary">
                <button
                  type="button"
                  aria-expanded={whyOpen}
                  aria-controls="extroversion-why"
                  onClick={() => setWhyOpen((open) => !open)}
                  className="max-w-full text-left underline underline-offset-2"
                >
                  {EXTROVERSION_WHY_TITLE}
                </button>
              </h3>
              {whyOpen && (
                <p id="extroversion-why" className="mt-2">
                  {EXTROVERSION_WHY_BODY}
                </p>
              )}
            </div>
          )}

          {ready.showNeuroticismNote && (
            <p className="mt-3 max-w-3xl text-sm text-text-muted">{NO_TESTED_STRATEGY}</p>
          )}

          {showBars && <Legend />}

          {ready.emptyState && (
            <div className="mt-4 rounded-lg border border-border-primary border-l-4 border-l-[var(--match-ink)] bg-bg-secondary p-4" data-empty={ready.emptyState.kind}>
              <p className="text-sm leading-relaxed text-text-primary">{ready.emptyState.message}</p>
              <a
                href="#benchmark-scores"
                onClick={(event) => {
                  event.preventDefault();
                  onOpenLeaderboard();
                }}
                className="mt-2 inline-block text-sm font-medium text-text-primary underline underline-offset-2"
              >
                {LEADERBOARD_LINK}
              </a>
            </div>
          )}

          {ready.tieBanner && (
            <div className="mt-4 rounded-lg border border-border-primary border-l-4 border-l-[var(--match-ink)] bg-bg-secondary p-4" data-banner="tie">
              <p className="text-sm leading-relaxed text-text-primary">{ready.tieBanner}</p>
            </div>
          )}

          {ready.allPoor && (
            <div className="mt-4 rounded-lg border border-border-primary border-l-4 border-l-[var(--match-ink)] bg-bg-secondary p-4" data-banner="all-poor">
              <p className="text-sm font-medium leading-relaxed text-text-primary">{ALL_POOR}</p>
              <button
                type="button"
                aria-expanded={poorOpen}
                aria-controls="all-poor-cards"
                onClick={() => setPoorOpen((open) => !open)}
                className="mt-2 text-sm font-semibold text-text-primary underline underline-offset-2"
              >
                {poorOpen ? HIDE_POOR_CARDS : SHOW_POOR_CARDS}
              </button>
            </div>
          )}

          <div className="mt-6 space-y-8">
            {ready.groups.map((group) => {
              const hiddenPoor = group.collapsed && !poorOpen;
              if (hiddenPoor) return null;
              return (
                <div key={group.id} id={group.collapsed ? 'all-poor-cards' : undefined}>
                  <h3 id={`fit-${group.id}`} className="text-base font-semibold text-text-primary">{group.heading}</h3>
                  <ul aria-labelledby={`fit-${group.id}`} data-ordered={ready.orderedBy} className="mt-3 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-2">
                    {group.models.map((card) => (
                      <li key={card.modelId} className="min-w-0">
                        <ModelCard card={card} timeZone={timeZone} onOpenLeaderboard={onOpenLeaderboard} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {ready.rankingNote && (
            // Acceptance criterion 6 says the note appears once. Section 18 does not
            // place it. The sentence is about the whole run, so one copy under the
            // groups is true for every group that shows a within-tier rank.
            <p className="mt-4 text-sm text-text-secondary" data-ranking-note="true">{ready.rankingNote}</p>
          )}

          <div className="mt-8 border-t border-dashed border-border-primary pt-4">
            <button
              type="button"
              aria-expanded={measuredOpen}
              aria-controls="how-we-measured"
              onClick={() => setMeasuredOpen((open) => !open)}
              className="text-sm font-semibold text-text-primary underline underline-offset-2"
            >
              {HOW_MEASURED}
            </button>
            {measuredOpen && state.status === 'ready' && (
              <div id="how-we-measured" className="mt-2 max-w-3xl space-y-2 text-sm leading-relaxed text-text-muted">
                <MeasuredCopy view={state.view} timeZone={timeZone} />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function MeasuredCopy({ view, timeZone }: { view: ModelMatchView; timeZone?: string }) {
  const { context } = view;
  return (
    <>
      <p>
        Each model answered the same interview with no system prompt, {repeatCountLabel(context.repeats)}.
        One judge, {context.judgeModelId}, scored every answer.
        Benchmark date: {formatTestedOn(context.generatedAt, timeZone)}, in your time zone.
        Reasoning effort on this run: {context.reasoningEffort}.
        {context.partial ? ' This run did not finish every model.' : ''}
      </p>
      <p>
        Tiers come from this run only. A strong fit here is not compared with a strong fit from another run.
        A gap of about 10 points sits inside the run-to-run noise, so these cards do not treat it as a meaningful difference.
      </p>
      {displayRunLabel(context.runLabel) && <p>Run label: {context.runLabel}.</p>}
    </>
  );
}
