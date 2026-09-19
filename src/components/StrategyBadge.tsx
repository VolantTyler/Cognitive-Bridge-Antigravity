/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId } from 'react';
import { AlignmentStrategy } from '../types';
import { ALIGNMENT_STRATEGY_INFO } from '../constants';

const PILL_CLASS =
  'text-[10px] px-2 py-0.5 rounded font-medium bg-bg-tertiary border border-border-secondary text-text-muted';

interface StrategyBadgeProps {
  strategy: AlignmentStrategy;
  className?: string;
}

export default function StrategyBadge({ strategy, className = '' }: StrategyBadgeProps) {
  const tooltipId = useId();
  const info = ALIGNMENT_STRATEGY_INFO[strategy];

  return (
    <span className={`relative inline-flex group/strategy ${className}`}>
      <button
        type="button"
        className={`${PILL_CLASS} cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent`}
        aria-describedby={tooltipId}
      >
        {info.label}
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 w-max max-w-[min(16rem,calc(100vw-2rem))] rounded-md border border-border-secondary bg-bg-surface px-2.5 py-1.5 text-[10px] font-normal normal-case tracking-normal leading-snug text-text-secondary opacity-0 shadow-lg transition-opacity duration-150 group-hover/strategy:opacity-100 group-focus-within/strategy:opacity-100"
      >
        {info.tooltip}
      </span>
    </span>
  );
}
