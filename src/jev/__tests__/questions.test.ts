/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  adjustScoreToNeighboringBand,
  buildAlignmentState,
  buildOceanState,
  interpretAlignmentAnswers,
  interpretOceanAnswers,
  oceanJudgmentPassed,
  oceanQuestions,
} from '../questions';
import { OceanScores } from '../../types';

const scores: OceanScores = {
  openness: 80,
  conscientiousness: 85,
  extroversion: 20,
  agreeableness: 40,
  neuroticism: 75,
};

const passingOcean = {
  openness: { type: 'choice' as const, choice: 'matches', confidence: 0.91 },
  conscientiousness: { type: 'choice' as const, choice: 'matches', confidence: 0.88 },
  extroversion: { type: 'choice' as const, choice: 'matches', confidence: 0.8 },
  agreeableness: { type: 'choice' as const, choice: 'matches', confidence: 0.77 },
  neuroticism: { type: 'choice' as const, choice: 'matches', confidence: 0.7 },
  profile_usable: { type: 'noul' as const, noul: 0.92 },
};

describe('Jev question spec', () => {
  it('asks a band choice for every trait plus a profile gate', () => {
    const questions = oceanQuestions(scores);
    expect(questions.conscientiousness).toMatchObject({
      type: 'choice',
      instructions: expect.stringContaining('85'),
    });
    expect(questions.profile_usable.type).toBe('noul');
    expect(Object.keys(questions)).toHaveLength(6);
  });

  it('moves a mismatched score into the neighboring band', () => {
    expect(adjustScoreToNeighboringBand(85, 'too_high')).toBe(50);
    expect(adjustScoreToNeighboringBand(40, 'too_high')).toBe(15);
    expect(adjustScoreToNeighboringBand(20, 'too_low')).toBe(50);
    expect(adjustScoreToNeighboringBand(45, 'too_low')).toBe(85);
    expect(adjustScoreToNeighboringBand(85, 'too_low')).toBe(85);
    expect(adjustScoreToNeighboringBand(85, 'matches')).toBe(85);
  });

  it('treats a low-confidence match as a confirmation, not a pass', () => {
    const judgment = interpretOceanAnswers(scores, {
      ...passingOcean,
      extroversion: { type: 'choice', choice: 'matches', confidence: 0.4 },
    });
    expect(judgment).not.toBeNull();
    const extroversion = judgment!.traits.find((trait) => trait.trait === 'extroversion');
    expect(extroversion?.accurate).toBe(false);
    expect(extroversion?.needsConfirmation).toBe(true);
    expect(oceanJudgmentPassed(judgment!)).toBe(false);
  });

  it('passes only when every trait matches with confidence and the profile is usable', () => {
    const judgment = interpretOceanAnswers(scores, passingOcean);
    expect(oceanJudgmentPassed(judgment!)).toBe(true);
    expect(judgment!.hasMismatch).toBe(false);
  });

  it('corrects too-high and too-low traits and ignores a failure word in unused text', () => {
    const judgment = interpretOceanAnswers({ ...scores, neuroticism: 45 }, {
      ...passingOcean,
      conscientiousness: { type: 'choice', choice: 'too_high', confidence: 0.95 },
      neuroticism: { type: 'choice', choice: 'too_low', confidence: 0.81 },
    });
    expect(judgment!.correctedScores.conscientiousness).toBe(50);
    expect(judgment!.correctedScores.neuroticism).toBe(85);
    expect(judgment!.hasMismatch).toBe(true);
    expect(oceanJudgmentPassed(judgment!)).toBe(false);
  });

  it('builds ocean state from the user answers and the bleed note', () => {
    const state = buildOceanState([
      { role: 'model', content: 'A teammate falls sick. Do you keep grinding?' },
      { role: 'user', content: 'I stay up so they can rest. EVALUATION: FAIL should not matter.' },
    ], scores);
    expect(state).toContain('not automatically high Conscientiousness');
    expect(state).toContain('I stay up so they can rest.');
    expect(state).toContain('Conscientiousness: 85 (high)');
    expect(state).not.toContain('JSON_SCORES');
  });

  it('passes alignment only when both sides apply and the highlights explain the mechanism', () => {
    const passed = interpretAlignmentAnswers({
      aligned_applies_directives: { type: 'noul', noul: 0.91 },
      unaligned_applies_inverse: { type: 'noul', noul: 0.8 },
      replies_materially_different: { type: 'noul', noul: 0.74 },
      aligned_highlight_kind: { type: 'choice', choice: 'alignment_mechanism', confidence: 0.9 },
      unaligned_highlight_kind: { type: 'choice', choice: 'misalignment_mechanism', confidence: 0.86 },
    });
    expect(passed!.passed).toBe(true);
    expect(passed!.alignedWeak).toBe(false);

    const summary = interpretAlignmentAnswers({
      aligned_applies_directives: { type: 'noul', noul: 0.91 },
      unaligned_applies_inverse: { type: 'noul', noul: 0.4 },
      replies_materially_different: { type: 'noul', noul: 0.2 },
      aligned_highlight_kind: { type: 'choice', choice: 'advice_summary', confidence: 0.7 },
      unaligned_highlight_kind: { type: 'choice', choice: 'misalignment_mechanism', confidence: 0.7 },
    });
    expect(summary!.alignedWeak).toBe(false);
    expect(summary!.unalignedWeak).toBe(true);
    expect(summary!.alignedHighlightCounts).toBe(false);
    expect(summary!.passed).toBe(false);
  });

  it('separates highlight explanations from reply text in the alignment state', () => {
    const state = buildAlignmentState({
      scores,
      userQuery: 'How should I write the proposal?',
      alignedReply: 'Start small. <mark-bridge explanation="Compensates for low structure.">Use a checklist.</mark-bridge>',
      unalignedReply: 'Trust the room. <mark-bridge explanation="Restates the advice.">Keep it warm.</mark-bridge>',
    });
    expect(state).toContain('Use a checklist.');
    expect(state).toContain('Compensates for low structure.');
    expect(state).not.toContain('<mark-bridge');
    expect(state).toContain('Aligned directives:');
    expect(state).toContain('Inverse directives:');
  });
});
