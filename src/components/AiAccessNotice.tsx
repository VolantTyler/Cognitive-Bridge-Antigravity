/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiAccessError } from '../services/aiAccess';

/** Inline notice for a locked AI call. Not a paywall screen. Neutral, not an error alert. */
export default function AiAccessNotice({ error }: { error: AiAccessError | null }) {
  if (!error) return null;
  return (
    <p role="status" data-ai-access={error.code} className="text-xs text-text-secondary">
      {error.message}
    </p>
  );
}
