/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import spec from './questions.json';
import { getActiveDirectives, getInverseDirectives } from '../constants';
import { OceanScores } from '../types';

export const JEV_MODEL = spec.model;
export const TRAIT_MATCH_CONFIDENCE = spec.gates.traitMatchConfidence;
export const ALIGNMENT_NOUL = spec.gates.alignmentNoul;

export const OCEAN_TRAITS = [
  'openness',
  'conscientiousness',
  'extroversion',
  'agreeableness',
  'neuroticism',
] as const;

export type OceanTrait = (typeof OCEAN_TRAITS)[number];

export const TRAIT_LABELS: Record<OceanTrait, string> = {
  openness: 'Openness',
  conscientiousness: 'Conscientiousness',
  extroversion: 'Extroversion',
  agreeableness: 'Agreeableness',
  neuroticism: 'Neuroticism',
};

export const TRAIT_FIT = ['matches', 'too_high', 'too_low', 'insufficient_evidence'] as const;
export type TraitFit = (typeof TRAIT_FIT)[number];

export const HIGHLIGHT_KIND = ['alignment_mechanism', 'misalignment_mechanism', 'advice_summary', 'missing'] as const;
export type HighlightKind = (typeof HIGHLIGHT_KIND)[number];

export type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};

export type NoulQuestion = {
  type: 'noul';
  instructions: string;
};

export type JevQuestion = ChoiceQuestion | NoulQuestion;

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export type JevAnswer = ChoiceAnswer | NoulAnswer;
export type JevAnswers = Record<string, JevAnswer | undefined>;

export interface TraitJudgment {
  trait: OceanTrait;
  label: string;
  fit: TraitFit | 'unrecognized';
  confidence: number;
  accurate: boolean;
  needsConfirmation: boolean;
  proposed: number;
  corrected: number;
}

export interface OceanJudgment {
  traits: TraitJudgment[];
  profileUsable: number | null;
  profileUsableEnough: boolean;
  correctedScores: OceanScores;
  hasMismatch: boolean;
}

export interface AlignmentJudgment {
  alignedApplies: number | null;
  unalignedApplies: number | null;
  repliesMateriallyDifferent: number | null;
  alignedHighlightKind: HighlightKind | null;
  unalignedHighlightKind: HighlightKind | null;
  alignedHighlightCounts: boolean;
  unalignedHighlightCounts: boolean;
  alignedWeak: boolean;
  unalignedWeak: boolean;
  passed: boolean;
}

export interface DialogueTurn {
  role: string;
  content: string;
}

const BAND_CENTER = { low: 15, mid: 50, high: 85 } as const;
const MAX_SCENARIO_CHARS = 400;
const MAX_USER_CHARS = 1500;
const MAX_REPLY_CHARS = 4000;

export function scoreBand(value: number): 'low' | 'mid' | 'high' {
  if (value < 30) return 'low';
  if (value > 70) return 'high';
  return 'mid';
}

export function adjustScoreToNeighboringBand(value: number, fit: TraitFit): number {
  const band = scoreBand(value);
  if (fit === 'too_high') {
    if (band === 'high') return BAND_CENTER.mid;
    if (band === 'mid') return BAND_CENTER.low;
    return value;
  }
  if (fit === 'too_low') {
    if (band === 'low') return BAND_CENTER.mid;
    if (band === 'mid') return BAND_CENTER.high;
    return value;
  }
  return value;
}

function isTraitFit(value: string): value is TraitFit {
  return (TRAIT_FIT as readonly string[]).includes(value);
}

function isHighlightKind(value: string): value is HighlightKind {
  return (HIGHLIGHT_KIND as readonly string[]).includes(value);
}

function asChoice(answer: JevAnswer | undefined): ChoiceAnswer | null {
  if (!answer || answer.type !== 'choice' || typeof answer.choice !== 'string') return null;
  const confidence = typeof answer.confidence === 'number' ? answer.confidence : 0;
  return { type: 'choice', choice: answer.choice, confidence, probabilities: answer.probabilities };
}

function asNoul(answer: JevAnswer | undefined): number | null {
  if (!answer || answer.type !== 'noul' || typeof answer.noul !== 'number') return null;
  return answer.noul;
}

export function oceanQuestions(scores: OceanScores): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  for (const trait of OCEAN_TRAITS) {
    questions[trait] = {
      type: 'choice',
      instructions: spec.ocean.traitInstruction
        .replace('{label}', TRAIT_LABELS[trait])
        .replace('{score}', String(scores[trait])),
      criteria: spec.ocean.traitCriteria,
    };
  }
  questions.profile_usable = {
    type: 'noul',
    instructions: spec.ocean.profileUsable.instructions,
  };
  return questions;
}

