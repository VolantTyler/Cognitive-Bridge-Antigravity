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
  /** Prefer "above" when a progress bar or other chrome sits below the badge (e.g. OCEAN desktop cards). */
  tooltipPlacement?: 'above' | 'below';
  'data-testid'?: string;
}

export default function StrategyBadge({
  strategy,
  className = '',
  tooltipPlacement = 'below',
  'data-testid': testId,
}: StrategyBadgeProps) {
  const tooltipId = useId();
  const info = ALIGNMENT_STRATEGY_INFO[strategy];

  const tooltipPositionClass =
    tooltipPlacement === 'above'
      ? 'bottom-full mb-1.5 left-0'
      : 'top-full mt-1.5 left-0';

  // Display classes belong on className so responsive hide/show (e.g. hidden md:inline-flex) is not overridden.
  const rootClassName = className
    ? `relative group/strategy isolate z-0 hover:z-50 focus-within:z-50 ${className}`
    : 'relative inline-flex group/strategy isolate z-0 hover:z-50 focus-within:z-50';

  return (
    <span className={rootClassName} data-testid={testId}>
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
        className={`strategy-badge-tooltip pointer-events-none absolute ${tooltipPositionClass} z-50 w-max max-w-[min(16rem,calc(100vw-2rem))] rounded-md border border-border-primary bg-bg-primary px-2.5 py-1.5 text-[10px] font-normal normal-case tracking-normal leading-snug text-text-secondary opacity-0 shadow-xl transition-opacity duration-150 group-hover/strategy:opacity-100 group-focus-within/strategy:opacity-100`}
      >
        {info.tooltip}
      </span>
    </span>
  );
}
