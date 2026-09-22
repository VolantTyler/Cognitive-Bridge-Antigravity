/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { OceanJudgment, traitFitLabel } from '../jev/questions';

interface OceanJudgmentPanelProps {
  judgment: OceanJudgment;
  onKeep: () => void;
  onAcceptCorrections: () => void;
}

export default function OceanJudgmentPanel({ judgment, onKeep, onAcceptCorrections }: OceanJudgmentPanelProps) {
  return (
    <div className="w-full max-w-xl flex flex-col gap-3 text-left">
      <div className="text-[10px] uppercase font-bold tracking-widest text-text-secondary text-center">
        Independent check against your answers
      </div>
      <p className="text-[11px] text-text-secondary text-center italic">
        {judgment.profileUsableEnough
          ? 'There is enough in your answers to check the profile.'
          : 'Your answers are thin for a full five-trait profile.'}
      </p>
      <ul className="flex flex-col gap-2">
        {judgment.traits.map((trait) => (
          <li
            key={trait.trait}
            className="flex items-start justify-between gap-3 rounded-lg border border-border-primary bg-bg-secondary/70 px-3 py-2"
          >
            <div>
              <div className="text-xs font-semibold text-text-primary">{trait.label}</div>
              <div className="text-[11px] text-text-secondary">{traitFitLabel(trait)}</div>
            </div>
            {trait.corrected !== trait.proposed && (
              <div className="text-[10px] uppercase tracking-wide text-accent-orange shrink-0">
                {trait.proposed} → {trait.corrected}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
        <button
          type="button"
          onClick={onKeep}
          className="px-5 py-3 rounded-full border border-border-primary bg-bg-secondary hover:bg-bg-tertiary text-text-primary font-bold text-[11px] uppercase tracking-widest cursor-pointer"
        >
          {judgment.hasMismatch ? 'Keep Mirror scores' : 'Proceed to Phase 2: The Tailor'}
        </button>
        {judgment.hasMismatch && (
          <button
            type="button"
            onClick={onAcceptCorrections}
            className="px-5 py-3 rounded-full bg-button-brand hover:bg-button-brand-hover text-white font-bold text-[11px] uppercase tracking-widest cursor-pointer"
          >
            Accept band corrections
          </button>
        )}
      </div>
    </div>
  );
}