export function alignmentQuestions(): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  for (const [key, question] of Object.entries(spec.alignment.questions)) {
    if (question.type === 'choice' && 'criteria' in question) {
      questions[key] = {
        type: 'choice',
        instructions: question.instructions,
        criteria: { ...question.criteria },
      };
      continue;
    }
    questions[key] = { type: 'noul', instructions: question.instructions };
  }
  return questions;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export function buildOceanState(messages: DialogueTurn[], scores: OceanScores): string {
  const lines: string[] = [
    'Known scoring bias:',
    spec.bleedNote,
    '',
    'Proposed scores (0-100). Bands: below 30 low, 30 to 70 mid, above 70 high.',
  ];
  for (const trait of OCEAN_TRAITS) {
    lines.push(`${TRAIT_LABELS[trait]}: ${scores[trait]} (${scoreBand(scores[trait])})`);
  }
  lines.push('', 'Dialogue:');

  let previousScenario = '';
  let userCount = 0;
  for (const message of messages) {
    if (message.role === 'model' || message.role === 'assistant') {
      const visible = message.content.split('JSON_SCORES:')[0];
      previousScenario = clip(visible, MAX_SCENARIO_CHARS);
      continue;
    }
    if (message.role !== 'user') continue;
    const answer = clip(message.content, MAX_USER_CHARS);
    if (!answer) continue;
    userCount += 1;
    if (previousScenario) {
      lines.push(`Scenario ${userCount}: ${previousScenario}`);
    }
    lines.push(`User ${userCount}: ${answer}`);
    previousScenario = '';
  }
  if (userCount === 0) {
    lines.push('The user has not answered yet.');
  }
  return lines.join('\n');
}

export interface HighlightPiece {
  text: string;
  explanation: string;
}

const HIGHLIGHT_PATTERN = /<mark-bridge explanation="([^"]*)">(.*?)<\/mark-bridge>/g;

export function splitHighlights(reply: string): { body: string; highlights: HighlightPiece[] } {
  const highlights: HighlightPiece[] = [];
  const body = reply.replace(HIGHLIGHT_PATTERN, (_match, explanation: string, text: string) => {
    highlights.push({ text, explanation });
    return text;
  });
  return { body, highlights };
}

function formatDirectives(directives: { strategy: string; text: string }[]): string {
  if (directives.length === 0) {
    return '- No extreme-trait directives. Expect a balanced professional tone.';
  }
  return directives.map((directive) => `- [${directive.strategy}] ${directive.text}`).join('\n');
}

function formatReply(title: string, reply: string): string {
  const { body, highlights } = splitHighlights(reply);
  const lines = [`${title}:`, clip(body, MAX_REPLY_CHARS)];
  if (highlights.length === 0) {
    lines.push('Highlight explanations: none');
    return lines.join('\n');
  }
  lines.push('Highlight explanations:');
  for (const highlight of highlights) {
    lines.push(`- "${clip(highlight.text, 300)}" — ${clip(highlight.explanation, 500)}`);
  }
  return lines.join('\n');
}

export function buildAlignmentState(input: {
  scores: OceanScores;
  userQuery: string;
  alignedReply: string;
  unalignedReply: string;
}): string {
  const scoreLines = OCEAN_TRAITS.map(
    (trait) => `${TRAIT_LABELS[trait]}: ${input.scores[trait]} (${scoreBand(input.scores[trait])})`
  );
  return [
    'Proposed scores (0-100). Bands: below 30 low, 30 to 70 mid, above 70 high.',
    ...scoreLines,
    '',
    'Aligned directives:',
    formatDirectives(getActiveDirectives(input.scores)),
    '',
    'Inverse directives:',
    formatDirectives(getInverseDirectives(input.scores)),
    '',
    'User request:',
    clip(input.userQuery, MAX_USER_CHARS),
    '',
    formatReply('Aligned reply', input.alignedReply),
    '',
    formatReply('Unaligned reply', input.unalignedReply),
  ].join('\n');
}

