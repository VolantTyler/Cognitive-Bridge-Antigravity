/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  INTERVIEW_COUNT_HREF,
  INTERVIEW_COUNT_LINK,
  INTERVIEWS_USED,
} from "../constants/paywallCopy";

export default function InterviewsUsedNotice() {
  return (
    <p role="status" className="text-sm text-text-secondary">
      {INTERVIEWS_USED}{" "}
      <a
        href={INTERVIEW_COUNT_HREF}
        className="inline-flex min-h-11 items-center underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
      >
        {INTERVIEW_COUNT_LINK}
      </a>
    </p>
  );
}
