import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OceanCards from '../OceanCards';
import { OceanScores } from '../../types';

const scoresWithDirectives: OceanScores = {
  openness: 50,
  conscientiousness: 15,
  extroversion: 50,
  agreeableness: 90,
  neuroticism: 50,
};

describe('OceanCards strategy badge layout', () => {
  it('renders trait labels without strategy badges in the header row', () => {
    render(<OceanCards scores={scoresWithDirectives} />);

    expect(screen.getByText('Conscientiousness')).toBeInTheDocument();
    expect(screen.getByText('Agreeableness')).toBeInTheDocument();

    const conscientiousnessHeader = screen.getByText('Conscientiousness').closest('div');
    expect(conscientiousnessHeader?.textContent).not.toMatch(/Compensatory|Congruent/);
  });

  it('places strategy badges below the score bar at every breakpoint', () => {
    render(<OceanCards scores={scoresWithDirectives} />);

    const badges = screen.getAllByTestId('ocean-strategy-badge');
    expect(badges).toHaveLength(2);

    for (const badge of badges) {
      expect(badge.className).toMatch(/inline-flex/);
      expect(badge.className).not.toMatch(/md:hidden|md:inline-flex/);
      const card = badge.parentElement;
      const bar = card?.querySelector('.h-2');
      expect(bar).toBeTruthy();
      expect(bar!.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const score = card?.querySelector('.text-3xl');
      expect(score).toBeTruthy();
      expect(score!.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    expect(badges[0].querySelector('button')?.textContent).toBe('Compensatory');
    expect(badges[1].querySelector('button')?.textContent).toBe('Congruent');
  });

  it('keeps strategy badge tooltips accessible below the badge', () => {
    render(<OceanCards scores={scoresWithDirectives} />);

    const badge = screen.getAllByTestId('ocean-strategy-badge')[0];
    const button = badge.querySelector('button');

    expect(button).toHaveAttribute('aria-describedby');
    const tooltip = badge.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toMatch(/Need-complementarity/i);
    expect(tooltip?.className).toMatch(/top-full/);
    expect(tooltip?.className).toMatch(/strategy-badge-tooltip/);
  });
});
