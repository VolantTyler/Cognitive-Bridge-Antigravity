import { describe, it, expect } from 'vitest';
import {
  STEERING_LIBRARY,
  getActiveDirectives,
  generateAlignmentPrompt,
  generateAgentCheatSheet,
  generateInverseAlignmentPrompt,
  generatePortableMetadata,
  MIRROR_SYSTEM_PROMPT,
  ALIGNMENT_STRATEGY_INFO,
  COGNITIVE_BRIDGE_APP_URL,
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

describe('portable exports', () => {
  const scores: OceanScores = {
    openness: 85,
    conscientiousness: 15,
    extroversion: 50,
    agreeableness: 90,
    neuroticism: 20,
  };

  it('includes strategy definitions, in-repo research framing, and the app link', () => {
    const markdown = generatePortableMetadata(scores);

    expect(markdown).toContain(ALIGNMENT_STRATEGY_INFO.congruent.tooltip);
    expect(markdown).toContain(ALIGNMENT_STRATEGY_INFO.compensatory.tooltip);
    expect(markdown).toContain(ALIGNMENT_STRATEGY_INFO.complementary.tooltip);
    expect(markdown).toContain('Complementarity + congruence (research matrix)');
    expect(markdown).toContain('Similarity-attraction / amplify extremes');
    expect(markdown).toContain(COGNITIVE_BRIDGE_APP_URL);
    expect(markdown).toContain('does not include bibliographic citations or article URLs');
    expect(markdown).not.toMatch(/doi\.org|arxiv\.org/);
  });

  it('agent cheat sheet maps each active trait to its directive and badge', () => {
    const sheet = generateAgentCheatSheet(scores);

    expect(sheet).toContain('**Openness** (high, 85/100) — badge: congruent');
    expect(sheet).toContain('Explore novel angles, theoretical mechanisms');
    expect(sheet).toContain('**Conscientiousness** (low, 15/100) — badge: compensatory');
    expect(sheet).toContain('**Agreeableness** (high, 90/100) — badge: congruent');
    expect(sheet).toContain('**Neuroticism** (low, 20/100) — badge: complementary');
    expect(sheet).toContain('* **Extroversion:** 50/100');
    expect(sheet).not.toMatch(/\*\*Extroversion\*\* \(/);
    expect(sheet).toContain(ALIGNMENT_STRATEGY_INFO.congruent.tooltip);
    expect(sheet).toContain(COGNITIVE_BRIDGE_APP_URL);
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
