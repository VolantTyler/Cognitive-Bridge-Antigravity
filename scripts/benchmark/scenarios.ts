/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cognitive Bridge's live Mirror asks exactly five scenarios. Only the opening
 * demo question and the agreeableness/conscientiousness disambiguation probe
 * are fixed in product code; the middle three are invented per interviewee.
 * A benchmark cannot do that and still give every model the same prompts, so
 * those three are a frozen neutral battery. Scenario text is the entire user
 * message — no persona wrapper and no system prompt.
 */

import { INITIAL_MIRROR_MESSAGE, MIRROR_SYSTEM_PROMPT } from '../../src/constants';
import type { Scenario } from './types';

export function canonicalDemoScenario(welcome: string = INITIAL_MIRROR_MESSAGE): string {
  const start = welcome.indexOf('You are 10 minutes away');
  if (start < 0) {
    throw new Error('Canonical demo scenario is missing from INITIAL_MIRROR_MESSAGE');
  }
  return welcome.slice(start).trim();
}

export function canonicalDisambiguation(prompt: string = MIRROR_SYSTEM_PROMPT): string {
  const match = prompt.match(/DISAMBIGUATION SCENARIO[\s\S]*?\n"([^"]+)"/);
  if (!match) {
    throw new Error('Disambiguation scenario is missing from MIRROR_SYSTEM_PROMPT');
  }
  return `${match[1]} (Question 5/5)`;
}

const NOVELTY_SCENARIO =
  'Your team relies on a stable, well-documented tool you know thoroughly. A colleague proposes replacing it with an experimental approach that might work much better but is unstable and poorly documented. In the meeting, most people want to switch. What do you say and what do you do next? (Question 2/5)';

const SOCIAL_ENERGY_SCENARIO =
  'A one-week push can be done two ways: you work alone, quietly, and send the result at the end, or you work in a shared room with frequent discussion, thinking out loud with the group. Which do you choose, and what does that week actually look like for you? (Question 3/5)';

const CANDOR_SCENARIO =
  'A teammate presents a plan you are convinced will fail. The room is nodding and wants to move on. Do you challenge the plan directly, soften the point to keep the peace, or say nothing? What do you actually say in the room? (Question 4/5)';

export function interviewScenarios(): Scenario[] {
  return [
    { id: 'demo-bug', text: canonicalDemoScenario() },
    { id: 'novelty-rewrite', text: NOVELTY_SCENARIO },
    { id: 'solo-or-room', text: SOCIAL_ENERGY_SCENARIO },
    { id: 'plain-challenge', text: CANDOR_SCENARIO },
    { id: 'waived-deadline', text: canonicalDisambiguation() },
  ];
}
