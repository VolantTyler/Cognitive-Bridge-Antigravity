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

/** Score-file label, shown verbatim. */
export const VERBATIM_HYPOTHESIS_LABEL = HYPOTHESIS_LABEL;

export const EXPLAINER =
  "This matching approach is our best research-based guess and hasn't been tested with real users yet.";

export const LEADERBOARD_LINK = 'See all benchmark scores';

export const MODEL_SCORES_LINK = 'See all scores for this model';

export const LOAD_ERROR = "We couldn't load benchmark scores.";

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

export const LEGEND_ZONE = 'Where we want the model';

export const LEGEND_BAND = 'Lowest to highest run';

export const LEGEND_MEAN = 'Average';
