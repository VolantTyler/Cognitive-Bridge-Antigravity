/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface OceanScores {
  openness: number;
  conscientiousness: number;
  extroversion: number;
  agreeableness: number;
  neuroticism: number;
}

export type ModuleId = 'mirror' | 'tailor' | 'playground';

export interface Message {
  role: 'user' | 'model' | 'system';
  content: string;
}

export interface ComparisonMessage {
  user: string;
  aligned: string;
  unaligned: string;
  loading: boolean;
}

export type AlignmentStrategy = 'congruent' | 'complementary' | 'compensatory';

export interface SteeringDirective {
  trait: keyof OceanScores;
  threshold: 'high' | 'low';
  strategy: AlignmentStrategy;
  text: string;
}
