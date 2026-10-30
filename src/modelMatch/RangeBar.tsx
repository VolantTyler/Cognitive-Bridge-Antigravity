/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
    <svg viewBox="0 0 100 36" role="img" aria-label={ariaLabel} className="block h-auto w-full max-w-full">
      <title>{ariaLabel}</title>
      {hatched && (
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width="2.2" height="2.2" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="2.2" stroke="var(--match-hatch)" strokeWidth="0.7" />
          </pattern>
        </defs>
      )}
      <line x1="0" x2="100" y1="16" y2="16" stroke="var(--match-axis)" strokeWidth="0.35" />
      <rect
        x={zoneX}
        y="7"
        width="50"
        height="18"
        fill="var(--match-zone)"
        stroke="var(--match-zone-edge)"
        strokeWidth="0.7"
      />
      <line x1="50" x2="50" y1="3" y2="28" stroke="var(--match-ink)" strokeWidth="0.45" />
      <rect
        data-band="range"
        data-dashed={dashed ? 'true' : 'false'}
        data-hatched={hatched ? 'true' : 'false'}
        x={start}
        y="10"
        width={width}
        height="12"
        fill={hatched ? `url(#${hatchId})` : 'var(--match-band)'}
        stroke="var(--match-tick)"
        strokeWidth={dashed ? 0.7 : 0}
        strokeDasharray={dashed ? '1.4 0.9' : undefined}
      />
      <rect data-mark="mean" x={tick - 0.45} y="6" width="0.9" height="20" fill="var(--match-tick)" />
      <text x="0" y="34.5" fontSize="3.1" fill="var(--match-axis)">0</text>
      <text x="50" y="34.5" fontSize="3.1" textAnchor="middle" fill="var(--match-axis)">50</text>
      <text x="100" y="34.5" fontSize="3.1" textAnchor="end" fill="var(--match-axis)">100</text>
    </svg>
  );
}
