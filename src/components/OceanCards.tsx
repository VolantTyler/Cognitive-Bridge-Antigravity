/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { OceanScores } from '../types';
import { STEERING_LIBRARY } from '../constants';
import StrategyBadge from './StrategyBadge';

interface OceanCardsProps {
  scores: OceanScores | null;
}

/**
 * Tile floor. auto-fit uses the card width, so a narrow demo column wraps
 * to two columns instead of forcing five viewport columns into that card.
 * The five-column `lg:` rule lived on main; squeezing it into the demo card
 * is what overlapped the labels.
 */
export const OCEAN_TILE_MIN_PX = 140;
export const OCEAN_TILE_PAD_X_PX = 16;
export const OCEAN_LABEL_FONT_PX = 10;

/** Conservative uppercase width. Fails before a nowrap label would spill the tile. */
export function oceanLabelFits(label: string, tilePx = OCEAN_TILE_MIN_PX): boolean {
  const inner = tilePx - OCEAN_TILE_PAD_X_PX;
  return label.length * OCEAN_LABEL_FONT_PX * 0.62 <= inner;
}

const TRAIT_CONFIG = {
  openness: {
    label: 'Openness',
    letter: 'O',
    color: 'text-accent-purple',
    bgBar: 'bg-accent-purple',
    bgShaded: 'bg-trait-openness-bg-shaded',
    bg: 'bg-trait-openness-bg'
  },
  conscientiousness: {
    label: 'Conscientiousness',
    letter: 'C',
    color: 'text-accent-blue',
    bgBar: 'bg-accent-blue',
    bgShaded: 'bg-trait-conscientiousness-bg-shaded',
    bg: 'bg-trait-conscientiousness-bg'
  },
  extroversion: {
    label: 'Extraversion',
    letter: 'E',
    color: 'text-accent-yellow',
    bgBar: 'bg-accent-yellow',
    bgShaded: 'bg-trait-extroversion-bg-shaded',
    bg: 'bg-trait-extroversion-bg'
  },
  agreeableness: {
    label: 'Agreeableness',
    letter: 'A',
    color: 'text-accent-green',
    bgBar: 'bg-accent-green',
    bgShaded: 'bg-trait-agreeableness-bg-shaded',
    bg: 'bg-trait-agreeableness-bg'
  },
  neuroticism: {
    label: 'Neuroticism',
    letter: 'N',
    color: 'text-accent-red',
    bgBar: 'bg-accent-red',
    bgShaded: 'bg-trait-neuroticism-bg-shaded',
    bg: 'bg-trait-neuroticism-bg'
  },
};

const TRAITS: (keyof OceanScores)[] = ['openness', 'conscientiousness', 'extroversion', 'agreeableness', 'neuroticism'];

export default function OceanCards({ scores }: OceanCardsProps) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      data-ocean-grid
      className="grid w-full gap-2"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${OCEAN_TILE_MIN_PX}px, 1fr))` }}
    >
      {TRAITS.map((trait) => {
        const config = TRAIT_CONFIG[trait];
        const value = scores ? scores[trait] : null;
        const hasScore = value !== null && value !== undefined;
        const activeDirective = hasScore
          ? STEERING_LIBRARY.find(
              (d) =>
                d.trait === trait &&
                ((d.threshold === 'high' && value! > 70) || (d.threshold === 'low' && value! < 30))
            )
          : undefined;

        return (
          <motion.div
            key={trait}
            data-ocean-tile
            initial={reduceMotion ? false : { y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.35 }}
            className={`min-w-0 overflow-hidden px-2 py-3 rounded-xl border border-border-primary ${config.bg} flex flex-col gap-2 relative group transition-colors duration-300`}
          >
            <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none" aria-hidden>
              {hasScore && (
                <div
                  className={`absolute left-0 top-0 bottom-0 ${config.bgShaded} opacity-20 transition-all duration-700`}
                  style={{ width: `${value}%` }}
                />
              )}
            </div>

            <div className="relative z-10 min-w-0">
              <span
                className={`text-2xl font-black font-mono leading-none tracking-normal select-none ${config.color}`}
              >
                {config.letter}
              </span>
              <span
                data-ocean-label
                className="mt-1 block max-w-full whitespace-nowrap text-[10px] font-bold uppercase leading-none tracking-normal text-text-primary"
              >
                {config.label}
              </span>
            </div>

            <div className="flex items-end gap-1 min-h-[2.25rem] relative z-10 opacity-100">
              <span className={`text-3xl font-mono font-bold tracking-tighter opacity-100 ${hasScore ? 'text-text-primary' : 'text-text-muted-darker'}`}>
                {hasScore ? value : '--'}
              </span>
              <span className={`text-[10px] mb-1.5 opacity-100 ${hasScore ? 'text-text-secondary' : 'text-text-muted-darker'}`}>/100</span>
            </div>

            <div className="h-2 bg-black/40 rounded-full overflow-hidden relative z-[1] border border-border-primary/10">
              <motion.div
                initial={reduceMotion ? false : { width: 0 }}
                animate={{ width: hasScore ? `${value}%` : '0%' }}
                transition={reduceMotion ? { duration: 0 } : undefined}
                className={`h-full ${config.bgBar} shadow-[0_0_10px_rgba(255,255,255,0.1)]`}
              />
            </div>

            {activeDirective && (
              <StrategyBadge
                strategy={activeDirective.strategy}
                className="inline-flex self-start relative z-10"
                data-testid="ocean-strategy-badge"
              />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
