/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dry-run and pre-call budgets count tokens from the real prompt strings.
 * This is a deterministic character estimate (4 characters ≈ 1 token) plus a
 * fixed per-message overhead. Live ledger rows prefer API usage when present.
 */

import type { ChatMessage } from './types';

export const CHARS_PER_TOKEN = 4;
export const MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (sum, message) => sum + estimateTokens(message.content) + MESSAGE_OVERHEAD_TOKENS,
    0,
  );
}
