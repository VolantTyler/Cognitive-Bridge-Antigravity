/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import InterviewsUsedNotice from "./InterviewsUsedNotice";
import { VIEW_RESULTS } from "../constants/paywallCopy";

const MIRROR_INVITE =
  "You get along with certain people better than others. It's the same with your AI assistants. Answer a few questions and we'll map your OCEAN personality traits to make your AI fit YOU. (Or, pick one of the examples below to skip ahead!)";

export { MIRROR_INVITE };

export default function InterviewsExhausted({ onViewResults }: { onViewResults: () => void }) {
  return (
    <div className="flex max-w-2xl flex-col items-start gap-4">
      <InterviewsUsedNotice />
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded-lg bg-button-brand px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
        onClick={onViewResults}
      >
        {VIEW_RESULTS}
      </button>
    </div>
  );
}
