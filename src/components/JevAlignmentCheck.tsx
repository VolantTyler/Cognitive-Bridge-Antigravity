/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlignmentJudgment, highlightKindLabel } from '../jev/questions';

function percent(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

interface JevAlignmentCheckProps {
  judgment: AlignmentJudgment;
  focus?: 'aligned' | 'unaligned';
}

export default function JevAlignmentCheck({ judgment, focus }: JevAlignmentCheckProps) {
  const showAligned = focus !== 'unaligned';
  const showUnaligned = focus !== 'aligned';

  return (
    <div className="space-y-3" data-testid="jev-alignment-check">
      <p className="text-[10px] uppercase font-bold text-text-secondary tracking-wider">Independent check</p>
      {showAligned && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-secondary">Aligned applies directives</span>
            <span className="text-xs font-semibold text-text-primary">{percent(judgment.alignedApplies)}</span>
          </div>
          {judgment.alignedWeak && (
            <p className="text-[10px] uppercase font-bold tracking-wider text-status-danger">Weak alignment</p>
          )}
          <p className="text-[11px] text-text-secondary">
            {highlightKindLabel(judgment.alignedHighlightKind, 'aligned')}
          </p>
        </div>
      )}
      {showUnaligned && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-secondary">Unaligned applies inverse</span>
            <span className="text-xs font-semibold text-text-primary">{percent(judgment.unalignedApplies)}</span>
          </div>
          {judgment.unalignedWeak && (
            <p className="text-[10px] uppercase font-bold tracking-wider text-status-danger">Weak alignment</p>
          )}
          <p className="text-[11px] text-text-secondary">
            {highlightKindLabel(judgment.unalignedHighlightKind, 'unaligned')}
          </p>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-secondary">Replies differ</span>
        <span className="text-xs font-semibold text-text-primary">{percent(judgment.repliesMateriallyDifferent)}</span>
      </div>
    </div>
  );
}
