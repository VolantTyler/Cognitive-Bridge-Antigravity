/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RETAKE_START_ACCEPT, RETAKE_START_LEAVE, START_RETAKE } from "../constants/paywallCopy";

const NOTICE_ID = "retake-replaces-notice";

export default function RetakeStartControl({ onRetake }: { onRetake: () => void }) {
  return (
    <div className="flex w-full max-w-full flex-col items-start gap-2">
      <div id={NOTICE_ID} role="status" className="flex flex-col gap-2 text-sm text-text-secondary">
        <p>{RETAKE_START_ACCEPT}</p>
        <p>{RETAKE_START_LEAVE}</p>
      </div>
      <button
        type="button"
        className="min-h-11 underline text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
        aria-describedby={NOTICE_ID}
        onClick={onRetake}
      >
        {START_RETAKE}
      </button>
    </div>
  );
}
