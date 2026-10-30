/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fixed thin track. Axis numbers sit in HTML so a stretched bar does not
 * stretch the type. The band is light and the mean tick is dark, so the
 * tick stays visible in grayscale.
 */

import { useId } from 'react';

interface RangeBarProps {
  mean: number;
  low: number;
  high: number;
  direction: 'high' | 'low';
  dashed: boolean;
  hatched: boolean;
  ariaLabel: string;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export default function RangeBar({ mean, low, high, direction, dashed, hatched, ariaLabel }: RangeBarProps) {
  const hatchId = useId().replace(/:/g, '');
  const start = clamp(Math.min(low, high));
  const end = clamp(Math.max(low, high));
  const width = Math.max(end - start, 0.8);
  const zoneX = direction === 'high' ? 50 : 0;
  const tick = clamp(mean);

  return (
    <div className="min-w-0">
      <svg
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        className="block h-7 w-full max-w-full"
      >
        <title>{ariaLabel}</title>
        {hatched && (
          <defs>
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width="1.6" height="1.6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="1.6" stroke="var(--match-hatch)" strokeWidth="0.45" />
            </pattern>
          </defs>
        )}
        <line x1="0" x2="100" y1="6" y2="6" stroke="var(--match-axis)" strokeWidth="0.25" />
        <rect
          x={zoneX}
          y="1.5"
          width="50"
          height="9"
          fill="var(--match-zone)"
          stroke="var(--match-zone-edge)"
          strokeWidth="0.45"
        />
        <line x1="50" x2="50" y1="0.4" y2="11.6" stroke="var(--match-ink)" strokeWidth="0.35" />
        <rect
          data-band="range"
          data-dashed={dashed ? 'true' : 'false'}
          data-hatched={hatched ? 'true' : 'false'}
          x={start}
          y="3"
          width={width}
          height="6"
          fill={hatched ? `url(#${hatchId})` : 'var(--match-band)'}
          stroke="var(--match-tick)"
          strokeWidth={dashed ? 0.45 : 0.2}
          strokeDasharray={dashed ? '1.1 0.7' : undefined}
        />
        <rect data-mark="mean" x={tick - 0.7} y="0.6" width="1.4" height="10.8" fill="var(--match-tick)" />
      </svg>
      <div className="flex justify-between text-[10px] leading-none text-text-muted" aria-hidden="true">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
    </div>
  );
}
