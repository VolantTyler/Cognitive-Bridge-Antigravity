/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * User-facing sentences for the model-match section. The stored exclusion_reason
 * is never one of these strings.
 */

import { HYPOTHESIS_LABEL } from '../../scripts/benchmark/types';

export const SECTION_HEADING = 'Models that fit your profile';

/** Brief's visible status. Shown without a hover or a disclosure. */
export const STATUS_LABEL = 'Design hypothesis, not validated';

/** Score-file label, shown verbatim only when it is not this generic line. */
export const VERBATIM_HYPOTHESIS_LABEL = HYPOTHESIS_LABEL;

function normalizeHypothesisText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Secondary chip text. Hidden when it repeats the primary line, or when the
 * score file still carries the generic hypothesis label.
 */
export function secondaryHypothesisLabel(fileLabel: string | null | undefined): string | null {
  if (fileLabel == null) return null;
  const trimmed = fileLabel.trim();
  if (trimmed === '') return null;
  const normalized = normalizeHypothesisText(trimmed);
  if (normalized === normalizeHypothesisText(STATUS_LABEL)) return null;
  if (normalized === normalizeHypothesisText(VERBATIM_HYPOTHESIS_LABEL)) return null;
  return trimmed;
}

export const EXPLAINER =
  "This matching approach is our best research-based guess and hasn't been tested with real users yet.";

export const LEADERBOARD_LINK = 'See all benchmark scores';

export const MODEL_SCORES_LINK = 'See all scores for this model';

export const LOAD_ERROR = "We couldn't load benchmark scores.";

/**
 * Shown with LOAD_ERROR when matchModels rejects the file. The stored
 * exclusion sentence is not quoted here.
 */
export const MATCH_REJECTED_DETAIL =
  "This file's strategy table does not match the current table, including a changed exclusion sentence. Matching stays off so the cards are not scored against a different hypothesis.";

export const RETRY_LABEL = 'Retry';

export const LOADING_LABEL = 'Loading benchmark scores';

export const HOW_MEASURED = 'How we measured this';

export const TARGETS_HEADING = 'What you asked for';

export const EXTROVERSION_CHIP = 'Extroversion: not used';

/** Spec 14b, short footnote under the chip. */
export const EXTROVERSION_SHORT =
  "Extroversion isn't used to rank models. In our tests, every model landed in a similar middle range on it, so it couldn't tell them apart.";

/** Title of Charlie's disclosure. The body is EXTROVERSION_WHY_BODY, with no numbers. */
export const EXTROVERSION_WHY_TITLE = "Why we don't use extroversion to pick a model";

export const EXTROVERSION_WHY_BODY =
  "We tested each AI model on all five personality traits, repeating the test many times. On extroversion, every model landed a little above the middle of the scale. Scores for the same model also moved around a lot from one run to the next. Because the models look alike on this trait, and the results aren't steady enough to tell them apart, ranking models by it would suggest a difference we can't show. We'll revisit this as we test more models. If extroversion is your strongest trait, we don't have a strong model recommendation for you yet.";

/** Spec 14b, only when extroversion is the only active target. */
export const EXTROVERSION_ONLY =
  "Your strongest trait is extroversion, which we don't use for matching, so we don't have a strong model recommendation for you.";

export const NEUROTICISM_CHIP = 'Neuroticism: not used';

export const NO_TESTED_STRATEGY = 'No tested strategy for this trait yet.';

export const NO_RECOMMENDATION = "We don't have a strong model recommendation for you.";

export const BALANCED_PROFILE =
  'Your profile is balanced enough that no single model stands out.';

export const ALL_POOR =
  'None of the models we tested fit this part of your profile.';

export const SHOW_POOR_CARDS = 'Show model cards';

export const HIDE_POOR_CARDS = 'Hide model cards';

export const NOT_ENOUGH_DATA = 'Not enough data';

export const WIDE_RANGE_TAG = 'Wide range';

export const LOW_CONFIDENCE_TAG = 'Low confidence';

export const TECHNICAL_DETAIL = 'Technical detail';

export const TIER_LABEL = {
  strong: 'Strong fit',
  decent: 'Decent fit',
  poor: 'Poor fit',
} as const;

/** Decent card sentence. A run that only touches 50 has not crossed the midpoint. */
export const DECENT_SENTENCE =
  'In at least one test run, this model scored at or below the midpoint on a trait you care about.';

/** Secondary line under the Decent chip when every blocking low is exactly 50. */
export const CLOSE_CALL_NOTE =
  'Close call: one or more test runs landed exactly on the midpoint.';

export const LEGEND_ZONE = 'Where we want the model';

export const LEGEND_BAND = 'Lowest to highest run';

export const LEGEND_MEAN = 'Average';
