/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function isStreamErrorText(text: string): boolean {
  return text.startsWith('Error connecting to');
}
