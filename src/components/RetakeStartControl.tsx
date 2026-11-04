/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RETAKE_START_WARNING, START_RETAKE } from "../constants/paywallCopy";

export default function RetakeStartControl({ onRetake }: { onRetake: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="min-h-11 underline text-sm" onClick={onRetake}>
        {START_RETAKE}
      </button>
      <p className="text-sm text-text-secondary">{RETAKE_START_WARNING}</p>
    </div>
  );
}
