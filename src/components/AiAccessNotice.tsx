/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiAccessError } from '../services/aiAccess';

/** Inline notice for a locked AI call. Not a paywall screen. */
export default function AiAccessNotice({ error }: { error: AiAccessError | null }) {
  if (!error) return null;
  return (
    <p role="alert" data-ai-access={error.code} className="text-xs text-status-danger">
      {error.message}
    </p>
  );
}
