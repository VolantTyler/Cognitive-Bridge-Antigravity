/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { OceanScores } from '../types';
import { STEERING_LIBRARY } from '../constants';
import StrategyBadge from './StrategyBadge';

interface OceanCardsProps {
  scores: OceanScores | null;
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
    label: 'Extroversion',
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
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 w-full">
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
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-xl border border-border-primary ${config.bg} flex flex-col gap-3 relative group transition-colors duration-300`}
          >
            {/* Shaded background — clipped separately so strategy tooltips are not cut off */}
            <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none" aria-hidden>
              {hasScore && (
                <div
                  className={`absolute left-0 top-0 bottom-0 ${config.bgShaded} opacity-20 transition-all duration-700`}
                  style={{ width: `${value}%` }}
                />
              )}
            </div>

            <div className="flex items-start gap-2 min-w-0 relative z-10">
              <span
                className={`text-2xl font-black font-mono leading-none tracking-normal select-none shrink-0 ${config.color}`}
              >
                {config.letter}
              </span>
              <span className="text-[10px] uppercase font-bold tracking-[0.1em] text-text-muted group-hover:text-text-secondary transition-colors leading-snug pt-0.5">
                {config.label}
              </span>
            </div>

            <div className="flex items-end gap-1 min-h-[2.25rem] relative z-10">
              <span className={`text-3xl font-mono font-bold tracking-tighter ${hasScore ? 'text-text-primary' : 'text-text-muted-darker'}`}>
                {hasScore ? value : '--'}
              </span>
              <span className={`text-[10px] mb-1.5 ${hasScore ? 'text-text-muted-dark' : 'text-text-muted-darker'}`}>/100</span>
            </div>

            <div className="h-2 bg-black/40 rounded-full overflow-hidden relative z-[1] border border-border-primary/10">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: hasScore ? `${value}%` : '0%' }}
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
