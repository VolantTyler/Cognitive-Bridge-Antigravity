/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { LOW_CONFIDENCE_TAG, MODEL_SCORES_LINK, TECHNICAL_DETAIL, TIER_LABEL, WIDE_RANGE_TAG } from './copy';
import { formatTestedOn, repeatCountLabel, type CardModel } from './derive';
import RangeBar from './RangeBar';

function TierIcon({ tier }: { tier: 'strong' | 'decent' | 'poor' }) {
  if (tier === 'strong') {
    return (
      <svg aria-hidden="true" data-shape="circle" viewBox="0 0 12 12" className="h-3 w-3 shrink-0">
        <circle cx="6" cy="6" r="4" fill="currentColor" />
      </svg>
    );
  }
  if (tier === 'decent') {
    return (
      <svg aria-hidden="true" data-shape="dashed-circle" viewBox="0 0 12 12" className="h-3 w-3 shrink-0">
        <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.4" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" data-shape="square" viewBox="0 0 12 12" className="h-3 w-3 shrink-0">
      <rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 6h5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

interface ModelCardProps {
  card: CardModel;
  timeZone?: string;
  onOpenLeaderboard: (modelId: string) => void;
}

export default function ModelCard({ card, timeZone, onOpenLeaderboard }: ModelCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = `details-${card.modelId.replace(/[^a-z0-9]+/gi, '-')}`;
  const hasDetails = Boolean(card.technicalDetail || card.providerDetail || card.reasoningDetail);
  const tier = card.tier === 'not_scored' ? null : card.tier;

  return (
    <article className="min-w-0 rounded-xl border border-border-primary bg-bg-secondary p-4" data-model-id={card.modelId} data-tier={card.tier}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="break-all font-mono text-sm font-semibold text-text-primary">{card.modelId}</h4>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            <span>{formatTestedOn(card.timestampIso, timeZone)}</span>
            <span>{repeatCountLabel(card.repeats)}</span>
            {card.runLabelChip && (
              <span data-run-label={card.runLabelChip} className="rounded border border-current px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">
                {card.runLabelChip}
              </span>
            )}
          </p>
        </div>
        {card.showTierChip && tier && (
          <span
            data-tier-chip={tier}
            className={`inline-flex items-center gap-1.5 rounded-md border-[1.5px] border-current px-2 py-0.5 text-xs font-semibold text-text-primary ${tier === 'decent' ? 'border-dashed' : ''}`}
          >
            <TierIcon tier={tier} />
            {TIER_LABEL[tier]}
          </span>
        )}
      </div>

      {card.closeCallNote && (
        <p data-close-call="true" className="mt-2 max-w-full break-words text-xs leading-relaxed text-text-muted">
          {card.closeCallNote}
        </p>
      )}

      <p className="mt-3 text-sm leading-relaxed text-text-secondary">
        {card.sentence}
        {card.fewerRunsTag && (
          <span className="ml-2 inline-flex rounded border border-current px-1.5 py-0.5 align-middle text-[11px] font-medium text-text-muted">
            {card.fewerRunsTag}
          </span>
        )}
      </p>
      {card.relativeRankLabel && (
        <p className="mt-1 text-xs font-medium text-text-secondary">{card.relativeRankLabel}</p>
      )}
      {card.missingTraitLabel && (
        <p className="mt-1 text-sm text-text-secondary">{card.missingTraitLabel}</p>
      )}

      {card.rows.length > 0 && (
        <div className="mt-3 space-y-3">
          {card.rows.map((row) => (
            <div key={row.trait} data-trait={row.trait} className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                <span className="text-text-primary">{row.label}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-semibold tabular-nums text-text-primary">{Math.round(row.mean)}</span>
                  {row.wideRange && (
                    <span className="inline-flex items-center gap-1 rounded border border-current px-1.5 py-0.5 font-medium text-text-primary">
                      <svg aria-hidden="true" viewBox="0 0 12 8" className="h-2 w-3">
                        <path d="M0 8 L3 0 L6 8 L9 0 L12 8" fill="none" stroke="currentColor" strokeWidth="1" />
                      </svg>
                      {WIDE_RANGE_TAG}
                    </span>
                  )}
                  {row.lowConfidence && (
                    <span className="rounded border border-dotted border-current px-1.5 py-0.5 font-medium text-text-secondary">
                      {LOW_CONFIDENCE_TAG}
                    </span>
                  )}
                </span>
              </div>
              <RangeBar
                mean={row.mean}
                low={row.low}
                high={row.high}
                direction={row.direction}
                dashed={row.dashed}
                hatched={row.wideRange}
                ariaLabel={row.ariaLabel}
              />
              <p className="text-xs text-text-muted">{row.caption}</p>
            </div>
          ))}
        </div>
      )}

      {hasDetails && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((open) => !open)}
            className="text-xs font-semibold text-text-primary underline underline-offset-2"
          >
            {detailsOpen ? 'Hide details' : 'Details'}
          </button>
          {detailsOpen && (
            <div id={detailsId} className="mt-2 space-y-1 text-xs leading-relaxed text-text-muted">
              {card.providerDetail && <p>{card.providerDetail}</p>}
              {card.reasoningDetail && <p>{card.reasoningDetail}</p>}
              {card.technicalDetail && (
                <p>
                  <span className="font-semibold text-text-secondary">{TECHNICAL_DETAIL}. </span>
                  {card.technicalDetail}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <a
        href={`#model-${card.modelId.replace(/[^a-z0-9]+/gi, '-')}`}
        onClick={(event) => {
          event.preventDefault();
          onOpenLeaderboard(card.modelId);
        }}
        className="mt-3 inline-block text-xs text-text-secondary underline underline-offset-2"
      >
        {MODEL_SCORES_LINK}
      </a>
    </article>
  );
}
