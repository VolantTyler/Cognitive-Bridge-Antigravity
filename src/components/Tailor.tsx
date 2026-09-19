/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { OceanScores } from '../types';
import { getActiveDirectives, generatePortableMetadata } from '../constants';
import { Brain, ArrowRight, Dna, Activity, Users, ShieldAlert, Heart, Copy, Check, FileCode } from 'lucide-react';
import OceanCards from './OceanCards';
import StrategyBadge from './StrategyBadge';

interface TailorProps {
  scores: OceanScores;
  onNext: () => void;
}

const TRAIT_CONFIG = {
  openness: { label: 'Openness', color: 'text-accent-purple' },
  conscientiousness: { label: 'Conscientiousness', color: 'text-accent-blue' },
  extroversion: { label: 'Extroversion', color: 'text-accent-yellow' },
  agreeableness: { label: 'Agreeableness', color: 'text-accent-green' },
  neuroticism: { label: 'Neuroticism', color: 'text-accent-red' },
};

export default function Tailor({ scores, onNext }: TailorProps) {
  const [copied, setCopied] = useState(false);
  
  const activeDirectives = getActiveDirectives(scores);
  const showBleedChip = scores.agreeableness > 70 && scores.conscientiousness > 70;

  const handleCopy = () => {
    const text = generatePortableMetadata(scores);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col gap-6 overflow-hidden">
      <OceanCards scores={scores} />

      {showBleedChip && (
        <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[11px] text-amber-300 font-medium">
          Possible A↔C bleed — prefer Compassion vs Industriousness reading from interview
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        <div className="flex flex-col gap-4 overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-orange-500" />
              <h3 className="text-lg font-medium">Alignment Directives</h3>
            </div>
            <button 
              onClick={handleCopy}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] uppercase font-bold tracking-widest ${
                copied 
                  ? 'bg-green-500/20 border-green-500/50 text-green-400' 
                  : 'bg-bg-surface border border-border-secondary text-text-muted hover:text-text-primary hover:border-text-muted'
              }`}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied to Clipboard' : 'Export Portable Context'}
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
            {/* Meta context explanation */}
            <div className="p-4 bg-orange-500/5 border border-orange-500/20 rounded-lg">
               <div className="flex items-center gap-2 mb-2">
                  <FileCode className="w-4 h-4 text-orange-400" />
                  <span className="text-xs font-bold text-orange-400">ALIGNMENT.md Generator</span>
               </div>
               <p className="text-[11px] text-text-secondary leading-relaxed italic">
                 Click the export button above to copy a portable markdown snippet. You can paste this into ChatGPT, Claude, or any other AI to align that session with your Cognitive Bridge profile.
               </p>
            </div>

            {activeDirectives.length > 0 ? (
              activeDirectives.map((d, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="p-4 bg-bg-surface border border-border-primary rounded-lg group hover:border-orange-500/50 transition-colors duration-300"
                >
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${
                      d.threshold === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {d.threshold === 'high' ? 'High' : 'Low'} {TRAIT_CONFIG[d.trait].label}
                    </span>
                    <StrategyBadge strategy={d.strategy} />
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed italic">"{d.text}"</p>
                </motion.div>
              ))
            ) : (
              <div className="p-8 border border-dashed border-border-secondary rounded-xl flex flex-col items-center justify-center text-center gap-3 opacity-50">
                <ShieldAlert className="w-8 h-8" />
                <p className="text-sm">No critical trait spikes detected. <br/>Default professional alignment active.</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-bg-surface border border-border-primary rounded-xl p-6 flex flex-col gap-6 transition-colors duration-300">
          <div className="flex flex-col gap-2">
            <h3 className="text-xl font-bold tracking-tight">The "Tailor" Synthesis</h3>
            <p className="text-sm text-text-secondary">Your profile has been mapped to specific steering directives in the agent's logic. This ensures the model compensates for your biases and enhances your strengths.</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4 text-orange-500" />
              </div>
              <div>
                <h4 className="text-sm font-semibold">Recursive Memory</h4>
                <p className="text-xs text-text-secondary mt-1">Directives injected via system prompt to guide procedural skills.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                <Heart className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <h4 className="text-sm font-semibold">Bias Mitigation</h4>
                <p className="text-xs text-text-secondary mt-1">Programmatically reduces agreeableness bias based on your score.</p>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-6 border-t border-border-primary">
            <button 
              onClick={onNext}
              className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-all shadow-xl shadow-orange-500/20 flex items-center justify-center gap-2 group"
            >
              Initialize Aligned Agent
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
