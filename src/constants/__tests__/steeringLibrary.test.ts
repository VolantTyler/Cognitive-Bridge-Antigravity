import { describe, it, expect } from 'vitest';
import {
  STEERING_LIBRARY,
  getActiveDirectives,
  generateAlignmentPrompt,
  generateInverseAlignmentPrompt,
  MIRROR_SYSTEM_PROMPT,
} from '../../constants';
import { OceanScores } from '../../types';

function directiveTextFor(scores: OceanScores, trait: keyof OceanScores): string | undefined {
  return getActiveDirectives(scores).find((d) => d.trait === trait)?.text;
}

describe('STEERING_LIBRARY (doc 02 matrix)', () => {
  it('has strategy tags on every directive', () => {
    expect(STEERING_LIBRARY).toHaveLength(10);
    for (const d of STEERING_LIBRARY) {
      expect(['congruent', 'complementary', 'compensatory']).toContain(d.strategy);
    }
  });

  it('high Agreeableness produces supportive congruent directive, not adversarial', () => {
    const scores: OceanScores = {
      openness: 50,
      conscientiousness: 50,
      extroversion: 50,
      agreeableness: 85,
      neuroticism: 50,
    };
    const text = directiveTextFor(scores, 'agreeableness') ?? '';
    expect(text.toLowerCase()).toMatch(/supportive|empathetic|diplomatic|rapport/);
    expect(text.toLowerCase()).not.toMatch(/adversarial|critical|challenge/);
  });

  it('low Extraversion produces concise low-friction directive, not bubbly', () => {
    const scores: OceanScores = {
      openness: 50,
      conscientiousness: 50,
      extroversion: 15,
      agreeableness: 50,
      neuroticism: 50,
    };
    const text = directiveTextFor(scores, 'extroversion') ?? '';
    expect(text.toLowerCase()).toMatch(/concise|low-friction|directly with the answer/);
    expect(text.toLowerCase()).not.toMatch(/high-energy|enthusiastic|bubbly|friendly language to engage/);
  });

  it('high Conscientiousness produces density/precision, not flexibility', () => {
    const scores: OceanScores = {
      openness: 50,
      conscientiousness: 85,
      extroversion: 50,
      agreeableness: 50,
      neuroticism: 50,
    };
    const text = directiveTextFor(scores, 'conscientiousness') ?? '';
    expect(text.toLowerCase()).toMatch(/high-density|precision|rigorously structured/);
    expect(text.toLowerCase()).not.toMatch(/flexible|spontaneous|organic flow/);
  });

  it('generateAlignmentPrompt prefixes directives with strategy tags', () => {
    const scores: OceanScores = {
      openness: 50,
      conscientiousness: 85,
      extroversion: 50,
      agreeableness: 85,
      neuroticism: 50,
    };
    const prompt = generateAlignmentPrompt(scores);
    expect(prompt).toContain('ALIGNMENT THEORY (Cognitive Bridge)');
    expect(prompt).toContain('- [congruent]');
    expect(prompt).toContain('<mark-bridge');
    expect(prompt).toContain('alignment mechanics');
    expect(prompt).toContain('NEVER describe reinforcing bias');
  });

  it('generateAlignmentPrompt uses neutral highlight rubric when no directives apply', () => {
    const scores: OceanScores = {
      openness: 50,
      conscientiousness: 50,
      extroversion: 50,
      agreeableness: 50,
      neuroticism: 50,
    };
    const prompt = generateAlignmentPrompt(scores);
    expect(getActiveDirectives(scores)).toHaveLength(0);
    expect(prompt).toContain('no critical trait spikes');
    expect(prompt).toContain('Do NOT invent a congruent, compensatory, or complementary strategy');
    expect(prompt).not.toContain('active directive strategy (congruent, compensatory, or complementary)');
  });

  it('generateInverseAlignmentPrompt uses neutral highlight rubric when no misalignment directives apply', () => {
    const scores: OceanScores = {
      openness: 50,
      conscientiousness: 50,
      extroversion: 50,
      agreeableness: 50,
      neuroticism: 50,
    };
    const prompt = generateInverseAlignmentPrompt(scores);
    expect(prompt).toContain('mid-range OCEAN profile with no trait spikes');
    expect(prompt).not.toContain('Name the OCEAN trait spike(s) being reinforced');
  });

  it('generateInverseAlignmentPrompt forbids aligned explanation language', () => {
    const scores: OceanScores = {
      openness: 50,
      conscientiousness: 15,
      extroversion: 50,
      agreeableness: 90,
      neuroticism: 50,
    };
    const prompt = generateInverseAlignmentPrompt(scores);
    expect(prompt).toContain('MIS-ALIGNMENT DIRECTIVES');
    expect(prompt).toContain('NEVER use language like "balances"');
    expect(prompt).toContain('what an aligned response would do differently');
  });
});

describe('MIRROR_SYSTEM_PROMPT bleed rules', () => {
  it('includes dual-attribution rules and waived-deadline probe', () => {
    expect(MIRROR_SYSTEM_PROMPT).toContain('TRAIT BLEED / ASPECT DISAMBIGUATION');
    expect(MIRROR_SYSTEM_PROMPT).toContain('Working overnight / taking on extra work');
    expect(MIRROR_SYSTEM_PROMPT).toContain('Management officially waives the deadline');
    expect(MIRROR_SYSTEM_PROMPT).toContain('bleed_risk: agreeableness_vs_conscientiousness');
    expect(MIRROR_SYSTEM_PROMPT).toContain('exactly 5 scenarios/questions');
  });
});