export function interpretOceanAnswers(scores: OceanScores, answers: JevAnswers): OceanJudgment | null {
  const traits: TraitJudgment[] = [];
  let recognized = 0;
  for (const trait of OCEAN_TRAITS) {
    const choice = asChoice(answers[trait]);
    if (!choice) continue;
    recognized += 1;
    const fit = isTraitFit(choice.choice) ? choice.choice : 'unrecognized';
    const accurate = fit === 'matches' && choice.confidence >= TRAIT_MATCH_CONFIDENCE;
    const needsConfirmation = !accurate;
    const corrected = fit === 'too_high' || fit === 'too_low'
      ? adjustScoreToNeighboringBand(scores[trait], fit)
      : scores[trait];
    traits.push({
      trait,
      label: TRAIT_LABELS[trait],
      fit,
      confidence: choice.confidence,
      accurate,
      needsConfirmation,
      proposed: scores[trait],
      corrected,
    });
  }
  if (recognized === 0) return null;

  const profileUsable = asNoul(answers.profile_usable);
  const correctedScores: OceanScores = { ...scores };
  for (const trait of traits) {
    correctedScores[trait.trait] = trait.corrected;
  }
  return {
    traits,
    profileUsable,
    profileUsableEnough: profileUsable !== null && profileUsable >= ALIGNMENT_NOUL,
    correctedScores,
    hasMismatch: traits.some((trait) => trait.fit === 'too_high' || trait.fit === 'too_low'),
  };
}

export function oceanJudgmentPassed(judgment: OceanJudgment): boolean {
  return judgment.profileUsableEnough
    && judgment.traits.length === OCEAN_TRAITS.length
    && judgment.traits.every((trait) => trait.accurate);
}

const ALIGNED_HIGHLIGHT = 'alignment_mechanism';
const UNALIGNED_HIGHLIGHT = 'misalignment_mechanism';

export function interpretAlignmentAnswers(answers: JevAnswers): AlignmentJudgment | null {
  const alignedApplies = asNoul(answers.aligned_applies_directives);
  const unalignedApplies = asNoul(answers.unaligned_applies_inverse);
  const repliesMateriallyDifferent = asNoul(answers.replies_materially_different);
  const alignedChoice = asChoice(answers.aligned_highlight_kind);
  const unalignedChoice = asChoice(answers.unaligned_highlight_kind);
  if (
    alignedApplies === null
    && unalignedApplies === null
    && repliesMateriallyDifferent === null
    && !alignedChoice
    && !unalignedChoice
  ) {
    return null;
  }

  const alignedHighlightKind = alignedChoice && isHighlightKind(alignedChoice.choice)
    ? alignedChoice.choice
    : null;
  const unalignedHighlightKind = unalignedChoice && isHighlightKind(unalignedChoice.choice)
    ? unalignedChoice.choice
    : null;
  const alignedHighlightCounts = alignedHighlightKind === ALIGNED_HIGHLIGHT;
  const unalignedHighlightCounts = unalignedHighlightKind === UNALIGNED_HIGHLIGHT;
  const alignedWeak = alignedApplies === null || alignedApplies < ALIGNMENT_NOUL;
  const unalignedWeak = unalignedApplies === null || unalignedApplies < ALIGNMENT_NOUL;
  const repliesDiffer = repliesMateriallyDifferent !== null && repliesMateriallyDifferent >= ALIGNMENT_NOUL;

  return {
    alignedApplies,
    unalignedApplies,
    repliesMateriallyDifferent,
    alignedHighlightKind,
    unalignedHighlightKind,
    alignedHighlightCounts,
    unalignedHighlightCounts,
    alignedWeak,
    unalignedWeak,
    passed: !alignedWeak && !unalignedWeak && alignedHighlightCounts && unalignedHighlightCounts && repliesDiffer,
  };
}

export function traitFitLabel(trait: TraitJudgment): string {
  if (trait.fit === 'matches' && trait.accurate) return 'Matches your answers';
  if (trait.fit === 'matches') return 'Uncertain match — confirm before you rely on it';
  if (trait.fit === 'too_high') return 'Higher than your answers support';
  if (trait.fit === 'too_low') return 'Lower than your answers support';
  if (trait.fit === 'insufficient_evidence') return 'Not enough in your answers to check this';
  return 'Could not read this check';
}

export function highlightKindLabel(kind: HighlightKind | null, side: 'aligned' | 'unaligned'): string {
  if (kind === 'alignment_mechanism' || kind === 'misalignment_mechanism') {
    return side === 'aligned' ? 'Explains the alignment mechanism' : 'Explains the misalignment mechanism';
  }
  if (kind === 'advice_summary') return 'Restates the advice';
  if (kind === 'missing') return 'No highlight explanation';
  return 'No reading';
}
