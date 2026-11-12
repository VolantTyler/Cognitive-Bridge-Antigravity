/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Tailor from '../Tailor';
import type { OceanScores } from '../../types';

const base: OceanScores = {
  openness: 50,
  conscientiousness: 50,
  extroversion: 50,
  agreeableness: 50,
  neuroticism: 50,
};

const NOTICE = 'Your Agreeableness and Conscientiousness scores may overlap, so read them together.';

describe('Tailor overlap notice', () => {
  it('shows plain overlap copy when Agreeableness and Conscientiousness are both above 70', () => {
    render(
      <Tailor
        scores={{ ...base, agreeableness: 71, conscientiousness: 71 }}
        onNext={() => undefined}
      />,
    );

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByText(/A↔C|bleed|Compassion|Industriousness/)).not.toBeInTheDocument();
  });

  it('stays hidden unless both scores are above 70', () => {
    const { rerender } = render(
      <Tailor
        scores={{ ...base, agreeableness: 90, conscientiousness: 70 }}
        onNext={() => undefined}
      />,
    );
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();

    rerender(
      <Tailor
        scores={{ ...base, agreeableness: 70, conscientiousness: 90 }}
        onNext={() => undefined}
      />,
    );
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
